import React, { useEffect, useMemo, useState } from 'react';
import usePersistedState from '../../lib/usePersistedState';
import usePolling from '../../lib/usePolling';
import ScrollArea from '../ui/ScrollArea';
import { LoadingBlock } from '../ui/Skeleton';
import { Updating } from '../ui/Spinner';
import StatPopover from './StatPopover';
import { FUT, Notice, Panel, SortTh, coin, fmtPct, fmtPrice, fmtUsd, useSort } from './shared';
import { bubblesOf, confluence, layoutBubbles, levelsOf, summarize, tableRow } from './maxPainCalc';

export const PAIN_WINDOWS = ['12h', '24h', '3d', '1w'];
const TOPS = [20, 30];
const W = 900;
const H = 320;
const LONG = '#34d399'; // long pain = positions that die below the price
const SHORT = '#fb7185';
const NOTE = 'Estimates from inferred positions, not exchange data. Not advice.';
const TOUCH_LABEL = 'Volatility-based estimate, not a forecast';

const chip = (on) => `focus-ring min-h-[44px] rounded-md px-3 text-xs font-medium md:min-h-[32px] ${on ? 'bg-slate-800 text-cyan-300' : 'text-slate-400 hover:text-slate-200'}`;
const toggle = (on) => `focus-ring min-h-[44px] rounded-md border px-3 text-xs md:min-h-[32px] ${on ? 'border-cyan-400/60 text-cyan-300' : 'border-slate-700 text-slate-400'}`;

const Card = ({ title, value, children }) => (
  <div className="min-w-0 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
    <p className="text-[11px] uppercase tracking-wider text-slate-500">{title}</p>
    <p className="mt-1 text-lg font-semibold tabular-nums text-slate-100">{value}</p>
    <p className="mt-0.5 truncate text-xs text-slate-400">{children}</p>
  </div>
);

const names = (list) => (list.length ? list.map((c) => `${coin(c.symbol)}${c.side ? ` (${c.side})` : ''}`).join(', ') : 'none');

export const Cards = ({ rows }) => {
  const s = useMemo(() => summarize(rows), [rows]);
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      <Card title="Market pull" value={s.belowPct == null ? '--' : `${s.belowPct}% below`}>
        {s.belowPct == null ? 'No levels' : `${100 - s.belowPct}% above, nearer levels weigh more`}
      </Card>
      <Card title="Critical within 1%" value={`${s.criticalCount} ${s.criticalCount === 1 ? 'coin' : 'coins'}`}>{names(s.critical)}</Card>
      <Card title="Strongest level" value={s.strongest ? fmtUsd(s.strongest.usd) : '--'}>
        {s.strongest ? `${coin(s.strongest.symbol)} ${s.strongest.side}, ${fmtPct(s.strongest.pct)}` : 'No levels'}
      </Card>
      <Card title="Two-way squeeze" value={`${s.squeezeCount} ${s.squeezeCount === 1 ? 'coin' : 'coins'}`}>{names(s.squeeze)}</Card>
    </div>
  );
};

// The bubble field. Hit targets are the circles; the sortable table below is the keyboard and screen-reader route to the same data.
export const Field = ({ nodes, xMax, axis, selected, onSelect, onHover }) => {
  const half = (W - 56) / 2;
  const unit = axis === 'sigma' ? 'sigma' : '%';
  const ticks = [-1, -0.5, 0, 0.5, 1].map((f) => ({ x: W / 2 + f * half, label: `${+(f * xMax).toFixed(1)}${unit === '%' ? '%' : 's'}` }));
  const band = axis === 'pct' ? { x1: W / 2 - (1 / xMax) * half, x2: W / 2 + (1 / xMax) * half } : null;
  const text = (n) => `${coin(n.symbol)} ${n.side} pain at ${fmtPrice(n.price)}, ${fmtPct(n.pct)} from price, ${fmtUsd(n.usd)} estimated`;
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950/60">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="block min-w-[800px] w-full" role="group" aria-label="Pain field: bubbles by distance from price. The table below lists the same coins.">
        {band && <rect data-testid="critical-band" x={band.x1} y={0} width={band.x2 - band.x1} height={H} fill="#fbbf24" opacity="0.1" />}
        <line x1={W / 2} x2={W / 2} y1={0} y2={H} stroke="#64748b" strokeDasharray="5 5" />
        <text x={8} y={16} fill={LONG} fontSize="12">Long pain (below price)</text>
        <text x={W - 8} y={16} fill={SHORT} fontSize="12" textAnchor="end">Short pain (above price)</text>
        {ticks.map((t) => <text key={t.x} x={t.x} y={H + 14} fill="#94a3b8" fontSize="11" textAnchor="middle">{t.label}</text>)}
        {nodes.map((n) => {
          const on = selected === n.symbol;
          const pick = () => onSelect(n.symbol);
          return (
            <g
              key={n.key}
              role="button"
              tabIndex={0}
              aria-label={text(n)}
              aria-pressed={on}
              className="cursor-pointer outline-none [&:focus-visible>circle]:stroke-white"
              onClick={pick}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}
              onMouseEnter={() => onHover(text(n))}
              onMouseLeave={() => onHover('')}
              onFocus={() => onHover(text(n))}
              onBlur={() => onHover('')}
            >
              <circle cx={n.cx} cy={n.cy} r={n.r} fill={n.side === 'long' ? LONG : SHORT} fillOpacity={on ? 0.85 : 0.5} stroke={on ? '#67e8f9' : n.side === 'long' ? LONG : SHORT} strokeWidth={on ? 3 : 1.5} />
              {n.r >= 18 && <text x={n.cx} y={n.cy + 4} textAnchor="middle" fontSize="11" fill="#e2e8f0" pointerEvents="none">{coin(n.symbol).slice(0, 5)}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
};

const LevelCard = ({ title, tone, l, touch }) => (
  <div className="rounded-lg border border-slate-800 p-3 text-xs tabular-nums">
    <p className={`text-[11px] uppercase tracking-wider ${tone}`}>{title}</p>
    {l ? (
      <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1">
        <dt className="text-slate-500">Price</dt><dd className="text-right text-slate-100">{fmtPrice(l.price)}</dd>
        <dt className="text-slate-500">Distance</dt><dd className="text-right text-slate-100">{fmtPct(l.pct)}</dd>
        <dt className="text-slate-500">Est. liquidations</dt><dd className="text-right text-slate-100">{fmtUsd(l.usd)}</dd>
        <dt className="text-slate-500">Touch estimate</dt>
        <dd className="text-right text-slate-100" title={TOUCH_LABEL}>{l.touchPct == null ? '--' : `${l.touchPct}% (${l.sigma} sigma)`}</dd>
      </dl>
    ) : <p className="mt-1 text-slate-400">No level on this side.</p>}
    {l && touch}
  </div>
);

// Levels per window come from the existing /liqheat endpoint (cached 60 s server side), for the selected coin only.
const PainDetail = ({ symbol, win, row, onOpenHeatmap }) => {
  const heats = PAIN_WINDOWS.map((w) => usePolling(`${FUT}/liqheat/${symbol}?range=${w}`, 120000)); // eslint-disable-line react-hooks/rules-of-hooks
  const byWin = {};
  PAIN_WINDOWS.forEach((w, i) => { if (heats[i].data?.cols > 0) byWin[w] = levelsOf(heats[i].data); });
  const cur = heats[PAIN_WINDOWS.indexOf(win)].data;
  const r = row || (byWin[win] && { ...byWin[win], longUsd: cur.totals?.longUsd || 0, shortUsd: cur.totals?.shortUsd || 0 });
  const tot = r ? r.longUsd + r.shortUsd : 0;
  const lp = tot > 0 ? Math.round((r.longUsd / tot) * 100) : 0;
  const cf = (side) => confluence(byWin, win, side);
  const note = (side) => { const c = cf(side); return c.total ? <p className="mt-2 text-[11px] text-slate-400">Confluence: {c.count} of {c.total} windows within 1%</p> : null; };
  return (
    <Panel title={`${coin(symbol)} detail`} right={<button type="button" onClick={() => onOpenHeatmap(symbol)} className="focus-ring min-h-[44px] rounded-md px-2 text-xs text-cyan-300 md:min-h-0">Open heatmap</button>}>
      {!r ? (
        <Notice>{heats.every((h) => h.error) ? 'No levels available for this coin right now.' : 'Loading levels...'}</Notice>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <LevelCard title="Short pain above" tone="text-rose-300" l={r.above} touch={note('above')} />
            <LevelCard title="Long pain below" tone="text-emerald-300" l={r.below} touch={note('below')} />
          </div>
          <p className="text-[11px] text-slate-500">{TOUCH_LABEL}: normal approximation from recent candle volatility.{!row && ' This coin is outside the loaded top list, so no touch estimate.'}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <caption className="pb-1 text-left text-[11px] uppercase tracking-wider text-slate-500">Strongest levels per window</caption>
              <thead><tr className="text-slate-500"><th scope="col" className="py-1 text-left font-medium">Window</th><th scope="col" className="py-1 text-right font-medium">Long pain</th><th scope="col" className="py-1 text-right font-medium">Short pain</th></tr></thead>
              <tbody>
                {PAIN_WINDOWS.map((w) => (
                  <tr key={w} className={w === win ? 'text-cyan-300' : 'text-slate-300'}>
                    <th scope="row" className="py-1 text-left font-medium">{w}</th>
                    <td className="py-1 text-right">{byWin[w]?.below ? `${fmtPrice(byWin[w].below.price)} (${fmtPct(byWin[w].below.pct)})` : '--'}</td>
                    <td className="py-1 text-right">{byWin[w]?.above ? `${fmtPrice(byWin[w].above.price)} (${fmtPct(byWin[w].above.pct)})` : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs tabular-nums">
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-800" role="img" aria-label={`Estimated long liquidations ${lp} percent, short ${100 - lp} percent`}>
              <div style={{ width: `${lp}%`, background: LONG }} /><div style={{ width: `${100 - lp}%`, background: SHORT }} />
            </div>
            <div className="mt-1 flex justify-between"><span className="text-emerald-400">Longs {fmtUsd(r.longUsd)}</span><span className="text-rose-400">Shorts {fmtUsd(r.shortUsd)}</span></div>
          </div>
        </div>
      )}
    </Panel>
  );
};

const GETTERS = {
  symbol: (r) => r.symbol,
  longPrice: (r) => r.longPrice,
  longPct: (r) => (r.longPct == null ? null : Math.abs(r.longPct)),
  shortPrice: (r) => r.shortPrice,
  shortPct: (r) => (r.shortPct == null ? null : Math.abs(r.shortPct)),
  usd: (r) => r.usd,
  sigma: (r) => r.sigma,
};

export const CoinTable = ({ rows, selected, onSelect }) => {
  const { sorted, sort, toggle: tg } = useSort(rows, GETTERS, 'usd', 'desc', 'painField');
  const th = { sort, toggle: tg };
  return (
    <ScrollArea label="Coins" footer="Sorted by the column you pick. Distances sort by size, not direction.">
      <table className="w-full min-w-[640px] text-xs tabular-nums">
        <thead className="sticky top-0 bg-slate-950 text-slate-500">
          <tr>
            <SortTh k="symbol" left {...th}>Coin</SortTh>
            <SortTh k="longPrice" {...th}>Long level</SortTh>
            <SortTh k="longPct" {...th}>Dist</SortTh>
            <SortTh k="shortPrice" {...th}>Short level</SortTh>
            <SortTh k="shortPct" {...th}>Dist</SortTh>
            <SortTh k="usd" {...th}>Est. $</SortTh>
            <SortTh k="sigma" {...th}>Sigma</SortTh>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.symbol} className={`border-t border-slate-800/70 ${selected === r.symbol ? 'bg-slate-800/50' : ''}`}>
              <th scope="row" className="px-2 text-left font-medium">
                <button type="button" aria-pressed={selected === r.symbol} onClick={() => onSelect(r.symbol)} className="focus-ring min-h-[44px] rounded px-1 text-left text-slate-100 hover:text-cyan-300">{coin(r.symbol)}</button>
              </th>
              <td className="px-2 text-right text-emerald-300">{r.longPrice == null ? '--' : fmtPrice(r.longPrice)}</td>
              <td className="px-2 text-right text-slate-300">{r.longPct == null ? '--' : fmtPct(r.longPct)}</td>
              <td className="px-2 text-right text-rose-300">{r.shortPrice == null ? '--' : fmtPrice(r.shortPrice)}</td>
              <td className="px-2 text-right text-slate-300">{r.shortPct == null ? '--' : fmtPct(r.shortPct)}</td>
              <td className="px-2 text-right text-slate-100">{fmtUsd(r.usd)}</td>
              <td className="px-2 text-right text-slate-300">{r.sigma == null ? '--' : r.sigma.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
};

const Pill = ({ tone, children }) => (
  <span role="status" className={`rounded border px-1.5 py-0.5 text-[11px] ${tone === 'bad' ? 'border-rose-400/50 text-rose-300' : tone === 'warn' ? 'border-amber-400/50 text-amber-400' : 'border-emerald-400/40 text-emerald-300'}`}>{children}</span>
);

const FAQ = [
  ['What is pain?', 'For each coin the model finds the price level with the most estimated liquidations below the price (long pain) and above it (short pain). Size is the estimated liquidation value at that level.'],
  ['Where do the numbers come from?', 'The same open-interest model as the heatmap: inferred positions, not exchange data. Real positions are not public.'],
  ['What is the touch estimate?', `${TOUCH_LABEL}. It converts the distance to the level into sigmas of recent candle volatility over the window and applies a normal approximation. It ignores trend and news.`],
  ['What does market pull mean?', 'The share of estimated liquidation value below versus above price across the listed coins, with nearer levels weighed more. It describes where the estimates sit, not where price will go.'],
  ['Confluence?', 'For the selected coin, how many of the 12h, 24h, 3d and 1w windows put their strongest level within 1% of the selected window. It is not computed for every coin because that would multiply the upstream requests by four.'],
];

const PainField = ({ symbol, onOpenHeatmap = () => {} }) => {
  const [win, setWin] = usePersistedState('liquidation.painWindow', '24h', { validate: (v) => PAIN_WINDOWS.includes(v) });
  const [top, setTop] = usePersistedState('liquidation.painTop', 20, { validate: (v) => TOPS.includes(v) });
  const [axis, setAxis] = usePersistedState('liquidation.painAxis', 'pct', { validate: (v) => v === 'pct' || v === 'sigma' });
  const [q, setQ] = useState('');
  const [longOn, setLong] = useState(true);
  const [shortOn, setShort] = useState(true);
  const [critOnly, setCrit] = useState(false);
  const [selected, setSelected] = useState(symbol);
  const [hover, setHover] = useState('');
  const [tick, setTick] = useState(0);
  useEffect(() => setSelected(symbol), [symbol]); // the page's coin is the default pick

  const { data, error, loading, fetching } = usePolling(`${FUT}/maxpain?window=${win}&top=${top}`, 60000, tick, undefined, true);
  const all = useMemo(() => data?.rows || [], [data]);
  const rows = useMemo(() => {
    const s = q.trim().toUpperCase();
    return s ? all.filter((r) => coin(r.symbol).includes(s)) : all;
  }, [all, q]);
  const { items, noSigma } = useMemo(() => bubblesOf(rows, { axis, long: longOn, short: shortOn, criticalOnly: critOnly }), [rows, axis, longOn, shortOn, critOnly]);
  const { nodes, xMax } = useMemo(() => layoutBubbles(items, { width: W, height: H }), [items]);
  const tableRows = useMemo(() => rows.map(tableRow), [rows]);
  const selRow = all.find((r) => r.symbol === selected) || null;

  const stale = !!data && (data.stale || !!error);
  const status = error && !data ? <Pill tone="bad">Error</Pill> : loading || !data ? <Pill tone="warn">Loading</Pill>
    : stale ? <Pill tone="warn">Stale</Pill> : data.skipped > 0 ? <Pill tone="warn">Partial</Pill> : <Pill>Live</Pill>;

  return (
    <Panel
      id="liq-max-pain"
      title="Liquidation max pain: pain field"
      right={(
        <div className="flex flex-wrap items-center gap-2">
          {status}
          {fetching && <Updating />}
          <button type="button" onClick={() => setTick((t) => t + 1)} className="focus-ring min-h-[44px] rounded-md border border-slate-700 px-3 text-xs text-slate-300 md:min-h-[32px]">Refresh</button>
          <StatPopover label="About pain field" trigger="FAQ" className="focus-ring min-h-[44px] rounded-md border border-slate-700 px-3 text-xs text-slate-300 md:min-h-[32px]">
            <div className="max-h-72 space-y-2 overflow-y-auto">{FAQ.map(([a, b]) => <p key={a}><strong className="text-slate-100">{a}</strong> {b}</p>)}</div>
          </StatPopover>
        </div>
      )}
    >
      <div className="space-y-3">
        <p className="text-xs text-amber-400">{NOTE}</p>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Window" className="inline-flex gap-0.5">
            {PAIN_WINDOWS.map((w) => <button key={w} type="button" aria-pressed={win === w} onClick={() => setWin(w)} className={chip(win === w)}>{w}</button>)}
          </div>
          <label className="text-xs text-slate-400">
            <span className="sr-only">Number of coins</span>
            <select aria-label="Number of coins" value={top} onChange={(e) => setTop(Number(e.target.value))} className="focus-ring min-h-[44px] rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 md:min-h-[32px]">
              {TOPS.map((n) => <option key={n} value={n}>Top {n}</option>)}
            </select>
          </label>
          <input type="search" aria-label="Filter coins" placeholder="Search coin" value={q} onChange={(e) => setQ(e.target.value)} className="focus-ring min-h-[44px] w-32 rounded-md border border-slate-700 bg-slate-950 px-2 text-xs text-slate-200 md:min-h-[32px]" />
          <div role="group" aria-label="Axis" className="inline-flex gap-0.5">
            <button type="button" aria-pressed={axis === 'pct'} onClick={() => setAxis('pct')} className={chip(axis === 'pct')}>Distance %</button>
            <button type="button" aria-pressed={axis === 'sigma'} onClick={() => setAxis('sigma')} className={chip(axis === 'sigma')}>Volatility sigma</button>
          </div>
        </div>

        {error && !data ? (
          <Notice tone="error">{error?.response?.status === 503 ? 'Binance futures data is unavailable from this server.' : 'Max pain data is unavailable right now. Retrying.'}</Notice>
        ) : !data ? (
          <LoadingBlock height={320} label="Computing pain levels for the top coins. The first load can take a while." />
        ) : (
          <>
            {stale && <p role="status" className="text-xs text-amber-400">{data.stale ? 'Showing the last computed board while it refreshes.' : `Showing data from ${new Date(data.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: refresh failed, retrying.`}</p>}
            {data.skipped > 0 && <p className="text-xs text-amber-400">Partial: {data.skipped} {data.skipped === 1 ? 'coin was' : 'coins were'} skipped (no data or no levels), {data.count} shown.</p>}
            <Cards rows={all} />
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={longOn} onClick={() => setLong((v) => !v)} className={toggle(longOn)}>Long pain</button>
              <button type="button" aria-pressed={shortOn} onClick={() => setShort((v) => !v)} className={toggle(shortOn)}>Short pain</button>
              <button type="button" aria-pressed={critOnly} onClick={() => setCrit((v) => !v)} className={toggle(critOnly)}>Critical only (within 1%)</button>
            </div>
            {nodes.length ? <Field nodes={nodes} xMax={xMax} axis={axis} selected={selected} onSelect={setSelected} onHover={setHover} /> : <Notice>No levels match these filters.</Notice>}
            <p className="min-h-[1rem] text-xs text-slate-400" aria-live="polite">{hover || 'Bubble size is the estimated liquidation value. Shaded band: within 1% of price.'}{axis === 'sigma' && noSigma > 0 ? ` ${noSigma} without enough candle history are not drawn.` : ''}</p>
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Coins</h3>
            {tableRows.length ? <CoinTable rows={tableRows} selected={selected} onSelect={setSelected} /> : <Notice>No coin matches the search.</Notice>}
          </>
        )}
        <PainDetail key={selected} symbol={selected} win={win} row={selRow} onOpenHeatmap={onOpenHeatmap} />
        <p className="text-[11px] text-slate-500">Each coin costs about two exchange requests per minute while cached data is fresh. Window sigma uses the candles of the chosen window.</p>
      </div>
    </Panel>
  );
};

export default PainField;
