import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import OtherCoinsGrid from './OtherCoinsGrid';

global.IS_REACT_ACT_ENVIRONMENT = true;

test('one link per symbol with the coin name', () => {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(<OtherCoinsGrid symbols={['ETHUSDT', 'SOLUSDT']} onPick={() => {}} />));
  const links = [...container.querySelectorAll('a')];
  expect(links.map((a) => a.textContent)).toEqual(['ETH Liquidation Heatmap', 'SOL Liquidation Heatmap']);
  act(() => root.unmount());
});
