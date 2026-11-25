// Public docs page at `/docs`. Sections come from lib/docsContent.js. Client-side search filters sections, the table of
// contents highlights the section in view (IntersectionObserver; without it the clicked/hash section is highlighted),
// every heading has a copy-link button, and sections end with previous/next links. No router, no data fetching.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DOCS_SECTIONS } from '../lib/docsContent';

const hay = (s) => [s.title, ...(s.paragraphs || []), ...(s.bullets || []), ...(s.terms || []).flat(), ...((s.table && s.table.rows.flat()) || [])].join(' ').toLowerCase();
const INDEX = DOCS_SECTIONS.map((s) => [s, hay(s)]);

const TOC = ({ sections, active, onPick }) => (
  <nav aria-label="On this page">
    <ul className="space-y-1 text-sm">
      {sections.map((s) => (
        <li key={s.id}>
          <a
            href={`#${s.id}`}
            onClick={() => onPick(s.id)}
            aria-current={active === s.id ? 'location' : undefined}
            className={`focus-ring block rounded px-2 py-1 hover:bg-slate-800/60 hover:text-white ${active === s.id ? 'bg-slate-800/70 font-medium text-white' : 'text-slate-300'}`}
          >{s.title}</a>
        </li>
      ))}
    </ul>
  </nav>
);

// Copies the section URL. Without the Clipboard API (insecure context) the hash is set instead so the address bar holds the link.
const CopyLink = ({ id, title }) => {
  const [done, setDone] = useState('');
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    let msg = 'Copied';
    try { await navigator.clipboard.writeText(url); } catch (e) { window.location.hash = id; msg = 'Link is in the address bar'; }
    setDone(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(''), 2000);
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={copy} aria-label={`Copy link to ${title}`} className="focus-ring rounded px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-800/60 hover:text-white">
        <svg aria-hidden="true" viewBox="0 0 20 20" className="inline h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 12l4-4M7.5 9.5l-2 2a2.8 2.8 0 004 4l2-2M12.5 10.5l2-2a2.8 2.8 0 00-4-4l-2 2" /></svg>
        <span className="ml-1">Copy link</span>
      </button>
      <span role="status" className="text-xs text-emerald-300">{done}</span>
    </span>
  );
};

const Chip = ({ children }) => <code className="rounded border border-slate-700 bg-slate-950 px-1.5 py-0.5 text-[11px] text-cyan-200">{children}</code>;

const STEPS = [
  { name: 'Binance', note: 'USDS-M futures, first choice', tags: ['binance-futures', 'ws'] },
  { name: 'Fallbacks', note: 'Only when earlier sources fail', tags: ['bybit', 'bitget', 'gate', 'mexc', 'spot'] },
  { name: 'Our API', note: 'Cleans, caches briefly, tags every answer with its source', tags: ['X-Data-Source'] },
  { name: 'Your screen', note: 'Shows the source, or a retry state if unavailable', tags: ['unavailable'] },
];

const DataDiagram = () => (
  <figure className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
    <ol className="grid gap-6 sm:grid-cols-4 sm:gap-5">
      {STEPS.map((st, i) => (
        <li key={st.name} className="relative rounded-lg border border-slate-700 bg-slate-900/80 p-3">
          <p className="text-sm font-semibold text-white">{st.name}</p>
          <p className="mt-1 text-xs text-slate-400">{st.note}</p>
          <p className="mt-2 flex flex-wrap gap-1">{st.tags.map((t) => <Chip key={t}>{t}</Chip>)}</p>
          {i < STEPS.length - 1 && (
            <span aria-hidden="true" className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-slate-500 sm:-right-4 sm:bottom-auto sm:left-auto sm:top-1/2 sm:-translate-y-1/2 sm:translate-x-0">
              <span className="sm:hidden">&#8595;</span><span className="hidden sm:inline">&#8594;</span>
            </span>
          )}
        </li>
      ))}
    </ol>
    <figcaption className="mt-4 text-xs leading-relaxed text-slate-400">
      Stocks take a separate path: Yahoo Finance (<Chip>yahoo</Chip>, delayed and unofficial) through our API to the Stocks page. Money (fills, marks, liquidations, TP/SL) only ever uses Binance prices.
    </figcaption>
  </figure>
);

const Section = ({ s, prev, next, copyId }) => (
  <section id={s.id} aria-labelledby={`${s.id}-h`} className="scroll-mt-4 space-y-3">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h2 id={`${s.id}-h`} className="text-lg font-semibold text-white">{s.title}</h2>
      {copyId && <CopyLink id={s.id} title={s.title} />}
    </div>
    {s.paragraphs.map((p) => <p key={p} className="text-sm leading-relaxed text-slate-300">{p}</p>)}
    {s.diagram === 'data' && <DataDiagram />}
    {s.table && (
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full min-w-[420px] text-left text-sm text-slate-300">
          <caption className="sr-only">{s.table.caption}</caption>
          <thead className="bg-slate-900/80 text-xs text-slate-400"><tr>{s.table.head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800">{s.table.rows.map((r) => <tr key={r[0]}>{r.map((c) => <td key={c} className="px-3 py-2 tabular-nums">{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    )}
    {s.bullets && (
      <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-300">
        {s.bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>
    )}
    {s.terms && (
      <dl className="space-y-3 text-sm leading-relaxed">
        {s.terms.map(([t, d]) => (
          <div key={t} className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <dt className="font-medium text-white">{t}</dt>
            <dd className="mt-1 text-slate-300">{d}</dd>
          </div>
        ))}
      </dl>
    )}
    {(prev || next) && (
      <nav aria-label={`${s.title} navigation`} className="flex flex-wrap justify-between gap-2 pt-1 text-sm">
        {prev ? <a href={`#${prev.id}`} className="focus-ring rounded px-2 py-1 text-cyan-300 hover:text-cyan-200">&larr; {prev.title}</a> : <span />}
        {next ? <a href={`#${next.id}`} className="focus-ring rounded px-2 py-1 text-cyan-300 hover:text-cyan-200">{next.title} &rarr;</a> : <span />}
      </nav>
    )}
  </section>
);

const Docs = () => {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(() => (window.location.hash || '').slice(1) || DOCS_SECTIONS[0].id);
  const query = q.trim().toLowerCase();
  const sections = useMemo(() => INDEX.filter(([, h]) => !query || h.includes(query)).map(([s]) => s), [query]);
  const ids = sections.map((s) => s.id).join('|');

  // Open on the section named by the URL hash (the lazy page mounts after the browser's own jump).
  useEffect(() => {
    const el = window.location.hash && document.getElementById(window.location.hash.slice(1));
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
  }, []);

  // Highlight the section nearest the top. Without IntersectionObserver the clicked TOC link / hash sets it.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Set();
    const order = ids ? ids.split('|') : [];
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => (e.isIntersecting ? seen.add(e.target.id) : seen.delete(e.target.id)));
      const first = order.find((id) => seen.has(id));
      if (first) setActive(first);
    }, { rootMargin: '0px 0px -65% 0px' });
    order.forEach((id) => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, [ids]);

  useEffect(() => {
    const onHash = () => setActive((window.location.hash || '').slice(1) || DOCS_SECTIONS[0].id);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <a href="#docs-content" className="focus-ring sr-only rounded bg-slate-900 px-3 py-2 text-sm text-white focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50">Skip to content</a>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-white">Docs</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">How Paperline works, what is simulated and what is estimated. Paper trading only, not financial advice.</p>
        <div className="mt-4 max-w-md">
          <label htmlFor="docs-search" className="sr-only">Search the docs</label>
          <input
            id="docs-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the docs (for example funding, fee, leverage)"
            className="focus-ring w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
          />
          <p role="status" className="mt-1 text-xs text-slate-500">{query ? `${sections.length} of ${DOCS_SECTIONS.length} sections match` : ''}</p>
        </div>
      </header>

      <details className="mb-6 rounded-xl border border-slate-800 bg-slate-950/60 p-3 lg:hidden">
        <summary className="focus-ring cursor-pointer text-sm font-medium text-slate-200">Contents</summary>
        <div className="mt-2"><TOC sections={sections} active={active} onPick={setActive} /></div>
      </details>

      <div className="grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-4"><TOC sections={sections} active={active} onPick={setActive} /></div>
        </aside>

        <div id="docs-content" tabIndex={-1} className="min-w-0 space-y-10 focus:outline-none">
          {sections.length === 0 && <p className="text-sm text-slate-400">No section matches &ldquo;{q.trim()}&rdquo;. Try another word.</p>}
          {sections.map((s, i) => <Section key={s.id} s={s} prev={sections[i - 1]} next={sections[i + 1]} copyId />)}
        </div>
      </div>
    </div>
  );
};

export default Docs;
