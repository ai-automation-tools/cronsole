import { useEffect, useState } from 'react';

/**
 * Track a CSS media query from JS.
 *
 * Needed where a Tailwind responsive class isn't enough, because a class can
 * only change how something *looks*. A `-translate-x-full` drawer is still in
 * the DOM, the tab order, and the accessibility tree; deciding it should also be
 * `inert` requires knowing the viewport in JS, not just in CSS.
 */
export function useMediaQuery(query: string): boolean {
  const supported =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function';

  const [matches, setMatches] = useState(() =>
    supported ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange(); // the query may have changed between render and effect
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query, supported]);

  return matches;
}
