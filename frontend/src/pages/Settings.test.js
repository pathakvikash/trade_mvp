import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import axios from 'axios';
import Settings from './Settings';
import useUserStore from '../store/userStore';
import { clearModelCache } from './settings/AiSection';

// Router mock: the location and route param are mutable so each test picks its section.
const mockRoute = { splat: 'profile' };
jest.mock('react-router-dom', () => ({
  NavLink: ({ to, className, children }) => {
    const active = `/settings/${mockRoute.splat.split('/')[0]}` === to;
    return <a href={to} aria-current={active ? 'page' : undefined} className={className({ isActive: active })}>{children}</a>;
  },
  Navigate: ({ to }) => <i data-testid="redirect" data-to={to} />,
  useParams: () => ({ '*': mockRoute.splat }),
  useNavigate: () => jest.fn(),
}), { virtual: true });
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() } }));
jest.mock('../components/ui/PairPicker', () => () => <span />);

const USER = {
  _id: 'u1', username: 'ana', email: 'ana@example.com', name: 'Ana Lopez', role: 'user', createdAt: '2026-01-02T00:00:00Z',
  profile: { bio: '', country: 'ES', timezone: 'Europe/Madrid', avatar: null },
  preferences: { defaultSymbol: 'ETHUSDT', defaultTimeframe: '5m', alertToasts: true, alertSound: false, tickerBar: true },
  ai: { provider: 'openai', model: null, systemPrompt: '', temperature: null, length: 'normal', includePortfolio: false, providers: { openai: { model: 'gpt-4o', keySet: false, keyLast4: null } } },
  security: { passwordSet: true, googleLinked: false },
};
const ME = {
  success: true,
  user: USER,
  aiModels: [{ id: 'small', label: 'Small', note: 'Cheap' }],
  aiProviders: [{ id: 'openai', label: 'OpenAI', modelSuggestions: ['gpt-4o'], needsBaseUrl: false }],
  aiDefaultPrompt: 'Be helpful.',
  aiServerRules: 'Rules text.',
};

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });

const mount = async (splat) => {
  mockRoute.splat = splat;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(<Settings />); });
};

beforeEach(() => {
  localStorage.clear();
  axios.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/api/ai/status') ? { provider: 'openai', configured: true } : ME }));
  useUserStore.setState({ token: 't', user: USER });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

const click = (el) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
const type = (el, value) => act(async () => {
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const byText = (sel, text) => [...container.querySelectorAll(sel)].find((b) => b.textContent.trim() === text);

test('sidebar has four links to /settings/<id> and marks the active one', async () => {
  await mount('ai');
  const links = [...container.querySelectorAll('nav a')];
  expect(links.map((a) => a.getAttribute('href'))).toEqual(['/settings/profile', '/settings/ai', '/settings/preferences', '/settings/security']);
  expect(links.filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.textContent)).toEqual(['AI & model']);
});

test('/settings redirects to the persisted section, unknown sections to profile', async () => {
  localStorage.setItem('tm:v1:u1:settings.section', JSON.stringify('security'));
  await mount('');
  expect(container.querySelector('[data-testid="redirect"]').dataset.to).toBe('/settings/security');
  act(() => root.unmount());
  container.remove();
  await mount('nope');
  expect(container.querySelector('[data-testid="redirect"]').dataset.to).toBe('/settings/profile');
});

test('profile: Save bar appears only when dirty', async () => {
  await mount('profile');
  expect(byText('button', 'Save')).toBeUndefined();
  await type(container.querySelector('#set-name'), 'Ana Maria');
  expect(byText('button', 'Save')).toBeDefined();
  expect(container.textContent).toContain('Unsaved changes');
});

const editBtn = () => container.querySelector('button[aria-label="Edit photo"]');
const grid = () => container.querySelector('[role="radiogroup"]');
const openEmojiGrid = async () => {
  await click(editBtn());
  await click(byText('[role="dialog"] button', 'Choose emoji'));
};

test('avatar: emoji grid is hidden by default and opens only after Edit photo > Choose emoji', async () => {
  await mount('profile');
  expect(grid()).toBeNull();
  expect(editBtn().getAttribute('aria-expanded')).toBe('false');
  await click(editBtn());
  expect(grid()).toBeNull();
  const items = [...container.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent.trim());
  expect(items).toEqual(['Upload image', 'Choose emoji']); // no Remove without an avatar
  await click(byText('[role="dialog"] button', 'Choose emoji'));
  expect(grid()).not.toBeNull();
});

test('avatar: choosing an emoji PUTs it and closes the popover; Remove DELETEs', async () => {
  axios.put.mockResolvedValue({ data: { success: true, user: { ...USER, profile: { ...USER.profile, avatar: 'emoji:🦊' } } } });
  axios.delete.mockResolvedValue({ data: { success: true, user: USER } });
  await mount('profile');
  await openEmojiGrid();
  await click(container.querySelector('[role="radio"][aria-label="Emoji 🦊"]'));
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me/avatar'), { avatar: 'emoji:🦊' }, expect.anything());
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(editBtn());
  await openEmojiGrid();
  expect(container.querySelector('[role="radio"][aria-label="Emoji 🦊"]').getAttribute('aria-checked')).toBe('true');
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  await click(editBtn());
  await click(byText('[role="dialog"] button', 'Remove'));
  expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me/avatar'), expect.anything());
});

test('avatar: Esc and click outside close the popover and return focus to Edit photo', async () => {
  await mount('profile');
  await openEmojiGrid();
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(editBtn());
  await click(editBtn());
  expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => { document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(axios.put).not.toHaveBeenCalled();
});

test('API key is never displayed or stored: input cleared, only ••••last4 shown', async () => {
  const KEY = 'sk-super-secret-key-123456';
  axios.put.mockResolvedValue({ data: { provider: 'openai', keySet: true, keyLast4: '3456' } });
  await mount('ai');
  const input = container.querySelector('#ai-key');
  expect(input.type).toBe('password');
  expect(input.autocomplete).toBe('off');
  expect(container.querySelector('[data-testid="key-not-set"]').textContent).toBe('Key: not set');
  await type(input, KEY);
  await act(async () => { container.querySelector('#ai-key').form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(axios.put).toHaveBeenCalledWith(expect.stringContaining('/api/ai/keys/openai'), { apiKey: KEY }, expect.anything());
  expect(container.querySelector('#ai-key')).toBeNull();
  expect(container.textContent).toContain('••••3456');
  expect(container.querySelector('[data-testid="key-not-set"]')).toBeNull();
  expect(container.innerHTML).not.toContain(KEY);
  const stored = Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('|');
  expect(stored).not.toContain(KEY);
  expect(JSON.stringify(useUserStore.getState())).not.toContain(KEY);
});

test('LM Studio: no key field, default base URL placeholder, Fetch models fills the model, base URL and model save', async () => {
  const LM = { id: 'lmstudio', label: 'LM Studio (local)', modelSuggestions: ['qwen/qwen3.5-9b'], needsBaseUrl: true, needsKey: false, defaultBaseUrl: 'http://localhost:1234/v1' };
  const lmUser = { ...USER, ai: { ...USER.ai, provider: 'lmstudio', providers: { ...USER.ai.providers, lmstudio: { model: '', baseUrl: '', keySet: false, keyLast4: null } } } };
  useUserStore.setState({ token: 't', user: lmUser });
  axios.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/api/ai/status') ? { provider: 'lmstudio', configured: true }
    : url.endsWith('/api/ai/lmstudio/models') ? { models: ['qwen/qwen3.5-9b', 'other/model'] }
      : { ...ME, user: lmUser, aiProviders: [...ME.aiProviders, LM] } }));
  await mount('ai');
  expect(container.querySelector('#ai-key')).toBeNull();
  expect(container.querySelector('[data-testid="key-not-set"]')).toBeNull();
  expect(container.querySelector('[data-testid="no-key-needed"]').textContent).toBe('No key needed');
  expect(container.querySelector('#ai-base-url').placeholder).toBe('http://localhost:1234/v1');
  expect(container.querySelector('#ai-model-text').placeholder).toBe('qwen/qwen3.5-9b');

  await click(byText('button', 'Fetch models'));
  expect(axios.get).toHaveBeenCalledWith(expect.stringContaining('/api/ai/lmstudio/models'), expect.anything());
  await click(byText('[data-testid="lm-models"] button', 'other/model'));
  expect(container.querySelector('#ai-model-text').value).toBe('other/model');

  // editing the base URL disables Fetch models until it is saved (the route reads the saved URL)
  await type(container.querySelector('#ai-base-url'), 'http://127.0.0.1:1234/v1');
  expect(byText('button', 'Fetch models').disabled).toBe(true);
  axios.patch.mockResolvedValue({ data: { user: lmUser } });
  await click(byText('button', 'Save'));
  expect(axios.patch.mock.calls[0][1].ai).toMatchObject({ provider: 'lmstudio', providers: { lmstudio: { model: 'other/model', baseUrl: 'http://127.0.0.1:1234/v1' } } });
});

test('LM Studio: Test connection runs without a key and shows the reasoning-budget error readably', async () => {
  const lmUser = { ...USER, ai: { ...USER.ai, provider: 'lmstudio', providers: { lmstudio: { model: '', baseUrl: '', keySet: false, keyLast4: null } } } };
  useUserStore.setState({ token: 't', user: lmUser });
  axios.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/api/ai/status') ? { provider: 'lmstudio', configured: true } : { ...ME, user: lmUser, aiProviders: [] } }));
  axios.post.mockRejectedValue({ response: { status: 502, data: { error: 'ai_reasoning_budget' } } });
  await mount('ai');
  await click(byText('button', 'Test connection'));
  expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/ai/test'), { provider: 'lmstudio' }, expect.anything());
  expect(container.querySelector('[role="alert"]').textContent).toMatch(/whole budget thinking; raise the token budget/);
});

test('preferences: toggling the ticker bar and saving PATCHes only that key and updates the store', async () => {
  axios.patch.mockResolvedValue({ data: { success: true, user: { ...USER, preferences: { ...USER.preferences, tickerBar: false } } } });
  await mount('preferences');
  await click(container.querySelector('#pref-ticker'));
  await click(byText('button', 'Save'));
  expect(axios.patch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me'), { preferences: { tickerBar: false } }, expect.anything());
  expect(useUserStore.getState().user.preferences.tickerBar).toBe(false);
});

test('security: delete stays disabled until the email matches', async () => {
  await mount('security');
  const del = byText('button', 'Delete my account');
  expect(del.disabled).toBe(true);
  await type(container.querySelector('#del-email'), 'ANA@example.com');
  expect(byText('button', 'Delete my account').disabled).toBe(false);
});

test('preferences: trade defaults (confirm close, leverage, order type) are editable and PATCH only what changed', async () => {
  axios.patch.mockResolvedValue({ data: { success: true, user: USER } });
  await mount('preferences');
  const sw = container.querySelector('#pref-confirm-close');
  expect(sw.getAttribute('aria-checked')).toBe('true'); // default on
  await click(sw);
  const lev = container.querySelector('#pref-leverage');
  expect(lev.value).toBe('10');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(lev, '25');
    lev.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click(byText('[aria-label="Default order type"] button', 'Limit'));
  await click(byText('button', 'Save'));
  expect(axios.patch).toHaveBeenCalledWith(expect.stringContaining('/api/auth/me'),
    { preferences: { confirmClose: false, defaultLeverage: 25, defaultOrderType: 'limit' } }, expect.anything());
});

test('mobile pill row: the active pill is scrolled into view (centered), instantly under reduced motion', async () => {
  const spy = jest.fn();
  Element.prototype.scrollIntoView = spy;
  try {
    await mount('security');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.instances[0].textContent).toBe('Security');
    expect(spy.mock.calls[0][0]).toMatchObject({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    act(() => root.unmount());
    container.remove();
    document.documentElement.dataset.reduceMotion = 'true';
    await mount('ai');
    expect(spy.mock.calls[1][0]).toMatchObject({ inline: 'center', behavior: 'auto' });
  } finally {
    delete Element.prototype.scrollIntoView;
    delete document.documentElement.dataset.reduceMotion;
  }
});

describe('AI provider: load models', () => {
  const KEY = 'sk-or-test-PASTED-1234';
  const LIST = [
    { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5', contextLength: 200000, pricePerMTokIn: 3, pricePerMTokOut: 15 },
    { id: 'meta/llama:free', name: 'Llama', free: true },
  ];
  const orUser = (keySet, model = 'anthropic/claude-sonnet-5.5') => ({ ...USER, ai: { ...USER.ai, provider: 'openrouter', providers: { openrouter: { model, keySet, keyLast4: keySet ? '1234' : null } } } });
  const setup = (u) => {
    useUserStore.setState({ token: 't', user: u });
    axios.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/api/ai/status') ? { provider: 'openrouter', configured: true } : { ...ME, user: u, aiProviders: [{ id: 'openrouter', label: 'OpenRouter', modelSuggestions: ['x/y'], needsBaseUrl: false }] } }));
  };
  beforeEach(() => clearModelCache());
  afterEach(() => clearModelCache());
  const loadBtn = () => byText('button', 'Load models');

  test('disabled until a valid key is typed or a saved key exists', async () => {
    setup(orUser(false));
    await mount('ai');
    expect(loadBtn().disabled).toBe(true);
    await type(container.querySelector('#ai-key'), 'short');
    expect(loadBtn().disabled).toBe(true);
    await type(container.querySelector('#ai-key'), KEY);
    expect(loadBtn().disabled).toBe(false);
    act(() => root.unmount()); container.remove();
    setup(orUser(true));
    await mount('ai');
    expect(loadBtn().disabled).toBe(false);
  });

  test('typed key: sends it once to /models, shows the spinner while loading, fills the picker, key never rendered or stored', async () => {
    setup(orUser(false));
    let resolve;
    axios.post.mockReturnValue(new Promise((r) => { resolve = r; }));
    await mount('ai');
    await type(container.querySelector('#ai-key'), KEY);
    await click(loadBtn());
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/ai/models'), { provider: 'openrouter', apiKey: KEY }, expect.anything());
    expect(loadBtn().disabled).toBe(true);
    expect(loadBtn().querySelector('svg')).not.toBeNull();
    await act(async () => { resolve({ data: { models: LIST } }); });
    expect(container.textContent).toContain('2 models loaded.');
    const combo = container.querySelector('#ai-model-text');
    expect(combo.getAttribute('role')).toBe('combobox');
    expect(combo.value).toBe('anthropic/claude-sonnet-5.5'); // saved model preselected
    expect(container.querySelector('#ai-key').type).toBe('password');
    expect(container.textContent).not.toContain(KEY); // only the masked password field holds it
    expect(Object.keys(localStorage).map((k) => localStorage.getItem(k)).join('|')).not.toContain(KEY);
    expect(JSON.stringify(useUserStore.getState())).not.toContain(KEY);
    expect(container.textContent).toContain('sent to our server only to ask the provider for its model list');
  });

  test('picking a model sets the draft and saves it; the custom-id path saves a typed id', async () => {
    setup(orUser(true));
    axios.post.mockResolvedValue({ data: { models: LIST } });
    axios.patch.mockResolvedValue({ data: { user: orUser(true) } });
    await mount('ai');
    await click(loadBtn());
    expect(axios.post).toHaveBeenCalledWith(expect.stringContaining('/api/ai/models'), { provider: 'openrouter' }, expect.anything()); // saved key: no apiKey in the body
    const combo = container.querySelector('#ai-model-text');
    await act(async () => { combo.focus(); combo.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    await act(async () => { container.querySelectorAll('[role="option"]')[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(container.querySelector('#ai-model-text').value).toBe('meta/llama:free');
    await click(byText('button', 'Save'));
    expect(axios.patch.mock.calls[0][1].ai.providers.openrouter.model).toBe('meta/llama:free');
    // custom id
    const c2 = container.querySelector('#ai-model-text');
    await act(async () => { c2.focus(); c2.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); });
    await type(c2, 'my/custom:9');
    await act(async () => { c2.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(container.querySelector('#ai-model-text').value).toBe('my/custom:9');
    expect(container.textContent).toContain('is not in the loaded list');
  });

  test.each([
    ['ai_auth_failed', /provider rejected the key/],
    ['ai_rate_limited', /rate limiting/],
    ['ai_unreachable', /Could not reach the provider/],
    ['ai_bad_response', /format we do not recognise/],
    ['rate_limited', /Too many requests/],
  ])('error %s is shown inline in plain words', async (code, re) => {
    setup(orUser(true));
    axios.post.mockRejectedValue({ response: { status: 502, data: { error: code } } });
    await mount('ai');
    await click(loadBtn());
    expect(container.querySelector('[role="alert"]').textContent).toMatch(re);
    expect(container.querySelector('#ai-model-text').getAttribute('role')).toBeNull(); // still the plain input
    expect(loadBtn().disabled).toBe(false);
  });

  test('a successful Test also fills the list (no second request)', async () => {
    setup(orUser(true));
    axios.post.mockImplementation((url) => Promise.resolve({ data: url.endsWith('/api/ai/test') ? { ok: true, model: 'm', latencyMs: 5, models: LIST } : {} }));
    await mount('ai');
    await click(byText('button', 'Test connection'));
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(container.querySelector('#ai-model-text').getAttribute('role')).toBe('combobox');
    expect(container.textContent).toContain('2 models loaded.');
  });

  test('the loaded list is remembered in memory when the section is reopened, without a request', async () => {
    setup(orUser(true));
    axios.post.mockResolvedValue({ data: { models: LIST } });
    await mount('ai');
    await click(loadBtn());
    act(() => root.unmount()); container.remove();
    axios.post.mockClear();
    await mount('ai');
    expect(container.querySelector('#ai-model-text').getAttribute('role')).toBe('combobox');
    expect(axios.post).not.toHaveBeenCalled();
  });
});
