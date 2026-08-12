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
  it('ships All and Favorites plus the five views the roadmap named, in bar order', () => {
    expect(BUILTIN_VIEWS.map(v => v.id))
      .toEqual(['all', 'favorites', 'my-jobs', 'failures', 'due-today', 'disabled', 'system']);
  });

  it('makes All actually mean all — no lens at all', () => {
    // Every other built-in withholds something; this is the one click that means
    // "stop withholding". If it kept the system or status lens it would be a
    // narrower view wearing the widest possible name.
    const all = builtin('all').filters;
    expect(all.status).toBe('any');
    expect(all.system).toBe('include');
    expect(all.favorites).toBe('any');
    expect(all.outcome).toBe('any');
    expect(all.due).toBe('any');
    expect(all.category).toBe('All');
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
  const myDefaults = filters({ source: 'WINDOWS_TASK_SCHEDULER', category: 'Backups' });

  it('opens on everything', () => {
    // Changed 2026-08-12 from "Favorites once you have any". Opening on a subset
    // chosen by a gesture the user may have made weeks ago needed a banner to
    // stay honest — naming the filter, counting what it withheld, offering the
    // way out. Opening on everything needs no such apology.
    const open = openingFilters(myDefaults);
    expect(open.status).toBe('any');
    expect(open.system).toBe('include');
    expect(open.favorites).toBe('any');
  });

  it('keeps the saved defaults that All says nothing about', () => {
    // `status` and `system` are exactly the lenses All is *about*, so honouring
    // them would make the opening view not-All. `category` and `source` narrow
    // along other axes and still apply.
    const open = openingFilters(myDefaults);
    expect(open.source).toBe('WINDOWS_TASK_SCHEDULER');
    expect(open.category).toBe('Backups');
  });

  it('resolves to a view the bar can name', () => {
    // The state must never be nameless: a list with no lit chip is one whose
    // constraints the user has no way to read off the page.
    expect(matchView(openingFilters(filters()), [])?.name).toBe('All');
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
      favorites: 'only', source: 'TASKHUB_NATIVE', category: 'Reports', search: 'db dump'
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
      filters({ ...builtin('failures').filters, source: 'TASKHUB_NATIVE' }),
      saved
    );
    expect(p.get('view')).toBe('failures');
    expect(p.get('source')).toBe('TASKHUB_NATIVE');
  });

  it('is omitted when it is All, so a plain view URL stays short', () => {
    const p = filtersToParams(filters(builtin('failures').filters), saved);
    expect(p.get('view')).toBe('failures');
    expect(p.has('source')).toBe(false);
  });

  it('round-trips through the URL on top of a view', () => {
    const original = filters({ ...builtin('my-jobs').filters, source: 'WINDOWS_TASK_SCHEDULER' });
    expect(filtersFromParams(filtersToParams(original, saved), saved)).toEqual(original);
  });

  it('a view URL without a source param reads back as All', () => {
    const back = filtersFromParams(new URLSearchParams('view=failures'), saved);
    expect(back.source).toBe('All');
  });

  it('does not drop the view bar to Custom', () => {
    // The whole point of the decision: picking a source keeps the view lit,
    // because both constraints are on screen at the same time.
    const withSource = filters({ ...builtin('failures').filters, source: 'TASKHUB_NATIVE' });
    expect(matchView(withSource, saved)?.id).toBe('failures');
  });

  it('viewFiltersFrom strips the source before a view stores it', () => {
    // A stored platform would be state nothing reads — matchView ignores it —
    // while looking meaningful to whoever opens the JSON next.
    expect(viewFiltersFrom(filters({ source: 'TASKHUB_NATIVE', category: 'Backup' })))
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
