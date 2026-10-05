import { useCallback } from 'react';
import type { PointerEvent } from 'react';

/**
 * Tracks the pointer inside an element so the `.spot` surface (index.css) can
 * draw its ring where the cursor is. Two custom properties, set on the element
 * itself, so a list of 300 cards costs one listener per card and no React state:
 * a state update per pointermove would re-render the memoised card on every
 * pixel, which is the one thing `TaskCard`'s memo exists to prevent.
 */
export function useSpotlight() {
  return useCallback((e: PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  }, []);
}
