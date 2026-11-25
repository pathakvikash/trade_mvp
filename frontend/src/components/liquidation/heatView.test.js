import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import useHeatView from './heatView';

global.IS_REACT_ACT_ENVIRONMENT = true;

const read = (stored) => {
  localStorage.clear();
  localStorage.setItem('tm:v1:anon:liquidation.heatIntensity', stored);
  let out;
  const C = () => { out = useHeatView().intensity; return null; };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<C />));
  act(() => root.unmount());
  return out;
};

test('saved intensity must be two integers 0..100 with lo < hi, else the defaults', () => {
  expect(read('[10,60]')).toEqual([10, 60]);
  expect(read('[null,50]')).toEqual([0, 100]); // null is >= 0 in JS: used to pass
  expect(read('[0,null]')).toEqual([0, 100]);
  expect(read('["5",50]')).toEqual([0, 100]);
  expect(read('[10.5,60]')).toEqual([0, 100]);
  expect(read('[60,10]')).toEqual([0, 100]);
  expect(read('[-5,50]')).toEqual([0, 100]);
  expect(read('[10,150]')).toEqual([0, 100]);
  expect(read('{bad')).toEqual([0, 100]);
});
