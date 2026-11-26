// Bring-your-own-key AI providers: one complete() over each provider's documented REST API, plus the SSRF guard for the
// user-supplied custom base URL. Plain node https/http, no SDKs, no redirects (https.request never follows them, and a
// 3xx is treated as an upstream error). Upstream error text is logged (warn, 300 chars, the key masked out) and returned
// to the client only for the local provider, which has no key to echo.
const dns = require('dns');
const net = require('net');
const http = require('http');
const https = require('https');
const logger = require('../config/logger');

// Lives here (not aiService) so this file has no dependency on aiService and there is no require cycle.
// detail: short upstream message safe to show the user (local provider only).
class AiError extends Error {
    constructor(status, code, detail) { super(code); this.status = status; this.code = code; if (detail) this.detail = detail; }
}

const PROVIDERS = [
    { id: 'anthropic', label: 'Anthropic', modelSuggestions: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], needsBaseUrl: false, docsNote: 'Create a key in the Anthropic Console. Calls are billed to your account.' },
    { id: 'openai', label: 'OpenAI', modelSuggestions: ['gpt-5', 'gpt-5-mini'], needsBaseUrl: false, docsNote: 'Create a key in the OpenAI dashboard. Calls are billed to your account.' },
    { id: 'gemini', label: 'Google Gemini', modelSuggestions: ['gemini-2.5-pro', 'gemini-2.5-flash'], needsBaseUrl: false, docsNote: 'Create a key in Google AI Studio.' },
    { id: 'openrouter', label: 'OpenRouter', modelSuggestions: ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-5.5', 'openai/gpt-5-mini'], needsBaseUrl: false, docsNote: 'One key for many models; use the provider/model id.' },
    { id: 'custom', label: 'Custom (OpenAI-compatible)', modelSuggestions: [], needsBaseUrl: true, docsNote: 'Any public HTTPS endpoint that speaks the OpenAI chat completions API. Private and local addresses are blocked.' },
    // Local models through LM Studio's OpenAI-compatible server. No key; loopback only (see checkLocalUrl).
    { id: 'lmstudio', label: 'LM Studio (local)', modelSuggestions: ['qwen/qwen3.5-9b'], needsBaseUrl: true, needsKey: false, defaultBaseUrl: 'http://localhost:1234/v1', docsNote: 'Runs a model in LM Studio on this machine. No key needed. Only localhost addresses, and only on a development server or with ALLOW_LOCAL_LLM=true.' },
];
const PROVIDER_IDS = PROVIDERS.map((p) => p.id);
const DEFAULT_MODELS = { anthropic: 'claude-sonnet-5-5', openai: 'gpt-5-mini', gemini: 'gemini-2.5-flash', openrouter: 'anthropic/claude-sonnet-5.5', custom: '' };
// LM Studio defaults are read per call so .env changes need only a restart, not a code change.
const defaultModel = (provider) => (provider === 'lmstudio' ? process.env.LMSTUDIO_MODEL || 'qwen/qwen3.5-9b' : DEFAULT_MODELS[provider] || '');
const lmstudioBaseUrl = (saved) => saved || process.env.LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
const MODEL_ID_RE = /^[A-Za-z0-9._:/@-]{1,100}$/;

// ---- SSRF guard ----
const v4Blocked = (o) => {
    const [a, b, c] = o;
    return a === 0 || a === 10 || a === 127 || a >= 224
        || (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64/10
        || (a === 169 && b === 254) // link-local incl. cloud metadata 169.254.169.254
        || (a === 172 && b >= 16 && b <= 31)
        || (a === 192 && b === 168)
        || (a === 192 && b === 0 && c === 0) // IETF protocol assignments
        || (a === 198 && (b === 18 || b === 19)); // benchmarking
};

// IPv6 text -> 16 bytes (handles '::', an embedded IPv4 tail and a zone id), or null.
function v6Bytes(ip) {
    let s = ip.split('%')[0].toLowerCase();
    const tail = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    if (tail) {
        const o = tail[2].split('.').map(Number);
        if (o.some((x) => x > 255)) return null;
        s = `${tail[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const parts = s.split('::');
    if (parts.length > 2) return null;
    const head = parts[0] ? parts[0].split(':') : [];
    const rest = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
    const fill = parts.length === 2 ? 8 - head.length - rest.length : 0;
    const groups = [...head, ...Array(Math.max(0, fill)).fill('0'), ...rest];
    if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
    return groups.flatMap((g) => { const n = parseInt(g, 16); return [n >> 8, n & 255]; });
}

// True for loopback, private, CGNAT, link-local, unspecified, multicast and reserved addresses (v4 and v6, including
// v4 embedded in mapped / NAT64 / 6to4 forms). Unparseable input is blocked. ponytail: Teredo (2001::/32) is not decoded.
function isBlockedIp(ip) {
    const fam = net.isIP(ip);
    if (fam === 4) return v4Blocked(ip.split('.').map(Number));
    if (fam !== 6) return true;
    const b = v6Bytes(ip);
    if (!b) return true;
    if (b.every((x) => x === 0)) return true; // ::
    if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1
    if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
    if (b[0] === 0xfe && (b[1] & 0xc0) >= 0x80) return true; // fe80::/10 link-local, fec0::/10 site-local
    if (b[0] === 0xff) return true; // multicast
    const first10Zero = b.slice(0, 10).every((x) => x === 0);
    if (first10Zero && b[10] === 0xff && b[11] === 0xff) return v4Blocked(b.slice(12)); // ::ffff:a.b.c.d
    if (b.slice(0, 12).every((x) => x === 0)) return v4Blocked(b.slice(12)); // ::a.b.c.d (deprecated compatible form)
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return v4Blocked(b.slice(12)); // 64:ff9b::/96
    if (b[0] === 0x20 && b[1] === 0x02) return v4Blocked(b.slice(2, 6)); // 6to4
    return false;
}

const bad = () => new AiError(400, 'ai_bad_base_url');

// Syntactic check (also used by the PATCH validator). Returns the parsed URL or throws AiError(400, 'ai_bad_base_url').
// The DNS half is guardedLookup, which runs at connect time.
function checkBaseUrl(raw) {
    let u;
    try { u = new URL(String(raw)); } catch (e) { throw bad(); }
    // http only on a local development server; any other NODE_ENV (production, test, unset) needs https.
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && process.env.NODE_ENV === 'development')) throw bad();
    if (u.username || u.password || u.search || u.hash) throw bad();
    // '//' or a backslash in the path makes `new URL(path, base)` treat it as protocol-relative (https://x//127.0.0.1 -> host 127.0.0.1)
    if (u.pathname.includes('//') || String(raw).includes('\\')) throw bad();
    let host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (!host) throw bad();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host === 'metadata.google.internal') throw bad();
    if (net.isIP(host) && isBlockedIp(host)) throw bad();
    return u;
}

// LM Studio base URL: the opposite of checkBaseUrl. Loopback ONLY, by literal host text (localhost, 127.0.0.1, [::1],
// optional port), so decimal/hex/mapped forms, userinfo (http://localhost@evil) and names like 127.0.0.1.nip.io all fail.
// A user-controlled loopback URL on a shared server is SSRF, so it is off in production unless ALLOW_LOCAL_LLM=true.
const localAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_LLM === 'true';
const LOCAL_HOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?(\/[^?#\\]*)?$/i;
function checkLocalUrl(raw) {
    if (!localAllowed()) throw new AiError(400, 'ai_local_disabled');
    const s = String(raw);
    let u;
    try { u = new URL(s); } catch (e) { throw bad(); }
    if (!LOCAL_HOST_RE.test(s) || u.username || u.password || u.search || u.hash || u.pathname.includes('//')) throw bad();
    if (!['localhost', '127.0.0.1', '[::1]'].includes(u.hostname.toLowerCase())) throw bad(); // parser agrees with the regex
    return u;
}
const isLoopback = (ip) => net.isIPv4(ip) ? ip.split('.')[0] === '127' : (v6Bytes(ip) || []).every((x, i) => x === (i === 15 ? 1 : 0));
// `localhost` must resolve to loopback and nothing else (a hosts-file entry cannot point it elsewhere).
function loopbackLookup(hostname, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
        if (err) return cb(err);
        if (!addrs || !addrs.length || !addrs.every((a) => isLoopback(a.address))) return cb(bad());
        if (opts && opts.all) return cb(null, addrs);
        cb(null, addrs[0].address, addrs[0].family);
    });
}

// Passed to http(s).request as `lookup`: resolves every address and refuses the connection if ANY is blocked. Doing it
// in the connect path (not before it) is what stops DNS rebinding. IP-literal hosts never reach lookup; checkBaseUrl
// covers them.
function guardedLookup(hostname, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addrs) => {
        if (err) return cb(err);
        if (!addrs || !addrs.length || addrs.some((a) => isBlockedIp(a.address))) return cb(bad());
        if (opts && opts.all) return cb(null, addrs);
        cb(null, addrs[0].address, addrs[0].family);
    });
}

// ---- HTTP ----
const TIMEOUT_MS = 60e3;
const LOCAL_TIMEOUT_MS = 180e3; // local models are slow: a 9B model on a laptop took ~45 s just to read a brief prompt and ~100 s in all
const MAX_BYTES = 1024 * 1024;

// bodyObj null -> GET. lookup: a guard hook (guardedLookup / loopbackLookup) or undefined for fixed public hosts.
function send(url, headers, bodyObj, { lookup, timeoutMs = TIMEOUT_MS, maxBytes = MAX_BYTES, overCode = 'ai_bad_response' } = {}) {
    return new Promise((resolve, reject) => {
        const data = bodyObj === null ? null : Buffer.from(JSON.stringify(bodyObj));
        const lib = url.protocol === 'http:' ? http : https;
        let settled = false;
        let timer = null;
        const done = (err, v) => { if (settled) return; settled = true; clearTimeout(timer); if (err) reject(err); else resolve(v); };
        const opts = {
            method: data ? 'POST' : 'GET', protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, path: url.pathname + url.search,
            headers: { ...(data ? { 'content-type': 'application/json', 'content-length': data.length } : {}), accept: 'application/json', ...headers },
        };
        if (lookup) opts.lookup = lookup;
        const req = lib.request(opts, (res) => {
            const chunks = [];
            let bytes = 0;
            res.on('data', (d) => {
                bytes += d.length;
                if (bytes > maxBytes) { req.destroy(); return done(new AiError(502, overCode)); }
                chunks.push(d);
            });
            res.on('end', () => done(null, { status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
            res.on('error', () => done(new AiError(502, 'ai_unreachable')));
        });
        timer = setTimeout(() => { req.destroy(); done(new AiError(502, 'ai_unreachable')); }, timeoutMs);
        if (timer.unref) timer.unref();
        req.on('error', (e) => done(e instanceof AiError ? e : new AiError(502, 'ai_unreachable')));
        if (data) req.end(data); else req.end();
    });
}

const textFrom = (parts) => parts.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('');
const chatText = (j) => {
    const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return typeof c === 'string' ? c : Array.isArray(c) ? textFrom(c) : '';
};
// Reasoning models (Qwen 3.5 in LM Studio) put thinking in reasoning_content, or inline as <think>...</think>; it counts
// against max_tokens and is never shown. All thinking and no answer is its own error so the user knows what to change.
const LOCAL_MIN_TOKENS = 1500;
const localMaxTokens = (n) => Math.max(n, parseInt(process.env.LMSTUDIO_MAX_TOKENS, 10) || 4096, LOCAL_MIN_TOKENS);
const stripThink = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/gi, '').trim();
const localText = (j) => {
    const text = stripThink(chatText(j));
    const m = j && j.choices && j.choices[0] && j.choices[0].message;
    if (!text && m && (m.reasoning_content || m.reasoning || /<think>/i.test(chatText(j)))) throw new AiError(502, 'ai_reasoning_budget');
    return text;
};
const noTemperature = (model) => /^(gpt-5|o\d)/.test(model); // ponytail: these OpenAI families reject non-default temperature; list by prefix, extend when others do

// Returns the model's text. Throws AiError (codes: ai_no_key, ai_no_model, ai_bad_base_url, ai_auth_failed,
// ai_rate_limited, ai_unreachable, ai_upstream_error, ai_bad_response, ai_local_disabled, ai_reasoning_budget,
// ai_context_too_small).
async function complete({ provider, apiKey, model, baseUrl, system, user, maxTokens = 1024, temperature = null }) {
    if (!PROVIDER_IDS.includes(provider)) throw new AiError(400, 'ai_bad_provider');
    const local = provider === 'lmstudio';
    if (!apiKey && !local) throw new AiError(400, 'ai_no_key');
    // OpenRouter ids use dots (anthropic/claude-sonnet-5.5); a saved hyphen form from the direct-Anthropic naming would 404.
    const m0 = model || defaultModel(provider);
    const m = provider === 'openrouter' ? m0.replace(/^(anthropic\/claude-[a-z]+)-(\d)-(\d)$/, '$1-$2.$3') : m0;
    if (!m || !MODEL_ID_RE.test(m)) throw new AiError(400, 'ai_no_model');
    const t = typeof temperature === 'number' ? temperature : undefined;
    const bearer = { authorization: `Bearer ${apiKey}` };
    const chat = (extra) => ({ model: m, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], ...extra });
    let url; let headers; let body; let parse; let lookup; let timeoutMs;
    if (provider === 'anthropic') {
        url = new URL('https://api.anthropic.com/v1/messages');
        headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
        body = { model: m, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }; // no temperature: these models run with thinking
        parse = (j) => textFrom((j && j.content) || []);
    } else if (provider === 'gemini') {
        url = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`);
        headers = { 'x-goog-api-key': apiKey }; // header, never the URL: URLs end up in logs
        body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens, ...(t === undefined ? {} : { temperature: t }) } };
        parse = (j) => ((j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts) || []).map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    } else if (provider === 'openai') {
        url = new URL('https://api.openai.com/v1/chat/completions');
        headers = bearer;
        body = chat({ max_completion_tokens: maxTokens, ...(t === undefined || noTemperature(m) ? {} : { temperature: t }) });
        parse = chatText;
    } else if (provider === 'openrouter') {
        url = new URL('https://openrouter.ai/api/v1/chat/completions');
        headers = bearer;
        body = chat({ max_tokens: maxTokens, ...(t === undefined ? {} : { temperature: t }) });
        parse = chatText;
    } else if (local) {
        url = endpoint(lmstudioBaseUrl(baseUrl), '/chat/completions', checkLocalUrl);
        headers = { authorization: 'Bearer lm-studio' }; // LM Studio checks no key; a user key is never sent to it
        // Thinking off by default: on a typical laptop Qwen 3.5 thinks for thousands of tokens at ~10 tok/s, so a brief
        // blew the 120 s timeout. LM Studio honours reasoning_effort "none"; LMSTUDIO_REASONING_EFFORT=low|medium|high turns it back on.
        body = chat({ max_tokens: localMaxTokens(maxTokens), reasoning_effort: process.env.LMSTUDIO_REASONING_EFFORT || 'none', ...(t === undefined ? {} : { temperature: t }) });
        parse = localText;
        lookup = loopbackLookup;
        timeoutMs = LOCAL_TIMEOUT_MS;
    } else {
        if (!baseUrl) throw new AiError(400, 'ai_bad_base_url');
        url = endpoint(baseUrl, '/chat/completions', checkBaseUrl);
        headers = bearer;
        body = chat({ max_tokens: maxTokens, ...(t === undefined ? {} : { temperature: t }) });
        parse = chatText;
        lookup = guardedLookup;
    }
    const r = await send(url, headers, body, { lookup, timeoutMs });
    checkStatus(r, provider, apiKey);
    let j;
    try { j = JSON.parse(r.text); } catch (e) { throw new AiError(502, 'ai_bad_response'); }
    const text = parse(j);
    if (!text) throw new AiError(502, 'ai_bad_response');
    return text;
}

// base + suffix by string append (never a relative resolve); the FINAL URL goes through the same check as the base.
function endpoint(base, suffix, check) {
    const b = check(base);
    const url = new URL(`${b.href.replace(/\/+$/, '')}${suffix}`);
    if (url.host !== b.host || url.protocol !== b.protocol) throw bad();
    check(url.origin + url.pathname);
    return url;
}

// The upstream error message: OpenAI-style {error:{message}}, LM Studio's {error:"..."} or the raw body.
function upstreamMessage(text) {
    let j = null;
    try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
    const e = j && j.error;
    const m = typeof e === 'string' ? e : (e && typeof e.message === 'string' ? e.message : (j && typeof j.message === 'string' ? j.message : text));
    return String(m || '').replace(/\s+/g, ' ').trim();
}

// LM Studio (llama.cpp) when prompt + answer do not fit the loaded context: "exceed_context_size_error",
// "request (11905 tokens) exceeds the available context size (8192 tokens)".
const CONTEXT_RE = /exceed_context_size|context size|context length|context window|n_ctx/i;

function checkStatus(r, provider = 'lmstudio', apiKey = '') {
    if (r.status >= 200 && r.status < 300) return;
    let msg = upstreamMessage(r.text || '');
    if (apiKey) msg = msg.split(apiKey).join('[key]'); // some providers echo the key in auth errors
    logger.warn(`ai upstream failure: provider=${provider} status=${r.status} message=${msg.slice(0, 300)}`);
    if (r.status === 401 || r.status === 403) throw new AiError(502, 'ai_auth_failed'); // 502, not 401: the SPA signs the user out on 401
    if (r.status === 429) throw new AiError(429, 'ai_rate_limited');
    if (provider !== 'lmstudio') throw new AiError(502, 'ai_upstream_error'); // includes 3xx: redirects are not followed
    if (CONTEXT_RE.test(msg)) throw new AiError(502, 'ai_context_too_small', msg.slice(0, 200));
    throw new AiError(502, 'ai_upstream_error', msg.slice(0, 200));
}

// GET {base}/models on the user's LM Studio: the ids of loaded chat models (embedding models are useless here).
async function listLocalModels(baseUrl) {
    const url = endpoint(lmstudioBaseUrl(baseUrl), '/models', checkLocalUrl);
    const r = await send(url, { authorization: 'Bearer lm-studio' }, null, { lookup: loopbackLookup, timeoutMs: 10e3 });
    checkStatus(r);
    let j;
    try { j = JSON.parse(r.text); } catch (e) { throw new AiError(502, 'ai_bad_response'); }
    if (!j || !Array.isArray(j.data)) throw new AiError(502, 'ai_bad_response');
    return j.data.map((m) => m && m.id).filter((id) => typeof id === 'string' && MODEL_ID_RE.test(id) && !/embed/i.test(id)).slice(0, 100);
}

// ---- Model lists (POST /api/ai/models and the Test button) ----
const MAX_MODELS = 500;
const LIST_MAX_BYTES = 4 * 1024 * 1024; // model lists only (OpenRouter's is large); chat calls keep the 1 MB cap
const NOT_CHAT_RE = /embed|whisper|tts|dall-e|moderation|davinci|babbage|transcribe|image|audio|realtime|search-preview/i;
const clip = (v, n) => String(v).slice(0, n);
const perM = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : undefined; }; // per-token string -> USD per 1M tokens (OpenRouter sends -1 for variable-price routers)
const pos = (n) => (Number.isFinite(n) && n > 0 ? n : undefined);
const entry = (id, name, extra = {}) => {
    const o = { id, name: name && name !== id ? clip(name, 100) : id, ...extra };
    Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
    return o;
};
const okId = (id) => typeof id === 'string' && MODEL_ID_RE.test(id);

// Per-provider list shape -> [{ id, name, contextLength?, pricePerMTokIn?, pricePerMTokOut?, free? }]. Pure; throws
// ai_bad_response when the body is not the shape we know. Anthropic keeps the API's newest-first order, others sort by id.
function normalizeModels(provider, j) {
    const bad502 = () => new AiError(502, 'ai_bad_response');
    let list;
    if (provider === 'gemini') {
        if (!j || !Array.isArray(j.models)) throw bad502();
        list = j.models.filter((m) => m && Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
            .map((m) => { const id = typeof m.name === 'string' ? m.name.replace(/^models\//, '') : ''; return okId(id) && entry(id, m.displayName, { contextLength: pos(m.inputTokenLimit) }); });
    } else {
        if (!j || !Array.isArray(j.data)) throw bad502();
        if (provider === 'openrouter') {
            list = j.data.map((m) => {
                if (!m || !okId(m.id)) return null;
                const pin = perM(m.pricing && m.pricing.prompt);
                const pout = perM(m.pricing && m.pricing.completion);
                const free = (pin === 0 && pout === 0) || /:free$/.test(m.id);
                return entry(m.id, m.name, { contextLength: pos(m.context_length), pricePerMTokIn: pin, pricePerMTokOut: pout, free: free || undefined });
            });
        } else if (provider === 'anthropic') {
            list = j.data.map((m) => m && okId(m.id) && entry(m.id, m.display_name));
        } else {
            const skip = provider === 'openai' ? NOT_CHAT_RE : provider === 'lmstudio' ? /embed/i : null;
            list = j.data.map((m) => m && okId(m.id) && !(skip && skip.test(m.id)) && entry(m.id));
        }
    }
    list = list.filter(Boolean).slice(0, MAX_MODELS);
    return provider === 'anthropic' ? list : list.sort((a, b) => a.id.localeCompare(b.id));
}

// Lists the models a provider offers for this key. Same hosts, headers, SSRF guards and 4 MB (lists only) / no-redirect rules as
// complete(); 8 s timeout. apiKey is used only for the request header and masked out of logged upstream text.
async function listModels({ provider, apiKey, baseUrl }) {
    if (!PROVIDER_IDS.includes(provider)) throw new AiError(400, 'ai_bad_provider');
    const local = provider === 'lmstudio';
    if (!apiKey && !local) throw new AiError(400, 'ai_no_key');
    let url; let headers; let lookup;
    if (provider === 'anthropic') { url = new URL('https://api.anthropic.com/v1/models?limit=1000'); headers = { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }; }
    else if (provider === 'gemini') { url = new URL('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000'); headers = { 'x-goog-api-key': apiKey }; }
    else if (provider === 'openai') { url = new URL('https://api.openai.com/v1/models'); headers = { authorization: `Bearer ${apiKey}` }; }
    else if (provider === 'openrouter') { url = new URL('https://openrouter.ai/api/v1/models'); headers = { authorization: `Bearer ${apiKey}` }; }
    else if (local) { url = endpoint(lmstudioBaseUrl(baseUrl), '/models', checkLocalUrl); headers = { authorization: 'Bearer lm-studio' }; lookup = loopbackLookup; }
    else { if (!baseUrl) throw new AiError(400, 'ai_bad_base_url'); url = endpoint(baseUrl, '/models', checkBaseUrl); headers = { authorization: `Bearer ${apiKey}` }; lookup = guardedLookup; }
    const r = await send(url, headers, null, { lookup, timeoutMs: 8e3, maxBytes: LIST_MAX_BYTES, overCode: 'ai_list_too_large' });
    checkStatus(r, provider, apiKey);
    let j;
    try { j = JSON.parse(r.text); } catch (e) { throw new AiError(502, 'ai_bad_response'); }
    return normalizeModels(provider, j);
}

module.exports = { listModels, normalizeModels, AiError, PROVIDERS, PROVIDER_IDS, MODEL_ID_RE, defaultModel, lmstudioBaseUrl, isBlockedIp, checkBaseUrl, checkLocalUrl, guardedLookup, loopbackLookup, complete, listLocalModels };
