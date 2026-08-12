import type { Task } from '../types';
import type { TimezoneMode } from '../hooks/useSettings';
import { resolveZone } from './timezone';
import { matchesTaskSearch } from './taskSearch';

/**
 * The dashboard's filter state, as one value.
 *
 * It used to be five separate `useState`s plus one persisted setting, which was
 * fine while every filter was a boolean and nothing had to *name* a combination.
 * Saved views need exactly that: a combination you can title, bookmark, and
 * compare against — so the state it saves has to be one thing rather than six
 * things a component happens to hold.
 *
 * Three of these dimensions are new, because four of the five views the roadmap
 * named could not be expressed by the old toggles: they were binary (active-only
 * vs. everything, personal vs. include-system) and there was no run-outcome or
 * next-run filter at all.
 */
export interface TaskFilters {
  /**
   * `'active'` and `'any'` are the two states the old boolean toggle had.
   * `'disabled'` and `'missing'` **isolate** rather than include — that is the
   * whole difference, and the reason "Disabled" could not be a saved view
   * before: showing everything is not the same as showing only the parked ones.
   */
  status: StatusFilter;
  /**
   * The system/personal lens, widened from a boolean to three states for the
   * same reason. `'only'` exists because "what is Windows itself running?" is a
   * real question the include-everything state answers by burying it in 95
   * personal tasks.
   */
  system: SystemFilter;
  /**
   * Run outcome, per the **server's** health verdict — never re-derived here.
   * See `matchesOutcome`.
   */
  outcome: OutcomeFilter;
  /** Next scheduled run, relative to now in the user's schedule timezone. */
  due: DueFilter;
  /**
   * The starred lens. `'only'` is what the Favorites view asks for; `'any'`
   * means the star plays no part in what is shown.
   *
   * A field on this object rather than a seventh piece of component state, for
   * the reason the whole object exists: a view is a combination that can be
   * *named*, and a dimension living outside it is one the URL can't carry, the
   * view bar can't match, and the counts beside the list don't know about.
   */
  favorites: FavoritesFilter;
  /** `'All'` or an exact platform. */
  platform: string;
  /** `'All'` or an exact category (`'Uncategorized'` for tasks with none). */
  category: string;
  /** Free text, matched by `matchesTaskSearch`. */
  search: string;
}

export type StatusFilter = 'any' | 'active' | 'disabled' | 'missing';
export type SystemFilter = 'personal' | 'include' | 'only';
export type FavoritesFilter = 'any' | 'only';
export type OutcomeFilter = 'any' | 'failing' | 'healthy' | 'unknown';
export type DueFilter = 'any' | 'today' | 'week' | 'overdue' | 'never';

/** The server's per-task verdict from `GET /api/tools/task-health`. */
export type HealthTier = 'ok' | 'attention' | 'critical' | 'unknown';

/**
 * The state the dashboard opens in: personal tasks, active only, everything
 * else unconstrained. Deliberately equal to what the two old toggles defaulted
 * to, so adopting this model changed nobody's first screen.
 */
export const DEFAULT_FILTERS: TaskFilters = {
  status: 'active',
  system: 'personal',
  outcome: 'any',
  due: 'any',
  favorites: 'any',
  platform: 'All',
  category: 'All',
  search: ''
};

// ---------------------------------------------------------------------------
// Individual predicates. Each is exported so it can be tested — and pinned —
// without standing up the dashboard.
// ---------------------------------------------------------------------------

export function matchesStatus(task: Task, filter: StatusFilter): boolean {
  switch (filter) {
    case 'any':
      return true;
    case 'active':
      return task.status === 'ACTIVE';
    case 'disabled':
      return task.status === 'DISABLED';
    case 'missing':
      return task.status === 'MISSING';
  }
}

export function matchesSystem(task: Task, filter: SystemFilter): boolean {
  // `isSystem` is the server's verdict (TaskService.isSystemTask). It is
  // optional on the wire so an older backend degrades to "not system" rather
  // than hiding every task at once — hence the `=== true` / `!== true` pairing
  // rather than a truthiness check that would read `undefined` as meaningful.
  switch (filter) {
    case 'include':
      return true;
    case 'personal':
      return task.isSystem !== true;
    case 'only':
      return task.isSystem === true;
  }
}

/**
 * The starred lens.
 *
 * `isFavorite` is the server's per-viewer answer (the `TaskFavorite` join), and
 * like `isSystem` it is optional on the wire — so `=== true` rather than a
 * truthiness check, and an older backend that sends nothing reads as "not
 * favorited" instead of as meaningful.
 */
export function matchesFavorites(task: Task, filter: FavoritesFilter): boolean {
  return filter === 'any' || task.isFavorite === true;
}

/**
 * Run outcome, from the tier the **server** already computed.
 *
 * This deliberately does not look at `lastRunStatus`. `ExecutionLog` records
 * runs Cronsole *performed*, so for a Windows task a `SUCCESS` there means "the
 * agent accepted the start" — a fire-and-forget handshake, not the job's
 * result. The real verdict needs Windows' own `lastTaskResult`, plus the
 * knowledge that Task Scheduler's informational codes (267009 "currently
 * running", 267014 "terminated") are not exit codes. All of that already lives
 * in `backend/src/services/taskHealth.ts`, and a second copy in the browser is
 * precisely the "two mechanisms answering the same question" drift that took a
 * folder out of every sync (troubleshooting #20a).
 *
 * So: a tier the server did not send is `unknown`, and `unknown` never matches
 * `'healthy'`. A task missing from the map — not yet loaded, or the request
 * failed — is unevidenced, not fine. The caller is responsible for saying so
 * out loud; see `needsHealthData`.
 */
export function matchesOutcome(
  task: Task,
  filter: OutcomeFilter,
  tiers: Map<string, HealthTier> | undefined
): boolean {
  if (filter === 'any') return true;
  const tier = tiers?.get(task.id) ?? 'unknown';
  switch (filter) {
    case 'failing':
      return tier === 'critical' || tier === 'attention';
    case 'healthy':
      return tier === 'ok';
    case 'unknown':
      return tier === 'unknown';
  }
}

/** The task's next scheduled run, or null when nothing is scheduled. */
export function nextRunOf(task: Task): Date | null {
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  const raw = typeof meta.nextRunTime === 'string'
    ? meta.nextRunTime
    : typeof meta.nextRun === 'string'
      ? meta.nextRun
      : null;
  if (!raw) return null;
  const d = new Date(raw);
  // An unparseable stamp is "no known next run", not epoch zero — which would
  // land every such task in `overdue` and make the filter confidently wrong.
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `YYYY-MM-DD` for an instant, as seen in `zone`. */
function dayIn(zone: string, at: Date): string {
  try {
    // en-CA formats as YYYY-MM-DD, so string equality is date equality.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/**
 * Next-run window.
 *
 * "Today" is the calendar date **in the user's schedule timezone**, not UTC and
 * not necessarily the machine's zone — the dashboard already reads and writes
 * every schedule in `settings.timezone` (CLAUDE.md §9), and a "Due today" that
 * disagreed with the times printed next to it would be the same class of lie
 * the zone work was done to remove.
 *
 * `'today'` and `'overdue'` deliberately **overlap**: a run scheduled for 09:00
 * that has not happened by 17:00 is both. Collapsing them would mean picking
 * which of two true things to hide.
 */
export function matchesDue(
  task: Task,
  filter: DueFilter,
  now: Date,
  zone: string
): boolean {
  if (filter === 'any') return true;

  const next = nextRunOf(task);
  if (filter === 'never') return next === null;
  // Everything below is a claim about a scheduled time. Without one there is
  // nothing to claim, so an unscheduled task matches none of them.
  if (next === null) return false;

  switch (filter) {
    case 'today':
      return dayIn(zone, next) === dayIn(zone, now);
    case 'overdue':
      return next.getTime() < now.getTime();
    case 'week':
      return (
        next.getTime() >= now.getTime() &&
        next.getTime() <= now.getTime() + 7 * 86400000
      );
  }
}

// ---------------------------------------------------------------------------

/**
 * Does this filter set need `GET /api/tools/task-health`?
 *
 * Exported so the dashboard only pays for the health query when a view actually
 * asks a question it can answer — and so it can say "waiting on health data"
 * instead of rendering an empty list that reads as "nothing is failing".
 */
export function needsHealthData(filters: TaskFilters): boolean {
  return filters.outcome !== 'any';
}

/**
 * Apply every dimension. Order is by cost, cheapest first — the string compares
 * eliminate most of the list before the date maths or the search tokenizer run.
 *
 * `now` and `zone` are parameters rather than read from the clock and the
 * settings store, so "due today" is testable without pretending it is a
 * particular Tuesday in Los Angeles.
 */
export function applyTaskFilters(
  tasks: Task[],
  filters: TaskFilters,
  options: {
    now: Date;
    timezone: TimezoneMode;
    tiers?: Map<string, HealthTier>;
  }
): Task[] {
  const zone = resolveZone(options.timezone);
  return tasks.filter(
    task =>
      matchesSystem(task, filters.system) &&
      matchesStatus(task, filters.status) &&
      matchesFavorites(task, filters.favorites) &&
      (filters.platform === 'All' || task.platform === filters.platform) &&
      (filters.category === 'All' ||
        (task.category || 'Uncategorized') === filters.category) &&
      matchesDue(task, filters.due, options.now, zone) &&
      matchesOutcome(task, filters.outcome, options.tiers) &&
      (!filters.search.trim() || matchesTaskSearch(task, filters.search))
  );
}

/**
 * Kanban's columns *are* the active/disabled split, so hiding disabled tasks
 * there would empty a column the layout exists to show. The old code expressed
 * this as "kanban ignores `showDisabled`"; with four status values that rule
 * needs a sharper edge:
 *
 * - `'active'` is relaxed to `'any'` — it is the *default*, not a request, and
 *   letting a default silently blank a column is what this guard prevents.
 * - `'disabled'` and `'missing'` pass through untouched, because those were
 *   **asked for by name**. Overriding a deliberate isolation would make the
 *   board disagree with the chip the user just clicked.
 */
export function effectiveFilters(filters: TaskFilters, viewMode: string): TaskFilters {
  if (viewMode === 'kanban' && filters.status === 'active') {
    return { ...filters, status: 'any' };
  }
  return filters;
}

/** Are two filter sets the same question? Used to name the active view. */
export function filtersEqual(a: TaskFilters, b: TaskFilters): boolean {
  return (
    a.status === b.status &&
    a.system === b.system &&
    a.outcome === b.outcome &&
    a.due === b.due &&
    a.favorites === b.favorites &&
    a.platform === b.platform &&
    a.category === b.category &&
    a.search.trim() === b.search.trim()
  );
}
