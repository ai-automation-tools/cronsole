import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Activity,
  RefreshCw,
  Loader2,
  Info,
  Folder,
  Tag,
  Grid,
  List,
  Columns,
  Calendar,
  HelpCircle,
  Zap,
  Search,
  X,
  Download,
  Trash2,
  PanelLeft
} from 'lucide-react';
import type { Task } from '../types';
import { TaskCard } from '../components/TaskCard';
import { TaskSchedule } from '../components/TaskSchedule';
import { TaskFavoriteStar } from '../components/TaskFavoriteStar';
import { ManageCollectionsModal } from '../components/ManageCollectionsModal';
import { TaskCollectionMenu } from '../components/TaskCollectionMenu';
import { useCollections } from '../hooks/useCollections';
import { TaskRowActions } from '../components/TaskRowActions';
import { TaskFilterMenu } from '../components/TaskFilterMenu';
import { HealthStrip } from '../components/HealthStrip';
import { SourceRail } from '../components/SourceRail';
import { HelpButton } from '../components/HelpButton';
import { sourceTopicId } from '../data/help';
import { ViewBar } from '../components/ViewBar';
import { platformLabel, platformBadgeClass, sourceLabel, sourceDescription } from '../platform';
import { applySystemLens } from '../utils/systemTasks';
import {
  applyTaskFilters,
  applyTaskFiltersExcept,
  DEFAULT_FILTERS,
  effectiveFilters,
  needsHealthData,
  type FilterDimension,
  type TaskFilters
} from '../utils/taskFilters';
import {
  allViews,
  describeFilters,
  viewFiltersFrom,
  FILTER_PARAM_KEYS,
  filtersFromParams,
  filtersToParams,
  matchView,
  newViewId,
  openingFilters,
  type SavedView
} from '../utils/savedViews';
import { useSettings, type Settings } from '../hooks/useSettings';
import { useTaskHealthTiers } from '../hooks/useTaskHealthTiers';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { formatDateTime, formatTime } from '../utils/datetime';
import { useSearchParams } from 'react-router';

// Loose shape for the untyped platform-metadata JSON blob on tasks.
type TaskMeta = { nextRunTime?: string; nextRun?: string; schedule?: string } | null | undefined;

export const DashboardScreen = ({
  onTaskSelect,
  onRun,
  tasks: allTasks,
  isLoading,
  onImport,
  onSyncNow,
  isSyncing,
  onClearMissing,
  isClearingMissing,
  onCategoryUpdate,
  onClone,
  onToggleStatus,
  onToggleFavorite,
  statusTogglingId,
  onShowHelp,
  onNewTask,
  settings
}: {
  onTaskSelect: (task: Task) => void;
  onRun: (task: Task) => void;
  tasks: Task[] | undefined;
  isLoading: boolean;
  onImport: () => void;
  onSyncNow: () => void;
  isSyncing: boolean;
  onClearMissing: (count: number) => void;
  isClearingMissing: boolean;
  onCategoryUpdate: (taskId: string, category: string) => void;
  onClone: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  onToggleFavorite: (task: Task) => void;
  statusTogglingId: string | null;
  onShowHelp: () => void;
  onNewTask: () => void;
  settings: Settings;
}) => {
  // Connection health and the "synced N ago" reading both live in HealthStrip
  // now — the strip is the one surface that reports them, so this screen no
  // longer derives a second copy of the timestamp.
  //
  // The system/personal split is a persisted preference rather than local state:
  // it is a standing answer to "whose machine is this dashboard about", not a
  // per-visit choice, and re-hiding 257 rows on every page load is the thing this
  // filter exists to stop.
  const { settings: prefs, update } = useSettings();
  const railCollapsed = prefs.railCollapsed;

  // ---- Filter state ------------------------------------------------------
  //
  // One object, and it lives in the URL rather than in `useState`. Saved views
  // need a combination that can be *named*, and "bookmarkable" means the state
  // has to survive a copy-paste into another window — which local state cannot
  // do no matter how carefully it is threaded.
  //
  // History is written with `replace`, not `push`. Filters are a state of this
  // page, not a sequence of pages, and search-as-you-type would otherwise make
  // Back an undo-one-character button and bury the route you actually came from.
  const [searchParams, setSearchParams] = useSearchParams();

  // What a bare URL means: the user's persisted dashboard defaults. Note the
  // two toggles that predate views map onto the wider dimensions rather than
  // being replaced by them, so nobody's first screen changed.
  const settingsFilters = useMemo<TaskFilters>(
    () => ({
      ...DEFAULT_FILTERS,
      status: settings.defaultShowDisabled ? 'any' : 'active',
      system: settings.showSystemTasks ? 'include' : 'personal',
      source: settings.defaultPlatform,
      category: settings.defaultCategory
    }),
    [
      settings.defaultShowDisabled,
      settings.showSystemTasks,
      settings.defaultPlatform,
      settings.defaultCategory
    ]
  );

  const hasFilterParams = FILTER_PARAM_KEYS.some(k => searchParams.has(k));
  const filters = useMemo(
    () =>
      hasFilterParams
        ? filtersFromParams(searchParams, settings.savedViews)
        // A bare URL opens on **All** — everything, no lens. It is *derived*
        // rather than written, so it can never fight you: touching any filter
        // makes the URL non-bare and this branch is not consulted again. And it
        // resolves to a built-in view, so the bar lights "All" rather than
        // leaving the state nameless.
        //
        // It used to open on Favorites. The banner that had to accompany that —
        // naming the filter, counting what it withheld, offering the way out —
        // is gone with it, because opening on everything withholds nothing and
        // so has nothing to disclose.
        : openingFilters(settingsFilters),
    [hasFilterParams, searchParams, settings.savedViews, settingsFilters]
  );

  const setFilters = (next: TaskFilters) => {
    setSearchParams(filtersToParams(next, settings.savedViews), { replace: true });
  };
  const setFilter = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    setFilters({ ...filters, [key]: value });

  /**
   * Apply a rail node's filter patch.
   *
   * A patch rather than a single dimension because the rail's two levels are not
   * the same dimension: a Windows folder sets `category`, a native job type sets
   * `source`, and picking any *source* row must also clear the folder — a folder
   * belongs to the source it came from, so carrying `AI-Tools` across to Claude
   * would filter to nothing while the rail showed Claude selected. Each node
   * states everything it sets, so that reset is part of the node rather than a
   * rule the caller has to remember.
   */
  const applyRailPatch = (patch: Partial<TaskFilters>) => setFilters({ ...filters, ...patch });

  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'kanban' | 'schedule'>(settings.defaultView);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // The source rail as a drawer, below `md` only. Local state and not the URL:
  // a bookmark reproduces *which tasks you are looking at*, and a link that also
  // reopened a drawer would make two URLs that mean the same thing.
  const [railOpen, setRailOpen] = useState(false);
  const [managingCollections, setManagingCollections] = useState(false);
  const { data: collections } = useCollections();

  // Escape closes the drawer. Only bound while it is open, so it cannot steal
  // the key from the search box's own clear-on-Escape.
  useEffect(() => {
    if (!railOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setRailOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [railOpen]);

  /**
   * What the page is looking at, in words — the heading and its breadcrumb.
   *
   * The heading used to be the constant "Unified Task Dashboard", which was true
   * and told you nothing: with a source and a folder selected in the rail, the
   * one line at the top of the page was the only thing on screen that did not
   * say which of your 354 tasks you were being shown. Naming the scope is the
   * payoff of making scope navigable.
   */
  // Favorites outranks the source in the heading: it is the row you clicked, and
  // it is a scope *over* every source rather than one of them. Reading "All
  // Tasks" above six starred rows is the same lie as a lit chip over a list it
  // no longer describes.
  const starredOnly = filters.favorites === 'only';

  /**
   * The selected collection, if any — resolved to its NAME for display.
   *
   * The filter holds an id (so a rename does not invalidate open links), which
   * means the heading has to look it up. When the lookup fails the scope is
   * still real — a deleted collection, or a link from someone else — so it is
   * named as unknown rather than silently reading "All Tasks" over a list
   * filtered to nothing.
   */
  const selectedCollection =
    filters.collection === 'All'
      ? null
      : (collections ?? []).find(c => c.id === filters.collection) ?? null;
  const collectionMissing = filters.collection !== 'All' && !selectedCollection;

  // A collection outranks both the source and the star in the heading, for the
  // reason Favorites outranks the source: it is the row you clicked, and it is a
  // scope *over* every source rather than one of them.
  const scopeHeading = selectedCollection
    ? selectedCollection.name
    : collectionMissing
      ? 'Unknown collection'
      : starredOnly
        ? 'Favorites'
        : filters.source === 'All'
          ? 'All Tasks'
          : sourceLabel(filters.source);

  /**
   * The one-line explanation of the selected source.
   *
   * Only for a real source — "All Tasks" has no single thing to describe, and
   * `sourceDescription` returns null for a source nobody has written up yet
   * rather than inventing a sentence for it.
   */
  const scopeDescription = selectedCollection
    ? `A set of ${selectedCollection.count} task${selectedCollection.count === 1 ? '' : 's'} you picked by hand. Unlike a view, it is not a filter — it can hold tasks from different platforms.`
    : collectionMissing
      ? 'This collection no longer exists, or belongs to another account. Pick a source on the left to get back.'
      : filters.source === 'All'
        ? null
        : sourceDescription(filters.source);

  /**
   * Which help topic the `?` beside the description opens.
   *
   * A collection's scope is not a source — it deliberately sets `source: 'All'` —
   * so routing on `filters.source` alone would open the generic sources topic
   * over a description that is talking about collections.
   */
  const scopeTopic =
    selectedCollection || collectionMissing ? 'collections' : sourceTopicId(filters.source);

  const scopeTrail =
    !starredOnly &&
    filters.collection === 'All' &&
    filters.source === 'All' &&
    filters.category === 'All'
      ? null
      : [
          selectedCollection ? `◈ ${selectedCollection.name}` : null,
          starredOnly ? '★ Favorites' : null,
          filters.source === 'All'
            ? starredOnly || selectedCollection
              ? null
              : 'All sources'
            : sourceLabel(filters.source),
          filters.category === 'All' ? null : filters.category
        ]
          .filter(Boolean)
          .join(' › ');

  // "/" focuses search (unless already typing somewhere); Escape clears it.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape' && target === searchInputRef.current) {
        setFilter('search', '');
        searchInputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  // The system/personal split is the OUTERMOST lens: every count, chip, facet and
  // view below works from `tasks`, so hiding OS-owned tasks here hides them
  // everywhere at once rather than in each place separately (and the places that
  // got missed are how a filter ends up lying about its own totals).
  //
  // It composes with — and is independent of — the active/disabled toggle: the
  // real default view is "personal AND active", and either can be turned off
  // without touching the other.
  //
  // `isSystem` is the server's verdict, not a rule re-derived here (see types.ts).
  // The two rules — outermost lens, count over ALL tasks — live in applySystemLens
  // so they are pinned by tests instead of by whoever reads this component next.
  const { visible: tasks, hidden: systemTaskCount } = useMemo(
    () => applySystemLens(allTasks, filters.system),
    [allTasks, filters.system]
  );

  // The run-outcome filter is answered by the SERVER's health scan — see
  // useTaskHealthTiers. Fetched only when a view actually asks about outcome,
  // because it is a scan of every task and its executions.
  const { tiers, isPending: healthPending } = useTaskHealthTiers(needsHealthData(filters));

  // One instant, shared by every date-sensitive predicate and every count in
  // this render, advancing once a minute. See useMinuteClock for why it is
  // neither read during render nor recreated on each one.
  const now = useMinuteClock();

  // What the current view mode does to the filters (kanban relaxes `active`,
  // because its two columns ARE the active/disabled split).
  const viewFilters = useMemo(() => effectiveFilters(filters, viewMode), [filters, viewMode]);

  // Facet counts: what would remain if you changed ONE dimension. Each chip
  // therefore reflects every other constraint — an empty category drops out
  // instead of showing a 0 — while never filtering by the dimension it is
  // offering, or you could never switch off the value you are on.
  //
  // Goes through `applyTaskFiltersExcept` rather than hand-writing
  // `{ ...viewFilters, category: 'All' }`: naming the dimension is the same
  // operation the status toggle needs, and two spellings of "leave this one out"
  // is how one of them ends up leaving out a dimension the other doesn't.
  const facetBase = (ignore: FilterDimension) =>
    applyTaskFiltersExcept(tasks ?? [], viewFilters, ignore, {
      now,
      timezone: settings.timezone,
      tiers
    });

  /**
   * The population the **source rail** counts over: every task passing every
   * lens the rail does not own — status, outcome, due, search — with the rail's
   * own dimensions (source, category, favorites) and the system lens all
   * neutralized.
   *
   * Three things about it are deliberate.
   *
   * It starts from `allTasks`, **not** the system-lensed `tasks`. The rail has to
   * show the `\Microsoft\` group, so it needs the tasks that lens is hiding;
   * building it from the lensed list would make the group vanish exactly when it
   * has something to disclose.
   *
   * The dimensions are neutralized rather than excluded, because
   * `applyTaskFiltersExcept` leaves out one and the rail offers several. Setting
   * them to their permissive values through the same pipeline gets the same
   * result without a second spelling of "leave this out".
   *
   * **`favorites` has to be in that list**, and leaving it out was a live bug for
   * the length of one commit: with Favorites selected, `All sources` counted 6
   * and clicking it showed 363. A rail row's count is a promise about what
   * clicking it does, so a population narrowed by a dimension the rail *offers*
   * can never count the alternatives. **`collection` is in the list for the same
   * reason** — it is a rail dimension, so with a 4-task collection selected an
   * un-neutralized population would have every source row reading at most 4.
   *
   * And it is one list, not three counts. `buildSourceTree` buckets it, so the
   * root, the source rows and the folder rows are partitions of a single pass —
   * which is what makes "All" exactly the sum of its parts rather than a number
   * computed by its own route that can drift from the rows beneath it.
   */
  const railPopulation = useMemo(
    () =>
      applyTaskFilters(
        allTasks ?? [],
        {
          ...viewFilters,
          source: 'All',
          category: 'All',
          favorites: 'any',
          collection: 'All',
          system: 'include'
        },
        { now, timezone: settings.timezone, tiers }
      ),
    [allTasks, viewFilters, now, settings.timezone, tiers]
  );

  /**
   * How many rows the **system lens** is holding back from *this list* — the
   * number on the "N system hidden" chip.
   *
   * Deliberately not `applySystemLens`'s `hidden`, which counts system tasks
   * that *exist* (257 on this machine) and says so in its own docstring. Both
   * numbers are legitimate and they answer different questions: existence gates
   * whether the Ownership control is worth showing at all, and this one is a
   * promise about what clicking the chip reveals.
   *
   * They were the same value until the source rail landed, and nothing had ever
   * printed them side by side. The rail's `\Microsoft\` group counts the same
   * set, faceted — so under the Failures view the chip read "257 system hidden"
   * two inches from a rail row reading 111, and clicking it revealed 111. Same
   * defect the status chip had when it printed `Showing All 269` above two rows:
   * **a count beside a filter control is a promise about what clicking it does.**
   */
  const hiddenBySystemFilter = useMemo(
    () =>
      applyTaskFiltersExcept(allTasks ?? [], viewFilters, 'system', {
        now,
        timezone: settings.timezone,
        tiers
      }).filter(t => t.isSystem === true).length,
    [allTasks, viewFilters, now, settings.timezone, tiers]
  );

  // The population the status toggle governs: every task that passes every
  // OTHER lens. This is the number the chip must speak in — see
  // `applyTaskFiltersExcept`.
  //
  // It used to be counted over the raw system-lens output, on the reasoning that
  // the toggle should report what the *dashboard* is withholding rather than
  // what the current category is. That was defensible with four dimensions and
  // stopped being so once views could pin favorites, due and outcome: opening on
  // two starred tasks printed `Showing All 269` above two rows. The rule that
  // settles it is that the count predicts the click — reveal one row after
  // promising twelve and the number was never about this list.
  //
  // Note it covers MISSING and UNKNOWN too, not just DISABLED — the filter keeps
  // only `ACTIVE`, so a natively-deleted task flagged MISSING is invisible in
  // Active Only, which is exactly the kind of thing you don't want silently hidden.
  const statusGoverned = useMemo(
    () => facetBase('status'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, viewFilters, now, settings.timezone, tiers]
  );

  // Tasks the last sync couldn't find on their platform. Drives the bulk-clear
  // affordance, which only exists when there's something to clear — a permanent
  // "Clear missing (0)" button would be noise on a healthy dashboard.
  const missingCount = useMemo(
    () => (tasks ?? []).filter(t => t.status === 'MISSING').length,
    [tasks]
  );

  // One pipeline, in one place. This used to be four hand-rolled `.filter()`
  // passes inline, which is fine at four and is exactly how the fifth ends up
  // applied to the list but not to the counts beside it.
  const filteredTasks = useMemo(
    () =>
      applyTaskFilters(tasks ?? [], viewFilters, {
        now,
        timezone: settings.timezone,
        tiers
      }),
    [tasks, viewFilters, now, settings.timezone, tiers]
  );

  // How many of the governed population the status filter is holding back —
  // derived as the difference rather than counted separately, so it cannot
  // disagree with the list it sits above. `statusGoverned` is `filteredTasks`
  // plus exactly the rows status removes, so this is 0 whenever status is 'any'.
  const hiddenByActiveFilter = statusGoverned.length - filteredTasks.length;

  // ---- Saved views --------------------------------------------------------

  const views = useMemo(() => allViews(settings.savedViews), [settings.savedViews]);
  const activeView = useMemo(() => matchView(filters, settings.savedViews), [filters, settings.savedViews]);

  // Per-view counts, computed against the full task list rather than the
  // filtered one — a view chip has to say how many tasks it would show, not how
  // many survive the filters you are currently looking through.
  //
  // **Except the source**, which is applied. It is the outer lens: clicking a
  // view keeps your source, so the count has to be taken inside it or the chip
  // over-promises. Selecting Cronsole-native and reading `My jobs 88` above a
  // list of one is the same broken promise as `Showing All 269` above two rows;
  // a count predicts the click, and here the click lands inside the source.
  //
  // A view whose answer depends on the health scan reports `null` until that
  // arrives, and the bar renders `–`. Printing 0 would assert "nothing is
  // failing", which is a claim, and a far more comforting one than "not looked
  // yet". Same rule as the health scorer itself: absence of evidence is not ok.
  const viewCounts = useMemo(() => {
    const counts = new Map<string, number | null>();
    for (const v of views) {
      const scoped = { ...v.filters, source: filters.source };
      counts.set(
        v.id,
        needsHealthData(v.filters) && !tiers
          ? null
          : applyTaskFilters(allTasks ?? [], effectiveFilters(scoped, viewMode), {
              now,
              timezone: settings.timezone,
              tiers
            }).length
      );
    }
    return counts;
  }, [views, allTasks, viewMode, now, settings.timezone, tiers, filters.source]);

  const saveCurrentView = (name: string) => {
    // Source is stripped before storing. A view is a question asked *of* a
    // source, not a question about one — `filtersEqual` ignores platform, so a
    // stored one would be state nothing reads while looking meaningful. The
    // blurb is generated from the stripped set for the same reason: it must
    // describe what the view actually reapplies.
    const viewFilters = viewFiltersFrom(filters);
    const view: SavedView = {
      id: newViewId(settings.savedViews),
      name,
      filters: viewFilters,
      blurb: describeFilters(viewFilters)
    };
    const next = [...settings.savedViews, view];
    update('savedViews', next);
    // Re-encode the URL against the new list so it collapses from the explicit
    // field-by-field form to `?view=<id>` — otherwise the chip lights up but the
    // address bar still shows the ad-hoc query, and the two disagree.
    setSearchParams(filtersToParams(filters, next), { replace: true });
  };

  const deleteView = (view: SavedView) => {
    const next = settings.savedViews.filter(v => v.id !== view.id);
    update('savedViews', next);
    // If the deleted view is the one on screen, the filters stay exactly as they
    // are — deleting a bookmark should not silently change what you are looking
    // at. It simply stops having a name, and the bar says "Custom".
    setSearchParams(filtersToParams(filters, next), { replace: true });
  };

  const scheduledTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aTime = (a.metadata as TaskMeta)?.nextRunTime || (a.metadata as TaskMeta)?.nextRun || a.updatedAt;
      const bTime = (b.metadata as TaskMeta)?.nextRunTime || (b.metadata as TaskMeta)?.nextRun || b.updatedAt;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
  }, [filteredTasks]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-foreground" size={48} />
        <p className="text-subtle-foreground font-medium animate-pulse">Fetching live tasks from agent...</p>
      </div>
    );
  }

  const isEmpty = !tasks || tasks.length === 0;


  return (
    <div className="flex items-start animate-in fade-in duration-500">
      {/*
        The source rail, as a **panel**.

        Its own surface plus a right border, filling the height of the viewport
        under the toolbar — not a column of links floating on the page. That
        separation is doing real work: the rail and the task list are different
        kinds of thing (one is chrome you navigate with, one is the content you
        navigated to), and rendering both on `background` with a gap between made
        them read as two halves of one scrolling document.

        `sticky top-0` rather than scrolling with the list: at 350 tasks the tree
        would otherwise be off screen within one flick, which is exactly when you
        want to switch folders. The height is the viewport minus the 56px
        toolbar, so the panel's border runs the full edge.

        **Width is a preference.** Expanded is `w-72` — sized to its longest
        *primary* label, since "Windows Task Scheduler" beside an icon tile, a
        health dot and a count needs about 200px of text and at `w-60` the very
        thing the rail exists to switch between rendered as "Windows Task Sc…".
        Collapsed is `w-[4.5rem]`: icon tiles only, no folder level, names in
        tooltips. A folder name may truncate (its full name is in `title`); the
        name of the system you are looking at may not.

        Hidden below `md` and reachable from the "Sources" button in the header
        instead. A tree cannot degrade to a horizontal scroller the way the old
        flat source bar did — the second level has nowhere to go — so on a phone
        it is a drawer, opened from beside the list it re-scopes.
      */}
      <aside
        /*
          `bg-surface` at full strength, not `/60`. The alpha version resolved to
          ~97% lightness against a 100% page in the light theme — a step you
          cannot see, leaving the border to do all the separating on its own.
          The token is a real 5% step in light and 3% in dark, which is what
          makes the panel read as chrome rather than as page.
        */
        className={`hidden md:flex flex-col shrink-0 self-start sticky top-0 h-[calc(100vh-3.5rem)] overflow-y-auto border-r border-border bg-surface transition-[width] duration-200 ${
          railCollapsed ? 'w-[4.5rem] px-2 py-4' : 'w-72 px-3 py-4'
        }`}
      >
        <SourceRail
          population={railPopulation}
          filters={filters}
          onSelect={applyRailPatch}
          collapsed={railCollapsed}
          onToggleCollapsed={() => update('railCollapsed', !railCollapsed)}
          onManageCollections={() => setManagingCollections(true)}
        />
      </aside>

      {railOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Sources">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setRailOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] bg-background border-r border-border p-4 overflow-y-auto animate-in slide-in-from-left duration-200">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-sm">Sources</span>
              <button
                onClick={() => setRailOpen(false)}
                aria-label="Close sources"
                className="p-1.5 rounded-lg text-subtle-foreground hover:text-foreground hover:bg-surface transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <SourceRail
              population={railPopulation}
              filters={filters}
              // Never collapsed in the drawer: it opened at full width on
              // purpose, and an icons-only tree inside a panel you had to tap to
              // open would be two gestures to reach one folder.
              collapsed={false}
              // Picking a source is navigation, and navigation closes the drawer
              // — leaving it open over the list it just changed hides the result
              // of the tap that closed the question.
              onSelect={patch => {
                applyRailPatch(patch);
                setRailOpen(false);
              }}
              // Closes the drawer with it: the manager is a modal, and leaving
              // the drawer open behind it stacks two overlays on a phone.
              onManageCollections={() => {
                setRailOpen(false);
                setManagingCollections(true);
              }}
            />
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-5 px-4 py-5 md:px-8 md:py-7">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="min-w-0">
          {/*
            Two help affordances here, doing different jobs. This `?` explains
            *this screen* — the source → view → filter layering, which is the
            thing a new user misreads. The Help Center button beside the actions
            is the hub: guides, the walkthrough, and the index of every topic.
            The topic view links back to it, so picking the narrower one first
            never dead-ends.
          */}
          <h2 className="text-2xl font-bold mb-1 flex items-center gap-1.5">
            {/* Opens the rail on a phone, where it is a drawer. Beside the
                heading it re-scopes rather than up in the app toolbar — the
                toolbar is not the thing this control acts on. */}
            <button
              onClick={() => setRailOpen(true)}
              aria-label="Open sources"
              title="Sources"
              className="md:hidden p-1.5 -ml-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface transition-colors"
            >
              <PanelLeft size={18} />
            </button>
            {scopeHeading}
            <HelpButton topic="dashboard" size="md" />
          </h2>
          {/*
            A breadcrumb when scoped, the ecosystem line when not.

            It earns its place on the phone: the rail is a closed drawer there, so
            without this nothing on screen says which folder the list is narrowed
            to — the "a constraint the user did not choose must be named in the
            page" rule, applied to a constraint they *did* choose but can no
            longer see.
          */}
          <p className="text-muted-foreground" data-testid="task-count-line">
            {scopeTrail ?? `Manage ${tasks?.length || 0} tasks across your ecosystem.`}
          </p>
          {/*
            What the selected source *is*, in one line.

            The heading and breadcrumb name the scope; neither says what it means.
            That gap is widest exactly where it matters most: the rail lists every
            native job type whether or not you have one, so a brand-new user's
            first sight of "Checks" is a lit row over an empty list with nothing
            explaining why they would put anything in it.

            Shown only when a source is selected — on "All Tasks" there is no one
            thing to describe, and a paragraph that is always present stops being
            read. The `?` beside it opens the matching help topic, which is what
            keeps this a summary rather than the documentation.
          */}
          {scopeDescription && (
            <p
              className="text-sm text-subtle-foreground mt-2 max-w-2xl flex items-start gap-1.5"
              data-testid="source-description"
            >
              <span>{scopeDescription}</span>
              <HelpButton topic={scopeTopic} />
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2.5">
          {/*
            Label drops below `sm`. Five labelled buttons wrapped to three rows at
            375px, pushing the first task below the fold — the exact cost this
            pass is spending. The name survives as `aria-label`/`title`, so the
            control is still named to a screen reader and on hover.
          */}
          <button
            onClick={onShowHelp}
            aria-label="Help Center"
            title="Help Center"
            className="px-3 sm:px-4 py-2 rounded-lg text-sm bg-surface border border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-all flex items-center gap-2 active:scale-95 shadow-md font-bold"
          >
            <HelpCircle size={16} /> <span className="hidden sm:inline">Help Center</span>
          </button>

          {/*
            The status and system lenses moved into the Filters popover below
            (TaskFilterMenu) as part of thinning the first viewport. What did NOT
            move is what they withhold: that is rendered beside the trigger,
            always, because these two are defaults nobody chose today and a
            closed drawer over a filtered list is the invisible fence with a
            nicer lid. See TaskFilterMenu for the rule and `withheldBy` for the
            pinned version of it.
          */}

          {/*
            Only rendered when something is actually missing: the mess arrives in
            bulk (deleting a Task Scheduler folder flags every task under it at
            once), so the way out has to be bulk too. Amber rather than red — it
            deletes Cronsole's records for tasks the platform already lost, not
            anything on the machine, and the confirm modal says exactly that.
          */}
          {missingCount > 0 && (
            <button
              onClick={() => onClearMissing(missingCount)}
              disabled={isClearingMissing}
              className="px-4 py-2 rounded-lg text-sm font-bold bg-warning/10 border border-warning/40 text-foreground hover:border-warning/70 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              title={`${missingCount} tracked task${missingCount === 1 ? ' was' : 's were'} not found on their platform at the last sync. Remove Cronsole's records for them — nothing on your machine is touched.`}
            >
              <Trash2 size={16} className="text-warning-text" />
              {isClearingMissing ? 'Clearing…' : `Clear ${missingCount} Missing`}
            </button>
          )}

          {/* Below `sm` this is the floating action button at the end of the
              screen instead — see the FAB near the bottom of this component. */}
          <button
            onClick={onNewTask}
            className="hidden sm:flex bg-native hover:bg-native/85 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all items-center gap-2 shadow-lg shadow-native/20 active:scale-95"
            title="Create a task that runs on Cronsole itself — no Windows entry"
          >
            <Zap size={16} /> New Task
          </button>

          <button
            onClick={onImport}
            aria-label="Import tasks"
            className="px-3 sm:px-4 py-2 rounded-lg text-sm font-bold bg-surface border border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-all flex items-center gap-2 active:scale-95 shadow-md"
            title="Discover and import tasks from your connected platforms"
          >
            <Download size={16} /> <span className="hidden sm:inline">Import</span>
          </button>

          <button
            onClick={onSyncNow}
            disabled={isSyncing}
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-primary/20 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
            title="Re-pull status and schedules for the tasks you already track"
          >
            <RefreshCw size={16} className={isSyncing ? 'animate-spin' : ''} /> {isSyncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/*
        Its own full-width row, not tucked under the title.

        The "synced N ago" chip used to sit in the subtitle line; it moved here
        rather than being duplicated, because two places printing the same
        timestamp is two places that can disagree — and this one also says
        whether the platform is reachable, which is the half that made the old
        chip misleading alone.

        The full-width row is not cosmetic. Inside the header's left column its
        width grew and shrank with its own text ("agent replied 2m ago" →
        "14m ago"), and a `justify-between` row turned that into the action
        buttons rewrapping from one line to two. A status readout must not be
        able to move the primary actions.
      */}
      <HealthStrip />

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-[50vh] border-2 border-dashed border-border rounded-3xl p-10 text-center">
           <Activity size={48} className="text-subtle-foreground mb-4 animate-pulse" />
           <h3 className="text-xl font-bold text-foreground">Dashboard is empty</h3>
           <p className="text-subtle-foreground max-w-sm mt-2 mb-6">
              Connect systems and perform your first sync to discover and monitor scheduled tasks.
           </p>
           <button
             onClick={onImport}
             className="bg-primary hover:bg-primary-hover px-6 py-3 rounded-2xl text-sm font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 flex items-center gap-2"
           >
             <Download size={16} /> Import Tasks
           </button>
        </div>
      ) : (
        <>
          {/* Source used to be a chip row here. It is the rail on the left now —
              the first-level axis deserved navigation, not a fourth horizontal
              bar competing with the three below it. The view bar is what is left,
              and it is now the only one. */}
          <ViewBar
            views={views}
            activeViewId={activeView?.id ?? null}
            counts={viewCounts}
            currentDescription={describeFilters(filters)}
            onSelect={v => setFilters(v.filters)}
            onSave={saveCurrentView}
            onDelete={deleteView}
            onReset={() => setFilters(DEFAULT_FILTERS)}
          />

          {/*
            The run-outcome filter has asked a question the health scan has not
            answered yet. Saying so is not politeness: with no tiers every task
            reads `unknown`, so "Failures" renders an empty list — and an empty
            list means "nothing is failing", which is a claim this app has not
            earned the right to make.
          */}
          {healthPending && (
            <div className="flex items-center gap-2 text-xs font-medium text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
              <Loader2 size={13} className="animate-spin" />
              Checking task health — this view is filtered by run outcome, so the list below is incomplete until it finishes.
            </div>
          )}

          {/* The filter zone.
              `bg-raised` and its own rounded container rather than a bare
              bottom border: this is where the neutral step earns its keep. The
              review's point was that everything read at one weight, and the
              specific consequence here was that the controls and the results
              they describe ran together — a border alone was doing all the work
              of separating a *zone* from a *list*. */}
          {/*
            Sticky below `sm`, static above it. On a phone the filter zone is the
            only way back out of a filtered list, and scrolling 269 cards put it
            off-screen within one flick — so the control that got you here has to
            stay reachable. `-mx-4 px-4` bleeds it to the screen edge so nothing
            slides through the gap `main`'s padding leaves at the sides, and the
            rounded panel comes back at `sm` where it is not pinned to anything.
          */}
          {/*
            One horizontally-scrolling row below `sm`, two aligned groups above.

            Stacking search+filters over the view-mode toggle made this ~90px
            tall — 11% of a 812px phone screen, held permanently by the sticky
            positioning. One scrolling row is the same idiom the saved-views bar
            uses at this width, and it keeps all four view modes rather than
            dropping the ones that are awkward to reach.
          */}
          <div className="sticky sm:static top-0 z-20 -mx-4 sm:mx-0 px-4 sm:px-3 py-2.5 bg-raised/95 sm:bg-raised backdrop-blur sm:backdrop-blur-none border-b sm:border border-border sm:rounded-2xl flex items-center justify-between gap-3 sm:gap-4 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="flex items-center gap-2 shrink-0 sm:flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none" />
                <input
                  ref={searchInputRef}
                  value={filters.search}
                  onChange={e => setFilter('search', e.target.value)}
                  placeholder="Search tasks…  /"
                  className="w-44 focus:w-60 bg-surface border border-border rounded-xl pl-8 pr-7 py-1.5 text-xs font-medium text-foreground placeholder:text-subtle-foreground outline-none focus:border-primary transition-all shadow-md"
                />
                {filters.search && (
                  <button
                    onClick={() => setFilter('search', '')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-subtle-foreground hover:text-foreground transition-colors"
                    title="Clear search (Esc)"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
              {filters.search.trim() && (
                <span className="text-[10px] font-bold text-subtle-foreground px-1">
                  {filteredTasks.length} match{filteredTasks.length === 1 ? '' : 'es'}
                </span>
              )}
              <TaskFilterMenu
                filters={filters}
                setFilter={setFilter}
                onSystemLensChange={next => {
                  // Clicking the lens directly is a standing answer to "whose
                  // machine is this dashboard about", so it writes the persisted
                  // preference too. A saved view that sets the lens does NOT — a
                  // view is a lens you look through, not a new default.
                  update('showSystemTasks', next === 'include');
                  setFilter('system', next);
                }}
                baseFilters={activeView?.filters}
                hiddenBySystemFilter={hiddenBySystemFilter}
                systemTaskCount={systemTaskCount}
                hiddenByActiveFilter={hiddenByActiveFilter}
              />
            </div>
            
            <div className="flex items-center gap-3 shrink-0">

            {/* View Mode Toggle */}
            <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md shrink-0">
              <button 
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Grid size={12} /> Grid
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <List size={12} /> List
              </button>
              <button 
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'kanban' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Columns size={12} /> Kanban
              </button>
              <button
                onClick={() => setViewMode('schedule')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'schedule' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <Calendar size={12} /> Schedule
              </button>
            </div>
            </div>
          </div>

          {/* Bulk work lives on the Tools tab now, not here.

              Selection was removed from the dashboard on 2026-08-12: a checkbox
              per row plus a select-all is a second way to express "these tasks",
              and it was the worse one — it cannot survive into a confirmation as
              anything a person can check, and it capped out at what a single
              request would accept. Mass actions is scope-based and batches.

              The safe-path concern this raised does not apply: "Remove from
              Cronsole" sits beside "Delete from Windows" in the **task modal**,
              per task, which is where that pairing always actually lived. */}
          {/* Grid View */}
          {viewMode === 'grid' && (
            <div data-testid="task-list" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
              {filteredTasks.length === 0 ? (
                <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-border rounded-3xl text-subtle-foreground">
                   <Tag size={48} className="mb-4 opacity-20" />
                   <p className="font-bold">No tasks found</p>
                   {/*
                     An empty list is ambiguous — "you have none" and "your
                     filters excluded them all" look identical, and with six
                     dimensions the second is far likelier. So it names the
                     constraints in force before offering a way out.
                   */}
                   <p className="mt-2 text-xs max-w-md text-center">
                     {allTasks && allTasks.length > 0
                       ? <>You have {allTasks.length} tasks. This view shows none of them — it is filtered by <span className="text-foreground font-semibold">{describeFilters(filters)}</span>.</>
                       : 'Nothing is being filtered — there are no tasks to show yet.'}
                   </p>
                   {filters.search.trim() && (
                     <button
                       onClick={() => setFilter('search', '')}
                       className="mt-4 text-foreground hover:text-foreground text-sm font-bold underline underline-offset-4"
                     >
                       Clear search "{filters.search.trim()}"
                     </button>
                   )}
                   {allTasks && allTasks.length > 0 && (
                     <button
                       onClick={() => setFilters(DEFAULT_FILTERS)}
                       className="mt-4 text-foreground hover:text-foreground text-sm font-bold underline underline-offset-4"
                     >
                       Reset to the default view
                     </button>
                   )}
                </div>
              ) : (
                filteredTasks.map(task => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onSelect={onTaskSelect}
                    onRun={onRun}
                    onCategoryUpdate={onCategoryUpdate}
                    onClone={onClone}
                    onToggleStatus={onToggleStatus}
                    onToggleFavorite={onToggleFavorite}
                    isTogglingStatus={statusTogglingId === task.id}
                  />
                ))
              )}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div className="bg-surface border border-border rounded-3xl overflow-hidden shadow-2xl pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-border/80 text-[10px] uppercase font-black text-subtle-foreground tracking-wider bg-background/20">
                      <th className="py-4 pl-6 pr-0 w-4"><span className="sr-only">Select</span></th>
                      <th className="py-4 px-4">Name</th>
                      <th className="py-4 px-4">Platform</th>
                      <th className="py-4 px-4">Category</th>
                      <th className="py-4 px-4">Status</th>
                      <th className="py-4 px-4">Last Sync</th>
                      <th className="py-4 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 text-sm">
                    {filteredTasks.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-12 text-subtle-foreground font-medium italic">
                          No tasks match the active filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTasks.map(task => (
                        <tr 
                          key={task.id} 
                          className="hover:bg-surface/50 transition-colors group cursor-pointer"
                          onClick={() => onTaskSelect(task)}
                        >
                          <td className="py-4 px-4 font-bold text-foreground group-hover:text-foreground transition-colors">
                            <div className="flex items-start gap-2">
                              <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={14} className="mt-0.5" />
                              <TaskCollectionMenu task={task} size={14} className="mt-0.5" />
                              <div>
                              <span className="block truncate max-w-[240px]">{task.name}</span>
                              <span className="block text-[10px] text-subtle-foreground font-mono font-normal truncate max-w-[240px] mt-0.5">{task.externalId}</span>
                              </div>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`text-[9px] uppercase font-black px-2.5 py-1 rounded-lg border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                              <Folder size={12} className="text-subtle-foreground" /> {task.category || 'Uncategorized'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 bg-background px-2 py-1 rounded-lg border border-border text-[10px] font-bold text-muted-foreground">
                                <span className={`h-1.5 w-1.5 rounded-full ${task.status === 'ACTIVE' ? 'bg-success' : task.status === 'MISSING' ? 'bg-warning' : 'bg-muted'}`}></span>
                                {task.status}
                              </span>
                              {task.lastRunStatus === 'FAILURE' && (
                                <span className="inline-flex items-center bg-danger/10 px-2 py-1 rounded-lg border border-danger/30 text-[9px] font-black text-danger-text uppercase" title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}>
                                  Run failed
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-xs text-muted-foreground font-mono">
                            {formatTime(task.updatedAt, settings.timezone)}
                          </td>
                          <td className="py-4 px-4">
                            <TaskRowActions
                              task={task}
                              size="md"
                              onRun={onRun}
                              onClone={onClone}
                              onToggleStatus={onToggleStatus}
                              isTogglingStatus={statusTogglingId === task.id}
                            />
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Kanban Board View */}
          {viewMode === 'kanban' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
              {/* Active Column */}
              <div className="bg-surface/40 border border-border/80 rounded-3xl p-5 flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-success"></div>
                    <h3 className="font-bold text-sm tracking-wide text-foreground uppercase">Active Tasks</h3>
                  </div>
                  <span className="bg-background px-2 py-0.5 rounded-md border border-border text-xs font-bold text-muted-foreground">
                    {filteredTasks.filter(t => t.status === 'ACTIVE').length}
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar pr-1">
                  {filteredTasks.filter(t => t.status === 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-subtle-foreground italic text-center py-10">No active tasks in this category.</p>
                  ) : (
                    filteredTasks.filter(t => t.status === 'ACTIVE').map(task => (
                      <div 
                        key={task.id} 
                        onClick={() => onTaskSelect(task)}
                        className="bg-surface border border-border hover:border-primary/40 p-4 rounded-2xl cursor-pointer hover:-translate-y-0.5 active:translate-y-0 transition-all flex flex-col gap-2 shadow-lg"
                      >
                        <div className="flex justify-between items-start">
                          <span className="flex items-center gap-1.5">
                            <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-subtle-foreground flex items-center gap-1">
                              <Folder size={10} /> {task.category || 'Uncategorized'}
                            </span>
                            <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={12} />
                            <TaskCollectionMenu task={task} size={12} />
                          </span>
                        </div>
                        <h4 className="font-bold text-foreground text-sm truncate">{task.name}</h4>
                        <TaskSchedule task={task} size="xs" />
                        <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                          <span className="text-[9px] text-subtle-foreground font-mono">
                            {formatTime(task.updatedAt, settings.timezone)}
                          </span>
                          <TaskRowActions
                            task={task}
                            size="xs"
                            onRun={onRun}
                            onClone={onClone}
                            onToggleStatus={onToggleStatus}
                            isTogglingStatus={statusTogglingId === task.id}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Disabled Column */}
              <div className="bg-surface/40 border border-border/80 rounded-3xl p-5 flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-border pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-muted"></div>
                    <h3 className="font-bold text-sm tracking-wide text-muted-foreground uppercase">Disabled Tasks</h3>
                  </div>
                  <span className="bg-background px-2 py-0.5 rounded-md border border-border text-xs font-bold text-muted-foreground">
                    {filteredTasks.filter(t => t.status !== 'ACTIVE').length}
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar pr-1">
                  {filteredTasks.filter(t => t.status !== 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-subtle-foreground italic text-center py-10">No disabled tasks in this category.</p>
                  ) : (
                    filteredTasks.filter(t => t.status !== 'ACTIVE').map(task => (
                      <div 
                        key={task.id} 
                        onClick={() => onTaskSelect(task)}
                        className="bg-surface border border-border hover:border-primary/40 p-4 rounded-2xl cursor-pointer hover:-translate-y-0.5 active:translate-y-0 transition-all flex flex-col gap-2 shadow-lg opacity-60 hover:opacity-100"
                      >
                        <div className="flex justify-between items-start">
                          <span className="flex items-center gap-1.5">
                            <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span className="text-[9px] font-bold text-subtle-foreground flex items-center gap-1">
                              <Folder size={10} /> {task.category || 'Uncategorized'}
                            </span>
                            <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={12} />
                            <TaskCollectionMenu task={task} size={12} />
                          </span>
                        </div>
                        <h4 className="font-bold text-muted-foreground text-sm truncate">{task.name}</h4>
                        <TaskSchedule task={task} size="xs" />
                        <div className="flex items-center justify-between border-t border-border pt-2 mt-1">
                          <span className="text-[9px] text-subtle-foreground font-mono">
                            {formatTime(task.updatedAt, settings.timezone)}
                          </span>
                          <TaskRowActions
                            task={task}
                            size="xs"
                            onRun={onRun}
                            onClone={onClone}
                            onToggleStatus={onToggleStatus}
                            isTogglingStatus={statusTogglingId === task.id}
                          />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Schedule View */}
          {viewMode === 'schedule' && (
            <div className="space-y-4 pb-20">
              <div className="bg-surface/30 border border-border p-4 rounded-2xl text-xs text-muted-foreground flex items-center gap-2 max-w-xl">
                <Info size={16} className="text-foreground shrink-0" />
                This view orders tasks chronologically based on their next scheduled run or last update time.
              </div>
              
              <div className="relative border-l border-border ml-4 pl-6 space-y-6">
                {scheduledTasks.length === 0 ? (
                  <p className="text-sm text-subtle-foreground italic">No scheduled tasks found in this category.</p>
                ) : (
                  scheduledTasks.map(task => {
                    const nextRun = (task.metadata as TaskMeta)?.nextRunTime || (task.metadata as TaskMeta)?.nextRun || null;
                    return (
                      <div key={task.id} className="relative group">
                        {/* Timeline node */}
                        <div className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-muted border-2 border-border group-hover:bg-primary-hover transition-colors"></div>
                        
                        <div 
                          onClick={() => onTaskSelect(task)}
                          className="bg-surface border border-border hover:border-primary/30 p-5 rounded-2xl max-w-3xl cursor-pointer shadow-xl transition-all hover:bg-surface/80"
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={14} />
                                <TaskCollectionMenu task={task} size={14} />
                                <h4 className="font-bold text-foreground text-base">{task.name}</h4>
                                <span className={`text-[8px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                                  {platformLabel(task.platform)}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground">
                                <span className="flex items-center gap-1"><Folder size={12} /> {task.category || 'Uncategorized'}</span>
                                <TaskSchedule task={task} />
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end border-t md:border-t-0 border-border/50 pt-2 md:pt-0">
                              <div className="text-right">
                                <span className="text-[10px] text-subtle-foreground block uppercase font-bold tracking-wider">Next Run Time</span>
                                <span className="text-xs text-foreground font-mono font-bold">
                                  {nextRun ? formatDateTime(nextRun, settings.timezone) : 'Not set / Manual'}
                                </span>
                              </div>
                              <TaskRowActions
                                task={task}
                                size="sm"
                                onRun={onRun}
                                onClone={onClone}
                                onToggleStatus={onToggleStatus}
                                isTogglingStatus={statusTogglingId === task.id}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/*
        New Task as a floating action button below `sm`.

        It is the one creative action on this screen, and in the header it was a
        ~120px button competing for a 375px row with four others. As a FAB it
        costs no header width and lands under the thumb — but it is the SAME
        control, not a second one: the header button is simply hidden at this
        width, so there is still exactly one way to create a task.
      */}
      <button
        onClick={onNewTask}
        aria-label="New task"
        title="Create a task that runs on Cronsole itself — no Windows entry"
        className="sm:hidden fixed bottom-5 right-5 z-30 h-14 w-14 rounded-full bg-native text-white shadow-2xl shadow-native/40 flex items-center justify-center active:scale-95 transition-transform"
      >
        <Zap size={22} />
      </button>

      {managingCollections && (
        <ManageCollectionsModal onClose={() => setManagingCollections(false)} />
      )}
      </div>
    </div>
  );
};
