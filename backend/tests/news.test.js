const axios = require('axios');
const news = require('../services/news');

const rfc = (ms) => new Date(Date.now() - ms).toUTCString();
const H = 3600e3;
const item = (title, link, ago = H, extra = '') => `<item><title>${title}</title><link>${link}</link><pubDate>${rfc(ago)}</pubDate>${extra}</item>`;
const rss = (...items) => `<?xml version="1.0"?><rss version="2.0"><channel>${items.join('')}</channel></rss>`;
const err = (status) => Object.assign(new Error(String(status)), { response: { status, headers: {} } });

// supertest needs to listen (not allowed in the sandbox): call the route handler with a fake req/res instead
const handler = require('../routes/newsRoutes').stack.find((l) => l.route).route.stack[0].handle;
const request = (app) => ({ async get(url) {
    const q = Object.fromEntries(new URL(url, 'http://x').searchParams);
    return new Promise((resolve) => {
        const res = { headers: {}, set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode || 200, headers: this.headers, body: JSON.parse(JSON.stringify(b)) }); } };
        handler({ query: q }, res);
    });
} });
const app = null;
const handlerFor = (path) => (params) => new Promise((resolve) => {
    const h = require('../routes/newsRoutes').stack.find((l) => l.route && l.route.path === path).route.stack[0].handle;
    const res = { headers: {}, set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, status(c) { this.statusCode = c; return this; }, json(b) { resolve({ status: this.statusCode || 200, headers: this.headers, body: JSON.parse(JSON.stringify(b)) }); } };
    h({ params }, res);
});
let byUrl;
function feeds(map) {
    byUrl = map;
    jest.spyOn(axios, 'get').mockImplementation(async (url, opts) => {
        const v = typeof byUrl === 'function' ? byUrl(url, opts) : byUrl[url];
        if (v instanceof Error) throw v;
        return { data: v === undefined ? rss() : v };
    });
}
const all = (v) => Object.fromEntries(news.SOURCES.map((s) => [s.url, v]));
beforeEach(() => news._test.reset());
afterEach(() => jest.restoreAllMocks());

describe('parseFeed', () => {
    test('RSS: CDATA, entities, HTML stripped, control chars removed, no description', () => {
        const [a, b] = news.parseFeed(rss(
            item('<![CDATA[<b>Bitcoin</b> &amp; <script>alert(1)</script>ETH rally]]>', 'https://a.com/1', H, '<description>SECRET BODY</description>'),
            item('Tom &amp; Jerry &#8377;5 &lt;i&gt;x&lt;/i&gt;\u0007\u0000', 'https://a.com/2', 2 * H),
        ));
        expect(a.title).toBe('Bitcoin & alert(1) ETH rally');
        expect(b.title).toBe('Tom & Jerry ₹5 x');
        expect(JSON.stringify([a, b])).not.toMatch(/<|description/);
        expect(a.summary).toBe('SECRET BODY');
    });
    test('Atom with rel links and updated', () => {
        const xml = `<feed><entry><title>Atom head</title><link rel="self" href="https://a.com/self"/><link rel="alternate" href="https://a.com/x?utm_source=1"/><updated>${new Date(Date.now() - H).toISOString()}</updated><content>BODY</content></entry></feed>`;
        const r = news.parseFeed(xml);
        expect(r).toHaveLength(1);
        expect(r[0].link).toBe('https://a.com/x?utm_source=1');
    });
    test('drops non-http links, old and far-future dates, bad dates', () => {
        const r = news.parseFeed(rss(
            item('js', 'javascript:alert(1)'), item('data', 'data:text/html,x'), item('ftp', 'ftp://a.com/x'),
            item('old', 'https://a.com/old', 8 * 24 * H), item('future', 'https://a.com/f', -2 * H), item('soon', 'https://a.com/s', -0.5 * H),
            '<item><title>nodate</title><link>https://a.com/nd</link></item>', item('ok', 'https://a.com/ok'),
        ));
        expect(r.map((x) => x.title).sort()).toEqual(['ok', 'soon']);
    });
    test('malformed XML does not throw', () => {
        for (const x of ['<item><title>x', '<rss><item><title>a</title><link>https://a.com', '<<<>>><item', '', null, '<item><title><![CDATA[unterminated</title>']) expect(() => news.parseFeed(x)).not.toThrow();
        expect(news.parseFeed('<item><title>x')).toEqual([]);
    });
    test('caps title at 200 chars and items per feed at 100', () => {
        const long = news.parseFeed(rss(item('x'.repeat(500), 'https://a.com/l')));
        expect(long[0].title.length).toBeLessThanOrEqual(200);
        const many = news.parseFeed(rss(...Array.from({ length: 150 }, (_, i) => item(`t${i}`, `https://a.com/${i}`))));
        expect(many).toHaveLength(100);
    });
    test('image: media:content, media:thumbnail, enclosure and img fallback', () => {
        const [a, b, c, d, e, f] = news.parseFeed(rss(
            item('a', 'https://a.com/a', H, '<media:content url="https://i.com/a.jpg" medium="image"/>'),
            item('b', 'https://a.com/b', 2 * H, '<media:thumbnail url="https://i.com/b.jpg?x=1&amp;y=2" width="1"/>'),
            item('c', 'https://a.com/c', 3 * H, '<enclosure url="https://i.com/c.png" type="image/png" length="1"/>'),
            item('d', 'https://a.com/d', 4 * H, '<description><![CDATA[<p>hi <img alt="x" src="https://i.com/d.jpg"> there</p>]]></description>'),
            item('e', 'https://a.com/e', 5 * H, '<content:encoded>&lt;img src=&quot;https://i.com/e.jpg&quot; /&gt;</content:encoded>'),
            item('f', 'https://a.com/f', 6 * H, '<enclosure url="https://i.com/f.mp3" type="audio/mpeg"/>'),
        ));
        expect([a, b, c, d, e, f].map((x) => x.image)).toEqual(['https://i.com/a.jpg', 'https://i.com/b.jpg?x=1&y=2', 'https://i.com/c.png', 'https://i.com/d.jpg', 'https://i.com/e.jpg', null]);
        expect(d.summary).toBe('hi there');
    });
    test('image: http, javascript, data, relative, control chars and long URLs are dropped', () => {
        const bad = ['http://i.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//i.com/a.jpg', '/a.jpg', 'https://i.com/a\u0007.jpg', 'https://i.com/' + 'x'.repeat(500)];
        const r = news.parseFeed(rss(...bad.map((u, i) => item(`t${i}`, `https://a.com/${i}`, H + i, `<media:content url="${u}"/><description>&lt;img src="${u}"&gt;</description>`))));
        expect(r).toHaveLength(bad.length);
        expect(r.every((x) => x.image === null)).toBe(true);
    });
    test('summary: HTML stripped, whitespace collapsed, empty when absent', () => {
        const [a, b] = news.parseFeed(rss(
            item('s1', 'https://a.com/1', H, '<description>&lt;p onclick="x"&gt;Hello&lt;/p&gt;  \n &lt;script&gt;alert(1)&lt;/script&gt;&amp;amp; world\u0007</description>'),
            item('s2', 'https://a.com/2', 2 * H),
        ));
        expect(a.summary).toBe('Hello alert(1) & world');
        expect(a.summary).not.toMatch(/[<>]/);
        expect(b.summary).toBe('');
    });
    test('summary: cut to 200 chars at a word boundary with an ellipsis', () => {
        const words = 'word '.repeat(100);
        const [a, b] = news.parseFeed(rss(
            item('t1', 'https://a.com/1', H, `<description>${words}</description>`),
            item('t2', 'https://a.com/2', 2 * H, `<description>${'y'.repeat(500)}</description>`),
        ));
        expect(a.summary.length).toBeLessThanOrEqual(200);
        expect(a.summary).toMatch(/word…$/);
        expect(b.summary).toBe('y'.repeat(199) + '…');
    });
    test('summary equal to the title is dropped', () => {
        const [a] = news.parseFeed(rss(item('Bitcoin hits 100k', 'https://a.com/1', H, '<description>&lt;p&gt;Bitcoin hits 100K!&lt;/p&gt;</description>')));
        expect(a.summary).toBe('');
    });
    test('pathological image/summary input is fast', () => {
        const t = Date.now();
        news.parseFeed('<item><title>t</title><link>https://a.com/1</link><pubDate>' + rfc(H) + '</pubDate><description>' + '<img '.repeat(100000) + '</description></item>');
        news.parseFeed('<item><title>t</title><link>https://a.com/1</link><pubDate>' + rfc(H) + '</pubDate>' + '<media:content url="x" '.repeat(50000) + '<description>' + '<'.repeat(200000));
        expect(Date.now() - t).toBeLessThan(2000);
    });
    test('pathological input is fast', () => {
        const t = Date.now();
        news.parseFeed('<item>'.repeat(50000) + '<'.repeat(200000));
        news.parseFeed('<item><title>' + '<a '.repeat(100000));
        expect(Date.now() - t).toBeLessThan(2000);
    });
});

describe('headlines service', () => {
    const crypto1 = 'https://cointelegraph.com/rss';
    test('merges, dedupes by link and title, sorts desc, sends honest UA, 1 MB cap, 6 s timeout', async () => {
        feeds({
            ...all(rss()),
            [crypto1]: rss(item('Older story', 'https://a.com/1', 3 * H), item('Newest', 'https://a.com/2/?utm_campaign=x', H)),
            'https://decrypt.co/feed': rss(item('NEWEST!', 'https://b.com/other', 2 * H), item('Same link', 'https://a.com/2', 4 * H)),
            'https://www.livemint.com/rss/markets': rss(item('Sensex up', 'https://m.com/1', 30 * 60e3)),
        });
        const r = await news.headlines({ limit: 50 });
        expect(r.items.map((i) => i.title)).toEqual(['Sensex up', 'Newest', 'Older story']);
        expect(r.items[0]).toEqual({ id: expect.stringMatching(/^[0-9a-f]{12}$/), title: 'Sensex up', link: 'https://m.com/1', source: 'Mint', category: 'india', publishedAt: expect.stringMatching(/Z$/), image: null, summary: '' });
        const opts = axios.get.mock.calls[0][1];
        expect(opts.headers['User-Agent']).toBe('Paperline/1.0 (+https://trade-mvp.vercel.app; headlines reader)');
        expect(opts.timeout).toBe(6000);
        expect(opts.maxContentLength).toBe(1024 * 1024);
        expect(r.sources).toHaveLength(6);
        expect(JSON.stringify(r)).not.toMatch(/description/);
    });
    test('oversized feed (axios cap error) fails that source only', async () => {
        feeds({ ...all(rss()), [crypto1]: Object.assign(new Error('maxContentLength size of 1048576 exceeded'), { code: 'ERR_BAD_RESPONSE' }), 'https://decrypt.co/feed': rss(item('ok', 'https://a.com/1')) });
        const r = await news.headlines({});
        expect(r.items).toHaveLength(1);
        expect(r.sources.find((s) => s.name === 'Cointelegraph').ok).toBe(false);
    });
    test('one source failing: others served, failed one flagged, last good headlines kept', async () => {
        feeds({ ...all(rss()), [crypto1]: rss(item('From CT', 'https://a.com/ct')) });
        await news.headlines({});
        jest.useFakeTimers({ now: Date.now() });
        jest.setSystemTime(Date.now() + 11 * 60e3);
        feeds({ ...all(rss()), [crypto1]: err(500), 'https://decrypt.co/feed': rss(item('From Decrypt', 'https://a.com/d', 60e3)) });
        const r = await news.headlines({});
        jest.useRealTimers();
        expect(r.stale).toBeUndefined();
        expect(r.sources.find((s) => s.name === 'Cointelegraph').ok).toBe(false);
        expect(r.items.map((i) => i.title).sort()).toEqual(['From CT', 'From Decrypt']);
    });
    test('all failing with lastGood -> stale; none -> throws', async () => {
        await expect((async () => { feeds(all(err(500))); return news.headlines({}); })()).rejects.toBeTruthy();
        news._test.reset();
        feeds({ ...all(rss()), [crypto1]: rss(item('Good', 'https://a.com/g')) });
        await news.headlines({});
        jest.useFakeTimers({ now: Date.now() });
        jest.setSystemTime(Date.now() + 11 * 60e3);
        feeds(all(err(500)));
        const r = await news.headlines({});
        jest.useRealTimers();
        expect(r.stale).toBe(true);
        expect(r.items[0].title).toBe('Good');
    });
    test('stale fallback survives the shared 200-entry lastGood map being flooded', async () => {
        const { remember } = require('../services/marketData/cache');
        feeds({ ...all(rss()), [crypto1]: rss(item('Good', 'https://a.com/g')) });
        await news.headlines({});
        for (let i = 0; i < 300; i++) remember(`other:${i}`, i); // would evict news:* from the shared map
        jest.useFakeTimers({ now: Date.now() });
        jest.setSystemTime(Date.now() + 11 * 60e3);
        feeds(all(err(500)));
        const r = await news.headlines({});
        jest.useRealTimers();
        expect(r.stale).toBe(true);
        expect(r.items[0].title).toBe('Good');
    });
    test('403 trips that source breaker: no second request until it recovers', async () => {
        feeds({ ...all(rss()), [crypto1]: err(403), 'https://decrypt.co/feed': rss(item('x', 'https://a.com/x')) });
        await news.headlines({});
        const callsFor = () => axios.get.mock.calls.filter((c) => c[0] === crypto1).length;
        expect(callsFor()).toBe(1);
        news._test.expire(); // merged cache gone, breaker still open
        await news.headlines({});
        expect(callsFor()).toBe(1);
    });
    test('caches 10 minutes and de-dupes in-flight requests', async () => {
        feeds({ ...all(rss()), [crypto1]: rss(item('x', 'https://a.com/x')) });
        await Promise.all([news.headlines({}), news.headlines({}), news.headlines({ category: 'crypto' })]);
        await news.headlines({});
        expect(axios.get).toHaveBeenCalledTimes(6);
    });
});

describe('decodeEntities', () => {
    test('common named entities map to characters; unknown ones become a space; numeric still works; linear on junk', () => {
        expect(news.decodeEntities('a&nbsp;b &rsquo;&lsquo;&ldquo;&rdquo;&hellip;&mdash;&ndash; &amp;&lt;&#65;&#x42;')).toBe('a b \u2019\u2018\u201c\u201d\u2026\u2014\u2013 &<AB');
        expect(news.decodeEntities('x&foo;y&bogus123;z&constructor;')).toBe('x y z ');
        const t = Date.now();
        news.decodeEntities('&'.repeat(200000) + 'a'.repeat(200000));
        expect(Date.now() - t).toBeLessThan(500);
    });
    test('titles from a feed come out clean', () => {
        const [it] = news.parseFeed(rss(item('Fed&nbsp;holds &ndash; markets&hellip; &weird;', 'https://a.com/1')));
        expect(it.title).toBe('Fed holds \u2013 markets\u2026');
    });
});

describe('GET /api/news/:id', () => {
    const byId = handlerFor('/:id');
    beforeEach(() => feeds({ ...all(rss()), 'https://cointelegraph.com/rss': rss(item('C1', 'https://a.com/1'), item('C2', 'https://a.com/2', 2 * H)), 'https://www.livemint.com/rss/markets': rss(item('I1', 'https://m.com/1')) }));
    test('returns {item, disclaimer} from the full list, even beyond limit and category', async () => {
        const list = await news.headlines({ limit: 50 });
        const last = list.items[list.items.length - 1]; // oldest of three, crypto or not: not on any limited page
        const r = await byId({ id: last.id });
        expect(r.status).toBe(200);
        expect(r.headers['x-data-source']).toBe('rss');
        expect(Object.keys(r.body).sort()).toEqual(['disclaimer', 'item']);
        expect(r.body.item).toEqual(last);
        expect(r.body.disclaimer).toBe(news.DISCLAIMER);
    });
    test('unknown or malformed id -> 404', async () => {
        for (const id of ['0'.repeat(12), 'zzzzzzzzzzzz', 'abc', 'A'.repeat(12), 'a'.repeat(13)]) {
            const r = await byId({ id });
            expect(r.status).toBe(404);
            expect(r.body).toEqual({ error: 'not found' });
        }
    });
    test('no data at all -> 502', async () => {
        news._test.reset();
        feeds(all(err(500)));
        const r = await byId({ id: 'a'.repeat(12) });
        expect(r.status).toBe(502);
    });
});

describe('GET /api/news', () => {
    beforeEach(() => feeds({ ...all(rss()), 'https://cointelegraph.com/rss': rss(item('C1', 'https://a.com/1'), item('C2', 'https://a.com/2', 2 * H)), 'https://www.livemint.com/rss/markets': rss(item('I1', 'https://m.com/1')) }));
    test('contract: header, disclaimer, category and limit', async () => {
        const r = await request(app).get('/api/news?limit=1&category=crypto');
        expect(r.status).toBe(200);
        expect(r.headers['x-data-source']).toBe('rss');
        expect(r.body.disclaimer).toBe('External headlines from the sources named, shown as links; not our analysis, not investment advice.');
        expect(r.body.items).toHaveLength(1);
        expect(r.body.items[0].category).toBe('crypto');
        expect(r.body.sources.every((s) => s.category === 'crypto')).toBe(true);
        expect(Object.keys(r.body.items[0]).sort()).toEqual(['category', 'id', 'image', 'link', 'publishedAt', 'source', 'summary', 'title']);
    });
    test('limit clamped 1..50, junk -> 30; invalid category 400', async () => {
        expect((await request(app).get('/api/news?limit=0')).body.items).toHaveLength(1);
        expect((await request(app).get('/api/news?limit=-5')).body.items).toHaveLength(1);
        expect((await request(app).get('/api/news?limit=abc')).status).toBe(200);
        expect((await request(app).get('/api/news?limit=9999')).status).toBe(200);
        expect((await request(app).get('/api/news?category=india')).body.items.map((i) => i.title)).toEqual(['I1']);
        const bad = await request(app).get('/api/news?category=stocks');
        expect(bad.status).toBe(400);
        expect(bad.body).toEqual({ error: 'invalid category' });
    });
    test('all failing, nothing cached -> 502', async () => {
        news._test.reset();
        feeds(all(err(500)));
        const r = await request(app).get('/api/news');
        expect(r.status).toBe(502);
        expect(r.body).toEqual({ error: 'News unavailable' });
    });
});
