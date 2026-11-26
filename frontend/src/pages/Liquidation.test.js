import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Liquidation from './Liquidation';
import useAgentStore from '../store/agentStore';

let mockQuery = '';
jest.mock('react-router-dom', () => {
  const React = require('react');
  return { __esModule: true, useSearchParams: () => [new URLSearchParams(mockQuery), jest.fn()] };
}, { virtual: true });
const mockOverview = [
  { symbol: 'BTCUSDT', quoteVolume: 900 }, { symbol: 'ETHUSDT', quoteVolume: 800 }, { symbol: 'SOLUSDT', quoteVolume: 700 }, { symbol: 'BADCOIN', quoteVolume: 9999 },
  ...Array.from({ length: 25 }, (_, i) => ({ symbol: `C${i}USDT`, quoteVolume: i })),
];
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: (url) => ({ data: url && url.includes('/overview') ? mockOverview : null, error: null }) }));
jest.mock('../components/LiquidationHeatmap', () => () => null);
jest.mock('../components/liquidation/Summary', () => () => null);
jest.mock('../components/liquidation/CoinTreemap', () => () => null);
jest.mock('../components/liquidation/LiqHeat', () => () => null);
jest.mock('../components/liquidation/LiqMap', () => () => null);
jest.mock('../components/liquidation/Cvd', () => () => null);
jest.mock('../components/liquidation/LiveFeed', () => () => null);
jest.mock('../components/ui/PairPicker', () => ({ onChange }) => <button id="pick" onClick={() => onChange('ETHUSDT')} />);

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); mockQuery = ''; container = document.createElement('div'); root = createRoot(container); });
afterEach(() => act(() => root.unmount()));

const render = () => act(() => root.render(<Liquidation />));
const title = () => container.querySelector('h1').textContent;

test('selected symbol survives unmount/remount, URL still wins', () => {
  render();
  expect(title()).toContain('BTCUSDT');
  act(() => container.querySelector('#pick').click());
  act(() => root.unmount());
  root = createRoot(container);
  render();
  expect(title()).toContain('ETHUSDT');
  act(() => root.unmount());
  root = createRoot(container);
  mockQuery = 'symbol=SOLUSDT';
  render();
  expect(title()).toContain('SOLUSDT');
});

test('a stale stored symbol falls back to BTCUSDT', () => {
  localStorage.setItem('tm:v1:anon:liquidation.symbol', '"nonsense"');
  render();
  expect(title()).toContain('BTCUSDT');
});

test('Ask AI opens the dock with the liquidation page context', () => {
  render();
  act(() => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Ask AI').click());
  expect(useAgentStore.getState().open).toBe(true);
  expect(useAgentStore.getState().ctx).toMatchObject({ kind: 'perp', symbol: 'BTCUSDT', page: 'liquidation' });
});

test('below the feed: related tools, other coins (top 20 by volume, not the current coin), FAQ', () => {
  render();
  expect(container.textContent).toContain('Related tools');
  const links = [...container.querySelectorAll('ul[aria-label="Other coins"] a')].map((a) => a.textContent);
  expect(links).toHaveLength(20);
  expect(links[0]).toBe('ETH Liquidation Heatmap'); // BTCUSDT is the current symbol, BADCOIN is not a valid perp symbol
  expect(links).not.toContain('BTC Liquidation Heatmap');
  expect(container.textContent).toContain('About these numbers');
});

test('picking another coin switches the page symbol', () => {
  render();
  act(() => [...container.querySelectorAll('ul[aria-label="Other coins"] a')].find((a) => a.textContent.startsWith('SOL')).click());
  expect(title()).toContain('SOLUSDT');
});
