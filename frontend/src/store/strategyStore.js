import { create } from 'zustand';

// The strategy currently applied to the chart:
//   {spec, symbol, kind, interval, allTimeframes, result, resultInterval}
// interval = the timeframe it was designed on (the pin when allTimeframes is false); allTimeframes !== false means the
// overlay follows the chart's current timeframe; result = /api/strategies/evaluate payload for resultInterval.
// Set by the AI dock only after the user accepts; the chart panel reads it.
// applied = the strategy object Trade already moved its timeframe for (so remounting Trade does not redo it).
const useStrategyStore = create((set) => ({
  active: null,
  applied: null,
  setActive: (active) => set({ active }),
  markApplied: (applied) => set({ applied }),
  // New object so the overlay re-resolves, but a toggle must not make Trade jump the chart to the pin.
  setAllTimeframes: (allTimeframes) => set((s) => {
    if (!s.active) return {};
    const active = { ...s.active, allTimeframes };
    return { active, applied: s.applied === s.active ? active : s.applied };
  }),
  clear: () => set({ active: null, applied: null }),
}));

export default useStrategyStore;
