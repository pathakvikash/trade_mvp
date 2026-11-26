import { useEffect, useRef } from 'react';

// Open floating layers (popover, menu, legend...) register here while open, so one Esc closes only the topmost.
const stack = [];
const onKey = (e) => {
  if (e.key !== 'Escape' || !stack.length) return;
  stack[stack.length - 1].current(e);
};
const add = (ref) => {
  if (!stack.length) window.addEventListener('keydown', onKey);
  stack.push(ref);
};
const remove = (ref) => {
  stack.splice(stack.indexOf(ref), 1);
  if (!stack.length) window.removeEventListener('keydown', onKey);
};

// true while any layer is open: Esc handlers outside the stack (maximise) leave that Esc to the layer
export const hasEscLayer = () => stack.length > 0;

export const useEscLayer = (open, close) => {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return undefined;
    add(ref);
    return () => remove(ref);
  }, [open]);
};
