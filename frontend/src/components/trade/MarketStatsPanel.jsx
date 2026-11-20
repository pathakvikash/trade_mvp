import React, { useEffect, useState } from 'react';
import Panel from '../ui/Panel';
import KeyStats from './KeyStats';
import { fmtCompact, fmtCountdown, fmtPct, fmtPrice, fmtUsd } from '../ui/fmt';

const money = (v) => (v == null ? '--' : `$${fmtPrice(v)}`);
const toneOf = (v) => (v == null ? undefined : v >= 0 ? 'text-emerald-400' : 'text-rose-400');

// Stats for the selected perp, from the futures overview row plus the live mark. No extra requests.
// row: overview entry for the symbol (or null); mark: futuresStore mark (or null until ready).
const MarketStatsPanel = ({ row, mark, className = '' }) => {
  const nextFunding = mark?.nextFundingTime ?? row?.nextFundingTime;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!nextFunding) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [nextFunding]);

  const funding = mark?.fundingRate ?? row?.fundingRate;
  const markPx = mark?.markPrice ?? row?.markPrice;
  const indexPx = mark?.indexPrice ?? row?.indexPrice;
  const premium = markPx && indexPx ? (markPx / indexPx - 1) * 100 : null;

  return (
    <Panel title="Market stats" className={className}>
      <KeyStats
        items={[
          { label: 'Funding rate', value: funding == null ? '--' : `${(funding * 100).toFixed(4)}%`, tone: toneOf(funding) },
          { label: 'Next funding', value: nextFunding ? fmtCountdown(nextFunding - now) : '--' },
          { label: 'Open interest', value: fmtUsd(row?.openInterestUsd) },
          { label: 'Mark vs index', value: fmtPct(premium, 3), tone: toneOf(premium) },
          { label: '24h high', value: money(row?.high) },
          { label: '24h low', value: money(row?.low) },
          { label: '24h volume', value: row?.quoteVolume == null ? '--' : `$${fmtCompact(row.quoteVolume)}` },
        ]}
      />
    </Panel>
  );
};

export default MarketStatsPanel;
