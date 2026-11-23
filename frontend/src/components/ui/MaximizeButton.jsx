import React from 'react';
import { Icon } from './IconButton';
import { Tip } from './Tooltip';

// Real button; focus stays on it across toggles because the panel is never remounted.
const MaximizeButton = ({ max, onToggle }) => {
  const label = max ? 'Restore chart' : 'Maximise chart';
  return (
    <Tip text={label}>
      <button
        type="button"
        aria-pressed={max}
        aria-label={label}
        onClick={onToggle}
        className="focus-ring inline-flex h-7 min-w-[1.75rem] shrink-0 items-center justify-center rounded border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 min-h-[36px] sm:min-h-0"
      >
        <Icon name={max ? 'minimize' : 'maximize'} />
      </button>
    </Tip>
  );
};

export const MaximizeBackdrop = ({ max, onClose }) => (
  max ? <div className="fixed inset-0 z-40 bg-black/70" onClick={onClose} aria-hidden="true" /> : null
);

export default MaximizeButton;
