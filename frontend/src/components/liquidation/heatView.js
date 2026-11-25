import usePersistedState from '../../lib/usePersistedState';
import { PALETTES } from './heat';

export const LENSES = [
  { id: 'heat', label: 'Heat' },
  { id: 'long', label: 'Long only' },
  { id: 'short', label: 'Short only' },
];
// Display toggles. Defaults reproduce the page as it was before the toggles existed (key levels are new, so off).
export const DISPLAY_ITEMS = [
  { id: 'candles', label: 'Price candles' },
  { id: 'grid', label: 'Grid lines' },
  { id: 'keyLevels', label: 'Key levels' },
  { id: 'priceLine', label: 'Current price line' },
];
const DEFAULT_DISPLAY = { candles: true, grid: true, keyLevels: false, priceLine: true };

// The heatmap's view settings. Persisted, so the legend (a separate component) reads the same values and stays in sync.
export default function useHeatView() {
  const [lens, setLens] = usePersistedState('liquidation.heatLens', 'heat', { validate: (v) => LENSES.some((l) => l.id === v) });
  const [palette, setPalette] = usePersistedState('liquidation.heatPalette', 'viridis', { validate: (v) => PALETTES.some((p) => p.id === v) });
  const [display, setDisplay] = usePersistedState('liquidation.heatDisplay', DEFAULT_DISPLAY, {
    validate: (v) => v && Object.keys(DEFAULT_DISPLAY).every((k) => typeof v[k] === 'boolean'),
  });
  const [intensity, setIntensity] = usePersistedState('liquidation.heatIntensity', [0, 100], {
    validate: (v) => Array.isArray(v) && v.length === 2 && v.every((n) => Number.isInteger(n) && n >= 0 && n <= 100) && v[0] < v[1],
  });
  return { lens, setLens, palette, setPalette, display, setDisplay, intensity, setIntensity };
}
