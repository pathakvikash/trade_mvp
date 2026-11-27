// Orrery link helpers. `next` comes from a URL, so only same-origin relative paths are ever followed (no open redirect).
export const ORRERY_URL = (process.env.REACT_APP_ORRERY_URL || '').replace(/\/+$/, '');

// '/trade?symbol=BTC' -> itself; 'https://evil', '//evil', '/\evil', 'javascript:' and non-strings -> null
export const safeNext = (next) => (typeof next === 'string' && /^\/(?![/\\])[^\s]*$/.test(next) ? next : null);
