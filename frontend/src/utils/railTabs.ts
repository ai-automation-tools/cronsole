/**
 * The rail's **list slider: Collections · Pinned**, one open at a time.
 *
 * It sits under the scope slider (*All sources · Favorites*, which selects on
 * click and stores nothing of its own) and above Sources, which are never
 * behind a segment — the platform tree is what you navigate by.
 *
 * The open list is a **synced preference** (`Settings.railTab`), like the folds
 * it replaced — it says how you like the sidebar arranged, not which tasks you
 * are looking at, so it is not in the URL either.
 */
export type RailTab = 'collections' | 'pinned';

export const RAIL_TABS: readonly RailTab[] = ['collections', 'pinned'];

export const DEFAULT_RAIL_TAB: RailTab = 'collections';

export const RAIL_TAB_LABEL: Record<RailTab, string> = {
  collections: 'Collections',
  pinned: 'Pinned'
};

/**
 * A stored value that is no longer a list reads as the default — including
 * `'sources'`, `'all'` and `'favorites'`, which earlier builds of this slider
 * wrote the same day it shipped.
 */
export const asRailTab = (v: unknown): RailTab =>
  RAIL_TABS.includes(v as RailTab) ? (v as RailTab) : DEFAULT_RAIL_TAB;

/**
 * The list actually drawn: the chosen one, **unless a filter would make it
 * swallow every hit.**
 *
 * The folds had this rule ("a fold may not swallow a hit") and a slider is the
 * same hazard in a new shape: someone who left it on Pinned and types a
 * collection's name would get an empty list while the match sat one segment
 * over. So while a query is running and the chosen list holds nothing, the
 * first list that does is shown instead — *without* writing it back, because
 * the user never chose it and clearing the query should put them where they
 * were.
 */
export function shownRailTab(
  chosen: RailTab,
  hits: Record<RailTab, number>,
  filtering: boolean
): RailTab {
  if (!filtering || hits[chosen] > 0) return chosen;
  return RAIL_TABS.find(t => hits[t] > 0) ?? chosen;
}
