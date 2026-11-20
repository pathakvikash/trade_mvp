const os = require('os');
const { EventEmitter } = require('events');
const cp = require('child_process');

jest.mock('child_process', () => ({ ...jest.requireActual('child_process'), spawn: jest.fn() }));
const ai = require('../services/aiService');

// Fake child process. `hang` never exits; `error` emits a spawn error (e.g. ENOENT); otherwise stdout then close(code).
function fakeChild({ stdout = '', code = 0, error = null, hang = false } = {}) {
  const c = new EventEmitter();
  c.stdout = new EventEmitter();
  c.stderr = new EventEmitter();
  c.stdin = Object.assign(new EventEmitter(), { end: jest.fn() });
  c.kill = jest.fn();
  setImmediate(() => {
    if (hang) return;
    if (error) return c.emit('error', error);
    c.stdout.emit('data', Buffer.from(stdout));
    c.emit('close', code);
  });
  return c;
}

// `auth status` gets a logged-in probe; each `-p` run takes the next scripted result.
function scriptRuns(...runs) {
  cp.spawn.mockImplementation((bin, args) => {
    if (args[0] === 'auth') return fakeChild({ stdout: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) });
    return fakeChild(runs.shift());
  });
}
const ok = (result) => ({ stdout: JSON.stringify({ type: 'result', is_error: false, stop_reason: 'end_turn', result }) });
const runCalls = () => cp.spawn.mock.calls.filter(([, a]) => a[0] === '-p');

const draft = { parsed: true, reason: '', symbol: 'BTCUSDT', metric: 'price', op: 'above', value: 70000, note: 'BTC above 70k' };
const ENV_KEYS = ['NODE_ENV', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AI_PROVIDER', 'ANTHROPIC_TEST_MARKER', 'KEEP_ME_TEST'];
const saved = {};

beforeAll(() => { ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
beforeEach(() => {
  process.env.NODE_ENV = 'development';
  ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'AI_PROVIDER', 'ANTHROPIC_TEST_MARKER', 'KEEP_ME_TEST'].forEach((k) => { delete process.env[k]; });
  ai._test.resetCli();
  cp.spawn.mockReset();
});
afterEach(() => {
  ENV_KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
});

test('runCli returns the result text and passes the CLI flags with no shell in os.tmpdir()', async () => {
  scriptRuns(ok('hello there'));
  await expect(ai.runCli({ system: 'S', user: 'U', model: 'claude-haiku-5-5', effort: 'low' })).resolves.toBe('hello there');
  const [, args, opts] = runCalls()[0];
  expect(args).toEqual(expect.arrayContaining(['-p', '--output-format', 'json', '--model', 'claude-haiku-5-5', '--tools', '', '--effort', 'low']));
  expect(opts).toMatchObject({ shell: false, cwd: os.tmpdir() });
});

test('parseAlert via the CLI: the JSON object in the text is extracted and zod-validated', async () => {
  scriptRuns(ok('Sure! ```json\n' + JSON.stringify(draft) + '\n```'));
  await expect(ai.parseAlert('alert me when BTC goes above 70000', 'claude-haiku-5-5')).resolves.toEqual(draft);
  const [, args] = runCalls()[0];
  expect(args.join(' ')).toContain('"symbol"'); // schema is rendered into the system prompt
});

test('invalid JSON is retried once and the second valid object is used', async () => {
  scriptRuns(ok('I cannot produce JSON right now'), ok(JSON.stringify(draft)));
  await expect(ai.parseAlert('alert me when BTC goes above 70000', 'claude-haiku-5-5')).resolves.toEqual(draft);
  expect(runCalls()).toHaveLength(2);
});

test('two invalid answers throw a 422 ai_invalid_output', async () => {
  scriptRuns(ok('nope'), ok('{"parsed": "yes"}'));
  await expect(ai.parseAlert('alert me when BTC goes above 70000', 'claude-haiku-5-5')).rejects.toMatchObject({ status: 422, code: 'ai_invalid_output' });
  expect(runCalls()).toHaveLength(2);
});

test('a run that never exits is killed at the 120s timeout and maps to 502 ai_unreachable', async () => {
  jest.useFakeTimers();
  try {
    cp.spawn.mockImplementation(() => fakeChild({ hang: true }));
    const p = ai.runCli({ system: 'S', user: 'U', model: 'claude-haiku-5-5' });
    const settled = expect(p).rejects.toMatchObject({ status: 502, code: 'ai_unreachable' });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    await jest.advanceTimersByTimeAsync(120e3);
    await settled;
    expect(cp.spawn.mock.results[0].value.kill).toHaveBeenCalledWith('SIGKILL');
  } finally {
    jest.useRealTimers();
  }
});

test('is_error from the CLI throws 502 ai_upstream_error', async () => {
  scriptRuns({ stdout: JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: 'detail' }) });
  await expect(ai.runCli({ system: 'S', user: 'U', model: 'claude-haiku-5-5' })).rejects.toMatchObject({ status: 502, code: 'ai_upstream_error' });
});

test('non-JSON stdout throws 502 ai_bad_response', async () => {
  scriptRuns({ stdout: 'not json at all' });
  await expect(ai.runCli({ system: 'S', user: 'U', model: 'claude-haiku-5-5' })).rejects.toMatchObject({ status: 502, code: 'ai_bad_response' });
});

test('ENOENT: cliAvailable is false and runCli maps to 503 ai_not_configured', async () => {
  cp.spawn.mockImplementation(() => fakeChild({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }));
  await expect(ai.cliAvailable()).resolves.toBe(false);
  ai._test.resetCli();
  cp.spawn.mockImplementation(() => fakeChild({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }));
  await expect(ai.runCli({ system: 'S', user: 'U', model: 'claude-haiku-5-5' })).rejects.toMatchObject({ status: 503, code: 'ai_not_configured' });
});

test('cliAvailable is true for a logged-in claude and the probe is cached for 60s', async () => {
  scriptRuns();
  await expect(ai.cliAvailable()).resolves.toBe(true);
  await expect(ai.cliAvailable()).resolves.toBe(true);
  expect(cp.spawn.mock.calls.filter(([, a]) => a[0] === 'auth')).toHaveLength(1);
});

test('cliAvailable is false outside development, with an API key or auth token, or with AI_PROVIDER=api, and never spawns', async () => {
  process.env.NODE_ENV = 'production';
  await expect(ai.cliAvailable()).resolves.toBe(false);
  process.env.NODE_ENV = 'test';
  await expect(ai.cliAvailable()).resolves.toBe(false);
  process.env.NODE_ENV = 'development';
  process.env.ANTHROPIC_API_KEY = 'sk-test-dummy';
  await expect(ai.cliAvailable()).resolves.toBe(false);
  delete process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_AUTH_TOKEN = 'dummy';
  await expect(ai.cliAvailable()).resolves.toBe(false);
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  process.env.AI_PROVIDER = 'api';
  await expect(ai.cliAvailable()).resolves.toBe(false);
  expect(cp.spawn).not.toHaveBeenCalled();
});

test('the prompt goes to stdin, never argv, and the child env has no ANTHROPIC_* vars', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-test-dummy';
  process.env.ANTHROPIC_TEST_MARKER = 'leak-me';
  process.env.KEEP_ME_TEST = 'yes';
  scriptRuns(ok('done'));
  await ai.runCli({ system: 'SYS', user: 'PROMPT-XYZ-123', model: 'claude-haiku-5-5' });
  const [, args, opts] = runCalls()[0];
  expect(args.join(' ')).not.toContain('PROMPT-XYZ-123');
  expect(cp.spawn.mock.results[0].value.stdin.end).toHaveBeenCalledWith('PROMPT-XYZ-123');
  expect(Object.keys(opts.env).filter((k) => k.startsWith('ANTHROPIC_'))).toEqual([]);
  expect(opts.env.KEEP_ME_TEST).toBe('yes');
});
