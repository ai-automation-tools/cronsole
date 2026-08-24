import type { Task } from '../types';
import type { TaskFilters } from './taskFilters';
import { sourceLabel, sourceSubtypeLabel, sourcePlatform, platformSourceLabel } from '../platform';
import { pinKey, pinIdFromKey, type RailPin } from './railPins';

/**
 * The dashboard's navigation tree: **source → that source's own grouping**.
 *
 * This replaces the flat `SourceBar`, and the change is not cosmetic. Source was
 * one horizontal chip row and category was a facet buried inside the Filters
 * drawer, which meant the two questions you actually navigate by — *which system
 * is this?* and *which folder is it in?* — were answered by controls at opposite
 * ends of the screen and at completely different weights. On a machine with 354
 * Windows tasks across a dozen folders, the folder is the primary axis and it was
 * the hardest one to reach.
 *
 * Three rules shape what gets built here, and each one is load-bearing.
 *
 * **Level 2 is whatever that platform groups by, and that is a property of the
 * platform.** For Windows it is the Task Scheduler folder, which Cronsole already
 * carries as `category` (derived from the folder path at import). For
 * Cronsole-native it is the job type, which lives in the *source key* as a
 * subtype (`TASKHUB_NATIVE:EXEC`) rather than in `category` at all. So a node
 * carries the **filter patch it applies** instead of a single dimension's value —
 * one shape for two genuinely different groupings, rather than a tree that only
 * works for the platform it was written against.
 *
 * **Existence and count answer different questions**, the rule `SourceBar`
 * learned the hard way. A source exists in the rail if you have tasks from it
 * *or* you have a connection to it — the rail is navigation now, not a filter, so
 * a connected Claude account with zero imported routines must be reachable in
 * order to show its empty state. The **count** stays faceted (what clicking
 * reveals, under every other lens), which is why a rail row can legitimately read
 * `0`. That zero predicts the empty list instead of hiding the route to it.
 *
 * **`\Microsoft\` is disclosed, never silently fenced.** ~257 of a real machine's
 * tasks are Windows' own, hidden by the system lens. Dropping them from the tree
 * would make a whole region of the machine reachable only from a control
 * somewhere else; listing them inline would bury a dozen real folders under
 * twenty system ones. So they are one collapsed group at the bottom of Windows,
 * counted out loud — `withheldBy`'s disclosure, moved to where it is actionable.
 */

export interface RailNode {
  /** Stable identity for React keys and for selection matching. */
  key: string;
  label: string;
  /**
   * Faceted count — every *other* lens applied, this node's own dimensions left
   * out. A count beside a control is a promise about what clicking it reveals.
   */
  count: number;
  /**
   * What picking this node sets. **Absent means the node is a disclosure only** —
   * the `\Microsoft\` group expands and collapses but selects nothing, so the
   * rail never writes `system: 'only'` and the system lens keeps the single
   * controller it has today.
   */
  patch?: Partial<TaskFilters>;
  children?: RailNode[];
  /**
   * Set on a group whose contents the current lens is holding back. Drives the
   * "hidden by default" wording — which must disappear the moment the lens stops
   * hiding them, or the label describes a state that is no longer true.
   */
  withheld?: boolean;
}

/**
 * Platforms whose level-2 grouping is the **source subtype**, not the category.
 *
 * Cronsole-native is the only one today: an HTTP job and a script are the same
 * platform, the same connector and the same connection — they differ in the job
 * spec, which the server already reports as a source subtype. Splitting them at
 * level 2 rather than at level 1 (where they used to sit) keeps the rail's top
 * level one-row-per-system; a platform beside a job type was two levels of
 * concept in one list.
 */
const GROUPED_BY_SUBTYPE = new Set(['TASKHUB_NATIVE']);

/**
 * The subtypes a platform structurally *has*, listed whether or not any task
 * currently uses one.
 *
 * This is the existence-vs-count split from the top level, applied one level
 * down — and the two levels differ for a real reason. A Windows folder is
 * **data**: Cronsole knows `\AI-Tools\` exists because a task is in it, so a
 * folder with nothing in it is a folder Cronsole cannot know about. A native job
 * type is **structure**: there are exactly two, always, and *Scripts* vanishing
 * because you happen to have written no script tasks yet reads as a missing
 * feature rather than an empty bucket. It is navigation, so the empty
 * destination still needs a route to it — and a `0` beside it is the honest
 * prediction of what clicking does.
 */
const STRUCTURAL_SUBTYPES: Record<string, string[]> = {
  TASKHUB_NATIVE: [
    'TASKHUB_NATIVE:HTTP',
    'TASKHUB_NATIVE:EXEC',
    'TASKHUB_NATIVE:SCRIPT',
    'TASKHUB_NATIVE:CHECK'
  ]
};

/**
 * The starred lens, as a **place**.
 *
 * It was a chip in the saved-views bar; it is a rail row under *All sources*
 * now, which is where people look for it — a mail client puts Starred in the
 * left rail, not in a filter menu.
 *
 * **It composes with your view rather than replacing it**, exactly like every
 * other rail row: *Failures* + *Favorites* is failing starred tasks, and the two
 * lit controls say so together. The rule it appears to bend — "a star is an
 * explicit choice, so no *default* may overrule it" — still holds where it was
 * written: the dashboard opens on **All** (every status, system included), so a
 * fresh click here shows every starred task including disabled and OS-owned
 * ones. It narrows only when you have *deliberately* picked a narrowing view,
 * and that view is lit on screen while it does. Making this one row silently
 * rewrite your status and ownership lenses would make it the single rail entry
 * that behaves unlike the others, which is the inconsistency the rail exists to
 * remove.
 */
export const FAVORITES_KEY = 'Favorites';

/** The bucket a task with no category falls into. Sorted last, never first. */
export const UNCATEGORIZED = 'Uncategorized';

/** The synthetic key for the "everything, no source lens" root. */
export const ALL_SOURCES = 'All';

const sourceKeyOf = (task: Task) => task.source ?? task.platform;

/**
 * Folder names sort alphabetically, except `Uncategorized`, which sorts last.
 *
 * It is not a folder — it is the absence of one — so alphabetical placement
 * would drop it between real folders and imply it is one of them.
 */
function byFolderName(a: string, b: string): number {
  if (a === UNCATEGORIZED) return 1;
  if (b === UNCATEGORIZED) return -1;
  return a.localeCompare(b);
}

/** Bucket tasks by a key, preserving nothing but the counts. */
function tally(tasks: Task[], keyOf: (t: Task) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const k = keyOf(t);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export interface SourceTreeInput {
  /**
   * The **rail population**: every task passing every lens the rail does *not*
   * own — status, outcome, due, search — with the rail's own dimensions
   * (source, category, favorites, collection) and the system lens left out.
   *
   * Left out rather than applied, because those are the dimensions this tree
   * offers. A population narrowed by the source you are on cannot count the
   * source you might switch to, which is the bug that made the old source bar
   * vanish on a single-source view — and the same bug had `All sources` reading
   * 6 over 363 rows while Favorites was selected.
   *
   * *(This comment listed `favorites` among the lenses that ARE applied until
   * 2026-08-16. The caller had it right; the doc did not.)*
   */
  population: Task[];
  filters: TaskFilters;
  /**
   * Platforms that get a row even when they hold no tasks.
   *
   * Once "connected", now the caller's whole visibility union — connected, **or**
   * asked for in `settings.shownSources`. The union is computed in
   * `utils/sourceVisibility.ts` and handed in already resolved, so this file
   * keeps knowing only how to *draw* a tree and never has to hold an opinion
   * about which sources somebody wants.
   */
  connectedPlatforms?: string[];
  /**
   * The user's collections, in rail order.
   *
   * Passed in rather than derived from `population`, and that is the whole
   * difference between this dimension and every other one in the rail: a source
   * or a folder is **observed** — Cronsole knows `\AI-Tools\` exists because a
   * task is in it — while a collection is **declared**, so an empty one exists
   * just as much as a full one and only its owner can say so. Deriving them from
   * task membership would make a collection disappear the moment you removed its
   * last task, which is precisely when you want to see it and add another.
   */
  collections?: CollectionSummary[];
  /**
   * Pinned rail locations, in rail order.
   *
   * Sits beside `collections` and is emitted into the same band of the rail, but
   * it is the **opposite kind of thing** and the tree treats it that way: a
   * collection is declared and so is counted from membership, while a pin is
   * derived and is counted by *reusing the node it mirrors*. See the pin rows in
   * `buildSourceTree` — nothing here tallies a folder twice.
   */
  pins?: RailPin[];
}

/** The minimum the rail needs to render a collection row. */
export interface CollectionSummary {
  id: string;
  name: string;
}

/**
 * Build the rail.
 *
 * Returns the top-level rows, "All sources" first. Every count is taken from
 * `population`, so **the parts always sum to the whole** — the two numbers come
 * from one pass over one list rather than from two routes that can disagree.
 */
export function buildSourceTree({
  population,
  filters,
  connectedPlatforms = [],
  collections = [],
  pins = []
}: SourceTreeInput): RailNode[] {
  // The lens the *list* is currently under. When it already includes system
  // tasks, a source row must count them too — otherwise the row promises 254
  // and the click delivers 511.
  const showsSystem = filters.system !== 'personal';

  const byPlatform = new Map<string, Task[]>();
  for (const t of population) {
    const p = sourcePlatform(sourceKeyOf(t));
    const bucket = byPlatform.get(p);
    if (bucket) bucket.push(t);
    else byPlatform.set(p, [t]);
  }

  // Which platforms get a row. Tasks you have, plus the platforms the caller
  // says to list (connected, or shown by preference), plus whatever the current
  // filter names — that last one so a link written against a source nothing
  // currently derives still lights a row rather than filtering the list while
  // the rail sits entirely unlit. A filter naming a hidden source therefore
  // *shows* it: the alternative is a URL that filters to nothing with no row on
  // screen to say why.
  const platforms = new Set<string>([
    ...byPlatform.keys(),
    ...connectedPlatforms,
    ...(filters.source !== ALL_SOURCES ? [sourcePlatform(filters.source)] : [])
  ]);

  const sourceRows = Array.from(platforms)
    .sort((a, b) => platformSourceLabel(a).localeCompare(platformSourceLabel(b)))
    .map(platform => {
      const mine = byPlatform.get(platform) ?? [];
      const personal = mine.filter(t => t.isSystem !== true);
      const system = mine.filter(t => t.isSystem === true);

      return {
        key: platform,
        label: platformSourceLabel(platform),
        count: showsSystem ? mine.length : personal.length,
        patch: { ...RAIL_SCOPE_RESET, source: platform },
        children: childrenFor(platform, personal, system, showsSystem)
      } satisfies RailNode;
    });

  const scoped = showsSystem ? population : population.filter(t => t.isSystem !== true);

  /**
   * One row per collection, whether or not it currently holds anything.
   *
   * This is the `STRUCTURAL_SUBTYPES` rule rather than the folder rule: a
   * collection is **declared**, so an empty one is a real place the user made
   * and named — and it is exactly where they need to navigate in order to put
   * the first task in it. A folder, being observed, cannot be empty and known.
   */
  const collectionRows = collections.map(
    (c): RailNode => ({
      key: collectionKey(c.id),
      label: c.name,
      count: scoped.filter(t => t.collectionIds?.includes(c.id) === true).length,
      patch: { ...RAIL_SCOPE_RESET, collection: c.id }
    })
  );

  /**
   * One row per pinned location — the mirrored node, relocated.
   *
   * **The count and the patch are the node's own, not a second derivation of
   * them.** A pin promises to keep agreeing with the folder it points at, and
   * the only way to guarantee that is to not compute it twice: two tallies over
   * the same population, written months apart, is exactly how `All sources 6`
   * once appeared over 363 rows. So the tree is indexed by key and the pin reads
   * its target's numbers straight off.
   *
   * A pin whose target has gone — folder renamed, last task removed, platform
   * disconnected — keeps its row and reads `0`, falling back to the patch it
   * stored. That is the same rule the rail already follows for a connected
   * platform with nothing imported: a declared place stays reachable so you can
   * see it is empty, and so you can still click it to take it away.
   */
  const nodeByKey = new Map<string, RailNode>();
  for (const row of sourceRows) {
    for (const child of row.children ?? []) {
      nodeByKey.set(child.key, child);
      for (const leaf of child.children ?? []) nodeByKey.set(leaf.key, leaf);
    }
  }

  const pinRows = pins.map((p): RailNode => {
    const target = nodeByKey.get(p.nodeKey);
    return {
      key: pinKey(p.id),
      // The node's current label, falling back to the stored one. A folder that
      // is still there but has been renamed should read as it reads today —
      // the pin follows the place, not the name it had when you pinned it.
      label: target?.label ?? p.label,
      count: target?.count ?? 0,
      patch: { ...RAIL_SCOPE_RESET, ...(target?.patch ?? p.patch) }
    };
  });

  return [
    {
      key: ALL_SOURCES,
      label: 'All sources',
      // Counted the same way each source row is, so the root is exactly the sum
      // of its rows under whatever lens is in force.
      count: scoped.length,
      patch: { ...RAIL_SCOPE_RESET }
    },
    {
      key: FAVORITES_KEY,
      label: 'Favorites',
      count: scoped.filter(t => t.isFavorite === true).length,
      patch: { ...RAIL_SCOPE_RESET, favorites: 'only' }
    },
    ...collectionRows,
    ...pinRows,
    ...sourceRows
  ];
}

/**
 * Which band of the rail a row belongs to.
 *
 * Four sections — *scopes* (everything, starred), *collections* (sets you
 * declared), *pinned* (places that keep changing), then the *source* tree — and
 * this is the one place that decides which is which. It is derived from the key
 * rather than carried on the node because the keys are already namespaced and
 * already load-bearing (`collection:`, `pin:`); adding a `section` field would
 * be a second statement of the same fact, free to disagree with the first.
 *
 * **Collections and pins started in one band and were split apart**, which is
 * the honest end of the distinction that made pins a separate type in the first
 * place. Two icons in one list asked the reader to hold "some of these rows hold
 * what I put in them and some track a folder" in their head; two headed,
 * separately foldable sections say it without being read.
 */
export type RailSection = 'scope' | 'collection' | 'pinned' | 'source';

export function railSectionOf(key: string): RailSection {
  if (key === ALL_SOURCES || key === FAVORITES_KEY) return 'scope';
  if (collectionIdFromKey(key) !== null) return 'collection';
  if (pinIdFromKey(key) !== null) return 'pinned';
  return 'source';
}

/**
 * The rail scope every node resets before applying its own dimension.
 *
 * **Every rail node states the whole rail scope**, so picking any row means
 * exactly what it says. Without this, clicking a source while a collection (or
 * starred-only) is in force leaves you filtered by something the heading no
 * longer mentions — the rail insisting you are looking at the whole source while
 * four tasks are on screen. Kept as one constant so a fifth rail dimension
 * cannot be added to some nodes and forgotten on others.
 */
const RAIL_SCOPE_RESET = {
  source: ALL_SOURCES,
  category: 'All',
  favorites: 'any',
  collection: 'All'
} as const satisfies Partial<TaskFilters>;

/** Rail key for a collection row — namespaced so it cannot collide with a platform. */
export const collectionKey = (id: string) => `${COLLECTION_PREFIX}${id}`;

/** The collection id a rail key names, or null if it is not a collection row. */
export const collectionIdFromKey = (key: string): string | null =>
  key.startsWith(COLLECTION_PREFIX) ? key.slice(COLLECTION_PREFIX.length) : null;

const COLLECTION_PREFIX = 'collection:';

/**
 * A platform's level-2 rows.
 *
 * `personal` and `system` arrive already split because the `\Microsoft\` group is
 * a different *kind* of child from a folder — it is a disclosure, not a
 * selection — and deciding that from `isSystem` inside the folder loop would put
 * a system task in a folder row on any platform that ever reports one.
 */
function childrenFor(
  platform: string,
  personal: Task[],
  system: Task[],
  showsSystem: boolean
): RailNode[] | undefined {
  const rows: RailNode[] = GROUPED_BY_SUBTYPE.has(platform)
    ? // Job type. Labelled by subtype alone ("Scripts") rather than by full
      // source label ("Cronsole (Scripts)") — the parent row already says
      // Cronsole, and a child that repeats its parent wastes the width the tree
      // exists to buy.
      //
      // The **structural** list, not the observed one: both job types are listed
      // whether or not any task uses them. See `STRUCTURAL_SUBTYPES`.
      (() => {
        const counts = tally(personal, sourceKeyOf);
        const keys = new Set([
          ...(STRUCTURAL_SUBTYPES[platform] ?? []),
          ...counts.keys()
        ]);
        return Array.from(keys)
          .sort((a, b) => sourceSubtypeLabel(a).localeCompare(sourceSubtypeLabel(b)))
          .map(key => ({
            key,
            label: sourceSubtypeLabel(key),
            count: counts.get(key) ?? 0,
            patch: { ...RAIL_SCOPE_RESET, source: key }
          }));
      })()
    : // Folders. On Windows this is the Task Scheduler folder; elsewhere it is
      // whatever the user has labelled things. Same dimension either way — and
      // observed rather than structural, because a folder Cronsole has no task
      // in is a folder Cronsole cannot know exists.
      Array.from(tally(personal, t => t.category || UNCATEGORIZED))
        .sort(([a], [b]) => byFolderName(a, b))
        .map(([category, count]) => ({
          key: `${platform}/${category}`,
          label: category,
          count,
          patch: { ...RAIL_SCOPE_RESET, source: platform, category }
        }));

  if (system.length > 0) {
    rows.push(systemGroup(platform, system, showsSystem));
  }

  return rows.length > 0 ? rows : undefined;
}

/**
 * The `\Microsoft\` group: one collapsed row holding the OS's own folders.
 *
 * **It has no `patch` on purpose.** Selecting it would have to write
 * `system: 'only'`, which would make the rail a third controller of a lens that
 * already has two (the Filters drawer and the "System" view) — the "two
 * mechanisms answering the same question" drift this codebase keeps naming. Its
 * children each set `system: 'include'` instead, which is enough: a `\Microsoft\`
 * category contains nothing but system tasks, so including-plus-narrowing lands
 * on exactly that folder without a third way to say "only".
 */
function systemGroup(platform: string, system: Task[], showsSystem: boolean): RailNode {
  return {
    key: `${platform}/__system__`,
    // The **name** only. Whether the lens is currently holding these back is a
    // *state*, carried by `withheld` and rendered as a badge — not folded into
    // the label, which made it long enough to wrap the row onto two lines and
    // left it ragged among its single-line siblings. The rule it must still obey
    // is unchanged: the disclosure appears only while the lens actually applies,
    // or it describes a state that is no longer true.
    // Short on purpose, and it matches the wording of the toolbar chip that
    // reports the same set ("213 system hidden") — two surfaces describing one
    // thing should use one word for it. "System — the OS's own" was both
    // redundant (System and OS say the same thing twice) and long enough to
    // truncate to "System — the OS's…" once the `hidden` badge took its width.
    label: 'System tasks',
    count: system.length,
    withheld: !showsSystem,
    children: Array.from(tally(system, t => t.category || UNCATEGORIZED))
      .sort(([a], [b]) => byFolderName(a, b))
      .map(([category, count]) => ({
        key: `${platform}/__system__/${category}`,
        label: category,
        count,
        // `include`, never `only`. See the note above.
        patch: {
          ...RAIL_SCOPE_RESET,
          source: platform,
          category,
          system: 'include' as const
        }
      }))
  };
}

/**
 * Is this node the one the current filters describe?
 *
 * Matches on **exactly the dimensions the node sets**, which is what lets a
 * folder row and its parent source row both be honest: picking `AI-Tools` lights
 * the folder, and the source row above it is a container rather than a competing
 * selection. A node with no patch is never selected — it is a disclosure.
 */
export function isRailNodeSelected(node: RailNode, filters: TaskFilters): boolean {
  if (!node.patch) return false;
  return (Object.keys(node.patch) as (keyof TaskFilters)[]).every(
    k => filters[k] === node.patch![k]
  );
}

/**
 * Which top-level source row a set of filters sits under — so the rail can open
 * on the right branch after a reload or a pasted link.
 *
 * Prefix-derived rather than exact, because `TASKHUB_NATIVE:EXEC` belongs under
 * `TASKHUB_NATIVE`; this is the same prefix relationship `matchesSource` uses to
 * keep pre-split links working.
 */
export function expandedSourceFor(filters: TaskFilters): string | null {
  return filters.source === ALL_SOURCES ? null : sourcePlatform(filters.source);
}

/** Human label for a source key — re-exported so the rail has one import. */
export { sourceLabel };
