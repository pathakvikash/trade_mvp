// Timeframe the Trade chart should switch to for the dock's active strategy, or null. `applied` is the strategy
// object already acted on (strategyStore.applied): `active` is global, so without it every Trade mount would
// re-switch the chart to the strategy's timeframe, overriding the user's own choice.
export default function strategyTimeframe(active, applied, { symbol, tfs, current }) {
  if (!active || active === applied) return null;
  if (active.kind !== 'perp' || active.symbol !== symbol || !tfs.includes(active.interval)) return null;
  return active.interval !== current ? active.interval : null;
}
