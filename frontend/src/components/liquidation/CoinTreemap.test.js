import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import CoinTreemap from './CoinTreemap';

global.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => { container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });

const ROWS = [
  { symbol: 'BTCUSDT', longUsd: 3000, shortUsd: 1000, count: 12 },
  { symbol: 'ETHUSDT', longUsd: 500, shortUsd: 1500, count: 5 },
];

test('tile click still selects the coin (drawer), the i button opens the details popover without selecting', () => {
  const onSelect = jest.fn();
  const onHeatmap = jest.fn();
  act(() => root.render(<CoinTreemap bySymbol={ROWS} selected="BTCUSDT" onSelect={onSelect} onHeatmap={onHeatmap} />));
  const tile = container.querySelector('button[aria-label^="BTC:"]');
  act(() => tile.click());
  expect(onSelect).toHaveBeenCalledWith('BTCUSDT');
  onSelect.mockClear();

  const info = container.querySelector('button[aria-label="BTC details"], button[aria-haspopup="dialog"]');
  act(() => info.click());
  expect(onSelect).not.toHaveBeenCalled();
  const d = document.body.querySelector('[role="dialog"]');
  expect(d.textContent).toContain('Longs $3K (75%)');
  expect(d.textContent).toContain('Shorts $1K (25%)');
  expect(d.textContent).toContain('66.7% of all sampled'); // 4000 of 6000
  expect(d.textContent).toContain('Sampled');
  act(() => [...d.querySelectorAll('button')].find((b) => b.textContent === 'Open heatmap').click());
  expect(onHeatmap).toHaveBeenCalledWith('BTCUSDT');
  expect(onSelect).not.toHaveBeenCalled();
});

test('the tile is not a button nested in a button and the table still lists every coin', () => {
  act(() => root.render(<CoinTreemap bySymbol={ROWS} selected="BTCUSDT" onSelect={() => {}} />));
  expect(container.querySelector('button button')).toBeNull();
  expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
});
