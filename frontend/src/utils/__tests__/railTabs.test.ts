import { describe, it, expect } from 'vitest';
import { asRailTab, shownRailTab, DEFAULT_RAIL_TAB } from '../railTabs';

const hits = (collections: number, pinned: number) => ({ collections, pinned });

describe('railTabs', () => {
  it('reads anything that is not a list as the default', () => {
    expect(asRailTab('pinned')).toBe('pinned');
    expect(asRailTab('bogus')).toBe(DEFAULT_RAIL_TAB);
    expect(asRailTab(undefined)).toBe(DEFAULT_RAIL_TAB);
    // What earlier builds of the slider stored the day it shipped.
    for (const old of ['sources', 'all', 'favorites']) expect(asRailTab(old)).toBe(DEFAULT_RAIL_TAB);
  });

  it('draws the chosen list when nothing is being filtered, even an empty one', () => {
    expect(shownRailTab('pinned', hits(3, 0), false)).toBe('pinned');
  });

  it('keeps the chosen list while it holds a hit', () => {
    expect(shownRailTab('pinned', hits(4, 1), true)).toBe('pinned');
  });

  // A list may not swallow a hit: the folds' rule, in its new shape.
  it('moves to the list holding a hit when the chosen one holds none', () => {
    expect(shownRailTab('pinned', hits(2, 0), true)).toBe('collections');
    expect(shownRailTab('collections', hits(0, 3), true)).toBe('pinned');
  });

  it('stays put when neither list matches — the empty state is said once', () => {
    expect(shownRailTab('pinned', hits(0, 0), true)).toBe('pinned');
  });
});
