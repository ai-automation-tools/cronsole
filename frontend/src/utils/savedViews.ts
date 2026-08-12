import {
  DEFAULT_FILTERS,
  filtersEqual,
  type DueFilter,
  type FavoritesFilter,
  type OutcomeFilter,
  type StatusFilter,
  type SystemFilter,
  type TaskFilters
} from './taskFilters';

/**
 * A named filter combination.
 *
 * At 350+ tasks the question is never "show me everything", and the filters
 * that answer the real questions were reset on every visit. A view is the
 * answer kept: titled, bookmarkable, and re-selectable in one click.
 *
 * Deliberately **not** part of a view: the layout (grid / list / kanban /
 * schedule). That is a presentation preference which already persists on its
 * own (`settings.defaultView`), and folding it in would mean picking "Failures"
 * silently rearranged your dashboard. A view answers *which tasks*; the view
 * mode answers *how they are drawn*, and the two are independent questions.
 */
export interface SavedView {
  /** Stable id — what the URL carries and what settings key off. */
  id: string;
  name: string;
  filters: TaskFilters;
  /**
   * A short, honest statement of what this view leaves out, shown next to it.
   * Built-ins carry one written by hand; user views get one generated from
   * their filters, because a named view that silently hides 200 rows is the
   * `Active Only · 110 hidden` problem again with a friendlier label.
   */
  blurb?: string;
}

const view = (
  id: string,
  name: string,
  filters: Partial<TaskFilters>,
  blurb: string
): SavedView => ({ id, name, filters: { ...DEFAULT_FILTERS, ...filters }, blurb });

/**
 * Starred tasks, and nothing else deciding what you see.
 *
 * `status: 'any'` and `system: 'include'` are the whole point: a star is an
 * explicit, per-task choice this user made, so no *default* lens may overrule
 * it. Starring a task, parking it, and then finding it missing from the view
 * named after your stars would make the star mean "shown, conditions apply".
 * The one task you starred out of `\Microsoft\` is shown for the same reason.
 *
 * Exported by name because the dashboard opens on it (see `DashboardScreen`),
 * and looking a default up by string id is how a rename becomes a blank screen.
 */
export const FAVORITES_VIEW: SavedView = {
  id: 'favorites',
  name: 'Favorites',
  filters: { ...DEFAULT_FILTERS, status: 'any', system: 'include', favorites: 'only' },
  blurb:
    'Only the tasks you have starred — including disabled, missing, and system ones, because you starred them on purpose.'
};

/**
 * The five views the roadmap named, plus Favorites and All. Four of the five needed
 * filter dimensions that did not exist — only "My jobs" was expressible by the
 * old toggles.
 *
 * Favorites leads because it is the view the dashboard opens on once you have
 * any; the bar should not make you hunt for the list you are already looking at.
 */
export const BUILTIN_VIEWS: SavedView[] = [
  /**
   * Everything, with no lens at all — including the ~257 tasks Windows owns.
   *
   * It exists because every other view *withholds* something, and until now
   * there was no single click that meant "stop withholding". Reaching the full
   * list took opening the Filters drawer and changing two separate lenses, which
   * made the honest question ("what is actually on this machine?") the hardest
   * one to ask.
   *
   * It leads the bar as the widest lens, not as a default: what a bare URL opens
   * on is decided by `openingFilters`, never by position here. And its count is
   * the reason it is safe to offer — the chip says 357 before you click it, so
   * the scale of what it un-hides is stated rather than discovered.
   */
  view('all', 'All', { status: 'any', system: 'include' },
    'Every task, including the ones Windows owns and anything disabled or missing. No lens at all.'),
  FAVORITES_VIEW,
  view('my-jobs', 'My jobs', { status: 'active', system: 'personal' },
    'Your active tasks. Hides Windows’ own tasks and anything disabled or missing.'),
  view('failures', 'Failures', { status: 'any', system: 'personal', outcome: 'failing' },
    'Tasks the health check rates critical or needs-attention. A task with no run evidence is not listed — unknown is not failing, and it is not fine either.'),
  view('due-today', 'Due today', { status: 'active', system: 'personal', due: 'today' },
    'Next run falls on today’s date in your schedule timezone. Tasks with no scheduled run are not listed.'),
  view('disabled', 'Disabled', { status: 'disabled', system: 'personal' },
    'Only the tasks you have parked. Isolates them — this is not the “show everything” toggle.'),
  view('system', 'System', { status: 'any', system: 'only' },
    'Only tasks Windows itself owns (\\Microsoft\\…), which the dashboard hides by default.')
];

export const isBuiltinView = (id: string): boolean =>
  BUILTIN_VIEWS.some(v => v.id === id);

/**
 * What a **bare** dashboard URL resolves to: your favorites if you have any,
 * otherwise your saved defaults.
 *
 * A function rather than a branch inside the screen so the rule can be pinned
 * without rendering a dashboard — and so it stays one rule with one answer.
 *
 * `hasFavorites` must be computed from the **unlensed** task list. Asking the
 * filtered list would make the answer depend on the filters this is choosing.
 */
export function openingFilters(hasFavorites: boolean, defaults: TaskFilters): TaskFilters {
  // The default **source** survives either branch. It is the outer lens, so it
  // is not something the Favorites view gets to overrule — the same reason a
  // view no longer stores a platform at all.
  return hasFavorites
    ? { ...FAVORITES_VIEW.filters, source: defaults.source }
    : defaults;
}

/**
 * The filters a saved view should actually store.
 *
 * Source is stripped, because a view does not own one: it is the outer lens,
 * `filtersEqual` ignores it, and a view carrying `source: WINDOWS` would be a
 * value nothing reads — dead state that reads as meaningful to the next person.
 */
export function viewFiltersFrom(filters: TaskFilters): TaskFilters {
  return { ...filters, source: DEFAULT_FILTERS.source };
}

/** Built-ins first, then the user's own, for the view bar. */
export function allViews(saved: SavedView[]): SavedView[] {
  return [...BUILTIN_VIEWS, ...saved.filter(v => !isBuiltinView(v.id))];
}

/**
 * Which view, if any, the current filters *are*.
 *
 * Returns null for an ad-hoc combination, which the bar renders as "Custom".
 * That honesty is the point: once you tweak a filter you are no longer looking
 * at "Failures", and leaving the chip lit would make the label a lie about the
 * list under it.
 */
export function matchView(
  filters: TaskFilters,
  saved: SavedView[]
): SavedView | null {
  return allViews(saved).find(v => filtersEqual(v.filters, filters)) ?? null;
}

export function newViewId(existing: SavedView[]): string {
  const taken = new Set(existing.map(v => v.id));
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    const id = `v-${crypto.randomUUID().slice(0, 8)}`;
    if (!taken.has(id)) return id;
  }
  let n = 1;
  while (taken.has(`v-${n}`)) n += 1;
  return `v-${n}`;
}

/** One sentence naming what a user-saved view constrains. */
export function describeFilters(filters: TaskFilters): string {
  const parts: string[] = [];
  if (filters.favorites === 'only') parts.push('favorites only');
  if (filters.status === 'active') parts.push('active only');
  if (filters.status === 'disabled') parts.push('disabled only');
  if (filters.status === 'missing') parts.push('missing only');
  if (filters.system === 'personal') parts.push('hides system tasks');
  if (filters.system === 'only') parts.push('system tasks only');
  if (filters.outcome === 'failing') parts.push('failing health');
  if (filters.outcome === 'healthy') parts.push('healthy only');
  if (filters.outcome === 'unknown') parts.push('no run evidence');
  if (filters.due === 'today') parts.push('due today');
  if (filters.due === 'week') parts.push('due within 7 days');
  if (filters.due === 'overdue') parts.push('overdue');
  if (filters.due === 'never') parts.push('no scheduled run');
  if (filters.source !== 'All') parts.push(filters.source);
  if (filters.category !== 'All') parts.push(filters.category);
  if (filters.search.trim()) parts.push(`matching “${filters.search.trim()}”`);
  return parts.length ? parts.join(' · ') : 'no filters — every task';
}

// ---------------------------------------------------------------------------
// URL codec. A view is a bookmarkable URL, so the state has to survive a copy
// and paste into another window — which means it lives in the query string
// rather than only in React state.
// ---------------------------------------------------------------------------

const STATUS: StatusFilter[] = ['any', 'active', 'disabled', 'missing'];
const SYSTEM: SystemFilter[] = ['personal', 'include', 'only'];
const OUTCOME: OutcomeFilter[] = ['any', 'failing', 'healthy', 'unknown'];
const DUE: DueFilter[] = ['any', 'today', 'week', 'overdue', 'never'];
const FAVORITES: FavoritesFilter[] = ['any', 'only'];

/**
 * Read a value that must be one of a fixed set.
 *
 * An unrecognized value falls back to the default rather than being passed
 * through. A hand-edited or truncated URL should show you the default
 * dashboard, not filter to zero rows and look like your tasks are gone.
 */
function oneOf<T extends string>(raw: string | null, allowed: T[], fallback: T): T {
  return raw !== null && (allowed as string[]).includes(raw) ? (raw as T) : fallback;
}

/** Every param this module writes — the caller uses it to spot a bare URL. */
export const FILTER_PARAM_KEYS = [
  'view', 'status', 'system', 'outcome', 'due', 'fav', 'source', 'platform', 'category', 'q'
] as const;

/**
 * Read the source, accepting the old `platform` param.
 *
 * The dimension was called `platform` for exactly one day (2026-08-12) before
 * Cronsole-native split into HTTP and script sources and the name stopped being
 * true. Reading both costs three lines and means a link copied in that window
 * still resolves — and a bare platform key is a valid source key anyway, since
 * `matchesSource` matches subtypes by prefix.
 */
function readSource(params: URLSearchParams): string {
  return params.get('source') || params.get('platform') || DEFAULT_FILTERS.source;
}

/**
 * Serialize to search params.
 *
 * A recognized view is written as just `?view=<id>` — short enough to paste
 * into a message, and it keeps meaning the same thing if the view is later
 * edited. Anything ad-hoc is written out field by field, and **only** the
 * fields that differ from the default, so an ad-hoc URL stays readable.
 *
 * A matched view **always** writes its id, including the one whose filters
 * happen to equal `DEFAULT_FILTERS`. Suppressing it to keep the address bar
 * clean was the first attempt and it was wrong: a bare URL already means
 * "whatever this user's saved dashboard defaults are", and those need not be
 * the defaults here — someone with `defaultPlatform: WINDOWS` would click "My
 * jobs", get an empty query string, and land back on a Windows-only list. Two
 * different states cannot share one encoding.
 */
export function filtersToParams(
  filters: TaskFilters,
  saved: SavedView[]
): URLSearchParams {
  const params = new URLSearchParams();
  const match = matchView(filters, saved);
  if (match) {
    params.set('view', match.id);
    // Source rides *alongside* the view id rather than being folded into it.
    // It is the outer lens (see `filtersEqual`), so a view no longer carries a
    // platform — and if this were dropped here, selecting a source would vanish
    // from the URL the moment the rest of the filters happened to match a view,
    // and reload as "All sources". A bookmark has to reproduce what you see.
    if (filters.source !== DEFAULT_FILTERS.source) params.set('source', filters.source);
    return params;
  }
  if (filters.status !== DEFAULT_FILTERS.status) params.set('status', filters.status);
  if (filters.system !== DEFAULT_FILTERS.system) params.set('system', filters.system);
  if (filters.outcome !== DEFAULT_FILTERS.outcome) params.set('outcome', filters.outcome);
  if (filters.due !== DEFAULT_FILTERS.due) params.set('due', filters.due);
  if (filters.favorites !== DEFAULT_FILTERS.favorites) params.set('fav', filters.favorites);
  if (filters.source !== DEFAULT_FILTERS.source) params.set('source', filters.source);
  if (filters.category !== DEFAULT_FILTERS.category) params.set('category', filters.category);
  if (filters.search.trim()) params.set('q', filters.search.trim());
  return params;
}

/**
 * Read filters back out of search params.
 *
 * `view=<id>` wins over the individual fields when it names a view that exists.
 * A `view` id that does **not** exist — a link to a saved view the recipient
 * never created, or one since deleted — falls through to the explicit fields
 * and then to the defaults, so a stale bookmark degrades to the normal
 * dashboard instead of an empty one.
 */
export function filtersFromParams(
  params: URLSearchParams,
  saved: SavedView[]
): TaskFilters {
  const id = params.get('view');
  if (id) {
    const found = allViews(saved).find(v => v.id === id);
    // The view supplies every dimension except source, which is read from its
    // own param — the mirror of how `filtersToParams` writes it.
    if (found) {
      return {
        ...found.filters,
        source: readSource(params)
      };
    }
  }
  return {
    status: oneOf(params.get('status'), STATUS, DEFAULT_FILTERS.status),
    system: oneOf(params.get('system'), SYSTEM, DEFAULT_FILTERS.system),
    outcome: oneOf(params.get('outcome'), OUTCOME, DEFAULT_FILTERS.outcome),
    due: oneOf(params.get('due'), DUE, DEFAULT_FILTERS.due),
    favorites: oneOf(params.get('fav'), FAVORITES, DEFAULT_FILTERS.favorites),
    source: readSource(params),
    category: params.get('category') || DEFAULT_FILTERS.category,
    search: params.get('q') || ''
  };
}
