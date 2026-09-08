import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import {
  activeFilterCount,
  applyTaskFilters,
  applyTaskFiltersExcept,
  DEFAULT_FILTERS,
  effectiveFilters,
  filtersEqual,
  matchesDue,
  matchesFavorites,
  matchesCollection,
  matchesOutcome,
  matchesFolderPath,
  matchesSource,
  matchesStatus,
  matchesSystem,
  needsHealthData,
  nextRunOf,
  windowsSubfolderPath,
  withheldBy,
  type HealthTier
} from '../taskFilters';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  name: `Task ${id}`,
  externalId: `\\Cronsole\\${id}`,
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Backup',
  updatedAt: '2026-07-31T12:00:00Z',
  metadata: {},
  ...over
});

const at = (iso: string) => new Date(iso);
const ZONE = 'America/Los_Angeles';

describe('matchesStatus', () => {
  it('isolates rather than includes', () => {
    // The whole reason "Disabled" could not be a saved view before: the old
    // toggle's "show everything" is not the same question as "show me only the
    // parked ones".
    const disabled = task('a', { status: 'DISABLED' });
    expect(matchesStatus(disabled, 'any')).toBe(true);
    expect(matchesStatus(disabled, 'disabled')).toBe(true);
    expect(matchesStatus(disabled, 'active')).toBe(false);
    expect(matchesStatus(task('b'), 'disabled')).toBe(false);
  });

  it('treats MISSING as its own state, not as disabled', () => {
    const missing = task('a', { status: 'MISSING' });
    expect(matchesStatus(missing, 'missing')).toBe(true);
    expect(matchesStatus(missing, 'disabled')).toBe(false);
    expect(matchesStatus(missing, 'active')).toBe(false);
  });
});

describe('matchesSystem', () => {
  it('has three states, and "only" is not the inverse of "personal"', () => {
    const mine = task('a');
    const os = task('b', { isSystem: true });
    expect([matchesSystem(mine, 'personal'), matchesSystem(os, 'personal')]).toEqual([true, false]);
    expect([matchesSystem(mine, 'include'), matchesSystem(os, 'include')]).toEqual([true, true]);
    expect([matchesSystem(mine, 'only'), matchesSystem(os, 'only')]).toEqual([false, true]);
  });

  it('reads a missing isSystem as "not system", never as unknown', () => {
    // The field is optional on the wire so an older backend degrades to showing
    // the task rather than hiding every task at once.
    const legacy = task('a', { isSystem: undefined });
    expect(matchesSystem(legacy, 'personal')).toBe(true);
    expect(matchesSystem(legacy, 'only')).toBe(false);
  });
});

describe('matchesFavorites', () => {
  it('only narrows when asked', () => {
    const starred = task('a', { isFavorite: true });
    const plain = task('b');
    expect([matchesFavorites(starred, 'any'), matchesFavorites(plain, 'any')]).toEqual([true, true]);
    expect([matchesFavorites(starred, 'only'), matchesFavorites(plain, 'only')]).toEqual([true, false]);
  });

  it('reads a missing isFavorite as "not favorited", never as unknown', () => {
    // Optional on the wire like isSystem. An older backend sends nothing, which
    // must degrade to "you have no favorites" — the normal dashboard — rather
    // than to a Favorites view holding everything.
    expect(matchesFavorites(task('a', { isFavorite: undefined }), 'only')).toBe(false);
  });
});

describe('matchesOutcome', () => {
  const tiers = (entries: [string, HealthTier][]) => new Map(entries);

  it('takes the server verdict for failing and healthy', () => {
    const map = tiers([['a', 'critical'], ['b', 'attention'], ['c', 'ok']]);
    expect(matchesOutcome(task('a'), 'failing', map)).toBe(true);
    expect(matchesOutcome(task('b'), 'failing', map)).toBe(true);
    expect(matchesOutcome(task('c'), 'failing', map)).toBe(false);
    expect(matchesOutcome(task('c'), 'healthy', map)).toBe(true);
  });

  it('treats a task the server did not score as unknown, never as healthy', () => {
    // The rule the health scorer is built on, carried through to the filter:
    // silence is the easiest thing in the world to mistake for health.
    const map = tiers([['a', 'ok']]);
    expect(matchesOutcome(task('zzz'), 'healthy', map)).toBe(false);
    expect(matchesOutcome(task('zzz'), 'failing', map)).toBe(false);
    expect(matchesOutcome(task('zzz'), 'unknown', map)).toBe(true);
  });

  it('treats an absent map as no evidence at all', () => {
    // Not yet loaded, or the request failed. Every task is unknown — so a
    // "Failures" view renders empty and the screen has to say why.
    expect(matchesOutcome(task('a'), 'failing', undefined)).toBe(false);
    expect(matchesOutcome(task('a'), 'healthy', undefined)).toBe(false);
    expect(matchesOutcome(task('a'), 'unknown', undefined)).toBe(true);
  });

  it('lets everything through when outcome is not being asked about', () => {
    expect(matchesOutcome(task('a'), 'any', undefined)).toBe(true);
  });
});

describe('nextRunOf', () => {
  it('reads either metadata spelling', () => {
    expect(nextRunOf(task('a', { metadata: { nextRunTime: '2026-08-01T10:00:00Z' } })))
      .toEqual(at('2026-08-01T10:00:00Z'));
    expect(nextRunOf(task('a', { metadata: { nextRun: '2026-08-01T10:00:00Z' } })))
      .toEqual(at('2026-08-01T10:00:00Z'));
  });

  it('returns null for a missing or unparseable stamp', () => {
    // An unparseable date must not become epoch zero — that would land every
    // such task in `overdue` and make the filter confidently wrong.
    expect(nextRunOf(task('a', { metadata: {} }))).toBeNull();
    expect(nextRunOf(task('a', { metadata: { nextRunTime: 'soon' } }))).toBeNull();
  });

  it('does not fall back to updatedAt', () => {
    // The schedule view sorts by updatedAt when there is no next run, which is
    // fine for ordering and would be a lie here: "not scheduled" is not "due".
    expect(nextRunOf(task('a', { metadata: {}, updatedAt: '2026-07-31T12:00:00Z' }))).toBeNull();
  });
});

describe('matchesDue', () => {
  // 2026-07-31 09:00 Pacific == 16:00Z.
  const now = at('2026-07-31T16:00:00Z');
  const withNext = (iso: string) => task('a', { metadata: { nextRunTime: iso } });

  it('judges "today" by the calendar date in the schedule zone, not UTC', () => {
    // 2026-08-01T04:00Z is still 2026-07-31 21:00 in Los Angeles. A UTC-based
    // check would call this tomorrow while the dashboard prints it as today.
    expect(matchesDue(withNext('2026-08-01T04:00:00Z'), 'today', now, ZONE)).toBe(true);
    expect(matchesDue(withNext('2026-08-01T04:00:00Z'), 'today', now, 'UTC')).toBe(false);
  });

  it('counts a run earlier today as both today and overdue', () => {
    // Deliberately overlapping: a 09:00 run that has not happened by 17:00 is
    // genuinely both, and collapsing them means picking which truth to hide.
    const earlier = withNext('2026-07-31T15:00:00Z');
    expect(matchesDue(earlier, 'today', now, ZONE)).toBe(true);
    expect(matchesDue(earlier, 'overdue', now, ZONE)).toBe(true);
  });

  it('bounds "week" to the next seven days and excludes the past', () => {
    expect(matchesDue(withNext('2026-08-05T16:00:00Z'), 'week', now, ZONE)).toBe(true);
    expect(matchesDue(withNext('2026-08-09T16:00:00Z'), 'week', now, ZONE)).toBe(false);
    expect(matchesDue(withNext('2026-07-30T16:00:00Z'), 'week', now, ZONE)).toBe(false);
  });

  it('matches an unscheduled task only against "never"', () => {
    const none = task('a', { metadata: {} });
    expect(matchesDue(none, 'never', now, ZONE)).toBe(true);
    expect(matchesDue(none, 'today', now, ZONE)).toBe(false);
    expect(matchesDue(none, 'overdue', now, ZONE)).toBe(false);
    expect(matchesDue(none, 'week', now, ZONE)).toBe(false);
    expect(matchesDue(none, 'any', now, ZONE)).toBe(true);
  });
});

describe('effectiveFilters', () => {
  it('relaxes the default active filter in kanban', () => {
    // Kanban's columns ARE the active/disabled split, so a default that empties
    // one of them is a default breaking the layout.
    const out = effectiveFilters({ ...DEFAULT_FILTERS, status: 'active' }, 'kanban');
    expect(out.status).toBe('any');
  });

  it('leaves a deliberate isolation alone', () => {
    // Asked for by name — overriding it would make the board disagree with the
    // chip the user just clicked.
    expect(effectiveFilters({ ...DEFAULT_FILTERS, status: 'disabled' }, 'kanban').status).toBe('disabled');
    expect(effectiveFilters({ ...DEFAULT_FILTERS, status: 'missing' }, 'kanban').status).toBe('missing');
  });

  it('changes nothing in the other views', () => {
    for (const mode of ['grid', 'list', 'schedule']) {
      expect(effectiveFilters({ ...DEFAULT_FILTERS, status: 'active' }, mode).status).toBe('active');
    }
  });
});

describe('needsHealthData', () => {
  it('is true only when outcome is constrained', () => {
    // Drives whether the dashboard pays for a scan of every task's executions.
    expect(needsHealthData(DEFAULT_FILTERS)).toBe(false);
    expect(needsHealthData({ ...DEFAULT_FILTERS, outcome: 'failing' })).toBe(true);
    expect(needsHealthData({ ...DEFAULT_FILTERS, outcome: 'unknown' })).toBe(true);
    expect(needsHealthData({ ...DEFAULT_FILTERS, due: 'today' })).toBe(false);
  });
});

describe('applyTaskFilters', () => {
  const now = at('2026-07-31T16:00:00Z');
  const opts = { now, timezone: 'America/Los_Angeles' as const };

  const tasks = [
    task('mine-active', { metadata: { nextRunTime: '2026-07-31T20:00:00Z' } }),
    task('mine-off', { status: 'DISABLED' }),
    task('os', { isSystem: true, category: 'Microsoft' }),
    task('native', { source: 'TASKHUB_NATIVE', category: 'Reports' })
  ];

  it('defaults to active personal tasks', () => {
    expect(applyTaskFilters(tasks, DEFAULT_FILTERS, opts).map(t => t.id))
      .toEqual(['mine-active', 'native']);
  });

  it('composes every dimension', () => {
    const out = applyTaskFilters(
      tasks,
      { ...DEFAULT_FILTERS, status: 'any', source: 'TASKHUB_NATIVE', category: 'Reports' },
      opts
    );
    expect(out.map(t => t.id)).toEqual(['native']);
  });

  it('applies the due window against the shared clock', () => {
    const out = applyTaskFilters(tasks, { ...DEFAULT_FILTERS, due: 'today' }, opts);
    expect(out.map(t => t.id)).toEqual(['mine-active']);
  });

  it('returns nothing for a run-outcome view with no health data', () => {
    // Not a bug — the honest consequence of "absence of evidence is unknown".
    // The dashboard is responsible for saying the scan has not landed, because
    // an empty list on its own reads as "nothing is failing".
    expect(applyTaskFilters(tasks, { ...DEFAULT_FILTERS, outcome: 'failing' }, opts)).toEqual([]);
  });

  it('filters by the server tier when it has one', () => {
    const tiers = new Map<string, HealthTier>([['mine-active', 'critical'], ['native', 'ok']]);
    const out = applyTaskFilters(
      tasks,
      { ...DEFAULT_FILTERS, outcome: 'failing' },
      { ...opts, tiers }
    );
    expect(out.map(t => t.id)).toEqual(['mine-active']);
  });

  it('shows a starred task the other lenses would have hidden', () => {
    // This is the Favorites view's exact filter set. A star is an explicit
    // choice, so the disabled task and the OS-owned one both belong here — if
    // the default lenses could overrule it, the star would mean "shown,
    // conditions apply".
    const starred = [
      task('mine-off', { status: 'DISABLED', isFavorite: true }),
      task('os', { isSystem: true, category: 'Microsoft', isFavorite: true }),
      task('plain')
    ];
    const out = applyTaskFilters(
      starred,
      { ...DEFAULT_FILTERS, status: 'any', system: 'include', favorites: 'only' },
      opts
    );
    expect(out.map(t => t.id)).toEqual(['mine-off', 'os']);
  });

  it('searches within the already-narrowed set', () => {
    const out = applyTaskFilters(tasks, { ...DEFAULT_FILTERS, search: 'native' }, opts);
    expect(out.map(t => t.id)).toEqual(['native']);
  });
});

describe('applyTaskFiltersExcept', () => {
  const now = at('2026-07-31T16:00:00Z');
  const opts = { now, timezone: 'America/Los_Angeles' as const };

  it('is applyTaskFilters when nothing is excluded', () => {
    const tasks = [task('a'), task('b', { status: 'DISABLED' })];
    expect(applyTaskFiltersExcept(tasks, DEFAULT_FILTERS, null, opts))
      .toEqual(applyTaskFilters(tasks, DEFAULT_FILTERS, opts));
  });

  it('drops only the named dimension, keeping every other one in force', () => {
    const tasks = [
      task('active-reports', { category: 'Reports' }),
      task('off-reports', { status: 'DISABLED', category: 'Reports' }),
      task('off-backups', { status: 'DISABLED', category: 'Backups' })
    ];
    // Excluding status must not also let the Backups task through.
    const out = applyTaskFiltersExcept(
      tasks,
      { ...DEFAULT_FILTERS, category: 'Reports' },
      'status',
      opts
    );
    expect(out.map(t => t.id)).toEqual(['active-reports', 'off-reports']);
  });

  /*
   * The regression this whole helper exists for.
   *
   * The status chip counts the population it governs. Counted over the raw list
   * it printed the dashboard's total — `Showing All 269` sitting directly above
   * the two rows the Favorites view was actually showing. The count has to be
   * taken within every other lens, because it is a promise about what clicking
   * will reveal.
   */
  it('counts the status population within the Favorites view, not across the dashboard', () => {
    const tasks = [
      task('star-on', { isFavorite: true }),
      task('star-off', { status: 'DISABLED', isFavorite: true }),
      ...Array.from({ length: 267 }, (_, i) => task(`crowd-${i}`, { status: 'DISABLED' }))
    ];
    const favorites = {
      ...DEFAULT_FILTERS,
      status: 'any' as const,
      system: 'include' as const,
      favorites: 'only' as const
    };

    const shown = applyTaskFilters(tasks, favorites, opts);
    const governed = applyTaskFiltersExcept(tasks, favorites, 'status', opts);

    // With status 'any' the chip prints the list's own length and hides nothing.
    expect(shown).toHaveLength(2);
    expect(governed).toHaveLength(2);
    expect(governed.length - shown.length).toBe(0);

    // Narrowing to active hides exactly one of the two starred tasks — not 267.
    const active = applyTaskFilters(tasks, { ...favorites, status: 'active' }, opts);
    const hidden = applyTaskFiltersExcept(tasks, { ...favorites, status: 'active' }, 'status', opts)
      .length - active.length;
    expect(hidden).toBe(1);
  });

  it('counts within the selected category, so the number predicts the click', () => {
    const tasks = [
      task('b-active', { category: 'Backups' }),
      task('b-off', { status: 'DISABLED', category: 'Backups' }),
      task('r-off-1', { status: 'DISABLED', category: 'Reports' }),
      task('r-off-2', { status: 'DISABLED', category: 'Reports' })
    ];
    const filters = { ...DEFAULT_FILTERS, category: 'Backups' };

    const shown = applyTaskFilters(tasks, filters, opts);
    const governed = applyTaskFiltersExcept(tasks, filters, 'status', opts);

    // Clicking the chip reveals the one disabled Backups task, so "1 hidden" is
    // the only honest number here — the two Reports rows are not on offer.
    expect(governed.length - shown.length).toBe(1);
  });
});

describe('activeFilterCount', () => {
  it('is zero for the default question', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });

  it('counts each dimension that has moved', () => {
    // The number on the Filters trigger. A closed drawer over a filtered list
    // would be the invisible fence with a nicer lid, so the count is what stops
    // the collapse from hiding *that* filters are set.
    expect(activeFilterCount({ ...DEFAULT_FILTERS, status: 'any' })).toBe(1);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, status: 'any', due: 'today' })).toBe(2);
    expect(
      activeFilterCount({ ...DEFAULT_FILTERS, status: 'any', system: 'include', outcome: 'failing' })
    ).toBe(3);
  });

  it('counts none of the three dimensions the rail owns', () => {
    // The badge may only describe what its own drawer can clear. Source has
    // never been in the popover; category left it for the rail's second level,
    // and favorites left the views bar for a rail row. Counting any of them
    // would put a "1 filter" badge on a drawer with nothing set in it.
    expect(activeFilterCount({ ...DEFAULT_FILTERS, category: 'Backups' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, favorites: 'only' })).toBe(0);
    expect(
      activeFilterCount({
        ...DEFAULT_FILTERS,
        category: 'Backups',
        source: 'CLAUDE_CODE',
        favorites: 'only',
        due: 'today'
      })
    ).toBe(1);
  });

  it('measures against a supplied baseline, so the All view reads 0', () => {
    // The badge counts what you added *on top of the view you are on*. Compared
    // to DEFAULT_FILTERS the All view — the widest possible state, withholding
    // nothing — lit the badge with 2 while the withheld chips beside it
    // correctly showed nothing hidden. A badge that fires when nothing is
    // constrained is one people learn to ignore, which costs the case it exists
    // for.
    const allView = { ...DEFAULT_FILTERS, status: 'any' as const, system: 'include' as const };
    expect(activeFilterCount(allView)).toBe(2);            // vs the dashboard default
    expect(activeFilterCount(allView, allView)).toBe(0);   // vs the view you are on
    // A dimension the drawer still owns moves the badge; category no longer does.
    expect(activeFilterCount({ ...allView, due: 'today' }, allView)).toBe(1);
    expect(activeFilterCount({ ...allView, category: 'Backups' }, allView)).toBe(0);
    expect(activeFilterCount({ ...allView, favorites: 'only' }, allView)).toBe(0);
  });

  it('ignores whitespace-only search, like filtersEqual does', () => {
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: '   ' })).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, search: 'nightly' })).toBe(1);
  });
});

describe('withheldBy', () => {
  /*
   * The rule: a lens that names itself needs no count; a lens that withholds
   * silently must print one. Category and platform get their own pills, so they
   * are absent here by design. System and status are *defaults* nobody chose
   * today, and they are the ones that quietly hold back 189 and 10 rows.
   */
  it('reports the two silent lenses, with what each is holding back', () => {
    const out = withheldBy(DEFAULT_FILTERS, { system: 189, status: 10 });
    expect(out).toEqual([
      { dimension: 'system', count: 189, label: 'system' },
      { dimension: 'status', count: 10, label: 'inactive' }
    ]);
  });

  it('says nothing when a lens is withholding nothing', () => {
    expect(withheldBy(DEFAULT_FILTERS, { system: 0, status: 0 })).toEqual([]);
  });

  it('says nothing once the user has opened each lens up', () => {
    // Including system tasks, or showing every status, means that lens is no
    // longer keeping anything from you — so claiming otherwise would be noise.
    const open = { ...DEFAULT_FILTERS, system: 'include' as const, status: 'any' as const };
    expect(withheldBy(open, { system: 189, status: 10 })).toEqual([]);
  });

  it('does not report an isolating lens as withholding', () => {
    // `disabled`/`missing` isolate rather than hide — the user asked for exactly
    // those rows by name, and the chip already says so.
    const isolated = { ...DEFAULT_FILTERS, status: 'disabled' as const };
    expect(withheldBy(isolated, { system: 0, status: 10 })).toEqual([]);
  });
});

describe('matchesSource — the outer lens', () => {
  it('matches everything under All', () => {
    expect(matchesSource(task('a', { source: 'TASKHUB_NATIVE:EXEC' }), 'All')).toBe(true);
  });

  it('matches subtypes under their bare platform', () => {
    // What makes splitting Cronsole-native safe: a persisted `defaultPlatform`
    // or a saved link naming the platform keeps working now that sources are
    // finer than platforms. Without the prefix rule it would silently match
    // nothing, and every stored preference pointing at native would empty.
    expect(matchesSource(task('a', { source: 'TASKHUB_NATIVE:HTTP' }), 'TASKHUB_NATIVE')).toBe(true);
    expect(matchesSource(task('b', { source: 'TASKHUB_NATIVE:EXEC' }), 'TASKHUB_NATIVE')).toBe(true);
  });

  it('separates the two native sources from each other', () => {
    expect(matchesSource(task('a', { source: 'TASKHUB_NATIVE:EXEC' }), 'TASKHUB_NATIVE:HTTP')).toBe(false);
  });

  it('falls back to platform when the server sent no source', () => {
    // An older backend degrades to platform-level sources rather than to nothing
    // matching, which would render an empty dashboard for every user mid-deploy.
    expect(matchesSource(task('a', { platform: 'WINDOWS_TASK_SCHEDULER' }), 'WINDOWS_TASK_SCHEDULER')).toBe(true);
  });

  it('is a prefix rule, not a substring rule', () => {
    expect(matchesSource(task('a', { source: 'TASKHUB_NATIVE_V2' }), 'TASKHUB_NATIVE')).toBe(false);
  });
});

describe('windowsSubfolderPath', () => {
  it('is empty for a task directly in its root folder', () => {
    expect(windowsSubfolderPath(task('a', { externalId: '\\Backup\\a' }))).toEqual([]);
  });

  it('returns every segment between the root folder and the task name', () => {
    expect(windowsSubfolderPath(task('a', { externalId: '\\Backup\\Old\\Nightly\\a' })))
      .toEqual(['Old', 'Nightly']);
  });

  it('is empty for an id with no folder at all', () => {
    expect(windowsSubfolderPath(task('a', { externalId: '\\a' }))).toEqual([]);
  });

  it('is empty for a non-Windows id, no platform check needed', () => {
    expect(windowsSubfolderPath(task('a', { platform: 'CLAUDE_CODE', externalId: 'trig_abc123' })))
      .toEqual([]);
  });
});

describe('matchesFolderPath', () => {
  it('matches everything under All', () => {
    expect(matchesFolderPath(task('a', { externalId: '\\Backup\\Old\\a' }), 'All')).toBe(true);
  });

  it('matches the exact subfolder', () => {
    expect(matchesFolderPath(task('a', { externalId: '\\Backup\\Old\\a' }), 'Old')).toBe(true);
  });

  it('matches a descendant of the selected subfolder', () => {
    expect(matchesFolderPath(task('a', { externalId: '\\Backup\\Old\\Nightly\\a' }), 'Old')).toBe(true);
  });

  it('does not match a sibling that merely shares a prefix', () => {
    // "Back" must not match "Backups" — a segment boundary, not a substring.
    expect(matchesFolderPath(task('a', { externalId: '\\Root\\Backups\\a' }), 'Back')).toBe(false);
  });

  it('does not match a task with no subfolder', () => {
    expect(matchesFolderPath(task('a', { externalId: '\\Backup\\a' }), 'Old')).toBe(false);
  });
});

describe('filtersEqual', () => {
  it('ignores surrounding whitespace in the search term', () => {
    expect(filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, search: '   ' })).toBe(true);
  });

  it('separates every dimension the view bar owns', () => {
    // A view is named by an exact filter match, so a dimension this misses would
    // light up the wrong chip over the wrong list.
    const variants: Partial<typeof DEFAULT_FILTERS>[] = [
      { status: 'any' }, { system: 'only' }, { outcome: 'failing' },
      { due: 'today' }, { search: 'x' }
    ];
    for (const v of variants) {
      expect(filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, ...v })).toBe(false);
    }
  });

  it('ignores all three dimensions the source rail owns', () => {
    // Source, category and favorites are navigation. Picking a system, a folder
    // or the starred scope must not drop the view bar to "Custom", because none
    // is a *hidden* constraint — the rail row is lit, the heading names the
    // source and the breadcrumb names the folder. Each joined this list as the
    // rail took it over; before that each lived somewhere hidden (the Filters
    // popover, the views bar) and was genuinely disqualifying.
    const rail: Partial<typeof DEFAULT_FILTERS>[] = [
      { source: 'WINDOWS_TASK_SCHEDULER' },
      { category: 'Backup' },
      { favorites: 'only' },
      { source: 'TASKHUB_NATIVE:EXEC', category: 'Reports', favorites: 'only' }
    ];
    for (const v of rail) {
      expect(filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, ...v })).toBe(true);
    }
  });

  it('does NOT separate source — it is the outer lens', () => {
    // Deliberate, and the one exception. Source has its own always-visible bar
    // above the view bar, so "Failures" and "Failures, Windows only" are the
    // same question asked of different sources and the view chip stays lit for
    // both. The rule this bends is about *hidden* constraints; a selected
    // button one line above the chip is not hidden.
    expect(
      filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' })
    ).toBe(true);
  });
});

describe('matchesCollection', () => {
  const now = new Date('2026-08-16T00:00:00Z');
  const opts = { now, timezone: 'utc' as const };

  it("passes everything when the lens is 'All'", () => {
    expect(matchesCollection(task('a'), 'All')).toBe(true);
  });

  it('matches on declared membership, not on any property of the task', () => {
    // The distinguishing feature of this dimension: two tasks identical in every
    // filterable respect can differ here, and two tasks with nothing in common
    // can match together.
    const inSet = task('a', { collectionIds: ['c1'] });
    const notInSet = task('b');
    expect(matchesCollection(inSet, 'c1')).toBe(true);
    expect(matchesCollection(notInSet, 'c1')).toBe(false);
  });

  it('reads a missing collectionIds as "in nothing", never as meaningful', () => {
    // Same wire rule as isFavorite/isSystem: an older backend that sends no
    // field degrades to "not a member" rather than matching everything.
    expect(matchesCollection(task('a'), 'c1')).toBe(false);
  });

  it('spans platforms — the reason collections exist', () => {
    const claudeTask = task('a', { platform: 'CLAUDE_CODE', collectionIds: ['c1'] });
    const windowsTask = task('b', { platform: 'WINDOWS_TASK_SCHEDULER', collectionIds: ['c1'] });
    const other = task('c', { platform: 'WINDOWS_TASK_SCHEDULER' });

    const got = applyTaskFilters(
      [claudeTask, windowsTask, other],
      { ...DEFAULT_FILTERS, collection: 'c1' },
      opts
    );
    expect(got.map(t => t.id)).toEqual(['a', 'b']);
  });

  it('is a dimension applyTaskFiltersExcept can leave out', () => {
    // What a rail count is taken over: every other lens, this one neutralized.
    const tasks = [
      task('a', { collectionIds: ['c1'] }),
      task('b'),
      task('c', { status: 'DISABLED', collectionIds: ['c1'] })
    ];
    const filters = { ...DEFAULT_FILTERS, collection: 'c1' };

    expect(applyTaskFilters(tasks, filters, opts).map(t => t.id)).toEqual(['a']);
    // Leaving it out counts the alternatives — without which a collection row's
    // count could never exceed what the collection already shows.
    expect(
      applyTaskFiltersExcept(tasks, filters, 'collection', opts).map(t => t.id)
    ).toEqual(['a', 'b']);
  });

  it('is not counted by the Filters badge, and does not drop a view to Custom', () => {
    // It is a rail dimension: displayed by the rail, cleared by the rail. Both
    // of these functions exclude it by OMISSION, which is easy to "fix" wrongly.
    const withCollection = { ...DEFAULT_FILTERS, collection: 'c1' };
    expect(activeFilterCount(withCollection)).toBe(0);
    expect(filtersEqual(withCollection, DEFAULT_FILTERS)).toBe(true);
  });
});
