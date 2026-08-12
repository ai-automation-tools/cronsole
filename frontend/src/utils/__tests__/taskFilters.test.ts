import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import {
  applyTaskFilters,
  DEFAULT_FILTERS,
  effectiveFilters,
  filtersEqual,
  matchesDue,
  matchesFavorites,
  matchesOutcome,
  matchesStatus,
  matchesSystem,
  needsHealthData,
  nextRunOf,
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
    task('native', { platform: 'TASKHUB_NATIVE', category: 'Reports' })
  ];

  it('defaults to active personal tasks', () => {
    expect(applyTaskFilters(tasks, DEFAULT_FILTERS, opts).map(t => t.id))
      .toEqual(['mine-active', 'native']);
  });

  it('composes every dimension', () => {
    const out = applyTaskFilters(
      tasks,
      { ...DEFAULT_FILTERS, status: 'any', platform: 'TASKHUB_NATIVE', category: 'Reports' },
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

describe('filtersEqual', () => {
  it('ignores surrounding whitespace in the search term', () => {
    expect(filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, search: '   ' })).toBe(true);
  });

  it('separates every dimension', () => {
    // A view is named by an exact filter match, so a dimension this misses would
    // light up the wrong chip over the wrong list.
    const variants: Partial<typeof DEFAULT_FILTERS>[] = [
      { status: 'any' }, { system: 'only' }, { outcome: 'failing' },
      { due: 'today' }, { favorites: 'only' }, { platform: 'WINDOWS_TASK_SCHEDULER' },
      { category: 'Backup' }, { search: 'x' }
    ];
    for (const v of variants) {
      expect(filtersEqual(DEFAULT_FILTERS, { ...DEFAULT_FILTERS, ...v })).toBe(false);
    }
  });
});
