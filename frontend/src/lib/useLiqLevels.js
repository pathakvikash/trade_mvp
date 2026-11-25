import { useMemo } from 'react';
import usePolling from './usePolling';
import { FUT } from '../components/liquidation/shared';
import { fmtCompact } from '../components/ui/fmt';

const TOP = 8;
const RED = [251, 113, 133];
const GREEN = [52, 211, 153];
const rgba = (c, a) => `rgba(${c.join(',')}, ${a.toFixed(2)})`;
const small = () => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 639px)').matches;

// Largest `TOP` estimated levels per side of the price. Width 1-3 and opacity follow size; only the biggest few get an axis label.
export function buildLiqLines(levels, price, labels) {
  const side = (rows, key, rgb, name) => {
    const top = rows.filter((l) => l[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, TOP);
    const max = top[0] ? top[0][key] : 1;
    return top.map((l, i) => {
      const f = l[key] / max;
      return {
        id: `${name}:${l.price}`, price: l.price, color: rgba(rgb, 0.35 + 0.55 * f), width: f > 0.66 ? 3 : f > 0.33 ? 2 : 1,
        style: 'dashed', title: i < labels ? `$${fmtCompact(l[key])} ${name}` : '',
      };
    });
  };
  return [
    ...side(levels.filter((l) => l.price >= price), 'shortUsd', RED, 'short'), // shorts liquidate above price
    ...side(levels.filter((l) => l.price < price), 'longUsd', GREEN, 'long'),
  ];
}

// Estimated liquidation levels as chart price lines. Idle (no request) unless `enabled`.
export default function useLiqLevels(symbol, enabled) {
  const { data, error, loading, source } = usePolling(enabled && symbol ? `${FUT}/liqmap/${symbol}` : null, 60000);
  const ok = !!(enabled && data && data.symbol === symbol && Array.isArray(data.levels) && Number.isFinite(data.price));
  const lines = useMemo(() => (ok ? buildLiqLines(data.levels, data.price, small() ? 2 : 4) : []), [ok, data]);
  return {
    lines,
    loading: !!enabled && loading,
    error: enabled && !ok && !loading ? error || new Error('no data') : null,
    source: ok ? data.source || source || null : null,
    generatedAt: ok ? data.generatedAt || null : null,
  };
}
