import { useEffect, useRef } from 'react';

// Returns a ref; the element scrolls into view once on mount (chart panels open above a long list, the clicked row is far below).
// block 'start' + the element's scroll-mt-* class leaves a small offset. Motion follows the OS and the in-app setting.
const useScrollIntoView = () => {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el?.scrollIntoView) return;
    const reduce = document.documentElement.dataset.reduceMotion === 'true' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
  }, []);
  return ref;
};

export default useScrollIntoView;
