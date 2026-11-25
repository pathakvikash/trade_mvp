// Public headlines service: title + link-out only, from six RSS/Atom feeds. NOT analysis, NOT investment advice.
// Never store or return descriptions, full text or images. Headlines are untrusted third-party text: NEVER put them
// into AI contexts (prompts, agent tools, briefs): a headline can carry prompt injection.
// Each source has its own breaker (datacenter IPs such as Render may be blocked), 6 s timeout, 1 MB cap. Failures serve
// last good data with stale:true for up to 24 h, then the route answers 502.
const axios = require('axios');
const crypto = require('crypto');
const { cached } = require('./marketData/cache');
const breaker = require('./marketData/breaker');

const UA = 'Paperline/1.0 (+https://trade-mvp.vercel.app; headlines reader)';
const SOURCES = [
    { name: 'Cointelegraph', category: 'crypto', url: 'https://cointelegraph.com/rss' },
    { name: 'CoinDesk', category: 'crypto', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
    { name: 'Decrypt', category: 'crypto', url: 'https://decrypt.co/feed' },
    { name: 'Mint', category: 'india', url: 'https://www.livemint.com/rss/markets' },
    { name: 'Economic Times', category: 'india', url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
    { name: 'Business Standard', category: 'india', url: 'https://www.business-standard.com/rss/markets-106.rss' },
];
const CATEGORIES = ['all', 'crypto', 'india'];
const DISCLAIMER = 'External headlines from the sources named, shown as links; not our analysis, not investment advice.';
const MAX_BYTES = 1024 * 1024;
const MAX_ITEMS_PER_FEED = 100;
const MAX_AGE_MS = 7 * 24 * 3600e3;
const MAX_FUTURE_MS = 3600e3;
const TTL_MS = 10 * 60e3;
const MAX_STALE_MS = 24 * 3600e3;
const MAX_TITLE = 200;

const breakers = new Map(SOURCES.map((s) => [s.name, breaker(`news:${s.name}`, { tripOnNetwork: true, level: 'info' })]));
const store = new Map(); // own cache store so nothing else evicts it
// Own last-good map too: the shared one in marketData/cache holds 200 entries, so busy market-data traffic could evict
// the news fallback and a source outage would 502 instead of serving stale. 7 keys (6 sources + merged), never evicted.
const lastGood = new Map();
const remember = (key, value) => { lastGood.set(key, { value, at: Date.now() }); return value; };

// ---- tiny linear XML scanner (indexOf only: no backtracking regex, no entity expansion beyond the five + numeric) ----
const NAME_END = /[\s>/]/;
// bodies/attrs of every <name ...>...</name> (or self-closing); at most `max`
function elements(xml, name, max = Infinity) {
    const out = [];
    let i = 0;
    while (out.length < max) {
        const s = xml.indexOf('<' + name, i);
        if (s < 0) break;
        const after = xml[s + name.length + 1];
        if (after === undefined || !NAME_END.test(after)) { i = s + 1; continue; }
        const gt = xml.indexOf('>', s);
        if (gt < 0) break;
        const attrs = xml.slice(s + name.length + 1, gt);
        if (xml[gt - 1] === '/') { out.push({ attrs, body: '' }); i = gt + 1; continue; }
        const close = xml.indexOf('</' + name + '>', gt);
        if (close < 0) break; // no closer anywhere later either: stop (keeps unclosed-tag floods linear)
        out.push({ attrs, body: xml.slice(gt + 1, close) });
        i = close + name.length + 3;
    }
    return out;
}

function decodeEntities(s) {
    return s.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|amp|lt|gt|quot|apos);/g, (m, e) => {
        if (e[0] === '#') {
            const n = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
            return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ' ';
        }
        return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
    });
}

// element text: CDATA sections taken literally, the rest entity-decoded
function textOf(body) {
    let out = '';
    let i = 0;
    for (;;) {
        const s = body.indexOf('<![CDATA[', i);
        if (s < 0) { out += decodeEntities(body.slice(i)); break; }
        out += decodeEntities(body.slice(i, s));
        const e = body.indexOf(']]>', s + 9);
        if (e < 0) { out += body.slice(s + 9); break; }
        out += body.slice(s + 9, e);
        i = e + 3;
    }
    return out;
}

// remove everything that looks like a tag/comment/PI; an unterminated '<tag' drops the rest. Text only.
function stripHtml(s) {
    let out = '';
    let i = 0;
    for (;;) {
        const lt = s.indexOf('<', i);
        if (lt < 0) { out += s.slice(i); break; }
        out += s.slice(i, lt);
        if (/[A-Za-z/!?]/.test(s[lt + 1] || '')) {
            const gt = s.indexOf('>', lt);
            if (gt < 0) break;
            i = gt + 1;
            out += ' ';
        } else { out += '<'; i = lt + 1; }
    }
    return out;
}

function cleanTitle(raw) {
    // decode, strip tags, decode once more (publishers double-encode), strip again so nothing HTML-like survives
    let t = stripHtml(decodeEntities(stripHtml(textOf(raw))));
    t = t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > MAX_TITLE ? t.slice(0, MAX_TITLE - 1).trimEnd() + '…' : t;
}

function cleanLink(raw) {
    const t = textOf(raw).trim();
    if (t.length > 2000 || !/^https?:\/\//i.test(t)) return null;
    try { const u = new URL(t); return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null; } catch { return null; }
}

const attr = (attrs, n) => { const m = new RegExp(`\\b${n}\\s*=\\s*(?:"([^"]{0,2000})"|'([^']{0,2000})')`).exec(attrs.slice(0, 4000)); return m ? (m[1] ?? m[2]) : null; };

// RSS 2.0 (<item>) and Atom (<entry>). Only title, link and date are read: descriptions/content/images are never touched.
function parseFeed(xml, now = Date.now()) {
    if (typeof xml !== 'string') return [];
    xml = xml.slice(0, MAX_BYTES);
    const out = [];
    for (const tag of ['item', 'entry']) {
        for (const { body } of elements(xml, tag, MAX_ITEMS_PER_FEED)) {
            const title = elements(body, 'title', 1)[0];
            let link = null;
            for (const l of elements(body, 'link')) {
                const rel = attr(l.attrs, 'rel');
                if (rel && rel !== 'alternate') continue;
                link = cleanLink(attr(l.attrs, 'href') || l.body);
                if (link) break;
            }
            const d = elements(body, 'pubDate', 1)[0] || elements(body, 'published', 1)[0] || elements(body, 'updated', 1)[0] || elements(body, 'dc:date', 1)[0];
            const ts = d ? Date.parse(textOf(d.body).trim()) : NaN;
            const t = title ? cleanTitle(title.body) : '';
            if (!t || !link || !Number.isFinite(ts)) continue;
            if (now - ts > MAX_AGE_MS || ts - now > MAX_FUTURE_MS) continue;
            out.push({ title: t, link, ts });
        }
    }
    return out;
}

// ---- fetching ----
const normLink = (l) => { const u = new URL(l); u.hash = ''; for (const k of [...u.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(k)) u.searchParams.delete(k); return (u.host + u.pathname.replace(/\/+$/, '') + u.search).toLowerCase(); };
const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const fetchOne = (src) => breakers.get(src.name).run(async () => {
    const r = await axios.get(src.url, {
        timeout: 6000, responseType: 'text', maxContentLength: MAX_BYTES, maxBodyLength: MAX_BYTES,
        headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5' },
        transformResponse: (d) => d,
    });
    return parseFeed(r.data);
});

const fresh = (e) => e && Date.now() - e.at < MAX_STALE_MS;

async function build() {
    const settled = await Promise.allSettled(SOURCES.map(fetchOne));
    const sources = [];
    const rows = [];
    settled.forEach((r, i) => {
        const s = SOURCES[i];
        if (r.status === 'fulfilled') {
            remember(`news:src:${s.name}`, r.value);
            sources.push({ name: s.name, category: s.category, ok: true, at: new Date().toISOString() });
            for (const it of r.value) rows.push({ ...it, source: s.name, category: s.category });
        } else {
            sources.push({ name: s.name, category: s.category, ok: false, at: null });
        }
    });
    if (!sources.some((s) => s.ok)) throw new Error('all news sources failed');
    // a failed source keeps its own last good headlines (still age-filtered below on next parse; ok:false tells the UI)
    settled.forEach((r, i) => {
        if (r.status === 'fulfilled') return;
        const g = lastGood.get(`news:src:${SOURCES[i].name}`);
        if (!fresh(g)) return;
        sources[i].at = new Date(g.at).toISOString();
        for (const it of g.value) if (Date.now() - it.ts <= MAX_AGE_MS) rows.push({ ...it, source: SOURCES[i].name, category: SOURCES[i].category });
    });
    rows.sort((a, b) => b.ts - a.ts);
    const seenLink = new Set();
    const seenTitle = new Set();
    const items = [];
    for (const r of rows) {
        const lk = normLink(r.link);
        const tk = normTitle(r.title);
        if (seenLink.has(lk) || seenTitle.has(tk)) continue;
        seenLink.add(lk); seenTitle.add(tk);
        items.push({ id: crypto.createHash('sha1').update(r.link).digest('hex').slice(0, 12), title: r.title, link: r.link, source: r.source, category: r.category, publishedAt: new Date(r.ts).toISOString() });
    }
    return remember('news:merged', { items, sources });
}

// -> { items, sources, stale? }; throws when nothing is available (route answers 502)
async function headlines({ limit = 30, category = 'all' } = {}) {
    let data;
    let stale = false;
    try {
        data = await cached('news:merged', TTL_MS, build, store, 5);
    } catch (e) {
        const g = lastGood.get('news:merged');
        if (!fresh(g)) throw e;
        data = g.value; stale = true;
    }
    const pick = (x) => category === 'all' || x.category === category;
    const out = { items: data.items.filter(pick).slice(0, limit), sources: data.sources.filter(pick) };
    if (stale) out.stale = true;
    return out;
}

module.exports = { headlines, parseFeed, CATEGORIES, DISCLAIMER, SOURCES, _test: { expire() { store.clear(); }, reset() { breakers.forEach((b) => b.reset()); store.clear(); lastGood.clear(); } } };
