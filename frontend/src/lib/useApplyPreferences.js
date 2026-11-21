import { useEffect } from 'react';
import { setTimeFormat } from '../components/ui/fmt';

// Pushes display preferences to where CSS and formatters can see them. Called once, from Layout.
export default function useApplyPreferences(prefs) {
  const compact = prefs?.compactTables === true;
  const reduce = prefs?.reduceMotion === true;
  const timeFormat = prefs?.timeFormat || 'auto';
  useEffect(() => {
    const d = document.documentElement.dataset;
    d.compact = String(compact);
    d.reduceMotion = String(reduce);
    setTimeFormat(timeFormat);
  }, [compact, reduce, timeFormat]);
}
