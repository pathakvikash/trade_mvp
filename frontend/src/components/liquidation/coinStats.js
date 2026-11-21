// Pure numbers for the coin detail drawer, from the SAMPLED per-symbol buffer ({since, events}).
// events: [{side:'long'|'short', price, usd, ts}]. Only the last 24h count; `windowMs` is how much of
// those 24h the buffer actually covers (it starts at server boot), so the UI can say so.
const H = 3600e3;

export function summarizeCoin(events, since, now = Date.now()) {
  const t0 = now - 24 * H;
  const ev = (events || []).filter((e) => e.ts >= t0 && e.ts <= now);
  const hours = Array.from({ length: 24 }, (_, i) => ({ t: t0 + i * H, long: 0, short: 0, count: 0 }));
  let longUsd = 0;
  let shortUsd = 0;
  let largest = null;
  const pxSum = { long: 0, short: 0 }; // usd-weighted price per side
  for (const e of ev) {
    const h = hours[Math.min(23, Math.floor((e.ts - t0) / H))];
    h[e.side] += e.usd;
    h.count += 1;
    if (e.side === 'long') longUsd += e.usd; else shortUsd += e.usd;
    pxSum[e.side] += e.price * e.usd;
    if (!largest || e.usd > largest.usd) largest = e;
  }
  const total = longUsd + shortUsd;
  const top = [...ev].sort((a, b) => b.usd - a.usd).slice(0, 10);
  return {
    longUsd,
    shortUsd,
    total,
    count: ev.length,
    avg: ev.length ? total / ev.length : 0,
    largest,
    longPct: total ? (longUsd / total) * 100 : 50,
    vwap: { long: longUsd ? pxSum.long / longUsd : null, short: shortUsd ? pxSum.short / shortUsd : null },
    hours,
    top,
    windowMs: Math.min(24 * H, Math.max(0, now - (since || t0))),
  };
}

export const dominantSide = (longPct) => (longPct >= 60 ? 'long' : longPct <= 40 ? 'short' : 'balanced');

// One strictly descriptive sentence: what was liquidated and where, never what comes next.
export function insightText(s, { coin, changePct, fmtPrice, fmtUsd }) {
  if (!s.count) return `No sampled ${coin} liquidations in this window.`;
  const side = dominantSide(s.longPct);
  const move = Number.isFinite(changePct) ? ` Price is ${changePct >= 0 ? 'up' : 'down'} ${Math.abs(changePct).toFixed(2)}% over 24h.` : '';
  const peak = s.hours.reduce((a, b) => (b.long + b.short > a.long + a.short ? b : a));
  const peakTxt = ` Busiest sampled hour: ${new Date(peak.t).getHours().toString().padStart(2, '0')}:00 (${fmtUsd(peak.long + peak.short)}).`;
  if (side === 'long') return `Longs dominate (${s.longPct.toFixed(0)}%): leveraged longs were force-closed as price fell, centred near ${fmtPrice(s.vwap.long)}.${move}${peakTxt}`;
  if (side === 'short') return `Shorts dominate (${(100 - s.longPct).toFixed(0)}%): leveraged shorts were force-closed as price rose, centred near ${fmtPrice(s.vwap.short)}.${move}${peakTxt}`;
  return `Balanced: longs ${s.longPct.toFixed(0)}% / shorts ${(100 - s.longPct).toFixed(0)}%, both sides were liquidated.${move}${peakTxt}`;
}
