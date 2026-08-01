import { useState, useMemo, useEffect, useRef } from 'react';
import {
  Activity,
  LayoutDashboard,
  RefreshCw,
  Loader2,
  Info,
  Clock,
  Folder,
  Tag,
  Eye,
  EyeOff,
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
  Cpu,
  User,
  Filter
} from 'lucide-react';
import type { Task } from '../types';
import { TaskCard } from '../components/TaskCard';
import { TaskRowActions } from '../components/TaskRowActions';
import { TaskSelectCheckbox } from '../components/TaskSelectCheckbox';
import { BulkActionBar } from '../components/BulkActionBar';
import { ViewBar } from '../components/ViewBar';
import { platformLabel, platformBadgeClass } from '../platform';
import { applySystemLens } from '../utils/systemTasks';
import {
  applyTaskFilters,
  DEFAULT_FILTERS,
  effectiveFilters,
  needsHealthData,
  type TaskFilters
} from '../utils/taskFilters';
import {
  allViews,
  describeFilters,
  FILTER_PARAM_KEYS,
  filtersFromParams,
  filtersToParams,
  matchView,
  newViewId,
  type SavedView
} from '../utils/savedViews';
import {
  pruneResolved,
  summarizeSelection,
  toggleSelectAll,
  toggleTaskSelection
} from '../utils/taskSelection';
import { useSettings, type Settings } from '../hooks/useSettings';
import { useConnections } from '../hooks/useConnections';
import { useTaskHealthTiers } from '../hooks/useTaskHealthTiers';
import { useMinuteClock } from '../hooks/useMinuteClock';
import { formatDateTime, formatTime, timeAgo } from '../utils/datetime';
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
  statusTogglingId,
  onShowHelp,
  onNewTask,
  onBulkStatus,
  isBulkPending,
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
  statusTogglingId: string | null;
  onShowHelp: () => void;
  onNewTask: () => void;
  /** Resolves to the ids that actually changed, so the selection can be pruned. */
  onBulkStatus: (tasks: Task[], status: 'ACTIVE' | 'DISABLED') => Promise<string[]>;
  isBulkPending: boolean;
  settings: Settings;
}) => {
  const { data: connections } = useConnections();
  // "Last synced" = the most recent per-connection sync timestamp.
  const lastSync = useMemo(() => {
    const stamps = (connections ?? [])
      .map(c => c.lastSync)
      .filter((s): s is string => !!s)
      .sort();
    return stamps.length ? stamps[stamps.length - 1] : null;
  }, [connections]);
  // The system/personal split is a persisted preference rather than local state:
  // it is a standing answer to "whose machine is this dashboard about", not a
  // per-visit choice, and re-hiding 257 rows on every page load is the thing this
  // filter exists to stop.
  const { update } = useSettings();

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
      platform: settings.defaultPlatform,
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
        : settingsFilters,
    [hasFilterParams, searchParams, settings.savedViews, settingsFilters]
  );

  const setFilters = (next: TaskFilters) => {
    setSearchParams(filtersToParams(next, settings.savedViews), { replace: true });
  };
  const setFilter = <K extends keyof TaskFilters>(key: K, value: TaskFilters[K]) =>
    setFilters({ ...filters, [key]: value });

  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'kanban' | 'schedule'>(settings.defaultView);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  const { visible: tasks, hidden: hiddenBySystemFilter } = useMemo(
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
  const facetBase = (ignore: 'category' | 'platform') =>
    applyTaskFilters(tasks ?? [], { ...viewFilters, [ignore]: 'All' }, {
      now,
      timezone: settings.timezone,
      tiers
    });

  const { categories, categoryCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of facetBase('category')) {
      const c = t.category || 'Uncategorized';
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    // The selected category stays pinned even when it empties, so the view
    // doesn't jump out from under you the moment its last task is filtered out.
    if (filters.category !== 'All' && !counts.has(filters.category)) counts.set(filters.category, 0);
    return { categories: ['All', ...Array.from(counts.keys()).sort()], categoryCounts: counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, viewFilters, now, settings.timezone, tiers]);

  // How many tasks the active-only filter is holding back. Counted across every
  // task the system lens lets through — not the category/platform selection, and
  // deliberately NOT the raw list either: in Personal mode it must report what
  // *this view* is withholding (12), not what both filters withhold together
  // (56), or the number describes a view the user isn't looking at. This answers
  // "is anything being kept from me right now?", which is the question the
  // toggle's own state can't answer. Note it covers MISSING and UNKNOWN too,
  // not just DISABLED — the filter keeps only `ACTIVE`, so a natively-deleted
  // task flagged MISSING is invisible in Active Only, which is exactly the kind
  // of thing you don't want silently hidden.
  const hiddenByActiveFilter = useMemo(
    () => (tasks ?? []).filter(t => t.status !== 'ACTIVE').length,
    [tasks]
  );

  // Tasks the last sync couldn't find on their platform. Drives the bulk-clear
  // affordance, which only exists when there's something to clear — a permanent
  // "Clear missing (0)" button would be noise on a healthy dashboard.
  const missingCount = useMemo(
    () => (tasks ?? []).filter(t => t.status === 'MISSING').length,
    [tasks]
  );

  // The "All" chip counts every task visible under the current active/platform
  // constraints — i.e. the sum of the per-category counts.
  const totalVisibleCount = useMemo(
    () => Array.from(categoryCounts.values()).reduce((sum, n) => sum + n, 0),
    [categoryCounts]
  );

  // Platform chips are faceted the same way, but never by the platform
  // selection itself — you must still be able to switch platforms.
  const { platforms, platformCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of facetBase('platform')) counts.set(t.platform, (counts.get(t.platform) ?? 0) + 1);
    if (filters.platform !== 'All' && !counts.has(filters.platform)) counts.set(filters.platform, 0);
    return { platforms: Array.from(counts.keys()).sort(), platformCounts: counts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, viewFilters, now, settings.timezone, tiers]);

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

  // ---- Saved views --------------------------------------------------------

  const views = useMemo(() => allViews(settings.savedViews), [settings.savedViews]);
  const activeView = useMemo(() => matchView(filters, settings.savedViews), [filters, settings.savedViews]);

  // Per-view counts, computed against the FULL task list rather than the
  // filtered one — a view chip has to say how many tasks it would show, not how
  // many survive the filters you are currently looking through.
  //
  // A view whose answer depends on the health scan reports `null` until that
  // arrives, and the bar renders `–`. Printing 0 would assert "nothing is
  // failing", which is a claim, and a far more comforting one than "not looked
  // yet". Same rule as the health scorer itself: absence of evidence is not ok.
  const viewCounts = useMemo(() => {
    const counts = new Map<string, number | null>();
    for (const v of views) {
      counts.set(
        v.id,
        needsHealthData(v.filters) && !tiers
          ? null
          : applyTaskFilters(allTasks ?? [], effectiveFilters(v.filters, viewMode), {
              now,
              timezone: settings.timezone,
              tiers
            }).length
      );
    }
    return counts;
  }, [views, allTasks, viewMode, now, settings.timezone, tiers]);

  const saveCurrentView = (name: string) => {
    const view: SavedView = {
      id: newViewId(settings.savedViews),
      name,
      filters,
      blurb: describeFilters(filters)
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

  // ---- Bulk selection -----------------------------------------------------
  //
  // One id-keyed Set for all four views. That works because all four already
  // render from `filteredTasks`: grid and list map it, schedule re-sorts it,
  // kanban partitions it by status. So "what is on screen" has one definition
  // and selection needs no per-view concept.
  //
  // Keyed by id rather than by index or object identity so it survives a refetch
  // (TanStack Query replaces the objects on every invalidation) and a view
  // switch.
  // The rules live in utils/taskSelection.ts as pure functions — the awkward
  // parts (shift-range order, what happens to a selection when the view changes
  // under it) are testable there without standing up the whole dashboard.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Anchor for shift-click range selection.
  const lastClickedId = useRef<string | null>(null);

  const scheduledTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aTime = (a.metadata as TaskMeta)?.nextRunTime || (a.metadata as TaskMeta)?.nextRun || a.updatedAt;
      const bTime = (b.metadata as TaskMeta)?.nextRunTime || (b.metadata as TaskMeta)?.nextRun || b.updatedAt;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
  }, [filteredTasks]);

  // Shift-click extends in the order the user is looking at — the schedule view
  // sorts by next run, so the same two endpoints there bracket a different set.
  const orderedTasks = viewMode === 'schedule' ? scheduledTasks : filteredTasks;

  const selection = useMemo(
    () => summarizeSelection(selectedIds, tasks ?? [], filteredTasks),
    [selectedIds, tasks, filteredTasks]
  );

  const toggleSelect = (task: Task, event: React.MouseEvent) => {
    setSelectedIds(prev =>
      toggleTaskSelection(prev, orderedTasks, task.id, {
        shiftKey: event.shiftKey,
        anchorId: lastClickedId.current
      })
    );
    lastClickedId.current = task.id;
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    lastClickedId.current = null;
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds(prev => toggleSelectAll(prev, filteredTasks));
    lastClickedId.current = null;
  };

  const allVisibleSelected =
    filteredTasks.length > 0 && filteredTasks.every(t => selectedIds.has(t.id));

  // Acts on the WHOLE selection, including the part this view isn't showing —
  // the bar has already said how many that is, and acting on only what happens
  // to be rendered would make the result depend on which view you were in.
  const runBulkStatus = async (status: 'ACTIVE' | 'DISABLED') => {
    const resolved = await onBulkStatus(selection.tasks, status);
    if (resolved.length > 0) setSelectedIds(prev => pruneResolved(prev, resolved));
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-foreground" size={48} />
        <p className="text-subtle-foreground font-medium animate-pulse">Fetching live tasks from agent...</p>
      </div>
    );
  }

  const isEmpty = !tasks || tasks.length === 0;

  // The two pre-view toggles are two-state controls over dimensions that now
  // have more than two states. Rather than let them mislabel a state they
  // cannot express, each renders a third treatment and says what it is.
  const isolatedStatus = filters.status === 'disabled' || filters.status === 'missing';
  const statusNoun = filters.status === 'missing' ? 'Missing' : 'Disabled';

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Unified Task Dashboard</h2>
          <p className="text-muted-foreground">
            Manage {tasks?.length || 0} tasks across your ecosystem.
            {lastSync && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs text-subtle-foreground">
                <RefreshCw size={11} /> synced {timeAgo(lastSync)}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button
            onClick={onShowHelp}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-surface border border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-all flex items-center gap-2 active:scale-95 shadow-md font-bold"
          >
            <HelpCircle size={16} /> Help Center
          </button>

          {/*
            Filter toggle. Both states carry a deliberate, saturated treatment
            because the previous design differentiated them only by a `bg-primary/10`
            tint and the eye's slash — at 10% opacity on a dark surface those read
            as the same button, so you couldn't tell which state you were in.
            Green = "only the live ones" (matching the ACTIVE dot on every task
            card); amber = "this includes tasks that will never fire". Three
            redundant signals — colour, icon, and the hidden-count — so meaning
            never rests on colour alone.
          */}
          {!isEmpty && viewMode !== 'kanban' && (
            <button
              // Isolation ('disabled'/'missing') is reachable only from a saved
              // view, and clicking out of it means "stop isolating" — i.e. show
              // everything — rather than snapping back to active-only, which
              // would hide the very rows you just went looking for.
              onClick={() => setFilter('status', filters.status === 'active' ? 'any' : filters.status === 'any' ? 'active' : 'any')}
              aria-pressed={filters.status === 'active'}
              title={
                isolatedStatus
                  ? `Showing only ${statusNoun} tasks — this view isolates them. Click to show everything.`
                  : filters.status === 'any'
                    ? `Showing all ${tasks?.length ?? 0} tasks, including disabled and missing ones. Click to show only active tasks.`
                    : hiddenByActiveFilter > 0
                      ? `Showing only active tasks — ${hiddenByActiveFilter} hidden (disabled, missing, or unknown). Click to show everything.`
                      : 'Showing only active tasks. Nothing is hidden right now. Click to show everything.'
              }
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border active:scale-95 ${
                isolatedStatus
                  ? 'bg-rose-500/10 border-rose-500/40 text-foreground hover:border-rose-500/70'
                  : filters.status === 'any'
                    ? 'bg-amber-500/10 border-amber-500/40 text-foreground hover:border-amber-500/70'
                    : 'bg-green-500/10 border-green-500/40 text-foreground hover:border-green-500/70'
              }`}
            >
              {/* A third state needs a third treatment. Reusing "Showing All"
                  amber for an isolation would say the opposite of what the list
                  is doing — it is showing *less*, not more. */}
              {isolatedStatus
                ? <Filter size={16} className="text-rose-400" />
                : filters.status === 'any'
                  ? <Eye size={16} className="text-amber-400" />
                  : <EyeOff size={16} className="text-green-400" />}
              {isolatedStatus ? `${statusNoun} only` : filters.status === 'any' ? 'Showing All' : 'Active Only'}
              {/* The count is the part that actually removes the ambiguity: the
                  label alone reads as either a state or an action. */}
              {isolatedStatus ? (
                <span className="text-[10px] font-bold text-rose-400/90 tabular-nums">{filteredTasks.length}</span>
              ) : filters.status === 'any' ? (
                <span className="text-[10px] font-bold text-amber-400/90 tabular-nums">{tasks?.length ?? 0}</span>
              ) : hiddenByActiveFilter > 0 && (
                <span className="text-[10px] font-bold text-green-400/90 tabular-nums whitespace-nowrap">
                  {hiddenByActiveFilter} hidden
                </span>
              )}
            </button>
          )}

          {/*
            The system/personal split. Rendered only when the machine actually has
            OS-owned tasks — a "0 system hidden" toggle on a clean install is noise
            for a problem that user doesn't have.

            Deliberately a SEPARATE control from Active Only rather than a mode
            they share: they answer different questions ("whose task is this?" vs
            "will it ever fire?") and the useful default is both at once. Same
            three redundant signals as its neighbour, and the same rule — it says
            what it is hiding, because a filter that silently withholds 257 of 352
            rows is the invisible fence again.
          */}
          {!isEmpty && hiddenBySystemFilter > 0 && (
            <button
              onClick={() => {
                // Clicking the control directly is a standing answer to "whose
                // machine is this dashboard about", so it writes the persisted
                // preference too. A saved view that sets the lens does NOT —
                // a view is a lens you look through, not a new default, and
                // leaving one must give you your own dashboard back.
                const next = filters.system === 'personal' ? 'include' : 'personal';
                update('showSystemTasks', next === 'include');
                setFilter('system', next);
              }}
              aria-pressed={filters.system === 'personal'}
              title={
                filters.system === 'only'
                  ? `Showing ONLY the ${hiddenBySystemFilter} tasks Windows itself owns — your own tasks are hidden. Click to go back to yours.`
                  : filters.system === 'include'
                    ? `Showing Windows' own scheduled tasks alongside yours (${hiddenBySystemFilter} of them). Click to hide them.`
                    : `Hiding ${hiddenBySystemFilter} tasks owned by Windows itself (under \\Microsoft\\). They still exist and still run — this only affects what the dashboard shows. Click to include them.`
              }
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 border active:scale-95 ${
                filters.system === 'only'
                  ? 'bg-rose-500/10 border-rose-500/40 text-foreground hover:border-rose-500/70'
                  : filters.system === 'include'
                    ? 'bg-sky-500/10 border-sky-500/40 text-foreground hover:border-sky-500/70'
                    : 'bg-violet-500/10 border-violet-500/40 text-foreground hover:border-violet-500/70'
              }`}
            >
              {filters.system === 'personal'
                ? <User size={16} className="text-violet-400" />
                : <Cpu size={16} className={filters.system === 'only' ? 'text-rose-400' : 'text-sky-400'} />}
              {filters.system === 'only' ? 'System only' : filters.system === 'include' ? 'Incl. System' : 'Personal'}
              <span className={`text-[10px] font-bold tabular-nums whitespace-nowrap ${
                filters.system === 'only' ? 'text-rose-400/90' : filters.system === 'include' ? 'text-sky-400/90' : 'text-violet-400/90'
              }`}>
                {filters.system === 'only'
                  ? `yours hidden`
                  : filters.system === 'include'
                    ? `${hiddenBySystemFilter} system`
                    : `${hiddenBySystemFilter} system hidden`}
              </span>
            </button>
          )}

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
              className="px-4 py-2 rounded-lg text-sm font-bold bg-amber-500/10 border border-amber-500/40 text-foreground hover:border-amber-500/70 transition-all flex items-center gap-2 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed"
              title={`${missingCount} tracked task${missingCount === 1 ? ' was' : 's were'} not found on their platform at the last sync. Remove Cronsole's records for them — nothing on your machine is touched.`}
            >
              <Trash2 size={16} className="text-amber-400" />
              {isClearingMissing ? 'Clearing…' : `Clear ${missingCount} Missing`}
            </button>
          )}

          <button
            onClick={onNewTask}
            className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-violet-600/20 active:scale-95"
            title="Create a task that runs on Cronsole itself — no Windows entry"
          >
            <Zap size={16} /> New Task
          </button>

          <button
            onClick={onImport}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-surface border border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground transition-all flex items-center gap-2 active:scale-95 shadow-md"
            title="Discover and import tasks from your connected platforms"
          >
            <Download size={16} /> Import
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
            <div className="flex items-center gap-2 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2">
              <Loader2 size={13} className="animate-spin" />
              Checking task health — this view is filtered by run outcome, so the list below is incomplete until it finishes.
            </div>
          )}

          {/* Category Tabs & Views */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
            <div className="flex flex-wrap items-center gap-2">
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
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setFilter('category', cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    filters.category === cat
                      ? 'bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/20'
                      : 'bg-surface border-border text-muted-foreground hover:border-foreground/20'
                  }`}
                >
                  {cat === 'All' ? <LayoutDashboard size={12} className="inline mr-2" /> : <Folder size={12} className="inline mr-2" />}
                  {cat}
                  <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${filters.category === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-subtle-foreground'}`}>
                    {cat === 'All' ? totalVisibleCount : categoryCounts.get(cat) ?? 0}
                  </span>
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-3 self-start sm:self-auto shrink-0">
            {/* Platform Isolation Filter */}
            {platforms.length > 1 && (
              <div className="flex bg-surface border border-border p-1 rounded-xl items-center shadow-md">
                <button
                  onClick={() => setFilter('platform', 'All')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${filters.platform === 'All' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  All
                </button>
                {platforms.map(p => (
                  <button
                    key={p}
                    onClick={() => setFilter('platform', p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      filters.platform === p
                        ? p === 'TASKHUB_NATIVE' ? 'bg-violet-600 text-white' : 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {p === 'TASKHUB_NATIVE' && <Zap size={11} />}
                    {platformLabel(p)}
                    <span className={`px-1 py-0.5 rounded text-[9px] ${filters.platform === p ? 'bg-black/20' : 'bg-muted text-subtle-foreground'}`}>
                      {platformCounts.get(p) ?? 0}
                    </span>
                  </button>
                ))}
              </div>
            )}

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

          {/* Selection: the select-all control lives in the toolbar rather than
              as a header checkbox, because only here can it name the number it
              is about to select — the same rule the Import modal follows. */}
          <div className="flex flex-col gap-3">
            {filteredTasks.length > 0 && (
              <label className="flex items-center gap-2 text-[11px] font-bold text-subtle-foreground hover:text-foreground transition-colors cursor-pointer w-fit">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAllVisible}
                  aria-label={
                    allVisibleSelected
                      ? `Deselect all ${filteredTasks.length} visible tasks`
                      : `Select all ${filteredTasks.length} visible tasks`
                  }
                  className="h-4 w-4 cursor-pointer accent-primary rounded border-border bg-background"
                />
                {allVisibleSelected
                  ? `Deselect all ${filteredTasks.length}`
                  : `Select all ${filteredTasks.length} shown`}
              </label>
            )}

            <BulkActionBar
              selectedCount={selectedIds.size}
              offscreenCount={selection.offscreenCount}
              enabledCount={selection.enabledCount}
              disabledCount={selection.disabledCount}
              onEnable={() => runBulkStatus('ACTIVE')}
              onDisable={() => runBulkStatus('DISABLED')}
              onClear={clearSelection}
              isPending={isBulkPending}
            />
          </div>

          {/* Grid View */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
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
                    isTogglingStatus={statusTogglingId === task.id}
                    selected={selectedIds.has(task.id)}
                    onToggleSelect={toggleSelect}
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
                          <td className="py-4 pl-6 pr-0">
                            <TaskSelectCheckbox
                              task={task}
                              checked={selectedIds.has(task.id)}
                              onToggle={toggleSelect}
                            />
                          </td>
                          <td className="py-4 px-4 font-bold text-foreground group-hover:text-foreground transition-colors">
                            <div>
                              <span className="block truncate max-w-[240px]">{task.name}</span>
                              <span className="block text-[10px] text-subtle-foreground font-mono font-normal truncate max-w-[240px] mt-0.5">{task.externalId}</span>
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
                                <span className={`h-1.5 w-1.5 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : task.status === 'MISSING' ? 'bg-amber-500' : 'bg-muted'}`}></span>
                                {task.status}
                              </span>
                              {task.lastRunStatus === 'FAILURE' && (
                                <span className="inline-flex items-center bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/30 text-[9px] font-black text-red-400 uppercase" title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}>
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
                    <div className="h-2 w-2 rounded-full bg-green-500"></div>
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
                            <TaskSelectCheckbox
                              task={task}
                              checked={selectedIds.has(task.id)}
                              onToggle={toggleSelect}
                              className="h-3.5 w-3.5"
                            />
                            <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </span>
                          <span className="text-[9px] font-bold text-subtle-foreground flex items-center gap-1">
                            <Folder size={10} /> {task.category || 'Uncategorized'}
                          </span>
                        </div>
                        <h4 className="font-bold text-foreground text-sm truncate">{task.name}</h4>
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
                            <TaskSelectCheckbox
                              task={task}
                              checked={selectedIds.has(task.id)}
                              onToggle={toggleSelect}
                              className="h-3.5 w-3.5"
                            />
                            <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </span>
                          <span className="text-[9px] font-bold text-subtle-foreground flex items-center gap-1">
                            <Folder size={10} /> {task.category || 'Uncategorized'}
                          </span>
                        </div>
                        <h4 className="font-bold text-muted-foreground text-sm truncate">{task.name}</h4>
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
                    const scheduleStr = task.schedule || (task.metadata as TaskMeta)?.schedule || 'No direct schedule';
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
                                <TaskSelectCheckbox
                                  task={task}
                                  checked={selectedIds.has(task.id)}
                                  onToggle={toggleSelect}
                                />
                                <h4 className="font-bold text-foreground text-base">{task.name}</h4>
                                <span className={`text-[8px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                                  {platformLabel(task.platform)}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-subtle-foreground">
                                <span className="flex items-center gap-1"><Folder size={12} /> {task.category || 'Uncategorized'}</span>
                                <span className="flex items-center gap-1 font-mono text-foreground/80"><Clock size={12} /> {scheduleStr}</span>
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
    </div>
  );
};
