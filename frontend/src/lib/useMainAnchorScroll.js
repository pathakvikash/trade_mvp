import { useEffect } from 'react';

// In-page #hash links scroll ONLY the <main> container. The browser default (and scrollIntoView) also scrolls
// every overflow:hidden ancestor, which shifted the whole app shell up and left the bottom blank.
const reduced = () => document.documentElement.dataset.reduceMotion === 'true' || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const scrollMainTo = (main, el, smooth = true) => {
  const top = el.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop - 8;
  main.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduced() ? 'smooth' : 'auto' });
};

const find = (hash) => { try { return document.getElementById(decodeURIComponent(hash.slice(1))); } catch (e) { return null; } };

const useMainAnchorScroll = (mainRef, pathname) => {
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return undefined;
    const onClick = (e) => {
      const a = e.target.closest?.('a[href^="#"]');
      if (!a || e.defaultPrevented || a.getAttribute('href').length < 2) return;
      const el = find(a.getAttribute('href'));
      if (!el) return;
      e.preventDefault();
      scrollMainTo(main, el);
      el.focus?.({ preventScroll: true });
    };
    main.addEventListener('click', onClick);
    return () => main.removeEventListener('click', onClick);
  }, [mainRef]);

  // Deep link on load: lazy panels mount late, so retry briefly, then drop the hash so re-renders cannot re-trigger it.
  useEffect(() => {
    const main = mainRef.current;
    const hash = window.location.hash;
    if (!main || hash.length < 2) return undefined;
    let tries = 0;
    const t = setInterval(() => {
      const el = find(hash);
      if (el) { scrollMainTo(main, el, false); clearInterval(t); }
      else if (++tries > 20) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, [mainRef, pathname]);
};

export default useMainAnchorScroll;
