import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import Panel from '../ui/Panel';
import Skeleton from '../ui/Skeleton';
import AgentLauncher from '../ai/AgentLauncher';
import usePolling from '../../lib/usePolling';
import { moverBias, oiChangePct, lastRatio, nearestClusters, TH } from '../../lib/moverBias';
import { FUT, coin, fmtPct } from '../liquidation/shared';
import { topMovers } from './stats';
import { toneCls } from './format';

const POLL_MS = 60000;
const BIAS_CLS = { Long: 'border-emerald-400/50 text-emerald-400', Short: 'border-rose-400/50 text-rose-400', Wait: 'border-slate-600 text-slate-300' };
const chip = 'rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider';

const HowItWorks = () => (
  <details className="mt-2 text-xs text-slate-400">
    <summary className="focus-ring cursor-pointer rounded text-cyan-400 hover:text-cyan-300">How this is computed</summary>
    <div className="mt-1 space-y-1 rounded-lg border border-slate-800 bg-slate-900/40 p-2">
      <p>A fixed rule set scores each input from -1 (short lean) to +1 (long lean) and adds them up. No AI model is called, and the same numbers always give the same answer.</p>
      <ul className="list-disc space-y-0.5 pl-4">
        <li>24h move: a move of {TH.move}% or more adds a small lean in its direction.</li>
        <li>Funding: very high funding means crowded longs (leans short); very negative funding means crowded shorts (squeeze risk, leans long).</li>
        <li>Open interest, 24h: rising with the move backs it; falling against it weakens it.</li>
        <li>Long/short account ratio: heavily long or short accounts lean the other way.</li>
        <li>Liquidation map: the nearer estimated cluster within {TH.clusterNear}% on either side. This is a model estimate, not real positions.</li>
      </ul>
      <p>Long or Short needs a total score of 1 or more and the factors mostly agreeing; otherwise it says Wait. Confidence rises with the number of agreeing factors. If the 24h move or funding is missing, it always says Wait. Missing inputs are shown as chips and never guessed.</p>
      <p>The levels are fixed rules, not predictions, and have not been tested for accuracy.</p>
    </div>
  </details>
);

export const MoverCard = ({ title, row }) => {
  const sym = row.symbol;
  const stats = usePolling(`${FUT}/stats/${sym}?period=1h`, POLL_MS);
  const lm = usePolling(`${FUT}/liqmap/${sym}`, POLL_MS);
  const result = useMemo(() => moverBias({
    price: row.lastPrice,
    change24h: row.priceChangePercent,
    funding: row.fundingRate,
    oiChange24h: oiChangePct(stats.data?.openInterest),
    lsRatio: lastRatio(stats.data?.longShort),
    liq: nearestClusters(lm.data?.levels, Number.isFinite(row.lastPrice) ? row.lastPrice : lm.data?.price),
  }), [row, stats.data, lm.data]);
  const waiting = (stats.loading || lm.loading) && !stats.data && !lm.data;
  const b = result.bias;

  return (
    <article className="rounded-lg border border-slate-800 bg-slate-900/40 p-3" aria-label={`${title}: ${coin(sym)}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{title}</h3>
        <span className="font-semibold text-slate-100">{coin(sym)}</span>
        <span className={`text-sm tabular-nums ${toneCls(row.priceChangePercent)}`}>{fmtPct(row.priceChangePercent)}</span>
      </div>
      {waiting ? (
        <div role="status" className="mt-2 space-y-2">
          <span className="sr-only">Loading bias</span>
          <Skeleton className="h-5 w-28" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-2/3" />
        </div>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`${chip} ${BIAS_CLS[b]}`} aria-label={`Bias ${b}`}>Bias: {b}</span>
            <span className={`${chip} border-slate-600 text-slate-300`}>{result.confidence} confidence</span>
            {result.missing.map((m) => <span key={m} className={`${chip} border-amber-400/40 text-amber-400`}>data missing: {m}</span>)}
          </div>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-300">
            {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          <p className="mt-2 text-xs text-slate-300"><span className="font-semibold text-slate-200">Invalidation: </span>{result.invalidation}</p>
        </>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <Link to={`/trade?symbol=${coin(sym)}`} className="focus-ring inline-flex items-center rounded-md border border-slate-700 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-900 max-sm:min-h-9">Open in Trade</Link>
        <AgentLauncher kind="perp" symbol={sym} page="dashboard" label="Ask AI why" className="max-sm:min-h-9" />
      </div>
    </article>
  );
};

// Top 24h gainer and loser among perps, each with a deterministic bias. Polls stats and the liquidation map at 60 s; never calls the LLM.
const MoverBias = ({ rows, loading, failed }) => {
  const { gainers, losers } = useMemo(() => topMovers(rows, 1), [rows]);
  const g = gainers[0];
  const l = losers[0];
  let body;
  if (loading) body = <div className="grid gap-3 sm:grid-cols-2" role="status"><span className="sr-only">Loading movers</span><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  else if (!g || !l) body = <p className="py-3 text-center text-sm text-slate-400">{failed ? 'Market data unavailable, retrying.' : 'No data yet.'}</p>;
  else {
    body = (
      <div className="grid gap-3 sm:grid-cols-2">
        <MoverCard title="Top gainer" row={g} />
        <MoverCard title="Top loser" row={l} />
      </div>
    );
  }
  return (
    <Panel title="Movers: trade bias" bodyClassName="p-3">
      {body}
      <HowItWorks />
      <p className="mt-2 text-[11px] text-slate-500">Analysis only, not financial advice. Paper trading.</p>
    </Panel>
  );
};

export default MoverBias;
