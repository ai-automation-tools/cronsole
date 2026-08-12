import { describe, it, expect } from 'vitest';
import type { Task } from '../../types';
import type { HealthTier } from '../taskFilters';
import {
  chunk,
  DEFAULT_SCOPE,
  defaultScopeValue,
  describeScope,
  detachedByCategorize,
  eligibleFor,
  inverseOf,
  MAX_TASKS_PER_BULK,
  needsTypedConfirmation,
  resolveScope,
  TYPE_TO_CONFIRM_THRESHOLD
} from '../massActions';

const task = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  name: `Task ${id}`,
  externalId: `\\Cronsole\\${id}`,
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Backups',
  updatedAt: '2026-08-12T12:00:00Z',
  metadata: {},
  ...over
});

const platformName = (id: string) => (id === 'WINDOWS_TASK_SCHEDULER' ? 'Windows Task Scheduler' : id);

describe('resolveScope', () => {
  const tasks = [
    task('mine'),
    task('reports', { category: 'Reports' }),
    task('os', { isSystem: true, category: 'Microsoft' }),
    task('native', { platform: 'TASKHUB_NATIVE', category: 'Reports' }),
    task('off', { status: 'DISABLED' })
  ];

  // These two are about the system fence, so they name the scope kind
  // explicitly rather than leaning on DEFAULT_SCOPE — which is `category`, and
  // whose job is a different question (see the `defaultScopeValue` block below).
  const allScope = { kind: 'all' as const, value: '', includeSystem: false };

  it('excludes system tasks by default and says how many', () => {
    // The fence exists so a machine-wide scope isn't dominated by ~257 tasks
    // the user will never act on — but an invisible fence is indistinguishable
    // from an empty one, so the count is part of the answer, not a footnote.
    const { tasks: out, systemExcluded } = resolveScope(tasks, allScope);
    expect(out.map(t => t.id)).toEqual(['mine', 'reports', 'native', 'off']);
    expect(systemExcluded).toBe(1);
  });

  it('includes system tasks when asked, and then excludes nothing', () => {
    const { tasks: out, systemExcluded } = resolveScope(tasks, {
      ...allScope,
      includeSystem: true
    });
    expect(out).toHaveLength(5);
    expect(systemExcluded).toBe(0);
  });

  it('scopes by category, platform and status', () => {
    const byCategory = resolveScope(tasks, { kind: 'category', value: 'Reports', includeSystem: false });
    expect(byCategory.tasks.map(t => t.id)).toEqual(['reports', 'native']);

    const byPlatform = resolveScope(tasks, {
      kind: 'platform',
      value: 'TASKHUB_NATIVE',
      includeSystem: false
    });
    expect(byPlatform.tasks.map(t => t.id)).toEqual(['native']);

    const byStatus = resolveScope(tasks, { kind: 'status', value: 'DISABLED', includeSystem: false });
    expect(byStatus.tasks.map(t => t.id)).toEqual(['off']);
  });

  it('treats a task with no health verdict as unknown, never as healthy', () => {
    // Absence of evidence is `unknown`. A scope that swept unscanned tasks into
    // "healthy" would be acting on a guess — and acting is the point of this
    // surface, which is exactly why the guess is not affordable here.
    const tiers = new Map<string, HealthTier>([['mine', 'critical']]);
    const critical = resolveScope(tasks, { kind: 'health', value: 'critical', includeSystem: false }, tiers);
    expect(critical.tasks.map(t => t.id)).toEqual(['mine']);

    const ok = resolveScope(tasks, { kind: 'health', value: 'ok', includeSystem: false }, tiers);
    expect(ok.tasks).toEqual([]);

    const unknown = resolveScope(tasks, { kind: 'health', value: 'unknown', includeSystem: false }, tiers);
    expect(unknown.tasks.map(t => t.id)).toEqual(['reports', 'native', 'off']);
  });

  it('survives an unloaded task list', () => {
    expect(resolveScope(undefined, allScope)).toEqual({ tasks: [], systemExcluded: 0 });
  });
});

describe('DEFAULT_SCOPE and defaultScopeValue', () => {
  it('opens on a category rather than on every task', () => {
    // A mass action pointed at everything makes the widest possible operation
    // the path of least resistance — you would have to narrow it to do the
    // ordinary thing. Category is how these tasks are already organised.
    expect(DEFAULT_SCOPE.kind).toBe('category');
    expect(DEFAULT_SCOPE.includeSystem).toBe(false);
  });

  it('leaves the default value empty, because it cannot be known statically', () => {
    // The categories come from the loaded task list. This is exactly why the
    // console must go through defaultScopeValue rather than using the literal:
    // a category scope with an empty value resolves to NOTHING, which would
    // read as "there are no tasks here" the moment you open an action.
    expect(DEFAULT_SCOPE.value).toBe('');
    expect(resolveScope([task('a', { category: 'Backups' })], DEFAULT_SCOPE).tasks).toEqual([]);
  });

  it('picks a starting value that exists for every kind', () => {
    const opts = { categories: ['AI-Maintenance', 'Backups'], platforms: ['WINDOWS_TASK_SCHEDULER'] };
    expect(defaultScopeValue('category', opts)).toBe('AI-Maintenance');
    expect(defaultScopeValue('platform', opts)).toBe('WINDOWS_TASK_SCHEDULER');
    expect(defaultScopeValue('status', opts)).toBe('ACTIVE');
    expect(defaultScopeValue('health', opts)).toBe('critical');
    expect(defaultScopeValue('all', opts)).toBe('');
  });

  it('degrades to empty rather than throwing when the machine has none', () => {
    const empty = { categories: [], platforms: [] };
    expect(defaultScopeValue('category', empty)).toBe('');
    expect(defaultScopeValue('platform', empty)).toBe('');
  });
});

describe('eligibleFor', () => {
  const tasks = [
    task('on'),
    task('off', { status: 'DISABLED' }),
    task('gone', { status: 'MISSING' }),
    task('native', { platform: 'TASKHUB_NATIVE' })
  ];

  it('counts what each verb would actually change, not the scope size', () => {
    // The same rule the server's `unchanged` outcome exists for: calling a
    // 3-task operation a 47-task one inflates the number in the direction that
    // erodes trust in every other number here.
    // 'native' is ACTIVE, so it is a no-op for enable and real work for disable.
    expect(eligibleFor(tasks, 'enable').map(t => t.id)).toEqual(['off']);
    expect(eligibleFor(tasks, 'disable').map(t => t.id)).toEqual(['on', 'native']);
  });

  it('refuses to enable a MISSING task — the platform already lost it', () => {
    expect(eligibleFor(tasks, 'enable').map(t => t.id)).not.toContain('gone');
    expect(eligibleFor(tasks, 'disable').map(t => t.id)).not.toContain('gone');
  });

  it('cannot untrack a Cronsole-native task, whose row is the task', () => {
    expect(eligibleFor(tasks, 'untrack').map(t => t.id)).toEqual(['on', 'off', 'gone']);
  });

  it('exports only Windows tasks as native XML', () => {
    expect(eligibleFor(tasks, 'export').map(t => t.id)).toEqual(['on', 'off', 'gone']);
  });

  it('lets categorize touch everything — nothing can refuse a label', () => {
    expect(eligibleFor(tasks, 'categorize')).toHaveLength(4);
  });
});

describe('detachedByCategorize', () => {
  it('counts the Windows tasks whose folder would stop matching their category', () => {
    // Stated before the click, because a warning delivered with the result
    // arrives too late to change the decision it was about.
    const tasks = [
      task('a', { category: 'Backups' }),
      task('b', { category: 'Reports' }),
      task('c', { platform: 'TASKHUB_NATIVE', category: 'Reports' })
    ];
    // 'b' moves away from its folder; 'a' is already there; 'c' is native and
    // has no Task Scheduler folder to disagree with.
    expect(detachedByCategorize(tasks, 'Backups')).toBe(1);
  });
});

describe('chunk', () => {
  it('splits at the server ceiling and loses nothing', () => {
    const items = Array.from({ length: 250 }, (_, i) => i);
    const batches = chunk(items);
    expect(batches.map(b => b.length)).toEqual([100, 100, 50]);
    expect(batches.flat()).toEqual(items);
  });

  it('returns no batches for an empty list', () => {
    expect(chunk([])).toEqual([]);
  });

  it('keeps a batch that exactly fills the ceiling as one request', () => {
    expect(chunk(Array.from({ length: MAX_TASKS_PER_BULK }, (_, i) => i))).toHaveLength(1);
  });

  it('rejects a nonsense size rather than looping forever', () => {
    expect(() => chunk([1, 2, 3], 0)).toThrow(/at least 1/);
  });
});

describe('needsTypedConfirmation', () => {
  it('hardens the dialog as the blast radius grows', () => {
    // The gap this closes: the confirm for 254 tasks used to be the same dialog
    // as the confirm for 3, so nothing about the operation got harder as it got
    // bigger.
    expect(needsTypedConfirmation(3)).toBe(false);
    expect(needsTypedConfirmation(TYPE_TO_CONFIRM_THRESHOLD - 1)).toBe(false);
    expect(needsTypedConfirmation(TYPE_TO_CONFIRM_THRESHOLD)).toBe(true);
    expect(needsTypedConfirmation(254)).toBe(true);
  });
});

describe('describeScope', () => {
  it('produces something a confirmation dialog can be read back from', () => {
    // This is the string `254 selected` could not say, and the reason the
    // console is scope-first at all.
    expect(describeScope({ kind: 'category', value: 'Backups', includeSystem: false }, platformName))
      .toBe('the "Backups" category');
    expect(describeScope({ kind: 'platform', value: 'WINDOWS_TASK_SCHEDULER', includeSystem: false }, platformName))
      .toBe('Windows Task Scheduler');
    expect(describeScope({ kind: 'health', value: 'unknown', includeSystem: false }, platformName))
      .toBe('tasks with no health evidence');
  });

  it('distinguishes an all-scope that includes the OS from one that does not', () => {
    expect(describeScope({ kind: 'all', value: '', includeSystem: false }, platformName))
      .toBe('every tracked task of yours');
    expect(describeScope({ kind: 'all', value: '', includeSystem: true }, platformName))
      .toBe('every tracked task');
  });
});

describe('inverseOf', () => {
  it('inverts status and nothing else', () => {
    // Untrack's undo is a re-import; categorize's would need the prior
    // categories stored. Promising a general undo to advertise the one that
    // works is how a safety feature becomes a lie.
    expect(inverseOf('enable')).toBe('disable');
    expect(inverseOf('disable')).toBe('enable');
    expect(inverseOf('untrack')).toBeNull();
    expect(inverseOf('categorize')).toBeNull();
    expect(inverseOf('export')).toBeNull();
  });
});
