import { create } from 'zustand';

// The strategy currently overlaid on the chart: {spec, symbol, kind, interval, result} where result is the
// /api/strategies/evaluate payload. Set by the AI dock; the chart panel reads it.
// applied = the strategy object Trade already moved its timeframe for (so remounting Trade does not redo it).
const useStrategyStore = create((set) => ({
  active: null,
  applied: null,
  setActive: (active) => set({ active }),
  markApplied: (applied) => set({ applied }),
  clear: () => set({ active: null, applied: null }),
}));

export default useStrategyStore;
