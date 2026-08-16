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
  /**
   * `'All'`, a platform (`WINDOWS_TASK_SCHEDULER`), or a platform **and
   * subtype** (`TASKHUB_NATIVE:EXEC`) — see `matchesSource`.
   *
   * Named `source` rather than `platform` because it stopped being one: a
   * Cronsole-native HTTP job and a Cronsole-native script are the same platform
   * and different sources, and calling the field `platform` while it holds
   * `TASKHUB_NATIVE:EXEC` would be a name that lies about its own contents.
   */
  source: string;
  /** `'All'` or an exact category (`'Uncategorized'` for tasks with none). */
  category: string;
  /**
   * `'All'`, or the id of a **collection** — a named set of tasks the user
   * hand-picked.
   *
   * The fourth rail dimension, and the only one whose membership is *declared*
   * rather than *derived*. Every other filter here is a predicate over a task's
   * own properties, so it can be evaluated against a task in isolation; this one
   * is a lookup into a set the user assembled, which is exactly what lets a
   * collection hold two Claude routines and two Windows tasks that share no
   * property any other dimension could name.
   *
   * It holds the **id**, never the name, so renaming a collection does not
   * invalidate every open URL and saved link pointing at it.
   */
  collection: string;
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
  source: 'All',
  category: 'All',
  collection: 'All',
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
 * The collection lens — is this task in the named set?
 *
 * `collectionIds` is the server's per-viewer answer (the `TaskCollectionMember`
 * join), optional on the wire for the same reason `isFavorite` is: an older
 * backend that sends nothing should read as "in no collection" rather than as
 * meaningful.
 *
 * **It matches on membership, not on any property of the task**, which is what
 * separates this from every other predicate in this file — and why a collection
 * can hold a Claude routine and a Windows task side by side.
 */
export function matchesCollection(task: Task, filter: string): boolean {
  if (filter === 'All') return true;
  return task.collectionIds?.includes(filter) === true;
}

/** Separator between a platform and its subtype in a source key. */
export const SOURCE_SEP = ':';

/**
 * The source lens — the dashboard's first-level axis.
 *
 * `task.source` is the **server's** key (`WINDOWS_TASK_SCHEDULER`,
 * `TASKHUB_NATIVE:EXEC`, …), because deciding it means reading the native job
 * spec and a browser-side copy of that would be a second definition of the same
 * judgement. It falls back to `task.platform`, which is exactly what a source key
 * is when nothing subdivides — so an older backend degrades to platform-level
 * sources rather than to nothing matching.
 *
 * **Matching is prefix-aware**, and that is what makes the split safe to add:
 * selecting the bare `TASKHUB_NATIVE` still matches both its subtypes, so a saved
 * view or a persisted `defaultPlatform` naming a *platform* keeps working
 * unchanged now that sources are finer than platforms. Without it, splitting
 * native would have silently emptied every stored preference pointing at it.
 */
export function matchesSource(task: Task, filter: string): boolean {
  if (filter === 'All') return true;
  const key = task.source ?? task.platform;
  return key === filter || key.startsWith(`${filter}${SOURCE_SEP}`);
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

/** One filterable dimension of `TaskFilters`, nameable so it can be left out. */
export type FilterDimension =
  | 'status'
  | 'system'
  | 'favorites'
  | 'source'
  | 'category'
  | 'collection'
  | 'due'
  | 'outcome'
  | 'search';

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
  return applyTaskFiltersExcept(tasks, filters, null, options);
}

/**
 * The same pipeline with **one dimension left out** — the population a single
 * control governs.
 *
 * This is what a filter control has to count over, and the rule is sharper than
 * "show a number": **the count is a promise about what clicking will do.** A
 * chip that says `12 hidden` and then reveals one row on click is the same lie
 * as a lit chip over a list it no longer describes, just delayed by a click.
 * Leaving out exactly the dimension the control owns — and applying every other
 * one — is what makes that promise true.
 *
 * The facet chips already worked this way (they were passing `{...filters,
 * category: 'All'}` by hand); the status toggle did not, and counted over the
 * raw list instead. With four dimensions that was survivable. Favorites made it
 * visible: opening on two starred tasks printed `Showing All 269` directly above
 * two rows. Both now come through here, so there is one definition of "the
 * population this control governs" rather than one per control.
 */
export function applyTaskFiltersExcept(
  tasks: Task[],
  filters: TaskFilters,
  /** The dimension this population is *for*. `null` applies everything. */
  except: FilterDimension | null,
  options: {
    now: Date;
    timezone: TimezoneMode;
    tiers?: Map<string, HealthTier>;
  }
): Task[] {
  const zone = resolveZone(options.timezone);
  const skip = (dimension: FilterDimension) => dimension === except;

  return tasks.filter(
    task =>
      (skip('system') || matchesSystem(task, filters.system)) &&
      (skip('status') || matchesStatus(task, filters.status)) &&
      (skip('favorites') || matchesFavorites(task, filters.favorites)) &&
      (skip('source') || matchesSource(task, filters.source)) &&
      (skip('category') ||
        filters.category === 'All' ||
        (task.category || 'Uncategorized') === filters.category) &&
      (skip('collection') || matchesCollection(task, filters.collection)) &&
      (skip('due') || matchesDue(task, filters.due, options.now, zone)) &&
      (skip('outcome') || matchesOutcome(task, filters.outcome, options.tiers)) &&
      (skip('search') ||
        !filters.search.trim() ||
        matchesTaskSearch(task, filters.search))
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

/**
 * How many dimensions differ from the dashboard's default question.
 *
 * The number on the Filters trigger. It exists so collapsing the controls into
 * a popover cannot hide *that* they are set — a closed drawer over a filtered
 * list is the invisible fence again, just with a nicer lid.
 *
 * **Neither `source` nor `category` is counted, because the popover holds
 * neither.** Both are the source rail — source at level 1, the platform's own
 * grouping at level 2 — which is always showing its own selection, so counting
 * them here would attribute a constraint to a control that cannot clear it: a
 * badge saying "1 filter" over a drawer with nothing set in it. The count must
 * only ever describe what is behind *this* trigger.
 *
 * `category` joined `source` in that exemption when the rail took it over
 * (2026-08-15), and `favorites` joined when Favorites became a rail row. The
 * category *pill* still exists and still clears it — but a pill names a
 * constraint rather than offering the alternatives, and a badge counting
 * something a second control already displays is double-reporting.
 *
 * **`collection` is exempt by the same rule, and it is exempt by *omission*** —
 * this function lists what it counts rather than what it skips. That is
 * deliberate but easy to misread as an oversight: a new *drawer* filter must be
 * added here, and a new *rail* dimension must not. The same is true of
 * `filtersEqual` below.
 */
export function activeFilterCount(filters: TaskFilters, base: TaskFilters = DEFAULT_FILTERS): number {
  let n = 0;
  if (filters.status !== base.status) n++;
  if (filters.system !== base.system) n++;
  if (filters.outcome !== base.outcome) n++;
  if (filters.due !== base.due) n++;
  if (filters.search.trim() !== base.search.trim()) n++;
  return n;
}

/** One lens that is currently withholding rows, and how many. */
export interface Withheld {
  dimension: 'system' | 'status';
  count: number;
  /** Plain-language noun for what is being kept back. */
  label: string;
}

/**
 * What the current filters are hiding **without saying so on their own**.
 *
 * The distinction this encodes is the whole reason the Filters popover is safe
 * to build: **a lens that names itself needs no count, and a lens that
 * withholds silently must print one.** Category and platform appear as their
 * own pills — you can read "Backups" and know the rest is elsewhere. The
 * system and status lenses are different: they are *defaults*, nobody chose
 * them today, and on a real machine they withhold 189 and 10 rows while
 * looking like a neutral starting state. That is `Active Only · 110 hidden`,
 * the failure this codebase keeps naming.
 *
 * So this summary is rendered **outside** the popover, always, and the popover
 * is only allowed to hold the controls.
 */
export function withheldBy(
  filters: TaskFilters,
  counts: { system: number; status: number }
): Withheld[] {
  const out: Withheld[] = [];
  if (filters.system === 'personal' && counts.system > 0) {
    out.push({ dimension: 'system', count: counts.system, label: 'system' });
  }
  if (filters.status === 'active' && counts.status > 0) {
    out.push({ dimension: 'status', count: counts.status, label: 'inactive' });
  }
  return out;
}

/**
 * Are two filter sets the same question? Used to name the active view.
 *
 * **`source`, `category` and `favorites` are all excluded** — together they are
 * the source rail, which is *navigation*, and navigation must not invalidate the
 * slice you are looking through. "Failures" and "Failures, in Windows ›
 * AI-Tools" are the same question asked in two places, so the view chip stays
 * lit for both; so is "Failures, starred only".
 *
 * That is not the lit-chip-over-a-list-it-no-longer-describes problem this
 * comparison exists to prevent, and the reason is precise: **the rule is about
 * *hidden* constraints.** Both of these are on screen — the rail row is lit, the
 * heading names the source, the breadcrumb names the folder, and the category
 * carries a pill that clears it. A constraint the reader can see is not a hidden
 * one.
 *
 * `category` joined `source` here on 2026-08-15 when the rail took it over, and
 * `favorites` joined them when Favorites became a rail row rather than a chip in
 * the views bar. Before those moves each was hidden — a facet inside the Filters
 * popover, and a lens the bar itself owned — and so genuinely disqualifying.
 * **The dimensions did not change; where they are displayed did, and that is
 * what this comparison is actually about.**
 *
 * `collection` joined them when collections shipped, for exactly the same
 * reason: a collection is a rail row, it is lit while it applies, and the
 * heading names it. "Failures, in View2" is still the Failures question.
 *
 * Every other dimension still counts, so flipping the status lens or picking a
 * due window drops you to "Custom" exactly as before. Note this function is
 * written as a list of what it **compares**, so a rail dimension is excluded by
 * being left out — adding one here would silently break navigation-keeps-the-view.
 */
export function filtersEqual(a: TaskFilters, b: TaskFilters): boolean {
  return (
    a.status === b.status &&
    a.system === b.system &&
    a.outcome === b.outcome &&
    a.due === b.due &&
    a.search.trim() === b.search.trim()
  );
}
