import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import TickerBar, { msToNextFunding } from './TickerBar';
import useUserStore from '../../store/userStore';
import useMarketStore from '../../store/marketStore';
import { fmtTime, setTimeFormat } from '../ui/fmt';

jest.mock('react-router-dom', () => ({ Link: ({ to, children, ...p }) => <a href={to} {...p}>{children}</a> }), { virtual: true });
jest.mock('../../lib/socket', () => ({ getMarketSocket: jest.fn() }));

let container;
let root;
beforeAll(() => { global.IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  useMarketStore.setState({ marketData: [{ id: 'bitcoin', symbol: 'btc', current_price: 50000, price_change_percentage_24h: 1.5 }] });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); setTimeFormat('auto'); });

const render = (preferences) => {
  act(() => {
    useUserStore.setState({ token: 't', user: { _id: 'u1', preferences } });
    root.render(<TickerBar />);
  });
};

test('shows prices and the funding chip by default', () => {
  render({});
  expect(container.textContent).toContain('BTC');
  expect(container.textContent).toMatch(/Next funding in \d\d:\d\d:\d\d/);
  expect(container.querySelector('.tm-marquee')).not.toBeNull();
});

test('hidden when tickerBar is false; static when reduceMotion; no chip when fundingCountdown is off', () => {
  render({ tickerBar: false });
  expect(container.querySelector('[data-testid="ticker-bar"]')).toBeNull();
  render({ reduceMotion: true, fundingCountdown: false });
  expect(container.querySelector('.tm-marquee')).toBeNull();
  expect(container.textContent).not.toContain('Next funding');
});

test('msToNextFunding lands on the next 00/08/16 UTC', () => {
  expect(msToNextFunding(Date.UTC(2026, 0, 1, 7, 59, 0))).toBe(60 * 1000);
  expect(msToNextFunding(Date.UTC(2026, 0, 1, 16, 0, 0))).toBe(8 * 3600 * 1000);
});

test('fmtTime honours 12h and 24h', () => {
  const t = new Date(2026, 0, 1, 13, 5, 9);
  setTimeFormat('24h');
  expect(fmtTime(t)).toBe('13:05:09');
  setTimeFormat('12h');
  expect(fmtTime(t)).toMatch(/^0?1:05:09\s?PM$/i);
});
