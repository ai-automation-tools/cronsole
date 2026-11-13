import { useId, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ChevronRight, Layers, Monitor, EyeOff, Star,
  PanelLeftClose, PanelLeftOpen, Bookmark, Plus, Pin, X,
  Compass, SlidersHorizontal, Search, Link2, Pencil
} from 'lucide-react';
import { useToast } from '../hooks/useToast';
import { TaskCollectionMenu } from './TaskCollectionMenu';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { usePlatformMatrix } from '../hooks/usePlatformMatrix';
import { useSettings } from '../hooks/useSettings';
import { railListedPlatforms } from '../utils/sourceVisibility';
import { sourceIcon, sourceAccentGlyph, platformSourceLabel, platformAccent, sourcePlatform } from '../platform';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';
import {
  buildSourceTree,
  expandedSourceFor,
  isRailNodeSelected,
  railSectionOf,
  railNodeTasks,
  collectionIdFromKey,
  ALL_SOURCES,
  FAVORITES_KEY,
  type RailNode,
  type RailSection
} from '../utils/sourceTree';
import { filterRailNodes, capRows } from '../utils/railFilter';
import { pinForNode, type RailPin } from '../utils/railPins';
import { moveKey } from '../utils/railOrder';
import {
  RAIL_TABS,
  RAIL_TAB_LABEL,
  DEFAULT_RAIL_TAB,
  asRailTab,
  shownRailTab,
  type RailTab
} from '../utils/railTabs';
import { useCollections, collectionLink } from '../hooks/useCollections';
import { railNodeLink } from '../utils/savedViews';
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
 * ## The 2026-11 pass: a slider and the sources
 *
 * Chosen from three mockups, then trimmed. Under the filter box, **a scope
 * slider** (All sources · Favorites) and **a list slider** (Collections ·
 * Pinned, `utils/railTabs.ts`, two-per-row tiles), and **Sources stand alone
 * below** — the tree is what you navigate by, so it is never behind a segment.
 * Then everything shrank ~25% in height. The three fold flags went with the bands: a
 * tab bar is a fold that can only leave one list open, and its badges keep the
 * closed one's count on screen the way a folded heading did. Sources became
 * cards with their **folders still rows** inside — they nest, and their counts
 * scan as a column — and the identity tile came back on the card, with health
 * beside it as a dot *and* a word. "A fold may not swallow a hit" survives as
 * `shownRailTab`. An overview card (task total + per-source bar) was built and
 * removed: the dashboard heading already counts the tasks.
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
      className: `cursor-grab active:cursor-grabbing rounded-xl ${
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
   * exactly what survives without text: the two scopes, the platforms, their
   * health, and their counts. Collections and pins are named things with no
   * glyph of their own, so they wait for the rail to widen.
   */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /**
   * Open the collection manager. Optional so the rail still renders in tests and
   * in any caller that has no manager wired — a missing handler hides the
   * button rather than rendering one that does nothing. `renameId` opens it
   * with that collection's name already in edit — the card's pencil.
   */
  onManageCollections?: (renameId?: string) => void;
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
   * Which section is showing. See `utils/railTabs.ts` — a synced preference,
   * so it is the caller's to store. Uncontrolled (local state) when no
   * `onTabChange` is given, which is what the tests use.
   */
  tab?: RailTab;
  onTabChange?: (tab: RailTab) => void;
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
  tab: tabProp,
  onTabChange,
  sourceOrder = [],
  onReorder
}: SourceRailProps) => {
  const navigate = useNavigate();
  const { data: connections } = useConnections();
  const { data: collections } = useCollections();
  const { data: matrix } = usePlatformMatrix();
  const { settings } = useSettings();
  // The rail renders twice at once (desktop panel + phone drawer), so tab ids
  // need a per-instance prefix or `aria-controls` points at the wrong panel.
  const idBase = useId();

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
  const changeQuery = (q: string) => {
    setQuery(q);
    setPickedThisQuery(null);
  };

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
   * The rail in four groups — two scopes, then the three tabs' contents.
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
      /** Every source, unfiltered — what the overview card's bar is drawn from. */
      allSources: bands.source,
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
    const kept = new Set(sections.source.map(n => n.key));
    return {
      searched: sections.allSources.length,
      missed: sections.allSources.filter(n => !kept.has(n.key)).map(n => platformSourceLabel(n.key))
    };
  }, [sections]);

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

  // One reorder hook per band, called unconditionally: the hidden tabs' hooks
  // still run, so switching tabs never changes the hook order.
  const sourceDrag = useBandReorder('source', sections.allKeys.source, onReorder);
  const collectionDrag = useBandReorder('collection', sections.allKeys.collection, onReorder);
  const pinDrag = useBandReorder('pinned', sections.allKeys.pinned, onReorder);

  /**
   * Which tab is drawn. Chosen by the user, except that a running filter may
   * show another one rather than an empty panel — see `shownRailTab`. The
   * badges become match counts at the same moment, so the reader can see where
   * the other hits are.
   */
  const [localTab, setLocalTab] = useState<RailTab>(DEFAULT_RAIL_TAB);
  const chosenTab = asRailTab(tabProp ?? localTab);
  /*
    A tab clicked *while filtering* is shown even when it holds no matches —
    the auto-switch is for landing on a query, never for overruling a click
    (a tab that ignores you reads as broken). Cleared with the query, so the
    next search starts from the rule again.
  */
  const [pickedThisQuery, setPickedThisQuery] = useState<RailTab | null>(null);
  const chooseTab = (t: RailTab) => {
    if (filtering) setPickedThisQuery(t);
    if (onTabChange) onTabChange(t);
    else setLocalTab(t);
  };
  const hits: Record<RailTab, number> = {
    collections: sections.collection.length,
    pinned: sections.pinned.length
  };
  const tab = (filtering && pickedThisQuery) || shownRailTab(chosenTab, hits, filtering);

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

  const rowProps = { isOpen, onToggle: toggle, onSelect, filters, pins, onTogglePin, isUncapped, uncap, population };

  const collectionCap = capRows(sections.collection, isUncapped('band:collection'));
  const pinCap = capRows(sections.pinned, isUncapped('band:pinned'));

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
        splitting them: the controls down there are the ones you reach for from
        anywhere in the tree.
      */}
      <div
        className={`min-h-0 flex-1 overflow-y-auto ${collapsed ? 'px-2 py-3' : 'px-3 py-3'}`}
      >
        {collapsed ? (
          <>
            {/* Only where there is a rail to expand. Without a toggle this would
                be a search button that cannot search and cannot widen. */}
            {onToggleCollapsed && (
              <button
                onClick={toggleCollapsed}
                aria-label="Filter sources — expands the sidebar"
                title="Filter sources and folders"
                className="mb-2 flex h-6 w-full items-center justify-center rounded-md border border-border bg-muted/40 text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <Search size={15} />
              </button>
            )}
            <ul className="space-y-0.5">
              {sections.scope.map(node => (
                <li key={node.key}>
                  <Row
                    node={node}
                    selected={isRailNodeSelected(node, filters)}
                    collapsed
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
            <span aria-hidden className="mx-auto my-2 block h-px w-8 bg-border" />
            <ul data-testid="sources-band" className="space-y-0.5">
              {sections.source.map(node => {
                const conn = health.get(node.key);
                return (
                  <li key={node.key}>
                    <Row
                      node={node}
                      selected={isRailNodeSelected(node, filters)}
                      collapsed
                      Icon={iconFor(node.key)}
                      iconClass={sourceAccentGlyph(node.key)}
                      dot={conn ? healthMeta(conn.state) : null}
                      expandable={false}
                      open={false}
                      onToggle={() => {}}
                      onSelect={onSelect}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <>

            {/*
              **Filter the rail by name.** Sources, folders, collections and pins —
              not tasks, which the view bar above the list already filters. The
              placeholder says which, because that is the one confusion this
              control can cause.
            */}
            <div className="relative">
              <Search
                size={13}
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={e => changeQuery(e.target.value)}
                // Escape clears rather than blurring: the field is a lens over
                // the rail, and leaving it focused-but-full is the state nobody
                // wants.
                onKeyDown={e => {
                  if (e.key !== 'Escape' || !filtering) return;
                  e.preventDefault();
                  // The mobile drawer closes on a document-level Escape.
                  // Without this, one press clears the field AND dismisses the
                  // sidebar the field lives in — and only while `filtering`, so
                  // an empty field still lets Escape shut the drawer.
                  e.stopPropagation();
                  setQuery('');
                }}
                aria-label="Filter sources and folders"
                placeholder="Filter sources and folders"
                className="h-7 w-full rounded-lg border border-border bg-background/60 pl-8 pr-7 text-[12.5px] text-foreground placeholder:text-subtle-foreground focus:border-ring/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
              />
              {filtering && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear filter"
                  className="absolute right-1 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                >
                  <X size={12} />
                </button>
              )}
            </div>

            {/*
              **Two sliders.** The first holds the two scopes — All sources and
              Favorites select on click, and are lit while they are the
              selection. The second holds the two lists — Collections and
              Pinned open underneath, one at a time. Sources are in neither: the
              tree is what you navigate by, so it stands alone below.
            */}
            <Segmented
              idBase={`${idBase}-scope`}
              label="Scope"
              className="mt-2"
              segments={sections.scope.map(node => {
                const fav = node.key === FAVORITES_KEY;
                const active = isRailNodeSelected(node, filters);
                return {
                  key: node.key,
                  label: node.label,
                  icon: fav
                    ? <Star size={13} aria-hidden className="shrink-0 text-warning-text" fill="currentColor" />
                    : <Layers size={13} aria-hidden className="shrink-0 text-primary-text" />,
                  count: node.count,
                  active,
                  ariaLabel: `${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`,
                  ariaState: { 'aria-current': active ? ('true' as const) : undefined },
                  onClick: () => node.patch && onSelect(node.patch)
                };
              })}
            />
            <Segmented
              idBase={`${idBase}-list`}
              label="Your lists"
              className="mt-1.5"
              segments={RAIL_TABS.map(t => ({
                key: t,
                label: RAIL_TAB_LABEL[t],
                count: hits[t],
                active: tab === t,
                ariaLabel: `${RAIL_TAB_LABEL[t]}, ${hits[t]}${filtering ? ` match${hits[t] === 1 ? '' : 'es'}` : ''}`,
                ariaState: { 'aria-expanded': tab === t, 'aria-controls': `${idBase}-panel` },
                onClick: () => chooseTab(t)
              }))}
            />

            {nothingMatched ? (
              <div className="mt-3 px-1">
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
            ) : (
              <>
                <div
                  role="region"
                  id={`${idBase}-panel`}
                  aria-label={RAIL_TAB_LABEL[tab]}
                  className="mt-2"
                >
                  {tab === 'collections' ? (
                  <div data-testid="collections-band">
                    {sections.collection.length === 0 && (
                      <p className="px-1 pb-2 text-[11.5px] leading-relaxed text-subtle-foreground">
                        {filtering
                          ? `No collection is called “${query.trim()}”.`
                          : 'A collection holds exactly the tasks you put in it, from any source.'}
                      </p>
                    )}
                    <ul className="grid grid-cols-2 gap-1.5">
                      {collectionCap.shown.map(node => (
                        <li key={node.key} {...withClass(collectionDrag(node.key), 'min-w-0')}>
                          <CollectionCard
                            node={node}
                            selected={isRailNodeSelected(node, filters)}
                            onSelect={onSelect}
                            onRename={onManageCollections}
                          />
                        </li>
                      ))}
                    </ul>
                    {collectionCap.hidden > 0 && (
                      <MoreButton
                        label={`Show ${collectionCap.hidden} more collection${collectionCap.hidden === 1 ? '' : 's'}`}
                        onClick={() => uncap('band:collection')}
                      />
                    )}
                    {!filtering && onManageCollections && (
                      <button
                        type="button"
                        onClick={() => onManageCollections()}
                        aria-label={collections?.length ? 'Manage collections' : 'New collection'}
                        className="mt-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:border-ring/50 hover:bg-muted/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      >
                        <Plus size={14} />
                        {collections?.length ? 'New or manage collections' : 'New collection'}
                      </button>
                    )}
                  </div>
                  ) : (
                  <div data-testid="pinned-band">
                    {sections.pinned.length === 0 && filtering && (
                      <p className="px-1 text-[11.5px] leading-relaxed text-subtle-foreground">
                        No pin is called &ldquo;{query.trim()}&rdquo;.
                      </p>
                    )}
                    {sections.pinned.length === 0 && !filtering && (
                      <p className="px-1 text-[11.5px] leading-relaxed text-subtle-foreground">
                        Pin a folder to keep it one click away. Under <strong className="font-semibold text-muted-foreground">Sources</strong> below,
                        open a source, hover a folder and press <strong className="font-semibold text-muted-foreground">+</strong>.
                        A pin keeps tracking the folder as tasks come and go.
                      </p>
                    )}
                    <ul className="grid grid-cols-2 gap-1.5">
                      {pinCap.shown.map(node => (
                        <li key={node.key} {...withClass(pinDrag(node.key), 'min-w-0')}>
                          <PinTile
                            node={node}
                            SourceIcon={node.patch?.source ? iconFor(node.patch.source) : null}
                            selected={isRailNodeSelected(node, filters)}
                            onSelect={onSelect}
                            onTogglePin={onTogglePin}
                          />
                        </li>
                      ))}
                    </ul>
                    {pinCap.hidden > 0 && (
                      <MoreButton
                        label={`Show ${pinCap.hidden} more pin${pinCap.hidden === 1 ? '' : 's'}`}
                        onClick={() => uncap('band:pinned')}
                      />
                    )}
                  </div>
                  )}
                </div>

                <section aria-label="Sources" data-testid="sources-band" className="mt-4">
                  <h3 className="flex items-center gap-1.5 px-1 pb-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-subtle-foreground">
                    Sources
                    <span className="tabular-nums font-semibold">{sections.source.length}</span>
                  </h3>
                  {/* Never capped: the user chose which sources to show (Manage
                      sources), so folding the last ones away hid platforms they
                      had asked for. */}
                  {filtering && sections.source.length === 0 && (
                    <p className="px-1 text-[11.5px] leading-relaxed text-subtle-foreground">
                      No source or folder is called &ldquo;{query.trim()}&rdquo;.
                    </p>
                  )}
                  <ul className="space-y-1">
                    {sections.source.map(node => {
                      const open = isOpen(node.key);
                      const conn = health.get(node.key);
                      return (
                        <li key={node.key} {...sourceDrag(node.key)}>
                          <SourceCard
                            node={node}
                            Icon={iconFor(node.key)}
                            selected={isRailNodeSelected(node, filters)}
                            health={conn ? healthMeta(conn.state) : null}
                            open={open}
                            onToggle={() => toggle(node.key)}
                            onSelect={onSelect}
                          >
                            {node.children && (
                              <ChildList nodes={node.children} listKey={node.key} {...rowProps} />
                            )}
                          </SourceCard>
                        </li>
                      );
                    })}
                  </ul>
                  {/*
                    What the filter looked at. Rendered whenever a query is
                    running and something was left out, because "no matches in
                    Vercel" and "Vercel was never searched" are different facts
                    and they render identically as an absence.
                  */}
                  {filtering && coverage.missed.length > 0 && (
                    <p className="mt-2 px-1 text-[10.5px] leading-relaxed text-subtle-foreground">
                      Searched {coverage.searched} source{coverage.searched === 1 ? '' : 's'}. No match in{' '}
                      {coverage.missed.join(', ')}.
                    </p>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>

      {/*
        **The utility bar.** Out of the scroll flow on purpose: these are the
        rail's own controls rather than destinations inside your tasks, and the
        two source routes are the only way to reach a platform you have *not*
        added — which is what makes an opt-in default set safe rather than
        indistinguishable from a missing platform.
      */}
      <div
        className={`flex shrink-0 items-center gap-1 border-t border-border ${
          collapsed ? 'flex-col px-2 py-1.5' : 'px-3 py-1.5'
        }`}
      >
        {onToggleCollapsed && (
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}

        <button
          type="button"
          onClick={() => navigate('/sources?focus=available')}
          aria-label="Explore sources"
          title="Everything Cronsole can connect to, including what you have not added"
          className={`flex items-center justify-center gap-1.5 rounded-md text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
            collapsed
              ? 'h-6 w-6 shrink-0 text-subtle-foreground hover:text-foreground hover:bg-muted'
              : 'h-6 min-w-0 flex-1 border border-border bg-raised px-2 text-muted-foreground hover:text-foreground hover:border-ring/50'
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
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
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

/** One segment of a `Segmented` slider. */
interface Segment {
  key: string;
  label: string;
  icon?: ReactNode;
  count: number;
  active: boolean;
  ariaLabel: string;
  /** `aria-current` for a scope, `aria-expanded` + `aria-controls` for a list. */
  ariaState: Record<string, string | boolean | undefined>;
  onClick: () => void;
}

/**
 * A slider of segments — the rail has two (scopes, then lists).
 *
 * A `toolbar` rather than a `tablist`, because the scope slider's segments
 * select instead of switching a panel, and the two sliders should behave the
 * same: arrows move focus, Enter or a click acts — an arrow that acted would
 * re-filter the dashboard on every keypress.
 */
const Segmented = ({
  idBase,
  label,
  segments,
  className = ''
}: {
  idBase: string;
  label: string;
  segments: Segment[];
  className?: string;
}) => {
  const focusable = segments.find(sg => sg.active)?.key ?? segments[0]?.key;
  const idFor = (key: string) => `${idBase}-${key.replace(/[^a-z0-9_-]/gi, '_')}`;
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const current = segments.findIndex(sg => document.getElementById(idFor(sg.key)) === document.activeElement);
    if (current < 0) return;
    const n = segments.length;
    const next =
      e.key === 'ArrowRight' ? (current + 1) % n
      : e.key === 'ArrowLeft' ? (current + n - 1) % n
      : e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    document.getElementById(idFor(segments[next].key))?.focus();
  };

  return (
    <div
      role="toolbar"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={`grid grid-cols-2 gap-0.5 rounded-lg border border-border bg-background/60 p-[2px] ${className}`}
    >
      {segments.map(sg => (
        <button
          key={sg.key}
          type="button"
          id={idFor(sg.key)}
          tabIndex={sg.key === focusable ? 0 : -1}
          onClick={sg.onClick}
          aria-label={sg.ariaLabel}
          title={sg.label}
          {...sg.ariaState}
          className={`flex h-6 min-w-0 items-center justify-center gap-1 rounded-md px-1.5 text-[11.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
            sg.active ? 'bg-raised text-foreground shadow-sm' : 'text-subtle-foreground hover:text-foreground'
          }`}
        >
          {sg.icon}
          <span className="truncate">{sg.label}</span>
          <span
            aria-hidden
            className={`shrink-0 rounded-full px-1 text-[10px] font-medium tabular-nums ${
              sg.active ? 'bg-primary/20 text-primary-text' : 'bg-muted text-subtle-foreground'
            }`}
          >
            {sg.count}
          </span>
        </button>
      ))}
    </div>
  );
};

/**
 * One platform, as a card: identity tile, name, health in words, count — and
 * its folders as **rows** inside, because they nest and their counts scan as a
 * column (§9: an observed tree is rows).
 *
 * Selecting and expanding stay two controls, as on the old row: the card's body
 * picks the source, the chevron opens it. Health keeps its own dot beside a
 * label rather than tinting the tile, so *which source* and *how it is doing*
 * are never read off one colour; a source with no connection says so instead
 * of drawing nothing, so "fine" and "unknown" cannot share a pixel.
 */
const SourceCard = ({
  node,
  Icon,
  selected,
  health,
  open,
  onToggle,
  onSelect,
  children
}: {
  node: RailNode;
  /** `iconFor(node.key)`, passed in so the component is not chosen during render. */
  Icon: typeof Monitor;
  selected: boolean;
  health: { label: string; dot: string; text: string } | null;
  open: boolean;
  onToggle: () => void;
  onSelect: (patch: Partial<TaskFilters>) => void;
  children?: ReactNode;
}) => {
  const expandable = !!node.children?.length;
  return (
    <div
      className={`rounded-xl border transition-colors ${
        selected ? 'border-primary/50 bg-primary/10' : 'border-border bg-raised hover:border-ring/40'
      }`}
    >
      <div className="flex items-center gap-1 p-1">
        <button
          type="button"
          onClick={() => node.patch && onSelect(node.patch)}
          aria-current={selected ? 'true' : undefined}
          aria-label={`${node.label}, ${node.count} task${node.count === 1 ? '' : 's'}`}
          title={health ? `${node.label} — ${health.label}` : node.label}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        >
          <span
            aria-hidden
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${platformAccent(sourcePlatform(node.key)).tile}`}
          >
            <Icon size={13} className={sourceAccentGlyph(node.key)} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate text-[12.5px] leading-tight ${selected ? 'font-bold' : 'font-semibold'}`}>{node.label}</span>
            <span className="flex items-center gap-1.5 text-[10.5px] leading-tight text-subtle-foreground">
              {health ? (
                <>
                  <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${health.dot}`} />
                  {health.label}
                </>
              ) : (
                'No health reported'
              )}
            </span>
          </span>
          <span
            className={`shrink-0 pl-1 tabular-nums text-[12px] font-semibold ${
              selected ? 'text-primary-text' : 'text-muted-foreground'
            }`}
          >
            {node.count}
          </span>
        </button>
        {expandable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            <ChevronRight size={13} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          </button>
        ) : (
          <span className="w-5 shrink-0" aria-hidden />
        )}
      </div>
      {open && expandable && children && (
        <div className="border-t border-border/60 px-1 pb-1 pt-0.5">{children}</div>
      )}
    </div>
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
  /** The rail population — what a folder's "add to collection" draws its tasks from. */
  population: Task[];
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
    className="flex w-full items-center gap-1.5 rounded-md py-0.5 pl-1.5 pr-2 text-[11px] font-semibold text-subtle-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
  >
    <ChevronRight size={11} className="shrink-0 rotate-90" />
    <span className="truncate">{label}</span>
  </button>
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
        action={
          <>
            {/* Whole folder → a collection, as a snapshot of what the row counts.
                Hover-revealed like the pin's `+`; absent on a disclosure or an
                empty folder, where there is nothing to add. */}
            {!isGroup && node.count > 0 && (
              <TaskCollectionMenu
                folder={{ label: node.label, tasks: railNodeTasks(ctx.population, node) }}
                size={12}
                className="h-[18px] w-[18px] justify-center rounded opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-muted"
              />
            )}
            <PinButton node={node} pins={ctx.pins} onTogglePin={ctx.onTogglePin} />
          </>
        }
      />
      {open && node.children && (
        <ChildList nodes={node.children} listKey={node.key} {...ctx} />
      )}
    </li>
  );
};

/** Merge a reorder hook's props with a row's own class, rather than letting one replace the other. */
const withClass = (props: DragProps, cls: string): DragProps => ({
  ...props,
  className: `${cls} ${props.className ?? ''}`
});

/** A square icon button on a card — copy link, rename, unpin. Always visible, so it works by touch. */
const CARD_ACTION =
  'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60';

const CopyLinkButton = ({ label, url }: { label: string; url: string }) => {
  const { toast } = useToast();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast(`Link to “${label}” copied.`, 'success');
    } catch {
      toast('Could not copy the link.', 'error');
    }
  };
  return (
    <button type="button" onClick={copy} aria-label={`Copy link to ${label}`} title="Copy link" className={CARD_ACTION}>
      <Link2 size={11} />
    </button>
  );
};

/**
 * The compact two-per-row tile both lists use: name and count on top, a small
 * mark (a bookmark, or the pin's source glyph) and the actions underneath.
 *
 * The whole tile selects; the actions sit beside the select button rather than
 * inside it, so a button never nests in a button and a click means one thing.
 */
const CompactTile = ({
  node,
  selected,
  onSelect,
  mark,
  actions
}: {
  node: RailNode;
  selected: boolean;
  onSelect: (patch: Partial<TaskFilters>) => void;
  mark: ReactNode;
  actions: ReactNode;
}) => (
  <div
    className={`relative h-full rounded-xl border transition-colors ${
      selected ? 'border-primary/50 bg-primary/10' : 'border-border bg-raised hover:border-ring/40'
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
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-xl px-2 pb-1 pt-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      <span className="flex w-full items-baseline gap-1.5">
        <span className={`min-w-0 flex-1 truncate text-[12.5px] leading-tight ${selected ? 'font-bold' : 'font-semibold'}`}>
          {node.label}
        </span>
        <span className={`shrink-0 text-[12px] font-bold leading-tight tabular-nums ${selected ? 'text-primary-text' : 'text-muted-foreground'}`}>
          {node.count}
        </span>
      </span>
      {/* Leaves room on the right for the actions, which sit over this line. */}
      <span className="flex h-4 items-center pr-10">{mark}</span>
    </button>
    <span className="absolute bottom-1 right-1 flex gap-0.5">{actions}</span>
  </div>
);

/**
 * A collection, as a compact tile: name, size, and its two actions — copy a
 * link and rename. Rename opens the manager in edit mode rather than editing
 * inline: a text field inside a tile is a control nobody can hit on a phone.
 * Deleting stays in the manager only, behind a confirmation, because it
 * destroys a set you built (a pin's unpin does not).
 */
const CollectionCard = ({
  node,
  selected,
  onSelect,
  onRename
}: {
  node: RailNode;
  selected: boolean;
  onSelect: (patch: Partial<TaskFilters>) => void;
  onRename?: (id: string) => void;
}) => {
  const id = collectionIdFromKey(node.key);
  return (
    <CompactTile
      node={node}
      selected={selected}
      onSelect={onSelect}
      mark={<Bookmark size={11} aria-hidden className="text-primary-text" />}
      actions={
        <>
          {id && <CopyLinkButton label={node.label} url={collectionLink(id)} />}
          {id && onRename && (
            <button type="button" onClick={() => onRename(id)} aria-label={`Rename ${node.label}`} title="Rename" className={CARD_ACTION}>
              <Pencil size={10} />
            </button>
          )}
        </>
      }
    />
  );
};

/**
 * A pinned folder, as a tile in a two-column grid: which source it lives in,
 * its count large, its name — then copy-link and unpin.
 *
 * The link names the **folder** (`railNodeLink`), not the pin. There is
 * deliberately **no rename**: a pin mirrors a real folder and shows that
 * folder's name as it reads today, so a label of your own would be a second
 * name for a place that already has one.
 *
 * Unpin lives on the tile as well as on the folder row it mirrors: it is the
 * surface you are looking at when you decide a pin has served its purpose, and
 * the only one that still works once the folder is gone — exactly when a `0`
 * tile you could not remove would be worst.
 */
const PinTile = ({
  node,
  SourceIcon,
  selected,
  onSelect,
  onTogglePin
}: {
  node: RailNode;
  /** The pinned folder's source glyph, passed in so it is not chosen during render. */
  SourceIcon: typeof Monitor | null;
  selected: boolean;
  onSelect: (patch: Partial<TaskFilters>) => void;
  onTogglePin?: (node: RailNode) => void;
}) => {
  const source = node.patch?.source;
  return (
    <CompactTile
      node={node}
      selected={selected}
      onSelect={onSelect}
      mark={
        /* The source as its glyph alone, named on hover: at half the rail's
           width "Windows Task Scheduler" truncates to nothing useful, and the
           glyph is the same identity the Sources section draws. */
        <span title={source ? platformSourceLabel(source) : undefined} className="flex items-center">
          {SourceIcon && source && <SourceIcon size={11} aria-hidden className={sourceAccentGlyph(source)} />}
        </span>
      }
      actions={
        <>
          {node.patch && <CopyLinkButton label={node.label} url={railNodeLink(node.patch)} />}
          {onTogglePin && (
            <button
              type="button"
              onClick={() => onTogglePin(node)}
              aria-label={`Unpin ${node.label} from collections`}
              title={`Unpin ${node.label} — the folder itself is untouched`}
              className={CARD_ACTION}
            >
              <X size={11} />
            </button>
          )}
        </>
      }
    />
  );
};

/**
 * Pin this folder to the Pinned tab, or take it back off.
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
        className={`group relative flex h-9 w-full flex-col items-center justify-center gap-0.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
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
        child ? 'h-5' : 'h-6'
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
          className={`truncate text-[12px] tracking-[-0.01em] ${
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
