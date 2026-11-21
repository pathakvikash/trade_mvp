import React, { useEffect } from 'react';
import { fmtPrice } from '../ui/fmt';
import { Tip } from '../ui/Tooltip';

const PRESETS = [1, 2, 5, 10, 20, 50];
const WARN_AT = 20; // from here the position is shown as high leverage

// Controlled leverage picker: preset buttons plus a range slider, capped at `max` (from maxLeverage(symbol, notional)).
// If `value` is above `max` (size grew), it is clamped down through onChange and a note says why.
// liqPrice (USD, or null) and requiredMargin (USD) are display-only, computed by the parent with lib/futuresMath.
// previewId: unique per instance (the trade form and a position edit panel can be on screen together).
const LeverageControl = ({ value, max, onChange, disabled = false, liqPrice = null, requiredMargin = null, previewId = 'leverage-preview' }) => {
  const clamped = value > max;
  const shown = Math.min(value, max);
  const presets = PRESETS.filter((x) => x <= max);
  const high = shown >= WARN_AT;

  useEffect(() => {
    if (clamped && !disabled) onChange(max);
  }, [clamped, max, disabled, onChange]);

  return (
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="flex w-full items-center justify-between text-[11px] text-slate-400">
        <span>Leverage</span>
        <span className={`text-sm font-semibold tabular-nums ${high ? 'text-amber-300' : 'text-slate-100'}`} aria-hidden="true">
          {shown}x
        </span>
      </legend>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Leverage presets">
        {presets.map((x) => (
          <Tip key={x} text={`Set leverage to ${x}x`}>
          <button
            type="button"
            aria-pressed={shown === x}
            disabled={disabled}
            onClick={() => onChange(x)}
            className={`focus-ring h-7 min-w-[2.75rem] rounded-md border px-2 text-xs font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              shown === x
                ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-300'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
            }`}
          >
            {x}x
          </button>
          </Tip>
        ))}
      </div>

      <input
        type="range"
        min={1}
        max={max}
        step={1}
        disabled={disabled}
        value={shown}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Leverage"
        aria-valuetext={`${shown}x`}
        aria-describedby={previewId}
        className="focus-ring h-2 w-full cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {clamped && !disabled && (
        <p role="status" className="text-[11px] text-amber-300">
          Max {max}x at this size. Leverage lowered to {max}x.
        </p>
      )}
      {high && (
        <p className="text-[11px] text-amber-300">
          High leverage: a small move against you can liquidate the position.
        </p>
      )}

      <dl id={previewId} className="grid grid-cols-2 gap-x-3 text-xs">
        <dt className="text-slate-400">Liq. price</dt>
        <dd className="text-right font-medium tabular-nums text-slate-100">{liqPrice == null ? '--' : `$${fmtPrice(liqPrice)}`}</dd>
        <dt className="text-slate-400">Required margin</dt>
        <dd className="text-right font-medium tabular-nums text-slate-100">{requiredMargin == null ? '--' : `$${fmtPrice(requiredMargin)}`}</dd>
      </dl>
    </fieldset>
  );
};

export default LeverageControl;
