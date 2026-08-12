import { describe, it, expect } from 'vitest';
import { DEFAULT_FILTERS, type TaskFilters } from '../taskFilters';
import {
  allViews,
  BUILTIN_VIEWS,
  describeFilters,
  filtersFromParams,
  filtersToParams,
  isBuiltinView,
  matchView,
  newViewId,
  openingFilters,
  viewFiltersFrom,
  type SavedView
} from '../savedViews';

const filters = (over: Partial<TaskFilters> = {}): TaskFilters => ({ ...DEFAULT_FILTERS, ...over });

const mine: SavedView = {
  id: 'v-mine',
  name: 'Nightly backups',
  filters: filters({ category: 'Backup', due: 'today' })
};

/** By id, never by index — the order changed once (Favorites was added to the
 *  front) and index-based assertions failed for a reason unrelated to what they
 *  were pinning. */
const builtin = (id: string) => BUILTIN_VIEWS.find(v => v.id === id)!;

describe('BUILTIN_VIEWS', () => {
  it('ships Favorites plus the five views the roadmap named, in bar order', () => {
    expect(BUILTIN_VIEWS.map(v => v.id))
      .toEqual(['favorites', 'my-jobs', 'failures', 'due-today', 'disabled', 'system']);
  });

  it('makes Favorites ignore every other lens', () => {
    // A star is an explicit per-task choice, so no *default* may overrule it —
    // otherwise starring a task and then parking it makes it vanish from the
    // view named after your stars, and the star quietly means "shown,
    // conditions apply".
    const fav = builtin('favorites').filters;
    expect(fav.favorites).toBe('only');
    expect(fav.status).toBe('any');
    expect(fav.system).toBe('include');
  });

  it('gives every built-in a blurb naming what it leaves out', () => {
    // A named view that silently withholds rows is the `Active Only · 110
    // hidden` problem wearing a friendlier label.
    for (const v of BUILTIN_VIEWS) {
      expect(v.blurb, `${v.id} needs a blurb`).toBeTruthy();
    }
  });

  it('uses the dimensions that did not exist before this feature', () => {
    // Four of the five are only expressible because status, the system lens,
    // outcome and due were widened. If one of these silently reverted to the
    // old binary toggles, the view would still render and quietly mean
    // something else.
    const by = (id: string) => BUILTIN_VIEWS.find(v => v.id === id)!.filters;
    expect(by('failures').outcome).toBe('failing');
    expect(by('due-today').due).toBe('today');
    expect(by('disabled').status).toBe('disabled');
    expect(by('system').system).toBe('only');
  });

  it('makes "My jobs" exactly the default dashboard', () => {
    expect(builtin('my-jobs').filters).toEqual(DEFAULT_FILTERS);
  });
});

describe('openingFilters — what a bare dashboard URL means', () => {
  // The user's ask, as a rule: favorites by default, the normal dashboard when
  // there are none.
  const myDefaults = filters({ platform: 'WINDOWS_TASK_SCHEDULER' });

  it('opens on Favorites once you have any', () => {
    expect(openingFilters(true, myDefaults)).toEqual({
      ...builtin('favorites').filters,
      // Source survives the Favorites default. It is the outer lens, so it is
      // not the Favorites view's to overrule — and a user whose default source
      // is Windows should not silently land on every source because they
      // happened to star something.
      platform: myDefaults.platform
    });
  });

  it('falls back to the user’s own defaults when nothing is starred', () => {
    // Not DEFAULT_FILTERS — this user set a default platform, and un-starring
    // your last task must return you to *your* dashboard, not to a generic one.
    expect(openingFilters(false, myDefaults)).toEqual(myDefaults);
  });

  it('resolves to a view the bar can name, so the filter announces itself', () => {
    // A dashboard that opens filtered and does not say so is `Active Only · 110
    // hidden` again — and worse here, because the user did not choose it.
    expect(matchView(openingFilters(true, myDefaults), [])?.name).toBe('Favorites');
  });
});

describe('matchView', () => {
  it('names the view a filter set is', () => {
    expect(matchView(DEFAULT_FILTERS, [])?.id).toBe('my-jobs');
    expect(matchView(filters({ system: 'only', status: 'any' }), [])?.id).toBe('system');
  });

  it('finds a user view alongside the built-ins', () => {
    expect(matchView(mine.filters, [mine])?.id).toBe('v-mine');
  });

  it('returns null once any dimension is tweaked', () => {
    // The chip must go dark: leaving "Failures" lit over a list narrowed to one
    // category makes the label a lie about its own contents.
    const tweaked = filters({ ...builtin('failures').filters, category: 'Backup' });
    expect(matchView(tweaked, [])).toBeNull();
  });
});

describe('allViews / isBuiltinView', () => {
  it('puts built-ins first and never duplicates one', () => {
    const shadow: SavedView = { id: 'failures', name: 'Mine', filters: DEFAULT_FILTERS };
    const out = allViews([mine, shadow]);
    expect(out.map(v => v.id)).toEqual([...BUILTIN_VIEWS.map(v => v.id), 'v-mine']);
  });

  it('knows which ids cannot be deleted', () => {
    expect(isBuiltinView('failures')).toBe(true);
    expect(isBuiltinView('v-mine')).toBe(false);
  });
});

describe('URL codec', () => {
  it('writes a matched view as just its id', () => {
    expect(filtersToParams(builtin('failures').filters, []).toString()).toBe('view=failures');
    expect(filtersToParams(mine.filters, [mine]).toString()).toBe('view=v-mine');
  });

  it('writes the default view explicitly rather than as a bare URL', () => {
    // The regression this pins: a bare URL already means "this user's saved
    // dashboard defaults", which need not be these defaults. Someone with
    // defaultPlatform=WINDOWS would click "My jobs", get an empty query string,
    // and land back on a Windows-only list. Two states, two encodings.
    expect(filtersToParams(DEFAULT_FILTERS, []).toString()).toBe('view=my-jobs');
  });

  it('writes an ad-hoc combination field by field, omitting defaults', () => {
    const params = filtersToParams(filters({ category: 'Backup', search: 'nightly' }), []);
    expect(params.get('category')).toBe('Backup');
    expect(params.get('q')).toBe('nightly');
    expect(params.has('status')).toBe(false);
    expect(params.has('view')).toBe(false);
  });

  it('round-trips every dimension', () => {
    const rich = filters({
      status: 'missing', system: 'include', outcome: 'unknown', due: 'week',
      favorites: 'only', platform: 'TASKHUB_NATIVE', category: 'Reports', search: 'db dump'
    });
    expect(filtersFromParams(filtersToParams(rich, []), [])).toEqual(rich);
  });

  it('carries the starred lens in the URL, so a Favorites link survives a paste', () => {
    expect(filtersToParams(builtin('favorites').filters, []).toString()).toBe('view=favorites');
    // And ad-hoc (favorites plus something else), where there is no view id to
    // lean on and the dimension has to be written out by name.
    const adhoc = filters({ favorites: 'only', category: 'Backup' });
    expect(filtersToParams(adhoc, []).get('fav')).toBe('only');
    expect(filtersFromParams(filtersToParams(adhoc, []), [])).toEqual(adhoc);
  });

  it('round-trips a saved view through its id', () => {
    expect(filtersFromParams(filtersToParams(mine.filters, [mine]), [mine])).toEqual(mine.filters);
  });

  it('falls back to the defaults for an unknown value instead of filtering to nothing', () => {
    // A hand-edited or truncated URL should show the default dashboard, not
    // zero rows that read as "your tasks are gone".
    const out = filtersFromParams(new URLSearchParams('status=banana&due=whenever'), []);
    expect(out.status).toBe(DEFAULT_FILTERS.status);
    expect(out.due).toBe(DEFAULT_FILTERS.due);
  });

  it('degrades a link to a view the reader does not have', () => {
    // Shared from another machine, or since deleted. It must not resolve to an
    // empty dashboard.
    expect(filtersFromParams(new URLSearchParams('view=v-someone-elses'), [])).toEqual(DEFAULT_FILTERS);
  });

  it('lets an unknown view id fall through to explicit fields', () => {
    const out = filtersFromParams(new URLSearchParams('view=v-gone&status=disabled'), []);
    expect(out.status).toBe('disabled');
  });

  it('trims the search term it writes', () => {
    expect(filtersToParams(filters({ search: '  db  ' }), []).get('q')).toBe('db');
  });
});

describe('source is the outer lens, not part of a view', () => {
  const saved = [mine];

  it('rides alongside a view id in the URL instead of being swallowed by it', () => {
    // The failure this prevents: a matched view writes `?view=failures` and
    // returns early, so a selected source vanishes from the URL and the page
    // reloads showing every source. A bookmark has to reproduce what you see.
    const p = filtersToParams(
      filters({ ...builtin('failures').filters, platform: 'TASKHUB_NATIVE' }),
      saved
    );
    expect(p.get('view')).toBe('failures');
    expect(p.get('platform')).toBe('TASKHUB_NATIVE');
  });

  it('is omitted when it is All, so a plain view URL stays short', () => {
    const p = filtersToParams(filters(builtin('failures').filters), saved);
    expect(p.get('view')).toBe('failures');
    expect(p.has('platform')).toBe(false);
  });

  it('round-trips through the URL on top of a view', () => {
    const original = filters({ ...builtin('my-jobs').filters, platform: 'WINDOWS_TASK_SCHEDULER' });
    expect(filtersFromParams(filtersToParams(original, saved), saved)).toEqual(original);
  });

  it('a view URL without a source param reads back as All', () => {
    const back = filtersFromParams(new URLSearchParams('view=failures'), saved);
    expect(back.platform).toBe('All');
  });

  it('does not drop the view bar to Custom', () => {
    // The whole point of the decision: picking a source keeps the view lit,
    // because both constraints are on screen at the same time.
    const withSource = filters({ ...builtin('failures').filters, platform: 'TASKHUB_NATIVE' });
    expect(matchView(withSource, saved)?.id).toBe('failures');
  });

  it('viewFiltersFrom strips the source before a view stores it', () => {
    // A stored platform would be state nothing reads — matchView ignores it —
    // while looking meaningful to whoever opens the JSON next.
    expect(viewFiltersFrom(filters({ platform: 'TASKHUB_NATIVE', category: 'Backup' })))
      .toEqual(filters({ category: 'Backup' }));
  });
});

describe('newViewId', () => {
  it('never collides with an existing id', () => {
    const taken = Array.from({ length: 5 }, (_, i) => ({ ...mine, id: `v-${i + 1}` }));
    expect(taken.map(v => v.id)).not.toContain(newViewId(taken));
  });
});

describe('describeFilters', () => {
  it('names each active constraint', () => {
    const text = describeFilters(filters({ outcome: 'failing', due: 'today', category: 'Backup' }));
    expect(text).toContain('failing health');
    expect(text).toContain('due today');
    expect(text).toContain('Backup');
  });

  it('names the starred lens, so an empty Favorites list explains itself', () => {
    expect(describeFilters(filters({ favorites: 'only' }))).toContain('favorites only');
  });

  it('says so plainly when nothing is constrained', () => {
    expect(describeFilters(filters({ status: 'any', system: 'include' }))).toBe('no filters — every task');
  });
});
