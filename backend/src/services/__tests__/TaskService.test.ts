import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService } from '../TaskService.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      updateMany: vi.fn()
    },
    executionLog: {
      deleteMany: vi.fn()
    },
    taskExclusion: {
      findMany: vi.fn(),
      deleteMany: vi.fn()
    },
    // Real $transaction resolves the batched operations; mirror that so
    // upsertTasks gets values back, not promises.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops))
  }
}));

/**
 * Stub the client, keep the **real** enums.
 *
 * These used to be hand-written partial copies — `PlatformType` listed only
 * `WINDOWS_TASK_SCHEDULER`. A partial enum does not fail loudly: any code
 * branching on a platform the copy omits compares against `undefined`, silently
 * takes the else-branch, and the test asserts the wrong answer confidently while
 * production does the right thing. That is exactly how `extractCategory`'s
 * Claude branch read as broken here while returning `Claude` against the live
 * server. `importActual` keeps the generated enums in sync by construction —
 * they are plain string constants and need no database.
 */
vi.mock('@prisma/client', async importActual => {
  const actual = await importActual<typeof import('@prisma/client')>();
  return {
    ...actual,
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    }
  };
});

const WIN = 'WINDOWS_TASK_SCHEDULER' as any;

describe('TaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.task.count.mockResolvedValue(3);
  });

  it('should extract root folder as category for Windows tasks', async () => {
    const externalId = '\\Folder\\Subfolder\\MyTask';
    const category = (TaskService as any).extractCategory(externalId, 'WINDOWS_TASK_SCHEDULER');
    expect(category).toBe('Folder');
  });

  it('should return Uncategorized for top-level Windows tasks', () => {
    const externalId = '\\MyTask';
    const category = (TaskService as any).extractCategory(externalId, 'WINDOWS_TASK_SCHEDULER');
    expect(category).toBe('Uncategorized');
  });

  it('files a Claude routine under Claude, not Uncategorized', () => {
    // A trig_ id has no path to derive a folder from, but Import is where the
    // user picks which categories to track — and a routine they typed into the
    // Platforms tab by hand has to be findable under a name that means
    // something. Uncategorized would also mix it in with unrelated tasks.
    expect((TaskService as any).extractCategory('trig_01ABC', 'CLAUDE_CODE')).toBe('Claude');
  });

  it('files a GitHub workflow under its repository', () => {
    // The repository is the level-2 grouping the rail draws and the unit the
    // Import screen offers — you track `owner/repo`, never a single workflow.
    // Read out of the id rather than stored beside it, exactly as a Windows
    // folder is: the id is what survives a rename.
    expect((TaskService as any).extractCategory('acme/website#42', 'GITHUB_ACTIONS')).toBe('acme/website');
  });

  it('does not guess a repository out of a malformed GitHub id', () => {
    // Uncategorized is the honest bucket. Inventing one would file the row under
    // a category no rail node can reach.
    expect((TaskService as any).extractCategory('42', 'GITHUB_ACTIONS')).toBe('Uncategorized');
  });

  it('should upsert tasks with initial category', async () => {
    const tasks = [
      { externalId: '\\Mikes\\Task1', name: 'Task 1', status: 'ACTIVE' as const }
    ];
    
    mockPrisma.task.upsert.mockResolvedValue({ id: '1' });

    await TaskService.upsertTasks('user-1', 'WINDOWS_TASK_SCHEDULER' as any, tasks);

    expect(mockPrisma.task.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        category: 'Mikes'
      })
    }));
  });

  it('sets the name on create but never on update, so a rename survives sync', async () => {
    // This one line was the whole reason renaming a task was not offered: sync
    // wrote `name` back from the platform on every pass, so a Cronsole-side
    // rename silently reverted minutes later.
    //
    // Removing it costs nothing, and the reason is structural rather than a
    // preference: no platform can supply a NEW name for an EXISTING row. A
    // Windows task's name is the last segment of its path, and the path is
    // `externalId` — the key this upsert matches on. So renaming on the machine
    // produces a different task (old path MISSING, new path imported), never a
    // new name on this one. Measured before shipping: 354 Windows tasks, zero
    // whose stored name differed from their path leaf.
    //
    // Same protection `category` has had since the beginning, and for the same
    // reason: both are Cronsole labels, and a sync must not undo a user's edit.
    const tasks = [
      { externalId: '\\Mikes\\Task1', name: 'Task 1', status: 'ACTIVE' as const }
    ];

    mockPrisma.task.upsert.mockResolvedValue({ id: '1' });

    await TaskService.upsertTasks('user-1', 'WINDOWS_TASK_SCHEDULER' as any, tasks);

    const call = mockPrisma.task.upsert.mock.calls[0][0];
    expect(call.create.name).toBe('Task 1');
    expect(call.update).not.toHaveProperty('name');
    // The pairing matters: status and metadata are platform facts and MUST keep
    // refreshing, so this is not "stop updating on sync", it is "labels are ours".
    expect(call.update).toHaveProperty('status');
    expect(call.update).not.toHaveProperty('category');
  });

  it('should store derived schedule and nextRunTime on create and update', async () => {
    const next = new Date('2026-07-09T03:00:00Z');
    const tasks = [
      { externalId: '\\Cronsole\\Nightly', name: 'Nightly', status: 'ACTIVE' as const, schedule: '0 3 * * *', nextRunTime: next }
    ];

    mockPrisma.task.upsert.mockResolvedValue({ id: '1' });

    await TaskService.upsertTasks('user-1', 'WINDOWS_TASK_SCHEDULER' as any, tasks);

    expect(mockPrisma.task.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ schedule: '0 3 * * *', nextRunTime: next }),
      update: expect.objectContaining({ schedule: '0 3 * * *', nextRunTime: next })
    }));
  });

  it('should not overwrite an existing schedule with a null conversion on update', async () => {
    const tasks = [
      { externalId: '\\Complex', name: 'Complex', status: 'ACTIVE' as const, schedule: null, nextRunTime: null }
    ];

    mockPrisma.task.upsert.mockResolvedValue({ id: '1' });

    await TaskService.upsertTasks('user-1', 'WINDOWS_TASK_SCHEDULER' as any, tasks);

    const call = mockPrisma.task.upsert.mock.calls[0][0];
    expect(call.update).not.toHaveProperty('schedule'); // preserved
    expect(call.update.nextRunTime).toBeNull();          // live value still refreshed
    expect(call.create.schedule).toBeNull();
  });

  it('should batch upserts into bounded transactions and preserve order', async () => {
    const tasks = Array.from({ length: 250 }, (_, i) => ({
      externalId: `\\Batch\\Task${i}`,
      name: `Task ${i}`,
      status: 'ACTIVE' as const
    }));
    mockPrisma.task.upsert.mockImplementation(
      async (args: any) => ({ externalId: args.where.platform_externalId.externalId })
    );

    const results = await TaskService.upsertTasks('user-1', 'WINDOWS_TASK_SCHEDULER' as any, tasks);

    // 250 ops → 3 transactions (100 + 100 + 50), one round trip each.
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mockPrisma.$transaction.mock.calls.map(c => c[0].length)).toEqual([100, 100, 50]);
    expect(results).toHaveLength(250);
    expect(results[0]).toEqual({ externalId: '\\Batch\\Task0' });
    expect(results[249]).toEqual({ externalId: '\\Batch\\Task249' });
  });

  it('marks tasks absent from the platform as MISSING instead of deleting them', async () => {
    // The honesty fix: absence from one sync is not proof a task is gone (an
    // offline agent looks identical), so the row and its execution history are
    // KEPT and flipped to MISSING with nextRunTime cleared — never deleted.
    mockPrisma.task.count.mockResolvedValue(3);
    mockPrisma.task.findMany.mockResolvedValue([
      { externalId: '\\Mikes\\GoneOne' },
      { externalId: '\\Other\\GoneTwo' }
    ]);
    mockPrisma.task.updateMany.mockResolvedValue({ count: 2 });

    const { count, concentrated } = await TaskService.reconcileMissingTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      ['\\Mikes\\StillExists']
    );

    expect(count).toBe(2);
    expect(concentrated).toBe(false); // too few rows to judge — under MISSING_CLUSTER_MIN_COUNT
    expect(mockPrisma.task.updateMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        platform: 'WINDOWS_TASK_SCHEDULER',
        externalId: { notIn: ['\\Mikes\\StillExists'] },
        status: { not: 'MISSING' }
      },
      data: { status: 'MISSING', nextRunTime: null }
    });
    // The row and its logs must survive — a MISSING task self-heals on re-sync.
    expect(mockPrisma.task.deleteMany).not.toHaveBeenCalled();
    expect(mockPrisma.executionLog.deleteMany).not.toHaveBeenCalled();
  });

  it('flags a MISSING batch concentrated in one folder while other folders came through untouched', async () => {
    mockPrisma.task.count.mockResolvedValue(10);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([
        { externalId: '\\Locked\\One' },
        { externalId: '\\Locked\\Two' },
        { externalId: '\\Locked\\Three' }
      ])
      // trackedCategories' own findMany — three folders exist, only one lost anything.
      .mockResolvedValueOnce([
        { externalId: '\\Locked\\One' },
        { externalId: '\\Locked\\Two' },
        { externalId: '\\Locked\\Three' },
        { externalId: '\\Fine\\StillHere' },
        { externalId: '\\AlsoFine\\StillHere' }
      ]);
    mockPrisma.task.updateMany.mockResolvedValue({ count: 3 });

    const { count, concentrated, categories } = await TaskService.reconcileMissingTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      ['\\Fine\\StillHere', '\\AlsoFine\\StillHere']
    );

    expect(count).toBe(3);
    expect(concentrated).toBe(true);
    expect(categories).toEqual([{ category: 'Locked', missingCount: 3 }]);
  });

  it('does not flag scattered attrition spread evenly across every tracked folder', async () => {
    mockPrisma.task.count.mockResolvedValue(10);
    mockPrisma.task.findMany
      .mockResolvedValueOnce([
        { externalId: '\\A\\Gone' },
        { externalId: '\\B\\Gone' },
        { externalId: '\\C\\Gone' }
      ])
      // trackedCategories: only these same three folders exist — nothing came
      // through untouched, so this reads as ordinary attrition, not a cluster.
      .mockResolvedValueOnce([
        { externalId: '\\A\\Gone' },
        { externalId: '\\B\\Gone' },
        { externalId: '\\C\\Gone' }
      ]);
    mockPrisma.task.updateMany.mockResolvedValue({ count: 3 });

    const { concentrated } = await TaskService.reconcileMissingTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      []
    );

    expect(concentrated).toBe(false);
  });

  it('does not re-mark rows that are already MISSING (the where-clause excludes them)', async () => {
    mockPrisma.task.count.mockResolvedValue(3);
    mockPrisma.task.findMany.mockResolvedValue([]);
    mockPrisma.task.updateMany.mockResolvedValue({ count: 0 });

    const { count } = await TaskService.reconcileMissingTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      ['\\Mikes\\StillExists']
    );

    expect(count).toBe(0);
    expect(mockPrisma.task.updateMany.mock.calls[0][0].where.status).toEqual({ not: 'MISSING' });
  });

  it('skips reconciliation when the platform snapshot is empty', async () => {
    const { count } = await TaskService.reconcileMissingTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      []
    );

    expect(count).toBe(0);
    expect(mockPrisma.task.count).not.toHaveBeenCalled();
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('skips reconciliation when an established platform returns a suspicious partial snapshot', async () => {
    // A whole-dashboard flip to MISSING on a partial sync is alarming noise —
    // preserve the DB and wait for a complete snapshot even though MISSING is
    // reversible.
    mockPrisma.task.count.mockResolvedValue(100);

    const { count } = await TaskService.reconcileMissingTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      ['\\Only\\OneTask']
    );

    expect(count).toBe(0);
    expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to reconcile when the generated client lacks MISSING, instead of reporting a false count', async () => {
    // The nine-day silent bug (troubleshooting #22): a stale container client
    // makes TaskStatus.MISSING `undefined`, Prisma drops the field from `data`,
    // and updateMany still returns a count — so the sync reported "56 marked
    // MISSING" while marking none and merely clearing nextRunTime. Refusing is
    // the only honest option; a wrong number is worse than an error.
    const { TaskStatus } = await import('@prisma/client');
    const saved = (TaskStatus as Record<string, string>).MISSING;
    delete (TaskStatus as Record<string, string>).MISSING;
    try {
      mockPrisma.task.updateMany.mockResolvedValue({ count: 56 });

      await expect(
        TaskService.reconcileMissingTasks('user-1', 'WINDOWS_TASK_SCHEDULER' as any, ['\\Still\\Here'])
      ).rejects.toThrow(/stale.*TaskStatus\.MISSING is undefined/s);

      // Critically: it must not have written at all — a partial write that
      // clears nextRunTime while leaving status alone is the corruption itself.
      expect(mockPrisma.task.updateMany).not.toHaveBeenCalled();
    } finally {
      (TaskStatus as Record<string, string>).MISSING = saved;
    }
  });

  describe('trackedCategories', () => {
    it('derives the set from native paths, ignoring a renamed stored category', async () => {
      // The regression this exists for: a caller that echoed stored `category`
      // values back as the sync filter sent names matching no folder, so the
      // folder silently stopped syncing — no new tasks, no refresh, no error.
      mockPrisma.task.findMany.mockResolvedValue([
        { externalId: '\\Edge-Radar\\NightlySettle', category: 'Betting' },
        { externalId: '\\AI-Maintenance\\Update Guides', category: 'Chores' }
      ]);

      const cats = await TaskService.trackedCategories('user-1', 'WINDOWS_TASK_SCHEDULER' as any);

      expect(cats.sort()).toEqual(['AI-Maintenance', 'Edge-Radar']);
      expect(cats).not.toContain('Betting');
      expect(cats).not.toContain('Chores');
    });

    it('deduplicates folders and maps root-level tasks to Uncategorized', async () => {
      mockPrisma.task.findMany.mockResolvedValue([
        { externalId: '\\Edge-Radar\\A' },
        { externalId: '\\Edge-Radar\\B' },
        { externalId: '\\Edge-Radar\\Nested\\C' },
        { externalId: '\\RootLevelTask' }
      ]);

      const cats = await TaskService.trackedCategories('user-1', 'WINDOWS_TASK_SCHEDULER' as any);

      expect(cats.sort()).toEqual(['Edge-Radar', 'Uncategorized']);
    });

    it('returns an empty set when nothing is tracked — sync nothing, not everything', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      const cats = await TaskService.trackedCategories('user-1', 'WINDOWS_TASK_SCHEDULER' as any);

      // The route filters on `include !== undefined`, so [] must stay [] rather
      // than becoming a falsy "no filter" that would sync all 399 Windows tasks.
      expect(cats).toEqual([]);
    });

    it('scopes the lookup to the user and platform', async () => {
      mockPrisma.task.findMany.mockResolvedValue([]);

      await TaskService.trackedCategories('user-1', 'WINDOWS_TASK_SCHEDULER' as any);

      expect(mockPrisma.task.findMany.mock.calls[0][0].where).toEqual({
        userId: 'user-1',
        platform: 'WINDOWS_TASK_SCHEDULER'
      });
    });
  });

  describe('summarizeUntracked', () => {

    it('reports tasks sitting in folders the sync did not include', () => {
      // The exact scenario from troubleshooting #20: two folders of real tasks
      // the connector reported on every sync, while the dashboard said only
      // "Tasks synced." and gave no hint they existed.
      const result = TaskService.summarizeUntracked(
        [
          '\\Edge-Radar\\NightlySettle',
          '\\IAM\\RotateKeys',
          '\\IAM\\AuditExport',
          '\\Edge-Radar-MikesAILab\\Digest'
        ],
        ['Edge-Radar'],
        WIN
      );

      expect(result.count).toBe(3);
      expect(result.folders).toEqual(['Edge-Radar-MikesAILab', 'IAM']);
    });

    it('counts OS-owned tasks separately so the signal cannot go constant', () => {
      // A real machine has hundreds of \Microsoft\ tasks. Folding them into
      // `count` would pin the banner at a number that never moves, and a warning
      // that never changes is one you stop reading.
      const result = TaskService.summarizeUntracked(
        [
          '\\Microsoft\\Windows\\Defrag\\ScheduledDefrag',
          '\\Microsoft\\Windows\\UpdateOrchestrator\\Reboot',
          '\\IAM\\RotateKeys'
        ],
        [],
        WIN
      );

      expect(result.count).toBe(1);
      expect(result.systemCount).toBe(2);
      // Surfaced, not silently dropped — the omission would be the other failure.
      expect(result.folders).toEqual(['IAM']);
    });

    it('treats no filter as "syncing everything", so nothing is left out', () => {
      // `include === undefined` means the caller asked for everything. Reporting
      // the whole enumeration as un-imported would be exactly backwards.
      const result = TaskService.summarizeUntracked(
        ['\\IAM\\RotateKeys', '\\Edge-Radar\\Settle'],
        undefined,
        WIN
      );

      expect(result).toEqual({ count: 0, folders: [], systemCount: 0, excludedCount: 0 });
    });

    it('deduplicates folders and maps root-level tasks to Uncategorized', () => {
      const result = TaskService.summarizeUntracked(
        ['\\IAM\\A', '\\IAM\\B', '\\IAM\\Nested\\C', '\\LooseTask'],
        [],
        WIN
      );

      expect(result.count).toBe(4);
      expect(result.folders).toEqual(['IAM', 'Uncategorized']);
    });

    it('returns zero when the platform reported nothing', () => {
      // TASKHUB_NATIVE's connector returns [] (the DB is its source of truth),
      // so this must read as "nothing outstanding", not as an error.
      expect(TaskService.summarizeUntracked([], [], WIN)).toEqual({
        count: 0,
        folders: [],
        systemCount: 0,
        excludedCount: 0
      });
    });

    it('reports zero once every reported folder is tracked', () => {
      const result = TaskService.summarizeUntracked(
        ['\\IAM\\RotateKeys', '\\Edge-Radar\\Settle'],
        ['IAM', 'Edge-Radar'],
        WIN
      );

      expect(result).toEqual({ count: 0, folders: [], systemCount: 0, excludedCount: 0 });
    });

    it('counts a deliberately untracked task separately, even inside a tracked folder', () => {
      // The load-bearing case: an untracked task lives in a folder the user DOES
      // sync, so the include-set check would swallow it before any counter saw
      // it. It must be reported as excluded, not silently vanish from the
      // summary — and it must NOT inflate `count`, which would nag the user
      // about a removal they performed on purpose.
      const result = TaskService.summarizeUntracked(
        ['\\IAM\\RotateKeys', '\\IAM\\Noisy', '\\Edge-Radar\\Settle'],
        ['IAM'],
        WIN,
        new Set(['\\IAM\\Noisy'])
      );

      expect(result.excludedCount).toBe(1);
      expect(result.count).toBe(1);            // only Edge-Radar, the un-imported folder
      expect(result.folders).toEqual(['Edge-Radar']);
    });
  });

  describe('exclusions (untrack)', () => {
    it('reads the excluded ids for the platform as a set', async () => {
      mockPrisma.taskExclusion.findMany.mockResolvedValue([
        { externalId: '\\IAM\\Noisy' },
        { externalId: '\\Work\\Chatty' }
      ]);

      const excluded = await TaskService.excludedExternalIds('u1', WIN);

      expect(excluded.has('\\IAM\\Noisy')).toBe(true);
      expect(excluded.size).toBe(2);
      expect(mockPrisma.taskExclusion.findMany).toHaveBeenCalledWith({
        where: { userId: 'u1', platform: WIN },
        select: { externalId: true }
      });
    });

    it('drops excluded tasks from a sync batch and leaves the rest alone', () => {
      const tasks = [
        { externalId: '\\IAM\\RotateKeys' },
        { externalId: '\\IAM\\Noisy' }
      ];

      expect(TaskService.filterExcluded(tasks, new Set(['\\IAM\\Noisy'])))
        .toEqual([{ externalId: '\\IAM\\RotateKeys' }]);
    });

    it('is a no-op when nothing is excluded', () => {
      const tasks = [{ externalId: '\\IAM\\RotateKeys' }];
      expect(TaskService.filterExcluded(tasks, new Set())).toBe(tasks);
    });

    it('clears only the exclusions inside the imported categories', async () => {
      // Importing \IAM must forget the untracks in \IAM and NOT touch \Work —
      // an import of one folder silently resurrecting another folder's removals
      // would be the surprise this feature is built to avoid.
      mockPrisma.taskExclusion.findMany.mockResolvedValue([
        { id: 'x1', externalId: '\\IAM\\Noisy' },
        { id: 'x2', externalId: '\\Work\\Chatty' }
      ]);
      mockPrisma.taskExclusion.deleteMany.mockResolvedValue({ count: 1 });

      const cleared = await TaskService.clearExclusionsForCategories('u1', WIN, ['IAM']);

      expect(cleared).toBe(1);
      expect(mockPrisma.taskExclusion.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ['x1'] } }
      });
    });

    it('does not touch the table when no category is requested', async () => {
      expect(await TaskService.clearExclusionsForCategories('u1', WIN, [])).toBe(0);
      expect(mockPrisma.taskExclusion.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.taskExclusion.deleteMany).not.toHaveBeenCalled();
    });

    it('does not issue a delete when nothing in those categories is excluded', async () => {
      mockPrisma.taskExclusion.findMany.mockResolvedValue([
        { id: 'x2', externalId: '\\Work\\Chatty' }
      ]);

      expect(await TaskService.clearExclusionsForCategories('u1', WIN, ['IAM'])).toBe(0);
      expect(mockPrisma.taskExclusion.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('isSystemTask', () => {
    it('identifies OS-owned tasks by their root folder', () => {
      expect(TaskService.isSystemTask('\\Microsoft\\Windows\\Defender\\Scan', WIN)).toBe(true);
      expect(TaskService.isSystemTask('\\Microsoft\\Anything', WIN)).toBe(true);
    });

    it('does not claim the user\'s own tasks', () => {
      expect(TaskService.isSystemTask('\\IAM\\RotateKeys', WIN)).toBe(false);
      expect(TaskService.isSystemTask('\\LooseTask', WIN)).toBe(false);
      // Not a substring match: a user folder that merely starts with the same
      // letters is theirs, and hiding it would be the filter silently eating
      // real work.
      expect(TaskService.isSystemTask('\\MicrosoftStuffOfMine\\Task', WIN)).toBe(false);
    });
  });
});
