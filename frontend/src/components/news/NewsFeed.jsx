import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import usePolling from '../../lib/usePolling';
import { API } from '../../lib/apiBase';
import SegTabs from '../ui/SegTabs';
import Skeleton from '../ui/Skeleton';

export const DISCLAIMER = 'External headlines from the sources named, shown as links; not our analysis, not investment advice.';
const TABS = [{ id: 'all', label: 'All' }, { id: 'crypto', label: 'Crypto' }, { id: 'india', label: 'India' }];
const DOT = { crypto: 'bg-amber-400', india: 'bg-emerald-400' };

// '12 min ago'; anything unparseable or in the future reads 'just now' / ''.
export const timeAgo = (iso, now = Date.now()) => {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const m = Math.floor((now - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
};

// Only http(s) links go out; anything else (javascript:, data:) renders as non-link text.
const safeHref = (u) => {
  try { const p = new URL(u); return p.protocol === 'http:' || p.protocol === 'https:' ? p.href : null; } catch { return null; }
};

const Row = ({ it }) => {
  const href = safeHref(it.link);
  const when = new Date(it.publishedAt);
  const abs = Number.isNaN(when.getTime()) ? undefined : when.toLocaleString();
  const inner = (
    <>
      <span className="min-w-0 flex-1 text-sm text-slate-200 group-hover:text-cyan-300">{String(it.title)}</span>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-slate-500">
        <span className={`h-1.5 w-1.5 rounded-full ${DOT[it.category] || 'bg-slate-500'}`} role="img" aria-label={`${it.category} news`} />
        <span className="max-w-[7rem] truncate rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-300">{it.source}</span>
        <time dateTime={it.publishedAt} title={abs} className="whitespace-nowrap">{timeAgo(it.publishedAt)}</time>
      </span>
    </>
  );
  const cls = 'group focus-ring flex min-h-[44px] flex-col justify-center gap-1 px-3 py-2 sm:flex-row sm:items-center sm:gap-3';
  return (
    <li className="border-t border-slate-800/60 first:border-t-0">
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className={cls}>{inner}</a>
        : <div className={cls}>{inner}</div>}
    </li>
  );
};

const NewsFeed = ({ compact = false, limit, category = 'all' }) => {
  const [tab, setTab] = useState(category);
  const [retry, setRetry] = useState(0);
  const cat = compact ? category : tab;
  const n = limit || (compact ? 6 : 30);
  const res = usePolling(`${API}/api/news?limit=${n}&category=${cat}`, 300000, retry, undefined, true);
  const d = res.data;
  const items = Array.isArray(d?.items) ? d.items : null;
  const sources = Array.isArray(d?.sources) ? d.sources : [];
  const okCount = sources.filter((s) => s.ok).length;

  let body;
  if (res.error && !items) {
    body = (
      <div role="alert" className="flex flex-wrap items-center justify-center gap-3 p-6 text-sm text-rose-300">
        <span>News is unavailable right now.</span>
        <button type="button" onClick={() => setRetry((x) => x + 1)} className="focus-ring min-h-[36px] rounded-md border border-rose-300/40 px-3 py-1 text-xs hover:bg-rose-300/10">Retry</button>
      </div>
    );
  } else if (!items) {
    body = (
      <div role="status" aria-label="Loading news" className="space-y-2 p-3">
        {Array.from({ length: compact ? 4 : 8 }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
      </div>
    );
  } else if (!items.length) {
    body = <p className="p-6 text-center text-sm text-slate-500">No headlines right now.</p>;
  } else {
    body = <ul className={res.fetching ? 'opacity-60' : ''}>{items.slice(0, n).map((it) => <Row key={it.id || it.link} it={it} />)}</ul>;
  }

  return (
    <section aria-label="Market news" className="min-w-0 rounded-xl border border-slate-800/80 bg-slate-950/60">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 pt-3">
        <h2 className="text-sm font-semibold text-slate-200">{compact ? 'Latest headlines' : 'Headlines'}</h2>
        {compact
          ? <Link to="/news" className="focus-ring rounded text-xs text-cyan-300 hover:underline">View all news</Link>
          : <SegTabs tabs={TABS} active={tab} onChange={setTab} label="News category" />}
      </div>
      {d?.stale && <p role="status" className="mx-3 mt-2 rounded border border-amber-400/30 bg-amber-400/5 px-2 py-1 text-xs text-amber-200">Showing earlier headlines, refresh failed</p>}
      <div className="mt-2">{body}</div>
      {!compact && sources.length > 0 && (
        <details className="border-t border-slate-800/60 px-3 py-2 text-xs text-slate-400">
          <summary className="focus-ring cursor-pointer rounded">{okCount} of {sources.length} sources responding</summary>
          <ul className="mt-1 space-y-0.5">
            {sources.map((s) => <li key={s.name}>{s.name}: {s.ok ? 'ok' : 'not ok'}</li>)}
          </ul>
        </details>
      )}
      <p className="border-t border-slate-800/60 px-3 py-2 text-[11px] text-slate-500">{DISCLAIMER}</p>
    </section>
  );
};

export default NewsFeed;
