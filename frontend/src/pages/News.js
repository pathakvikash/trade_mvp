import React from 'react';
import NewsFeed from '../components/news/NewsFeed';

const SOURCES = ['Cointelegraph', 'CoinDesk', 'Decrypt', 'Mint', 'Economic Times', 'Business Standard'];

// Public headlines page: links out only, never republishes articles.
const News = () => (
  <div className="mx-auto flex w-full min-w-0 max-w-4xl flex-col gap-4">
    <div>
      <h1 className="text-lg font-semibold text-slate-200">News</h1>
      <p className="text-xs text-slate-400">Headlines from public RSS feeds. We link out; we do not republish articles.</p>
    </div>
    <NewsFeed />
    <section aria-label="Sources">
      <h2 className="text-sm font-semibold text-slate-200">Sources</h2>
      <p className="mt-1 text-xs text-slate-400">{SOURCES.join(', ')}</p>
    </section>
  </div>
);

export default News;
