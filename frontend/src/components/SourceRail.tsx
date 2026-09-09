import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ChevronRight, Layers, Monitor, EyeOff, Star,
  PanelLeftClose, PanelLeftOpen, Bookmark, Plus, Pin, X,
  Compass, SlidersHorizontal, Search
} from 'lucide-react';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { usePlatformMatrix } from '../hooks/usePlatformMatrix';
import { useSettings } from '../hooks/useSettings';
import { railListedPlatforms } from '../utils/sourceVisibility';
import { sourceIcon, sourceAccentGlyph, platformSourceLabel } from '../platform';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';
import {
  buildSourceTree,
  expandedSourceFor,
  isRailNodeSelected,
  railSectionOf,
  ALL_SOURCES,
  FAVORITES_KEY,
  type RailNode,
  type RailSection
} from '../utils/sourceTree';
import { filterRailNodes, capRows } from '../utils/railFilter';
import { pinForNode, type RailPin } from '../utils/railPins';
import { moveKey } from '../utils/railOrder';
import { useCollections } from '../hooks/useCollections';
import type { Task } from '../types';
import type { TaskFilters } from '../utils/taskFilters';

/**
 * **Where a task lives** — the dashboard's navigation, as a tree.
 *
 * This is the second level of the app's chrome: the top toolbar answers *what am
 * I doing* (Dashboard / Templates / Platforms / Tools), and this answers *which
 * system, and which folder inside it*. What is left over — *which slice* —
 * belongs to the view bar and the filters.
 *
 * It absorbs two things that used to sit elsewhere: **the category facet**, which
 * was buried inside the Filters drawer even though the folder is the axis you
 * actually navigate by on a machine with 354 Windows tasks; and **per-platform
 * health**, which the old sidebar printed as a separate "System Status" panel
 * listing exactly these platforms with exactly these dots.
 *
 * The rail is *navigation*, which inverts one rule the old source bar followed.
 * `SourceBar` refused to show a source with no tasks, on the reasoning that a
 * control should never lead somewhere empty — right for a filter chip. As
 * navigation the opposite holds: a connected platform with nothing imported has
 * to be reachable, because its empty state is the only place that can tell you to
 * import from it. See `buildSourceTree` for the existence-vs-count split.
 *
 * ## The 2026-09 pass: four bands became two shapes
 *
 * The rail had grown to four stacked bands, each with a hairline rule, an
 * uppercase heading and its own fold — and 44px rows carrying a 28px bordered
 * icon tile, so six platforms cost 264px before a single folder. Collections with
 * two entries spent 61px of chrome on 60px of content, and the only route to a
 * source you have *not* added sat below the whole tree, off screen on any real
 * machine. Four changes, in the order they matter:
 *
 * **A declared list is chips; an observed tree is rows.** Collections and Pinned
 * are flat, named and short — nine of them cost two wrapped lines as chips
 * against nine 32px rows. The source tree stays rows because it nests and its
 * children carry counts you scan down a column. The two bands are still two
 * bands with two headings and two independent folds — that distinction is the
 * whole reason a pin is not a collection, and it survives the change of shape.
 *
 * **The rows lost their tiles.** A 28px bordered tile per row is the single
 * largest cost in the rail, and once it goes the glyph is the only thing left
 * that can say which source a row is — so identity colour moves onto the glyph
 * (`sourceAccentGlyph`, the same table the Sources cards read).
 *
 * **Everything caps.** No band and no folder list draws more than
 * `RAIL_ROW_CAP` rows without saying how many it is holding back.
 *
 * **Chrome left the scroll.** The collapse toggle, both source routes and the
 * help `?` live in a footer bar pinned to the bottom of the panel, so four
 * controls that used to compete with the tree are always exactly where they were
 * last time.
 *
 * And one thing was **deliberately not** done, having been drawn and rejected:
 * hiding the health dot on a healthy platform. Six green dots really are six
 * things saying nothing — but a platform with no connection at all already draws
 * no dot, so suppressing the healthy one makes *connected and fine* and *not
 * connected* the same pixel. That is §9's "absence of evidence is `unknown`,
 * never `ok`" in miniature. The dot shrank instead, and moved into a gutter of
 * its own so the states read as a column.
 */

// One definition, in `platform.ts`, because the Sources tab draws the same
// glyphs on its cards. See `sourceIcon` for why it is not private here.
const iconFor = sourceIcon;

/**
 * Props a reorderable row's `<li>` spreads. Named so the hook can return an
 * empty object for a band that cannot reorder without the two shapes diverging.
 */
interface DragProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (e: DragEvent<HTMLLIElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLLIElement>) => void;
  className?: string;
}

/**
 * **Drag one band's rows into the order you want**, with a keyboard path.
 *
 * Native HTML5 drag-and-drop rather than a library: the rail reorders a flat
 * list of at most a few dozen rows inside one container, which is the exact case
 * the platform already handles, and a drag library is a dependency plus a
 * provider plus a sensor config to do it. What the platform does *not* give is a
 * keyboard path — HTML5 DnD has none at all — so **Alt+Arrow moves the focused
 * row**, which is the half that would otherwise make this control mouse-only.
 * That is not a nicety here: the rail is the app's navigation, and a
 * navigation preference you cannot set without a pointer is one a keyboard user
 * simply does not have.
 *
 * A drop means *the dragged row takes the target's index* — the same thing
 * Alt+Arrow does one step at a time, so the two gestures cannot disagree about
 * what a move is. Order is written by the caller, never here: this hook knows
 * two rows swapped, and `onReorder` knows where that fact is kept.
 *
 * ponytail: touch is left out — HTML5 DnD does not fire for a finger and the
 * keyboard path needs a keyboard, so the rail is arranged on a desktop and the
 * order (a synced preference) is what the phone reads. Add pointer-event
 * dragging if anyone ever wants to arrange a sidebar from a phone.
 *
 * Returns no props at all for a band of fewer than two rows or one whose caller
 * passed no handler — a single row that can be picked up and dropped on itself
 * is an affordance that promises something it cannot do.
 */
function useBandReorder(
  section: RailSection,
  keys: string[],
  onReorder?: (section: RailSection, keys: string[]) => void
): (key: string) => DragProps {
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const enabled = !!onReorder && keys.length > 1;

  const move = (from: string, to: string) => {
    const next = moveKey(keys, from, to);
    // `moveKey` returns the same array when nothing moved — a drop on yourself,
    // or on a row that has gone since the drag began. Reporting that would push
    // a write for a change that did not happen.
    if (next !== keys) onReorder?.(section, next);
  };

  return (key: string) => {
    if (!enabled) return {};
    return {
      draggable: true,
      onDragStart: e => {
        dragging.current = key;
        e.dataTransfer.effectAllowed = 'move';
        // Set *something*: Firefox starts no drag at all without payload, and
        // it doubles as the fallback when `dragging` is lost to a re-render.
        e.dataTransfer.setData('text/plain', key);
      },
      onDragOver: e => {
        // Preventing the default is what makes this a drop target — without it
        // the row rejects every drag and the whole gesture silently no-ops.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver(prev => (prev === key ? null : prev)),
      onDrop: e => {
        e.preventDefault();
        move(dragging.current ?? e.dataTransfer.getData('text/plain'), key);
        dragging.current = null;
        setOver(null);
      },
      onDragEnd: () => {
        dragging.current = null;
        setOver(null);
      },
      onKeyDown: e => {
        // Alt-modified, so the arrows keep meaning "move the caret / scroll" in
        // every other context and this cannot shadow a browser or screen-reader
        // binding. Bubbles up from the row's own button, which is what holds
        // focus.
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        const i = keys.indexOf(key);
        const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= keys.length) return;
        e.preventDefault();
        move(key, keys[j]);
      },
      className: `cursor-grab active:cursor-grabbing rounded-full ${
        over === key ? 'ring-1 ring-ring/60' : ''
      }`
    };
  };
}

interface SourceRailProps {
  /**
   * The rail population — every task passing the lenses the rail does *not* own.
   * See `SourceTreeInput.population` for why source, category and the system
   * lens must all be left out of it.
   */
  population: Task[];
  filters: TaskFilters;
  onSelect: (patch: Partial<TaskFilters>) => void;
  /**
   * Icons-only mode.
   *
   * The folder level is **dropped**, not shrunk. At 72px a Task Scheduler folder
   * name has nowhere to go, and a tree whose second level is a column of
   * tooltips is worse than one that admits it needs width — so collapsing keeps
   * exactly what survives without text: the platforms, their health, and their
   * counts. Picking one expands the rail again, because the folder you were
   * heading for is the reason you clicked.
   */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Open the collection manager. Optional so the rail still renders in tests and
   * in any caller that has no manager wired — a missing handler hides the "+"
   * rather than rendering a button that does nothing.
   */
  onManageCollections?: () => void;
  /**
   * Pinned rail locations. See `utils/railPins.ts` for why these are not
   * collections: a collection's membership is declared, a pinned folder's is
   * derived, and the rail must not blur the two.
   */
  pins?: RailPin[];
  /**
   * Pin or unpin a level-2 row. Optional on the same terms as
   * `onManageCollections` — no handler, no `+`.
   */
  onTogglePin?: (node: RailNode) => void;
  /**
   * Is the Collections band folded shut?
   *
   * Its own preference rather than a piece of `collapsed`: folding the band is
   * about *how much of your own stuff you want on screen*, while `collapsed` is
   * about the width of the whole rail. Someone with fifteen collections and
   * three platforms wants the first shut and the second open, and one flag
   * cannot say that.
   */
  collectionsCollapsed?: boolean;
  onToggleCollectionsCollapsed?: () => void;
  /**
   * Is the Pinned band folded shut?
   *
   * Its own flag rather than sharing the Collections one: the reason to shut
   * fifteen collections has nothing to do with the reason to shut three pins,
   * and a single toggle over two sections would make each one's chevron lie
   * about the other.
   */
  pinnedCollapsed?: boolean;
  onTogglePinnedCollapsed?: () => void;
  /**
   * Is the Sources tree folded shut?
   *
   * A third independent flag, for the same reason as the second. Someone who
   * works out of two collections and one pinned folder has no use for a dozen
   * platform rows underneath them, and no reason to lose the rail's width to
   * hide them.
   */
  sourcesCollapsed?: boolean;
  onToggleSourcesCollapsed?: () => void;
  /**
   * The order the user dragged the source rows into. See
   * `SourceTreeInput.sourceOrder` — empty means alphabetical.
   */
  sourceOrder?: string[];
  /**
   * The band was reordered — here are **all** of its row keys, in the new order.
   *
   * The whole band rather than the pair that moved, because the rail is the only
   * surface that knows the order the user was looking at when they dragged. A
   * source's stored order is empty until the first drag, so a `(from, to)` pair
   * applied to an empty list would name two platforms and leave every other row
   * unordered beneath them — the first drag would reshuffle rows nobody touched.
   *
   * It says which band it is about because *where the order is kept* differs per
   * band and the rail must not hold an opinion about that: a pin's order is an
   * array in preferences, a collection's is a column the server already serves,
   * a source's is a preference of its own. Optional on the same terms as
   * `onTogglePin` — no handler, no drag.
   */
  onReorder?: (section: RailSection, keys: string[]) => void;
}

export const SourceRail = ({
  population,
  filters,
  onSelect,
  collapsed = false,
  onToggleCollapsed,
  onManageCollections,
  pins = [],
  onTogglePin,
  collectionsCollapsed = false,
  onToggleCollectionsCollapsed,
  pinnedCollapsed = false,
  onTogglePinnedCollapsed,
  sourcesCollapsed = false,
  onToggleSourcesCollapsed,
  sourceOrder = [],
  onReorder
}: SourceRailProps) => {
  const navigate = useNavigate();
  const { data: connections } = useConnections();
  const { data: collections } = useCollections();
  const { data: matrix } = usePlatformMatrix();
  const { settings } = useSettings();

  /**
   * What you typed into the filter field.
   *
   * Local state, and **not** a `TaskFilters` field — see `filterRailNodes`. It is
   * also not persisted: a narrowed rail is a thing you are doing right now, and
   * finding the sidebar still filtered tomorrow morning would read as a platform
   * that had disappeared.
   */
  const [query, setQuery] = useState('');
  const filtering = query.trim().length > 0;

  /**
   * Narrowing the rail and narrowing the *panel* do not compose, so one clears
   * the other.
   *
   * At 72px there is no field, no clear button and no empty state — every one of
   * them needs a label. A query surviving the collapse would leave platforms
   * missing from the icon rail with nothing on screen saying why, which is
   * indistinguishable from a source that has disappeared. Both entry points
   * route through here, including the collapsed search button, so the field you
   * expand into is always the one you left.
   */
  const toggleCollapsed = () => {
    setQuery('');
    onToggleCollapsed?.();
  };

  /**
   * Which capped lists you have opened past `RAIL_ROW_CAP`.
   *
   * Keyed by the list, not by the row, and local for the same reason as `query`.
   */
  const [uncapped, setUncapped] = useState<Set<string>>(() => new Set());
  const uncap = (key: string) =>
    setUncapped(prev => new Set(prev).add(key));

  /**
   * Which platforms get a row even with no tasks of their own.
   *
   * The union of three facts — asked for, holds tasks, is connected — with one
   * definition in `utils/sourceVisibility.ts`, because the eye switch on every
   * Sources-tab card has to be answering this same question. A second copy here
   * is how "connected but hidden" starts meaning two things.
   *
   * Note the Sources tab's three *views* do **not** read this: they split on
   * `configured`. Listed and connected are different facts, and only this one
   * decides whether the rail draws a row.
   *
   * Connections are still read directly: they arrive on their own query, and a
   * rail that waits for the matrix would drop every empty-but-connected row for
   * the first paint after login.
   */
  const listedPlatforms = useMemo(
    () => railListedPlatforms(
      matrix?.platforms,
      (connections ?? []).filter(c => c.state).map(c => c.platform),
      settings.shownSources
    ),
    [matrix, connections, settings.shownSources]
  );

  const tree = useMemo(
    () =>
      buildSourceTree({
        population,
        filters,
        connectedPlatforms: listedPlatforms,
        collections: collections ?? [],
        pins,
        sourceOrder
      }),
    [population, filters, listedPlatforms, collections, pins, sourceOrder]
  );

  /**
   * The rail in four bands.
   *
   * Partitioned here rather than rendered from one flat list with dividers
   * computed per row, which is what this did before: the rule was "rule under
   * the last scope row, wherever that is", and every new row type meant
   * re-deriving where the boundary had moved. Four arrays cannot put a
   * separator in the wrong place.
   *
   * **Scopes are never filtered.** *All sources* and *Favorites* are not search
   * results — they are the two places that mean "stop narrowing", and the moment
   * they can vanish, a filter that matches nothing leaves you with no route back
   * to everything.
   */
  const sections = useMemo(() => {
    const bands: Record<RailSection, RailNode[]> = {
      scope: [],
      collection: [],
      pinned: [],
      source: []
    };
    for (const node of tree) bands[railSectionOf(node.key)].push(node);

    const filtered = {
      collection: filterRailNodes(bands.collection, query),
      pinned: filterRailNodes(bands.pinned, query),
      source: filterRailNodes(bands.source, query)
    };

    /*
      Every list of *matches* has its cap lifted; a list carried along by a
      parent that matched keeps its cap. The bands themselves are lifted while a
      query is running, because each row in them is a hit — but the children of a
      hit are not, which is the whole distinction. See `FilteredRail`.
    */
    const liftedLists = new Set<string>();
    for (const [section, result] of Object.entries(filtered)) {
      for (const key of result.liftedLists) liftedLists.add(key);
      if (query.trim()) liftedLists.add(`band:${section}`);
    }

    return {
      scope: bands.scope,
      collection: filtered.collection.nodes,
      pinned: filtered.pinned.nodes,
      source: filtered.source.nodes,
      /**
       * **The whole band's keys, before the filter.**
       *
       * A reorder reports the band in its new order and the caller writes that
       * list verbatim — `orderBy` **drops every record the list does not name**,
       * which is stated in its own doc as a precondition: the caller hands in
       * the band's own rows. Handing it the *filtered* rows breaks that. With
       * five pins and a query matching two, one drag would have written a
       * two-element `railPins` and destroyed the other three, permanently, in a
       * synced preference. The cap never had this problem — hidden rows stay in
       * the key list and only the rendering is trimmed — and this restores the
       * same shape for the filter.
       *
       * Dropping A on B still means "A takes B's index", now resolved against
       * the full band, which is the right answer when rows between them are
       * hidden: the two visible chips end up in the order you dragged them into.
       */
      allKeys: {
        collection: bands.collection.map(n => n.key),
        pinned: bands.pinned.map(n => n.key),
        source: bands.source.map(n => n.key)
      },
      liftedLists
    };
  }, [tree, query]);

  /**
   * What the filter looked at, so "found nothing" and "looked at nothing" are
   * never the same sentence — the coverage rule `SyncOutcome.notes` follows,
   * one layer up in the UI.
   */
  const coverage = useMemo(() => {
    const all = tree.filter(n => railSectionOf(n.key) === 'source');
    const kept = new Set(sections.source.map(n => n.key));
    return {
      searched: all.length,
      missed: all.filter(n => !kept.has(n.key)).map(n => platformSourceLabel(n.key))
    };
  }, [tree, sections.source]);

  /**
   * Is this list drawn in full? Either you opened it, or its rows are matches —
   * see `FilteredRail.liftedLists` for why those are two different things.
   */
  const isUncapped = (key: string) => uncapped.has(key) || sections.liftedLists.has(key);

  const nothingMatched =
    filtering &&
    sections.collection.length === 0 &&
    sections.pinned.length === 0 &&
    sections.source.length === 0;

  const health = useMemo(
    () => new Map((connections ?? []).filter(c => c.state).map(c => [c.platform, c])),
    [connections]
  );

  // The source band reorders here rather than inside `Band` because these rows
  // are not `Band` rows — they expand into folders and carry health dots. Same
  // hook, same gesture, one level up.
  const sourceDrag = useBandReorder('source', sections.allKeys.source, onReorder);

  /**
   * Which branches are open.
   *
   * Stored as **overrides**, not as the set itself, so the default — "the branch
   * the current filters live in is open" — is *derived during render* rather than
   * synced into state by an effect. That matters beyond lint: an effect would
   * have to re-open the branch after every filter change, and the filters object
   * is new on every poll and invalidation (troubleshooting #52), so the effect's
   * dependency had to be a hand-picked string to avoid re-running forever. There
   * is no dependency to pick if there is no effect.
   *
   * The override also carries a meaning the additive version could not express:
   * `false` is *"I closed this on purpose"*, which now survives a re-render
   * instead of being immediately undone by the auto-open.
   *
   * **A filter opens everything**, overrides included: you asked for these rows
   * by name, and delivering them folded shut would hide the answer inside the
   * result.
   *
   * Expansion is presentation and deliberately **not** in the URL: a bookmark
   * reproduces which tasks you are looking at, and a link that also restored a
   * disclosure would make two URLs that mean the same thing.
   */
  const branch = expandedSourceFor(filters);
  const [overrides, setOverrides] = useState<Map<string, boolean>>(() => new Map());

  const isOpen = (key: string) => filtering || (overrides.get(key) ?? key === branch);
  const toggle = (key: string) =>
    setOverrides(prev => new Map(prev).set(key, !isOpen(key)));

  const rowProps = { isOpen, onToggle: toggle, onSelect, filters, pins, onTogglePin, isUncapped, uncap };

  return (
    <nav
      aria-label="Task sources"
      data-testid="source-rail"
      /* `flex-1`, not `h-full`: the rail is a flex child in both of its homes
         (the desktop panel and the mobile drawer), and `height: 100%` in a
         column would resolve against the whole container and push its own
         footer past the bottom edge in the drawer, which has a header above. */
      className="flex min-h-0 flex-1 flex-col text-sm"
    >
      {/*
        Everything that scrolls. The footer below does not, which is the point of
        splitting them: the four controls down there are the ones you reach for
        from anywhere in the tree, and under 350 tasks they were off screen.
      */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}
      >
        {/*
          **Filter the rail by name.** Sources, folders, collections and pins —
          not tasks, which the view bar above the list already filters. The
          placeholder says which, because that is the one confusion this control
          can cause.
        */}
        {collapsed ? (
          // Only where there is a rail to expand. Without a toggle this would be
          // a search button that cannot search and cannot widen — a control
          // promising something it has no way to do.
          onToggleCollapsed && <button
            onClick={toggleCollapsed}
            aria-label="Filter sources — expands the sidebar"
            title="Filter sources and folders"
            className="mb-3 flex h-8 w-full items-center justify-center rounded-lg border border-border bg-muted/40 text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <Search size={15} />
          </button>
        ) : (
          <div className="relative mb-3">
            <Search
              size={13}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground"
            />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              // Escape clears rather than blurring: the field is a lens over the
              // rail, and leaving it focused-but-full is the state nobody wants.
              onKeyDown={e => {
                if (e.key !== 'Escape' || !filtering) return;
                e.preventDefault();
                // The mobile drawer closes on a document-level Escape. Without
                // this, one press clears the field AND dismisses the sidebar
                // the field lives in — and only while `filtering`, so an empty
                // field still lets Escape shut the drawer.
                e.stopPropagation();
                setQuery('');
              }}
              aria-label="Filter sources and folders"
              placeholder="Filter sources and folders"
              className="h-8 w-full rounded-lg border border-border bg-muted/40 pl-8 pr-7 text-[12.5px] text-foreground placeholder:text-subtle-foreground focus:border-ring/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
            />
            {filtering && (
              <button
                onClick={() => setQuery('')}
                aria-label="Clear filter"
                className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}

        {/* Scopes: everything, and starred. Two rows that name a slice of every
            system rather than one system — which is why they lead the rail and
            never take part in the filter. */}
        <ul className="space-y-0.5">
          {sections.scope.map(node => (
            <li key={node.key}>
              <Row
                node={node}
                selected={isRailNodeSelected(node, filters)}
                collapsed={collapsed}
                Icon={node.key === ALL_SOURCES ? Layers : Star}
                iconTone={node.key === FAVORITES_KEY ? 'warning' : undefined}
                dot={null}
                expandable={false}
                open={false}
                onToggle={() => {}}
                onSelect={onSelect}
              />
            </li>
          ))}
        </ul>

        {/*
          **Collections, then Pinned — two bands of chips.**

          Two bands, because one list wearing two glyphs asks the reader to hold
          "some of these hold what I put in them, some track a folder" in their
          head. Chips, because both lists are flat, named and short: nine of them
          cost two wrapped lines against nine 32px rows, and neither has children
          to nest or a column of counts to scan.
        */}
        <ChipBand
          testId="collections-band"
          title="Collections"
          section="collection"
          onReorder={onReorder}
          Icon={Bookmark}
          rows={sections.collection}
          reorderKeys={sections.allKeys.collection}
          filtering={filtering}
          railCollapsed={collapsed}
          folded={collectionsCollapsed}
          onToggleFolded={onToggleCollectionsCollapsed}
          filters={filters}
          onSelect={onSelect}
          isUncapped={isUncapped}
          uncap={uncap}
          /*
            Collections keep their empty state: the `+` in the header is how the
            first one gets made, so the band has to be there before you have any.
            While the filter is running it goes — an empty band under a query is
            a result, and "no collections match" is said once, at the bottom.
          */
          keepWhenEmpty={!filtering}
          headerAction={
            !collapsed && onManageCollections ? (
              <button
                type="button"
                onClick={onManageCollections}
                aria-label={collections?.length ? 'Manage collections' : 'New collection'}
                title={collections?.length ? 'Manage collections' : 'New collection'}
                className="flex h-[18px] w-[18px] items-center justify-center rounded text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <Plus size={13} />
              </button>
            ) : undefined
          }
        />

        {/*
          Pinned has **no** empty state, unlike Collections, and the asymmetry is
          the point rather than an oversight. A band earns permanent chrome when
          its empty state can teach you something you can act on *there* — which
          "New collection" does. Pinning happens on a folder in the tree, so an
          empty Pinned band could only point somewhere else.
        */}
        <ChipBand
          testId="pinned-band"
          title="Pinned"
          section="pinned"
          onReorder={onReorder}
          Icon={Pin}
          rows={sections.pinned}
          reorderKeys={sections.allKeys.pinned}
          filtering={filtering}
          railCollapsed={collapsed}
          folded={pinnedCollapsed}
          onToggleFolded={onTogglePinnedCollapsed}
          filters={filters}
          onSelect={onSelect}
          isUncapped={isUncapped}
          uncap={uncap}
          /*
            Unpin from the pinned chip itself, not only from the tree row it
            mirrors. It is the surface you are looking at when you decide a pin
            has served its purpose — and the only one that still works once the
            folder is gone, which is exactly when a `0` row you cannot remove
            would be worst. Collections carry no equivalent: removing one
            destroys a set you built, and that belongs in the manager behind a
            confirmation.
          */
          chipAction={node => <UnpinButton node={node} onTogglePin={onTogglePin} />}
        />

        {/* The source tree: rows, because these nest and carry counts. */}
        <div data-testid="sources-band" className="mt-3">
          {!collapsed && (
            <BandHeader
              title="Sources"
              Icon={Layers}
              /* A fold may not swallow a hit — see `ChipBand`. Someone who
                 folded Sources and then types `backups` would otherwise get a
                 header, a coverage note, and no results at all. */
              folded={sourcesCollapsed && !filtering}
              onToggleFolded={onToggleSourcesCollapsed}
              count={sections.source.length}
            />
          )}
          {(collapsed || !sourcesCollapsed || filtering) && (
            <ul className="space-y-0.5">
              {(() => {
                const { shown, hidden } = capRows(
                  sections.source,
                  isUncapped('band:source') || collapsed
                );
                return (
                  <>
                    {shown.map(node => {
                      const open = isOpen(node.key);
                      const conn = health.get(node.key);

                      return (
                        <li key={node.key} {...sourceDrag(node.key)}>
                          <Row
                            node={node}
                            selected={isRailNodeSelected(node, filters)}
                            collapsed={collapsed}
                            Icon={iconFor(node.key)}
                            iconClass={sourceAccentGlyph(node.key)}
                            dot={conn ? healthMeta(conn.state) : null}
                            expandable={!collapsed && !!node.children?.length}
                            open={open}
                            onToggle={() => toggle(node.key)}
                            onSelect={onSelect}
                          />

                          {!collapsed && open && node.children && (
                            /*
                              The guide rail. Depth was expressed only as left
                              padding, so fifteen folders under Windows read as a
                              flat list that happened to start further right. A
                              hairline down the group is what makes it a tree.
                            */
                            <ChildList
                              nodes={node.children}
                              listKey={node.key}
                              {...rowProps}
                            />
                          )}
                        </li>
                      );
                    })}
                    {hidden > 0 && (
                      <li>
                        <MoreButton
                          label={`Show ${hidden} more source${hidden === 1 ? '' : 's'}`}
                          onClick={() => uncap('band:source')}
                        />
                      </li>
                    )}
                  </>
                );
              })()}
            </ul>
          )}

          {/*
            What the filter looked at. Rendered whenever a query is running and
            something was left out, because "no matches in Vercel" and "Vercel
            was never searched" are different facts and they render identically
            as an absence.
          */}
          {!collapsed && filtering && coverage.missed.length > 0 && !nothingMatched && (
            <p className="mt-2 px-2 text-[10.5px] leading-relaxed text-subtle-foreground">
              Searched {coverage.searched} source{coverage.searched === 1 ? '' : 's'}. No match in{' '}
              {coverage.missed.join(', ')}.
            </p>
          )}
        </div>

        {nothingMatched && !collapsed && (
          <div className="mt-6 px-2">
            <p className="text-[12.5px] font-semibold text-muted-foreground">
              Nothing here is called &ldquo;{query.trim()}&rdquo;
            </p>
            <p className="mt-1.5 text-[11px] leading-relaxed text-subtle-foreground">
              Searched {coverage.searched} source{coverage.searched === 1 ? '' : 's'}, your
              collections and your pins, by name. This filters the sidebar, not your tasks — to
              search task names, use the filters above the list.
            </p>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="mt-2.5 flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-[11px] font-bold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <X size={12} />
              Clear filter
            </button>
          </div>
        )}
      </div>

      {/*
        **The utility bar.** Out of the scroll flow on purpose: these are the
        rail's own controls rather than destinations inside your tasks, and the
        two source routes are the only way to reach a platform you have *not*
        added — which is what makes an opt-in default set safe rather than
        indistinguishable from a missing platform. Below fifteen folders they
        were off screen on every real machine.
      */}
      <div
        className={`flex shrink-0 items-center gap-1 border-t border-border ${
          collapsed ? 'flex-col px-2 py-2' : 'px-2 py-1.5'
        }`}
      >
        {onToggleCollapsed && (
          <button
            onClick={toggleCollapsed}
            /* "sidebar", not "sources". This narrows the whole rail — scopes,
               Collections and Pinned included — and the word only meant the
               tree back when the tree was all there was. It would also collide
               with the Sources section's own fold, leaving two different
               controls sharing one accessible name. */
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/sources?focus=available')}
          aria-label="Explore sources"
          title="Everything Cronsole can connect to, including what you have not added"
          className={`flex items-center justify-center gap-1.5 rounded-lg text-[11px] font-bold text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
            collapsed ? 'h-7 w-7 shrink-0' : 'h-7 min-w-0 flex-1 px-2'
          }`}
        >
          <Compass size={14} className="shrink-0" />
          {!collapsed && <span className="truncate">Explore sources</span>}
        </button>

        {!collapsed && (
          <>
            <button
              type="button"
              onClick={() => navigate('/sources?focus=connected')}
              aria-label="Manage sources"
              title="Connect, disconnect, and choose which sources this sidebar lists"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
            >
              <SlidersHorizontal size={14} />
            </button>
            {/* Topic-sensitive to the selected source: it explains the platforms,
                so it belongs beside the control that reaches them. */}
            <HelpButton
              topic={filters.source === ALL_SOURCES ? 'sources' : sourceTopicId(filters.source)}
            />
          </>
        )}
      </div>
    </nav>
  );
};

/** Shared row-rendering handles, threaded down the folder tree. */
interface RowContext {
  filters: TaskFilters;
  isOpen: (key: string) => boolean;
  onToggle: (key: string) => void;
  onSelect: (patch: Partial<TaskFilters>) => void;
  pins: RailPin[];
  onTogglePin?: (node: RailNode) => void;
  isUncapped: (key: string) => boolean;
  uncap: (key: string) => void;
}

/**
 * One nested list of folders, capped.
 *
 * Recursive, and the cap applies at **every** level rather than only the first:
 * a machine with fifteen folders under Windows usually has a deep one somewhere
 * too, and a rule that stops at depth 1 fixes the list you were looking at while
 * leaving the one underneath it exactly as long.
 */
const ChildList = ({
  nodes,
  listKey,
  ...ctx
}: RowContext & { nodes: RailNode[]; listKey: string }) => {
  /*
    **A disclosure is never capped.** The `\Microsoft\` group is the one child
    whose entire job is saying that 300 tasks are being held back, and it sorts
    last — so under a plain cap it would be the first thing to go behind *Show 12
    more folders* on exactly the machines that have most to disclose. §9 requires
    it be disclosed rather than silently fenced, and a disclosure you have to
    find behind a fold is most of the way to fenced.

    It is identified by having no `patch`, which is the same thing that makes it
    a disclosure rather than a destination — not a second way of spotting it that
    could disagree with the first.
  */
  const destinations = nodes.filter(n => n.patch);
  const disclosures = nodes.filter(n => !n.patch);
  const { shown, hidden } = capRows(destinations, ctx.isUncapped(listKey));

  return (
    <ul className="mt-px ml-[13px] pl-1.5 border-l border-border/70 space-y-px">
      {shown.map(node => (
        <ChildRow key={node.key} node={node} {...ctx} />
      ))}
      {hidden > 0 && (
        <li>
          <MoreButton
            label={`Show ${hidden} more folder${hidden === 1 ? '' : 's'}`}
            onClick={() => ctx.uncap(listKey)}
          />
        </li>
      )}
      {disclosures.map(node => (
        <ChildRow key={node.key} node={node} {...ctx} />
      ))}
    </ul>
  );
};

/**
 * *Show N more* — the one control a capped list owes its reader.
 *
 * One-way on purpose. A list you opened is a list you went looking in, and a
 * *Show less* beside every one of them spends a permanent row policing a
 * decision nobody regrets; the band's own fold already puts the whole thing
 * away. It states the remainder rather than "more", because a count is what
 * makes a cap honest instead of a silent truncation.
 */
const MoreButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2 text-[11px] font-semibold text-subtle-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
  >
    <ChevronRight size={11} className="shrink-0 rotate-90" />
    <span className="truncate">{label}</span>
  </button>
);

/**
 * A section heading: chevron, name, and — while folded — its tally.
 *
 * Shared by all three of the rail's named sections, because they are meant to
 * read as the same kind of thing. *Sources* is the odd one out structurally (its
 * rows are expandable trees, not chips, so it cannot use `ChipBand`), and that
 * is exactly why the heading had to come out on its own: without this, the one
 * section that could not share the component would have been the one that
 * drifted.
 *
 * The tally shows **only while folded**. Open, you can count the rows yourself;
 * shut, it is the one thing you cannot see — and a chevron that hid twelve rows
 * with no hint of them is the "silently hides 200 rows" problem in miniature.
 */
const BandHeader = ({
  title,
  Icon,
  folded,
  onToggleFolded,
  count,
  trailing
}: {
  title: string;
  /** Shown beside the name when the section cannot fold (no handler given). */
  Icon: typeof Monitor;
  folded: boolean;
  onToggleFolded?: () => void;
  count: number;
  /** An extra control docked to the right of the heading. */
  trailing?: ReactNode;
}) => (
  <div className="flex items-center gap-1 px-2 pb-1.5">
    {onToggleFolded ? (
      <button
        type="button"
        onClick={onToggleFolded}
        aria-expanded={!folded}
        aria-label={`${folded ? 'Expand' : 'Collapse'} ${title.toLowerCase()}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-0.5 text-subtle-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
      >
        <ChevronRight
          size={11}
          className={`shrink-0 transition-transform duration-200 ${folded ? '' : 'rotate-90'}`}
        />
        <span className="text-[10px] font-black uppercase tracking-[0.14em]">{title}</span>
        {folded && count > 0 && (
          <span className="ml-auto tabular-nums text-[10px] font-semibold">{count}</span>
        )}
      </button>
    ) : (
      <>
        <Icon size={11} className="text-subtle-foreground shrink-0" />
        <span className="flex-1 text-[10px] font-black uppercase tracking-[0.14em] text-subtle-foreground">
          {title}
        </span>
      </>
    )}
    {trailing && <span className="flex shrink-0 items-center">{trailing}</span>}
  </div>
);

/**
 * One of the rail's two chip bands — *Collections* and *Pinned*.
 *
 * One component rather than two blocks of near-identical JSX, because the two
 * sections are supposed to look and behave the same: same heading weight, same
 * fold, same tally when shut, same cap. Two copies would drift on the first
 * change made to only one of them, and the drift would be the "these are the
 * same kind of place" claim quietly becoming false.
 *
 * At icon width there is nowhere to put a chip's label, so the band falls back
 * to the same stacked cells the source rows use — a chip without its name is a
 * coloured pill that means nothing.
 */
const ChipBand = ({
  testId,
  title,
  Icon,
  rows,
  reorderKeys,
  railCollapsed,
  folded,
  onToggleFolded,
  filtering,
  filters,
  onSelect,
  keepWhenEmpty = false,
  headerAction,
  chipAction,
  section,
  onReorder,
  isUncapped,
  uncap
}: {
  testId: string;
  title: string;
  /** Shown beside the heading when the band cannot be folded (no handler). */
  Icon: typeof Monitor;
  rows: RailNode[];
  /**
   * The **whole** band's keys, filter or no filter — what a reorder reports.
   * See `sections.allKeys`: reporting only the visible rows destroys the rest.
   */
  reorderKeys: string[];
  /** A query is running, so a fold may not hide a hit. */
  filtering: boolean;
  /** The whole rail is icons-only. Distinct from `folded`, which is this band. */
  railCollapsed: boolean;
  folded: boolean;
  onToggleFolded?: () => void;
  filters: TaskFilters;
  onSelect: (patch: Partial<TaskFilters>) => void;
  /** Render the band even with no rows — for a band whose header creates them. */
  keepWhenEmpty?: boolean;
  headerAction?: ReactNode;
  chipAction?: (node: RailNode) => ReactNode;
  /** Which band these rows belong to — passed straight back to `onReorder`. */
  section: RailSection;
  onReorder?: (section: RailSection, keys: string[]) => void;
  isUncapped: (key: string) => boolean;
  uncap: (key: string) => void;
}) => {
  const drag = useBandReorder(section, reorderKeys, onReorder);

  /*
    Nothing to show and nothing to offer: render nothing at all. A band that is
    empty *and* has no way to fill itself from here is a heading over a gap —
    and at 72px, where the heading is dropped, that is what every empty band
    would be.
  */
  if (rows.length === 0 && (!keepWhenEmpty || railCollapsed)) return null;

  /*
    **A fold may not swallow a hit.** The three band folds are persisted
    preferences, so someone who shut Collections months ago and then types a
    collection's name would get a `COLLECTIONS 3` heading, a coverage note, and
    nothing on screen — with `nothingMatched` false, so even the empty state
    that would explain it never renders. The branch-level `isOpen` already had
    this override; the band-level fold was missed.

    The chevron follows, rather than claiming shut over an open band.
  */
  const effectivelyFolded = folded && !filtering;
  const open = railCollapsed || !effectivelyFolded;
  const { shown, hidden } = capRows(rows, isUncapped(`band:${section}`) || railCollapsed);

  return (
    <div data-testid={testId} className="mt-3">
      {/* Icons-only drops the heading: 72px has no room for a label, and a
          disclosure you cannot read is one you cannot use. The band is simply
          always open there. */}
      {!railCollapsed && (
        <BandHeader
          title={title}
          Icon={Icon}
          folded={effectivelyFolded}
          onToggleFolded={onToggleFolded}
          count={rows.length}
          trailing={headerAction}
        />
      )}

      {open &&
        (railCollapsed ? (
          <ul className="space-y-0.5">
            {shown.map(node => (
              <li key={node.key}>
                <Row
                  node={node}
                  selected={isRailNodeSelected(node, filters)}
                  collapsed
                  Icon={Icon}
                  dot={null}
                  expandable={false}
                  open={false}
                  onToggle={() => {}}
                  onSelect={onSelect}
                />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-wrap gap-1.5 px-1">
            {shown.map(node => (
              // The drag props carry a `className` (grab cursor, drop-target
              // ring), so this has to merge rather than replace — a literal
              // after the spread wins, and the affordance vanishes silently.
              <li
                key={node.key}
                {...(() => {
                  const p = drag(node.key);
                  return { ...p, className: `max-w-full ${p.className ?? ''}` };
                })()}
              >
                <Chip
                  node={node}
                  selected={isRailNodeSelected(node, filters)}
                  Icon={Icon}
                  onSelect={onSelect}
                  action={chipAction?.(node)}
                />
              </li>
            ))}
            {hidden > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => uncap(`band:${section}`)}
                  aria-label={`Show ${hidden} more ${title.toLowerCase()}`}
                  className="flex h-[25px] items-center rounded-full border border-dashed border-border px-2.5 text-[11px] font-semibold text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  +{hidden}
                </button>
              </li>
            )}
          </ul>
        ))}
    </div>
  );
};

/**
 * A collection or a pin, as a chip.
 *
 * It keeps everything the row it replaced carried and drops nothing: the name,
 * the **count** (which is what says whether a destination is worth clicking),
 * the selected state, and — on a pin — the control that takes it away. What it
 * loses is the 32px of rail height per entry, and a column of counts nobody
 * scanned down because these lists are three items long.
 */
const Chip = ({
  node,
  selected,
  Icon,
  onSelect,
  action
}: {
  node: RailNode;
  selected: boolean;
  Icon: typeof Monitor;
  onSelect: (patch: Partial<TaskFilters>) => void;
  action?: ReactNode;
}) => (
  <span
    className={`group flex h-[25px] max-w-full items-center rounded-full border pl-2 pr-1 transition-colors ${
      selected
        ? 'border-primary/50 bg-primary/15 text-foreground'
        : 'border-border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted'
    }`}
  >
    <button
      type="button"
      onClick={() => node.patch && onSelect(node.patch)}
      aria-current={selected ? 'true' : undefined}
      // Named explicitly rather than left to the content: a collection called
      // "2" would otherwise be indistinguishable from its own tally.
      aria-label={`${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
      title={node.label}
      className="flex min-w-0 items-center gap-1.5 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-full"
    >
      <Icon size={11} className="shrink-0" />
      <span className="truncate text-[11.5px] font-semibold">{node.label}</span>
      <span
        className={`shrink-0 tabular-nums text-[10.5px] font-medium ${
          selected ? 'text-primary-text' : 'text-subtle-foreground'
        }`}
      >
        {node.count}
      </span>
    </button>
    {action ?? <span className="w-1" aria-hidden />}
  </span>
);

/**
 * A level-2 row: a folder, a job type, or the `\Microsoft\` disclosure group.
 *
 * The group is the one row here that is **not** a selection — it has no patch,
 * so it renders as an expander only. That is deliberate: selecting it would mean
 * writing `system: 'only'` from the rail, making it a third controller of a lens
 * that already has two.
 */
const ChildRow = ({ node, ...ctx }: RowContext & { node: RailNode }) => {
  const open = ctx.isOpen(node.key);
  const isGroup = !node.patch;

  return (
    <li>
      <Row
        node={node}
        selected={isRailNodeSelected(node, ctx.filters)}
        child
        Icon={isGroup ? EyeOff : null}
        dot={null}
        // Was `isGroup && …`, back when only the `\Microsoft\` disclosure ever
        // had children at this depth. An ordinary folder is selectable AND can
        // now hold its own subfolders, so it needs the same chevron — selecting
        // and expanding are independent controls (label vs. chevron), not
        // opposites.
        expandable={!!node.children?.length}
        open={open}
        onToggle={() => ctx.onToggle(node.key)}
        onSelect={ctx.onSelect}
        action={<PinButton node={node} pins={ctx.pins} onTogglePin={ctx.onTogglePin} />}
      />
      {open && node.children && (
        <ChildList nodes={node.children} listKey={node.key} {...ctx} />
      )}
    </li>
  );
};

/**
 * Take a pinned chip back off the band.
 *
 * A separate component from `PinButton` rather than a mode of it: that one is
 * asked *about a folder* and has to work out whether it is pinned, while this
 * one is on a chip that is a pin by construction. Folding them together would
 * mean a control whose meaning depends on which list it was rendered into.
 */
const UnpinButton = ({
  node,
  onTogglePin
}: {
  node: RailNode;
  onTogglePin?: (node: RailNode) => void;
}) => {
  if (!onTogglePin) return null;

  return (
    <button
      type="button"
      onClick={() => onTogglePin(node)}
      aria-label={`Unpin ${node.label} from collections`}
      title={`Unpin ${node.label} — the folder itself is untouched`}
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full text-subtle-foreground opacity-0 transition-all hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <X size={11} />
    </button>
  );
};

/**
 * Pin this folder to the Pinned band, or take it back off.
 *
 * **One control, both directions.** A `+` that only added would leave removal to
 * some other surface, and the row that shows you a folder is pinned is exactly
 * the row you are looking at when you decide it should not be.
 *
 * Hover-revealed while unpinned, permanent once pinned — an affordance you have
 * to go looking for is fine for an action, but the *state* has to be readable
 * without a pointer, and there is no hover on a touch screen at all. It stays in
 * the tab order either way, so the keyboard path does not depend on the mouse
 * path.
 *
 * Absent for a node with no patch: the `\Microsoft\` disclosure group is an
 * expander, not a destination, and pinning "the idea of system tasks" would
 * produce a row that selects nothing. `pinFromNode` refuses it independently —
 * this only avoids drawing a button that would be refused.
 */
const PinButton = ({
  node,
  pins,
  onTogglePin
}: {
  node: RailNode;
  pins: RailPin[];
  onTogglePin?: (node: RailNode) => void;
}) => {
  if (!onTogglePin || !node.patch) return null;
  const pinned = pinForNode(pins, node.key) !== undefined;

  return (
    <button
      type="button"
      onClick={() => onTogglePin(node)}
      aria-pressed={pinned}
      aria-label={
        pinned
          ? `Unpin ${node.label} from collections`
          : `Pin ${node.label} to collections`
      }
      title={
        pinned
          ? `Unpin ${node.label} — it stays in the tree`
          : `Pin ${node.label} to Pinned. It keeps tracking this folder.`
      }
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
        pinned
          ? 'text-primary opacity-100'
          : 'text-subtle-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground hover:bg-muted'
      }`}
    >
      {pinned ? <Pin size={11} fill="currentColor" /> : <Plus size={12} />}
    </button>
  );
};

const Row = ({
  node,
  selected,
  child = false,
  collapsed = false,
  Icon,
  iconClass,
  iconTone,
  dot,
  expandable,
  open,
  onToggle,
  onSelect,
  action
}: {
  node: RailNode;
  selected: boolean;
  /** A folder or job type — contents of a destination, not a destination. */
  child?: boolean;
  /** Icons-only. Only ever true at the top level — folders are dropped. */
  collapsed?: boolean;
  Icon: typeof Monitor | null;
  /**
   * The glyph's identity colour, from `sourceAccentGlyph`. Only the source rows
   * pass one: a collection and a folder belong to no platform, and tinting them
   * would make the colour mean "this is a row" rather than "this is Claude".
   */
  iconClass?: string;
  /** Overrides the icon's accent — Favorites wears the same amber as its star. */
  iconTone?: 'warning';
  dot: { label: string; dot: string; text: string } | null;
  expandable: boolean;
  open: boolean;
  onToggle: () => void;
  onSelect: (patch: Partial<TaskFilters>) => void;
  /**
   * A trailing control, rendered **outside** the row's own button.
   *
   * Outside because nesting it would put a button inside a button — invalid
   * markup that browsers recover from by dropping one, and the one they drop is
   * not the one you would choose. It also keeps the two jobs separate: the row
   * navigates, the action acts on the row, and a click can only ever mean one
   * of them.
   */
  action?: ReactNode;
}) => {
  const selectable = !!node.patch;

  /*
    Collapsed: one centred cell, the count beneath, the name in a tooltip.
    Rendered as its own branch rather than as the expanded row with pieces
    hidden — the two share almost no layout, and threading four `collapsed ?`
    conditionals through the wide row is how one of them ends up wrong at 72px
    where nobody looks.
  */
  if (collapsed) {
    return (
      <button
        onClick={() => selectable && onSelect(node.patch!)}
        aria-current={selected ? 'true' : undefined}
        aria-label={`${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
        title={`${node.label} — ${node.count} task${node.count === 1 ? '' : 's'}${
          dot ? ` · ${dot.label}` : ''
        }`}
        /*
          Icon over count, stacked and centred — not a number tucked into the
          corner. `357` in a corner badge ran to the tile's edge and fought the
          glyph beside it; stacked, three digits fit and the column of counts
          still scans vertically the way the expanded rail's does.
        */
        className={`group relative flex h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
          selected ? 'bg-primary/15' : 'hover:bg-muted/60'
        }`}
      >
        {Icon && (
          <Icon
            size={17}
            className={
              iconTone === 'warning'
                ? 'text-warning-text'
                : iconClass ?? (selected ? 'text-primary-text' : 'text-muted-foreground')
            }
            {...(iconTone === 'warning' ? { fill: 'currentColor' } : {})}
          />
        )}
        {dot && (
          <span
            aria-hidden
            className={`absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full ${dot.dot}`}
          />
        )}
        {/* The count survives the collapse: it is the one number that says
            whether a source is worth clicking, and losing it would make the
            collapsed rail a row of anonymous glyphs. */}
        <span
          className={`text-[10px] tabular-nums leading-none ${
            selected ? 'text-foreground font-bold' : 'text-subtle-foreground'
          }`}
        >
          {node.count}
        </span>
      </button>
    );
  }

  return (
    /*
      One fixed-height row, and the selected state is unmistakable.

      The accent bar on the leading edge is what actually reads — it is the same
      "you are here" grammar the top toolbar uses on its active tab, rotated to
      match a vertical list. Heights are fixed rather than derived from content:
      a row that grew because its label wrapped would shift every row under it,
      and this list re-renders on a 45s poll.
    */
    <div
      className={`group relative flex items-center rounded-lg pr-1.5 transition-colors duration-100 ${
        child ? 'h-[26px]' : 'h-8'
      } ${selected ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/50'}`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-150 ${
          selected ? (child ? 'h-3.5 opacity-100' : 'h-4 opacity-100') : 'h-0 opacity-0'
        }`}
      />

      {expandable ? (
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <ChevronRight
            size={12}
            className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
          />
        </button>
      ) : (
        // Reserve the chevron's width so sibling labels stay on one left edge —
        // a row that shifts sideways depending on whether it has children makes
        // the tree's depth unreadable at a glance.
        <span className="w-[18px] shrink-0" aria-hidden />
      )}

      {/*
        **Health gets a column of its own**, before the glyph rather than tucked
        onto it. On a tile the dot was a corner badge; with the tile gone it
        would have had to sit somewhere in the row's flow, and a mark that moves
        with the label cannot be scanned down. An empty gutter on the rows that
        have no health keeps every glyph on one left edge.

        Present for *every* connection state including healthy. Suppressing the
        green one is tempting — six calm dots say very little — but a platform
        with no connection at all already draws nothing here, so a hidden healthy
        dot would make "connected and fine" and "not connected" the same pixel.
      */}
      {!child && (
        <span className="flex w-2.5 shrink-0 items-center justify-center" aria-hidden>
          {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot.dot}`} />}
        </span>
      )}

      <button
        // A selectable row filters; a disclosure group only opens. Both are
        // buttons and neither pretends to be the other — the group never claims
        // a selected state it cannot be in, and clicking its label does the one
        // thing it can do rather than nothing at all.
        onClick={() => (selectable ? onSelect(node.patch!) : onToggle())}
        aria-expanded={selectable ? undefined : open}
        aria-current={selected ? 'true' : undefined}
        // Named explicitly rather than left to the text content. The count sits
        // in its own span, so a content-derived name reads "AI-Tools 8" — and a
        // folder called "2" would be indistinguishable from its own tally.
        aria-label={`${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
        // A long folder name truncates; the full one has to stay reachable, or
        // three folders sharing a prefix become the same row.
        title={
          node.withheld
            ? `${node.count} tasks the OS owns. The dashboard hides these by default — open the group to look inside one folder.`
            : dot
              ? `${node.label} — ${dot.label}`
              : node.label
        }
        className={`flex h-full min-w-0 flex-1 items-center gap-1.5 pl-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 rounded-md ${
          selected
            ? 'text-foreground'
            : selectable
              ? 'text-muted-foreground hover:text-foreground'
              : 'text-subtle-foreground hover:text-foreground'
        }`}
      >
        {/*
          The glyph carries platform identity now that the tile is gone —
          `iconClass` is `sourceAccentGlyph`'s answer, one table shared with the
          Sources cards. Identity only: the dot in the gutter says how the
          platform is doing, and the two must never be read off one colour.
        */}
        {Icon && (
          <Icon
            size={child ? 13 : 16}
            className={`shrink-0 transition-colors ${
              iconTone === 'warning'
                ? 'text-warning-text'
                : iconClass ?? (selected ? 'text-primary-text' : '')
            }`}
            {...(iconTone === 'warning' ? { fill: 'currentColor' } : {})}
          />
        )}

        <span
          className={`truncate text-[13px] tracking-[-0.01em] ${
            selected ? 'font-bold' : child ? 'font-medium' : 'font-semibold'
          }`}
        >
          {node.label}
        </span>

        {/*
          The withheld state as a badge rather than a parenthetical in the label.

          It has to stay visible — this is the one row whose job is saying what is
          being held back — and as text it made the label long enough to wrap,
          which left a two-line row ragged among single-line ones. A badge states
          the same fact in a fixed slot and cannot push the row's height around.
        */}
        {node.withheld && (
          <span className="shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide bg-muted text-subtle-foreground">
            hidden
          </span>
        )}

        {/*
          Counts form a **column**, not a row of pills: right-aligned, tabular,
          and set in one dim weight so fifteen of them scan vertically. One size
          and one weight at every depth, because a count is the same kind of fact
          whether it is beside a platform or a folder.
        */}
        <span
          className={`ml-auto shrink-0 pl-1 tabular-nums text-right text-[11px] ${
            selected ? 'text-foreground font-semibold' : 'text-subtle-foreground'
          }`}
        >
          {node.count}
        </span>
      </button>

      {action}
    </div>
  );
};

export default SourceRail;
