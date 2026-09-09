import type { RailNode } from './sourceTree';

/**
 * **Narrow the rail's tree by name.**
 *
 * Presentation only, and deliberately not a `TaskFilters` field: this changes
 * which *routes* are on screen, never which tasks are in the list. Putting it in
 * the URL would make two links that show the same tasks — the same reason branch
 * expansion is not in the URL either.
 *
 * A node survives if it matches, **or** if anything beneath it does. The two
 * cases keep different children, and the difference is the whole behaviour:
 *
 * - the node itself matched → keep **every** child, because you asked for this
 *   place and its contents are what you came for;
 * - only a descendant matched → keep **only** the matching descendants, so the
 *   ancestor renders as the path to the hit rather than as a hit of its own.
 *
 * A node with no `patch` (the `\Microsoft\` disclosure) is kept only for its
 * descendants — matching the word "System" and then offering a row that selects
 * nothing would be a result you cannot act on.
 */
export interface FilteredRail {
  nodes: RailNode[];
  /**
   * Keys of the lists whose rows are **matches**, rather than contents carried
   * along by a parent that matched.
   *
   * The caller lifts its row cap for exactly these, and the distinction is not
   * academic: capping a list of matches would hide the hit you typed behind
   * *Show 6 more*, while lifting the cap everywhere means one match on
   * `AI-Lab` dumps all eight of its subfolders on screen — which is what a
   * blanket lift actually did the first time this ran against a real machine.
   *
   * Keyed exactly as the caller's cap is: a node's **own key** for its child
   * list, `band:<section>` for a whole band. Do not invent a prefix on one side
   * — the two lookups would stop meeting and cap-lifting would fail silently,
   * with no test to redden.
   */
  liftedLists: Set<string>;
}

export function filterRailNodes(nodes: RailNode[], query: string): FilteredRail {
  const needle = query.trim().toLowerCase();
  if (!needle) return { nodes, liftedLists: new Set() };

  const liftedLists = new Set<string>();

  const walk = (node: RailNode): RailNode | null => {
    // `?? ''` rather than a bare `.toLowerCase()`: a row whose label the server
    // has not filled in is a data defect, and a *presentation* helper that
    // throws over one takes down the whole rail two layers from the cause —
    // `sourcePlatform`'s rule in `platform.ts`, which learned it the hard way.
    // An unlabelled node simply matches nothing.
    const self = (node.label ?? '').toLowerCase().includes(needle);
    if (self && node.patch) return node;

    const kept = (node.children ?? []).map(walk).filter((n): n is RailNode => n !== null);
    if (kept.length > 0) {
      // These children are hits, so the caller must not cap them.
      liftedLists.add(node.key);
      return { ...node, children: kept };
    }

    // A disclosure that matched by name but holds nothing matching is dropped:
    // it has no patch, so keeping it would put an unselectable row on screen as
    // if it were an answer.
    return null;
  };

  return {
    nodes: nodes.map(walk).filter((n): n is RailNode => n !== null),
    liftedLists
  };
}

/** How many rows a band shows before it offers the rest behind one control. */
export const RAIL_ROW_CAP = 4;

/**
 * Split a list into what is drawn and what is held back.
 *
 * Held back rather than dropped, and the caller always renders the remainder's
 * count: a fold that hid eleven folders with no hint of them is the thing the
 * band tallies already exist to prevent.
 *
 * One over the cap is left alone: *Show 1 more* costs a row to save a row, and
 * hides something for no gain at all.
 */
export function capRows<T>(rows: T[], expanded: boolean): { shown: T[]; hidden: number } {
  if (expanded || rows.length <= RAIL_ROW_CAP + 1) return { shown: rows, hidden: 0 };
  return { shown: rows.slice(0, RAIL_ROW_CAP), hidden: rows.length - RAIL_ROW_CAP };
}
