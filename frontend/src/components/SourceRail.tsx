import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ChevronRight, Layers, Monitor, EyeOff, Star,
  PanelLeftClose, PanelLeftOpen, Bookmark, Plus, Pin, X,
  Compass, SlidersHorizontal, Search
} from 'lucide-react';
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
  ALL_SOURCES,
  FAVORITES_KEY,
  type RailNode,
  type RailSection
} from '../utils/sourceTree';
import { filterRailNodes, capRows } from '../utils/railFilter';
import { pinForNode, type RailPin } from '../utils/railPins';
import { useBandReorder } from '../hooks/useBandReorder';
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
 * Later the same day the sliders went: All tasks, Favorites, Pinned and every
 * collection became **one Scopes list** of rows, and Pinned stopped listing its
 * pins here — it opens `PinnedGallery` in the main area instead, since the rail
 * already draws the tree those pins point into.
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

/** A scope that opens a gallery in the main area instead of a task list. */
export type RailLens = 'collections' | 'pinned';

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
   * Pinned rail locations. See `utils/railPins.ts` for why these are not
   * collections: a collection's membership is declared, a pinned folder's is
   * derived, and the rail must not blur the two.
   */
  pins?: RailPin[];
  /**
   * Pin or unpin a level-2 row. Optional on the same terms as
   * `onReorder` — no handler, no `+`.
   */
  onTogglePin?: (node: RailNode) => void;
  /**
   * Which gallery the main area is showing, if any. **Collections** and
   * **Pinned** are scope rows that open a gallery of cards in the main content
   * area rather than a list in the rail — the rail stays the tree, and a list
   * of places is easier to read as boxes than as a second column of rows.
   * `lens` lights its row and unlights every other (a gallery is not a task
   * slice); `onShowLens` opens one. No handler, no rows.
   */
  lens?: RailLens | null;
  onShowLens?: (lens: RailLens) => void;
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
  pins = [],
  onTogglePin,
  lens = null,
  onShowLens,
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
  const changeQuery = setQuery;

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

  const nothingMatched = filtering && sections.source.length === 0;

  const health = useMemo(
    () => new Map((connections ?? []).filter(c => c.state).map(c => [c.platform, c])),
    [connections]
  );

  const sourceDrag = useBandReorder('source', sections.allKeys.source, onReorder);

  /**
   * Is this row the current place? Never while a gallery is open: a gallery is
   * not a task slice, so the filters still in the URL behind it do not describe
   * what is on screen, and lighting them would put two "you are here" marks in
   * one rail.
   */
  const isSelected = (node: RailNode) => !lens && isRailNodeSelected(node, filters);

  /**
   * The Collections row is lit in its gallery **and** while one collection's
   * tasks are on screen — collections have no rows of their own in the rail any
   * more, so without this a collection's list would light nothing at all.
   */
  const collectionsLit = lens === 'collections' || (!lens && filters.collection !== 'All');
  const collectionCount = collections?.length ?? 0;

  /**
   * The two gallery scopes, in rail order (after Favorites). Stand-in nodes so
   * the collapsed rail's `Row` can draw them; their patch is never applied —
   * each row's onSelect opens its gallery.
   */
  const lensRows = onShowLens
    ? ([
        {
          lens: 'collections' as const,
          node: { key: '__collections', label: 'Collections', count: collectionCount, patch: {} },
          Icon: Bookmark,
          lit: collectionsLit,
          ariaLabel: `Collections, ${collectionCount} collection${collectionCount === 1 ? '' : 's'}`
        },
        {
          lens: 'pinned' as const,
          node: { key: '__pinned', label: 'Pinned', count: pins.length, patch: {} },
          Icon: Pin,
          lit: lens === 'pinned',
          ariaLabel: `Pinned, ${pins.length} pinned folder${pins.length === 1 ? '' : 's'}`
        }
      ] satisfies { lens: RailLens; node: RailNode; Icon: typeof Monitor; lit: boolean; ariaLabel: string }[])
    : [];

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

  const rowProps = { isOpen, onToggle: toggle, onSelect, isSelected, pins, onTogglePin, isUncapped, uncap, population };


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
        **The rail's header, out of the scroll**: the filter box and, beside it,
        the collapse toggle — at the top where it is seen, coloured so it reads as
        a control, and never scrolled away. (It lived in the bottom bar until
        2026-11-13, a 24px grey glyph nobody found.)
      */}
      <div className={`flex shrink-0 items-center gap-2 ${collapsed ? 'justify-center px-2 pt-3' : 'px-3 pt-3'}`}>
        {!collapsed && (
          <>
          {/*
            **Filter the rail by name.** Sources and folders —
            not tasks, which the view bar above the list already filters. The
            placeholder says which, because that is the one confusion this
            control can cause.
          */}
          <div className="relative min-w-0 flex-1">
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
              className="h-8 w-full rounded-lg border border-border bg-background/60 pl-8 pr-7 text-[12.5px] text-foreground placeholder:text-subtle-foreground focus:border-ring/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-search-cancel-button]:hidden"
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
          </>
        )}
        {onToggleCollapsed && (
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-info/40 bg-info/15 text-info-text transition-colors hover:bg-info/25 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        )}
      </div>

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
                    selected={isSelected(node)}
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
              {lensRows.map(r => (
                <li key={r.lens}>
                  <Row
                    node={r.node}
                    selected={r.lit}
                    collapsed
                    Icon={r.Icon}
                    dot={null}
                    expandable={false}
                    open={false}
                    onToggle={() => {}}
                    onSelect={() => onShowLens?.(r.lens)}
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
                      selected={isSelected(node)}
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
              **Scopes: one list.** All tasks, Favorites, Collections and
              Pinned are all "which tasks" answers that cut across sources, so
              they share a section. None of them is filtered — they are the
              routes back when a query matches nothing. Collections and Pinned
              open a gallery in the main area instead of listing here.
            */}
            <section aria-label="Scopes" data-testid="scopes-band">
              <h3 className="px-2 pb-1 text-[10.5px] font-bold uppercase tracking-[0.12em] text-subtle-foreground">
                Scopes
              </h3>
              <ul className="space-y-px">
                {sections.scope.map(node => {
                  const fav = node.key === FAVORITES_KEY;
                  return (
                    <li key={node.key}>
                      <ScopeRow
                        icon={fav
                          ? <Star size={15} aria-hidden className="shrink-0 text-warning-text" fill="currentColor" />
                          : <Layers size={15} aria-hidden className="shrink-0 text-primary-text" />}
                        label={fav ? node.label : 'All tasks'}
                        count={node.count}
                        selected={isSelected(node)}
                        onClick={() => node.patch && onSelect(node.patch)}
                      />
                    </li>
                  );
                })}
                {lensRows.map(r => (
                  <li key={r.lens}>
                    <ScopeRow
                      icon={<r.Icon size={15} aria-hidden className="shrink-0 text-primary-text" />}
                      label={r.node.label}
                      count={r.node.count}
                      ariaLabel={r.ariaLabel}
                      selected={r.lit}
                      onClick={() => onShowLens?.(r.lens)}
                    />
                  </li>
                ))}
              </ul>
            </section>

            {nothingMatched ? (
              <div className="mt-3 px-1">
                <p className="text-[12.5px] font-semibold text-muted-foreground">
                  Nothing here is called &ldquo;{query.trim()}&rdquo;
                </p>
                <p className="mt-1.5 text-[11px] leading-relaxed text-subtle-foreground">
                  Searched {coverage.searched} source{coverage.searched === 1 ? '' : 's'} and their
                  folders, by name. This filters the sidebar, not your tasks — to search task
                  names, use the filters above the list.
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
                            selected={isSelected(node)}
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

/**
 * One row of the Scopes list — All tasks, Favorites, Pinned, or a collection.
 *
 * Icon, name, count; the selected row is filled. Trailing actions (a
 * collection's copy-link and rename) sit **outside** the row's button so a
 * button never nests in a button, and are revealed on hover or focus — always
 * shown where there is no hover (`hover:none`), so a phone can still reach them.
 */
const ScopeRow = ({
  icon,
  label,
  count,
  selected,
  onClick,
  ariaLabel,
  actions
}: {
  icon: ReactNode;
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
  ariaLabel?: string;
  actions?: ReactNode;
}) => (
  <div
    className={`group flex h-7 items-center rounded-lg pr-1 transition-colors ${
      selected ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
    }`}
  >
    <button
      type="button"
      onClick={onClick}
      aria-current={selected ? 'true' : undefined}
      // Named explicitly: a collection called "2" would otherwise be
      // indistinguishable from its own tally.
      aria-label={ariaLabel ?? `${label}, ${count} task${count === 1 ? '' : 's'}`}
      title={label}
      className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
    >
      {icon}
      <span className={`truncate text-[12.5px] ${selected ? 'font-bold' : 'font-semibold'}`}>{label}</span>
      <span
        className={`ml-auto shrink-0 pl-1 tabular-nums text-[11.5px] ${
          selected ? 'font-semibold text-primary-text' : 'text-subtle-foreground'
        }`}
      >
        {count}
      </span>
    </button>
    {actions && (
      <span className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
        {actions}
      </span>
    )}
  </div>
);

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
            className={chevronChip(open)}
          >
            <ChevronRight size={16} strokeWidth={2.75} className={chevronTurn(open)} />
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden />
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
  isSelected: (node: RailNode) => boolean;
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
    className="flex w-full items-center gap-1.5 rounded-md py-1 pl-1.5 pr-2 text-[12px] font-semibold text-subtle-foreground hover:text-foreground hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
  >
    <ChevronRight size={14} strokeWidth={2.5} className="shrink-0 rotate-90" />
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
        selected={ctx.isSelected(node)}
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

/**
 * The expand arrow, on a bordered chip — one style for a source card and its
 * folder rows. A bare 12px chevron was too small to see or hit; blue = closed, solid violet = open.
 */
const chevronChip = (open: boolean) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
    open
      ? 'border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/40'
      : 'border-info/40 bg-info/15 text-info-text hover:bg-info/25'
  }`;
const chevronTurn = (open: boolean) => `transition-transform duration-200 ${open ? 'rotate-90' : ''}`;

/**
 * Pin this folder to Pinned, or take it back off.
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
        {/* No count under the icon (removed 2026-11-13 at the user's request —
            a column of small numbers was noise at 72px); it stays in the
            tooltip and the accessible name. */}
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
        child ? 'h-7' : 'h-8'
      } ${selected ? 'bg-primary/15 text-foreground' : 'hover:bg-muted/50'}`}
    >
      <span
        aria-hidden
        className={`absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-150 ${
          selected ? (child ? 'h-4 opacity-100' : 'h-5 opacity-100') : 'h-0 opacity-0'
        }`}
      />

      {expandable ? (
        <button
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${node.label}`}
          className={chevronChip(open)}
        >
          <ChevronRight size={16} strokeWidth={2.75} className={chevronTurn(open)} />
        </button>
      ) : (
        // Reserve the chevron's width so sibling labels stay on one left edge —
        // a row that shifts sideways depending on whether it has children makes
        // the tree's depth unreadable at a glance.
        <span className="w-6 shrink-0" aria-hidden />
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
            size={child ? 15 : 17}
            className={`shrink-0 transition-colors ${
              iconTone === 'warning'
                ? 'text-warning-text'
                : iconClass ?? (selected ? 'text-primary-text' : '')
            }`}
            {...(iconTone === 'warning' ? { fill: 'currentColor' } : {})}
          />
        )}

        <span
          className={`truncate tracking-[-0.01em] ${child ? 'text-[13px]' : 'text-[14px]'} ${
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
          className={`ml-auto shrink-0 pl-1 tabular-nums text-right text-[12px] ${
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
