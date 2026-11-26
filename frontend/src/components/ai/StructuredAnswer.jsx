import React from 'react';
import { isNum, rankLevels } from '../../lib/agentReply';

const VERDICT = {
  long: ['Long', 'border-emerald-400/50 bg-emerald-400/10 text-emerald-300'],
  short: ['Short', 'border-rose-400/50 bg-rose-400/10 text-rose-300'],
  neutral: ['Neutral', 'border-slate-500/60 bg-slate-500/10 text-slate-300'],
  avoid: ['Avoid', 'border-amber-400/50 bg-amber-400/10 text-amber-300'],
};
const KIND = { support: '#34d399', resistance: '#fb7185', liquidation: '#f59e0b', invalidation: '#a78bfa', target: '#22d3ee' };
const CONF = { low: 1, medium: 2, high: 3 };
const px = (v) => (isNum(v) ? (v >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(Number(v.toPrecision(4)))) : '-');
const usd = (v) => (isNum(v) ? `$${Math.round(v * 100) / 100}` : '-');
const list = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string' && x) : []);

// Horizontal ladder, to scale: stop, entry, target dots + current price marker. Left-to-right is low-to-high price,
// so a long reads stop < entry < target and a short reads target < entry < stop.
export const Ladder = ({ plan, price }) => {
  const pts = [['Stop', plan.stop, '#fb7185'], ['Entry', plan.entry, '#e2e8f0'], ['Target', plan.target, '#34d399']].filter(([, v]) => isNum(v));
  if (pts.length < 2) return null;
  const all = [...pts.map((p) => p[1]), ...(isNum(price) ? [price] : [])];
  const lo = Math.min(...all);
  const span = Math.max(...all) - lo || 1;
  const x = (v) => 30 + ((v - lo) / span) * 240;
  return (
    <svg viewBox="0 0 300 56" role="img" aria-label="Price ladder" className="mt-2 w-full">
      <line x1="30" x2="270" y1="26" y2="26" stroke="#334155" strokeWidth="2" />
      {pts.map(([name, v, c]) => (
        <g key={name} data-ladder={name} data-x={x(v).toFixed(1)}>
          <circle cx={x(v)} cy="26" r="5" fill={c} />
          <text x={x(v)} y="48" textAnchor="middle" fontSize="9" fill="#94a3b8">{name} {px(v)}</text>
        </g>
      ))}
      {isNum(price) && <g data-ladder="Now" data-x={x(price).toFixed(1)}><line x1={x(price)} x2={x(price)} y1="12" y2="40" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="2 2" /><text x={x(price)} y="9" textAnchor="middle" fontSize="9" fill="#22d3ee">Now</text></g>}
    </svg>
  );
};

const Stat = ({ k, v }) => <div className="flex justify-between gap-2"><dt className="text-slate-500">{k}</dt><dd className="text-slate-100">{v}</dd></div>;

const Bullets = ({ title, items, tone }) => (items.length ? (
  <div className="min-w-0"><h5 className={`text-[11px] font-semibold uppercase tracking-wide ${tone}`}>{title}</h5>
    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-300">{items.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ul></div>
) : null);

const StructuredAnswer = ({ s }) => {
  const [label, cls] = VERDICT[s?.verdict] || VERDICT.neutral;
  const dots = CONF[s?.confidence] || 0;
  const plan = s?.plan;
  const price = isNum(s?.price) ? s.price : plan?.entry; // ponytail: contract has no price field; entry stands in for the marker
  const levels = rankLevels(s?.levels, price);
  const bull = list(s?.bull); const bear = list(s?.bear); const risks = list(s?.risks); const needs = list(s?.needsData);
  return (
    <div aria-label="Structured answer" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded border px-2 py-0.5 text-xs font-semibold uppercase ${cls}`}>{label}</span>
        {dots > 0 && (
          <span aria-label={`Confidence ${s.confidence}`} className="flex items-center gap-1 text-[11px] text-slate-400">
            {[1, 2, 3].map((n) => <span key={n} data-dot={n <= dots ? 'on' : 'off'} className={`h-2 w-2 rounded-full ${n <= dots ? 'bg-cyan-400' : 'bg-slate-700'}`} />)}{s.confidence}
          </span>
        )}
      </div>
      {s?.headline && <p className="break-words text-sm font-semibold text-slate-100">{s.headline}</p>}
      {s?.summary && <p className="break-words text-xs text-slate-300">{s.summary}</p>}
      {plan && (
        <section aria-label="Trade plan" className="rounded-lg border border-slate-700/70 bg-slate-950/50 p-2 text-xs">
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-slate-500">Trade plan</h4>
          <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5">
            <Stat k="Side" v={plan.side || '-'} /><Stat k="Horizon" v={plan.horizon || '-'} />
            <Stat k="Entry" v={px(plan.entry)} /><Stat k="Size" v={usd(plan.sizeUsd)} />
            <Stat k="Stop" v={px(plan.stop)} /><Stat k="Leverage" v={isNum(plan.leverage) ? `${plan.leverage}x` : '-'} />
            <Stat k="Target" v={px(plan.target)} /><Stat k="R:R" v={isNum(plan.rr) ? String(Math.round(plan.rr * 100) / 100) : '-'} />
            <Stat k="Risk" v={usd(plan.riskUsd)} /><Stat k="Reward" v={usd(plan.rewardUsd)} />
          </dl>
          <Ladder plan={plan} price={price} />
        </section>
      )}
      {levels.length > 0 && (
        <ul aria-label="Levels" className="space-y-0.5 text-xs">
          {levels.map((l, i) => (
            <li key={i} className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5"><span className="h-2 w-2 shrink-0 rounded-full" style={{ background: KIND[l.kind] || '#64748b' }} /><span className="truncate text-slate-300">{l.label || l.kind}</span></span>
              <span className="tabular-nums text-slate-100">{px(l.price)}{l.dist != null && <span className="ml-1 text-slate-500">{l.dist > 0 ? '+' : ''}{l.dist.toFixed(1)}%</span>}</span>
            </li>
          ))}
        </ul>
      )}
      {(bull.length > 0 || bear.length > 0) && <div className="grid grid-cols-2 gap-3"><Bullets title="Bull" items={bull} tone="text-emerald-300" /><Bullets title="Bear" items={bear} tone="text-rose-300" /></div>}
      {risks.length > 0 && <ul aria-label="Risks" className="list-disc space-y-0.5 rounded-md border border-amber-400/30 bg-amber-400/10 py-1.5 pl-6 pr-2 text-xs text-amber-200">{risks.map((t, i) => <li key={i} className="break-words">{t}</li>)}</ul>}
      {needs.length > 0 && <p className="text-[11px] text-slate-500">Needs data: {needs.join(', ')}</p>}
    </div>
  );
};

export default StructuredAnswer;
