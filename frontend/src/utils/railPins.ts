import type { TaskFilters } from './taskFilters';

/**
 * A **pinned rail location** — a folder or job type lifted out of the source
 * tree and shown beside your collections.
 *
 * This exists because of what a collection is *not*. `TaskCollection` stores the
 * tasks themselves (schema.prisma › "membership is declared, not derived"), so a
 * collection can hold two Claude routines and two Windows tasks that share no
 * property a filter could name. A folder is the opposite kind of thing: it is
 * **derived** from `category`, and the whole value of pinning one is that it
 * keeps agreeing with the folder as tasks come and go.
 *
 * Those two cannot be the same record. Snapshotting `\AI-Maintenance\` into a
 * collection would freeze it at the moment you clicked, leaving a row named
 * after a folder it no longer matches — and making collection membership
 * resolve from a rule instead would turn one concept into two with no way to
 * tell which kind of row you are looking at. So a pin is its own thing, stored
 * beside the collections rather than among them, and drawn with its own icon
 * for exactly that reason: **`Bookmark` is a set you built, `Pin` is a place
 * that keeps changing.**
 *
 * It is a *preference*, not a resource — the same call as `savedViews` and
 * `railCollapsed`. There is nothing here for a server to own: a pin references
 * no row by id (see below), touches no platform, and means nothing to another
 * user's account.
 */
export interface RailPin {
  /** Stable id — what the rail key carries, and what removal names. */
  id: string;
  /**
   * The rail key of the level-2 row this pin mirrors.
   *
   * Matching is exact, and matching by **key** rather than by patch is what
   * keeps the count honest: the pin does not compute a tally of its own, it
   * reuses the node's, so a pinned folder and the folder row it came from can
   * never print two different numbers. See `buildSourceTree`.
   */
  nodeKey: string;
  /** Display label — the folder's own name at the time it was pinned. */
  label: string;
  /**
   * What picking this pin selects.
   *
   * Stored rather than looked up, so a pin whose folder has gone (renamed,
   * emptied, the whole platform disconnected) still navigates somewhere honest
   * instead of becoming an inert row you cannot even click to remove.
   *
   * Deliberately only these three fields, and deliberately **no collection id**.
   * A pin holding a foreign key would not degrade when its target vanished, it
   * would break — the same reason `viewFiltersFrom` strips `collection` from a
   * saved view. A source key and a folder name are just strings: when they stop
   * matching anything the pin reads `0`, which is the truth.
   */
  patch: PinPatch;
}

export interface PinPatch {
  source: string;
  category?: string;
  /**
   * Set only for a folder under `\Microsoft\`. Carried because those rows select
   * `system: 'include'` — a pin that dropped it would land on a folder the
   * dashboard's lens is holding back and report an empty place that is not.
   */
  system?: 'include';
}

/** The rail key prefix, namespaced so a pin can never collide with a platform. */
const PIN_PREFIX = 'pin:';

/** Rail key for a pin row. */
export const pinKey = (id: string) => `${PIN_PREFIX}${id}`;

/** The pin id a rail key names, or null if it is not a pin row. */
export const pinIdFromKey = (key: string): string | null =>
  key.startsWith(PIN_PREFIX) ? key.slice(PIN_PREFIX.length) : null;

/**
 * The minimum of a `RailNode` this module needs.
 *
 * Structural rather than an import of `RailNode`, purely to keep the dependency
 * pointing one way — `sourceTree` imports pins, never the reverse.
 */
interface PinnableNode {
  key: string;
  label: string;
  patch?: Partial<TaskFilters>;
}

/**
 * Is there already a pin for this node?
 *
 * Keyed on `nodeKey`, so pinning is idempotent per folder rather than per click
 * — the `+` is a toggle, and two rows for one folder would make the count
 * duplicated rather than doubled, which is worse.
 */
export const pinForNode = (pins: RailPin[], nodeKey: string): RailPin | undefined =>
  pins.find(p => p.nodeKey === nodeKey);

/**
 * Build a pin from the rail node the user clicked `+` on.
 *
 * Returns `null` for a node with no patch — the `\Microsoft\` disclosure group
 * is an expander, not a destination, so there is nothing to pin. The caller
 * hides the `+` there too; this is the guard that makes the rule true rather
 * than merely observed.
 */
export function pinFromNode(node: PinnableNode, existing: RailPin[]): RailPin | null {
  if (!node.patch?.source) return null;
  return {
    id: newPinId(existing),
    nodeKey: node.key,
    label: node.label,
    patch: {
      source: node.patch.source,
      ...(node.patch.category !== undefined && node.patch.category !== 'All'
        ? { category: node.patch.category }
        : {}),
      ...(node.patch.system === 'include' ? { system: 'include' as const } : {})
    }
  };
}

/**
 * Next free pin id.
 *
 * Counter-based rather than random, matching `newViewId` — these land in
 * `localStorage` where a human occasionally reads them, and `pin-3` says more
 * than a cuid does.
 */
export function newPinId(existing: RailPin[]): string {
  const taken = new Set(existing.map(p => p.id));
  let n = existing.length + 1;
  while (taken.has(`pin-${n}`)) n += 1;
  return `pin-${n}`;
}
