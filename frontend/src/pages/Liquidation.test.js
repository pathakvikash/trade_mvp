import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import Liquidation from './Liquidation';

let mockQuery = '';
jest.mock('react-router-dom', () => {
  const React = require('react');
  return { __esModule: true, useSearchParams: () => [new URLSearchParams(mockQuery), jest.fn()] };
}, { virtual: true });
jest.mock('../lib/usePolling', () => ({ __esModule: true, default: () => ({ data: null, error: null }) }));
jest.mock('../components/LiquidationHeatmap', () => () => null);
jest.mock('../components/liquidation/Summary', () => () => null);
jest.mock('../components/liquidation/CoinTreemap', () => () => null);
jest.mock('../components/liquidation/LiqHeat', () => () => null);
jest.mock('../components/liquidation/LiqMap', () => () => null);
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
