import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import useUserStore from '../../store/userStore';
import { API, authed } from '../../lib/api';
import Panel from '../ui/Panel';
import { Disclosures } from './BotPerformance';
import describeSpec from '../../lib/describeSpec';
import { btnDanger, btnGo, createdCache, dollars, Err, num, useAction, usd } from './shared';

const Row = ({ k, v }) => <div className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right text-slate-100">{v}</dd></div>;

// The approval screen: everything the bot will do, from the stored bot (the server re-checks the hash on accept).
// Accept sends the hash this screen was loaded with; if the bot changed since, the server answers 409 HASH_MISMATCH.
const BotAccept = ({ bot, cfg, onChanged }) => {
  const token = useUserStore((s) => s.token);
  const [ack, setAck] = useState(false);
  // Hash captured on mount (and on review): accept sends THIS one, so a changed bot gets 409 instead of silent approval.
  const [hash, setHash] = useState(bot.acceptHash);
  const [changed, setChanged] = useState(false);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (bot.acceptHash !== hash) { setAck(false); setChanged(true); }
  }, [bot.acceptHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const { busy, error, run } = useAction();
  const L = bot.limits || {};
  const spec = bot.spec || {};
  const risk = spec.risk || {};
  const made = createdCache.get(String(bot._id));
  const caps = cfg?.caps || {};
  const stopLoss = typeof risk.stopPct === 'number' ? (bot.sizeUsd * risk.stopPct) / 100 : null;
  const bt = made?.backtest;
  const stats = bt?.stats || {};

  const act = (path, body) => run(async () => { const r = await axios.post(`${API}/api/bots/${bot._id}/${path}`, body, authed(token)); onChanged(r.data, path === 'accept' ? 'Accepted. Press Start when you are ready.' : 'Declined.'); })
    .then(() => null);

  const lines = made?.describe ? [made.describe] : describeSpec(spec);
  const worst = made ? `${usd(made.worstCaseLossCents)} (stop hit plus fees)` : stopLoss == null ? '--' : `about ${dollars(stopLoss)} at the stop, plus fees`;

  return (
    <Panel title="Step 1 and 2: review and accept" className="border-amber-400/30">
      <div className="space-y-4 text-sm">
        <p className="text-slate-300">Nothing runs until you accept. This is exactly what the bot will run:</p>
        <section aria-label="What it does" className="space-y-1">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">What it does</h3>
          <ul className="list-disc space-y-1 pl-4 text-slate-100">
            <li>{`Trades ${bot.symbol} perpetual futures (paper money) on ${bot.interval} candles.`}</li>
            {lines.map((l, i) => <li key={i} className="break-words">{l}</li>)}
            <li>{`Uses ${dollars(bot.sizeUsd)} per position at ${bot.leverage}x leverage.`}</li>
            <li>{`Stop loss ${risk.stopPct ?? 'none'}%, take profit ${risk.targetPct ?? 'none'}%. Worst case per trade: ${worst}.`}</li>
            <li>{`Daily loss limit ${dollars(L.dailyLossUsd)}: when reached the bot is killed and will not restart by itself. At most ${num(L.maxTradesPerDay, 0)} trades per day.`}</li>
          </ul>
        </section>
        <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2 sm:gap-x-6" aria-label="Bot terms">
          <Row k="Strategy" v={String(bot.name)} />
          <Row k="Symbol" v={`${bot.symbol} perpetual (paper)`} />
          <Row k="Candle interval" v={bot.interval} />
          <Row k="Position size" v={dollars(bot.sizeUsd)} />
          <Row k="Leverage" v={`${bot.leverage}x`} />
          <Row k="Stop loss / take profit" v={`${risk.stopPct ?? 'none'}% / ${risk.targetPct ?? 'none'}%`} />
          <Row k="Daily loss limit (kill switch)" v={dollars(L.dailyLossUsd)} />
          <Row k="Max trades per day" v={num(L.maxTradesPerDay, 0)} />
          <Row k="Max position / max leverage" v={`${dollars(L.maxPositionUsd)} / ${L.maxLeverage}x`} />
          <Row k="Allowed symbols" v={Array.isArray(L.symbols) ? L.symbols.join(', ') : '--'} />
          <Row k="Worst-case loss per trade" v={worst} />
          <Row k="Hard caps (server)" v={`${caps.MAX_BOTS ?? '--'} bots, ${caps.MAX_RUNNING ?? '--'} running, ${caps.MAX_LEVERAGE ?? '--'}x, ${dollars(caps.MAX_SIZE_USD)}`} />
        </dl>
        <div aria-label="Backtest">
          <h4 className="text-xs font-medium text-slate-300">Backtest (fitted to the past)</h4>
          {made ? (
            <>
              <p className="text-xs text-slate-400">{bt ? Object.entries(stats).map(([k, v]) => `${k}: ${typeof v === 'number' ? num(v) : String(v ?? '--')}`).join('; ') : 'Backtest unavailable.'}</p>
              <ul className="list-disc pl-4 text-xs text-slate-500">{(bt?.caveats || []).map((c, i) => <li key={i}>{String(c)}</li>)}</ul>
            </>
          ) : <p className="text-xs text-slate-500">The backtest is shown only when a bot is created. Backtests are not predictions; forward results on few trades are noise.</p>}
        </div>
        <div role="alert" className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-xs text-amber-200">
          {cfg?.disclosure || 'Paper money only. Not financial advice.'}
        </div>
        <Disclosures />
        <details>
          <summary className="focus-ring min-h-[44px] cursor-pointer py-3 text-xs text-slate-400">Show exact spec</summary>
          <pre className="max-h-60 overflow-auto rounded-md border border-slate-800 bg-slate-900/60 p-2 text-[11px] text-slate-300">{JSON.stringify(spec, null, 2)}</pre>
        </details>
        {/* sticky: the approval controls stay reachable however long the terms are (mobile especially) */}
        <div className="sticky bottom-0 z-10 -mx-3 -mb-3 space-y-2 rounded-b-xl border-t border-slate-800 bg-slate-950 p-3">
          <label className="flex min-h-[44px] items-center gap-2 text-slate-200">
            <input type="checkbox" className="h-5 w-5 shrink-0" checked={ack} onChange={(e) => { setAck(e.target.checked); if (e.target.checked) { setHash(bot.acceptHash); setChanged(false); } }} disabled={busy} />
            I have read this and approve exactly these terms.
          </label>
          {changed && <p role="alert" className="text-xs text-amber-300">The terms changed. Review them again, then tick the box to accept the new terms.</p>}
          <Err>{error}</Err>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!ack || busy} onClick={() => act('accept', { acceptHash: hash, ack: true })} className={`${btnGo} flex-1 sm:flex-none`}>{busy ? 'Working...' : 'Accept'}</button>
            <button type="button" disabled={busy} onClick={() => act('decline')} className={btnDanger}>Decline</button>
          </div>
        </div>
      </div>
    </Panel>
  );
};

export default BotAccept;
