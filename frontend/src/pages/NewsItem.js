import React from 'react';
import { Link, useParams } from 'react-router-dom';
import usePolling from '../lib/usePolling';
import { API } from '../lib/apiBase';
import Skeleton from '../components/ui/Skeleton';
import { DISCLAIMER, NewsThumb, safeHref, timeAgo } from '../components/news/NewsFeed';

const back = <Link to="/news" className="focus-ring inline-flex min-h-[44px] items-center rounded text-sm text-cyan-300 hover:underline">&larr; Back to news</Link>;

// In-app detail for one headline: text only, the publisher link is a button out.
const NewsItem = () => {
  const { id } = useParams();
  const res = usePolling(`${API}/api/news/${encodeURIComponent(id)}`, 300000, 0, undefined, true);
  const it = res.data?.item || null;
  const notFound = res.error?.response?.status === 404;
  const href = it && safeHref(it.link);
  const when = it ? new Date(it.publishedAt) : null;
  const valid = when && !Number.isNaN(when.getTime());

  let body;
  if (!it && notFound) body = <p className="text-sm text-slate-300">This headline is no longer in the feed.</p>;
  else if (!it && res.error) body = <p role="alert" className="text-sm text-rose-300">News is unavailable right now.</p>;
  else if (!it) body = <div role="status" aria-label="Loading news"><Skeleton className="h-48 w-full" /></div>;
  else {
    body = (
      <article className="flex flex-col gap-3">
        <NewsThumb it={it} cls="h-48 w-full text-5xl sm:h-64" />
        <h1 className="text-lg font-semibold text-slate-100">{String(it.title)}</h1>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-slate-400">
          <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-slate-300">{it.source}</span>
          {valid && <time dateTime={it.publishedAt}>{when.toLocaleString()}</time>}
          <span>{timeAgo(it.publishedAt)}</span>
        </p>
        {typeof it.summary === 'string' && it.summary && <p className="text-sm text-slate-300">{it.summary}</p>}
        {href && (
          <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="focus-ring inline-flex min-h-[44px] items-center justify-center rounded-md bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
            Read full article on {it.source}
          </a>
        )}
      </article>
    );
  }
  return (
    <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-3">
      {back}
      {body}
      <p className="border-t border-slate-800/60 pt-2 text-[11px] text-slate-500">{DISCLAIMER}</p>
    </div>
  );
};

export default NewsItem;
