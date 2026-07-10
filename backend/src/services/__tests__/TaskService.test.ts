import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService } from '../TaskService.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      upsert: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn()
    },
    executionLog: {
      deleteMany: vi.fn()
    },
    // Real $transaction resolves the batched operations; mirror that so
    // upsertTasks gets values back, not promises.
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops))
  }
}));

vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma;
      }
    },
    PlatformType: {
      WINDOWS_TASK_SCHEDULER: 'WINDOWS_TASK_SCHEDULER'
    },
    TaskStatus: {
      ACTIVE: 'ACTIVE',
      DISABLED: 'DISABLED'
    }
  };
});

describe('TaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('should store derived schedule and nextRunTime on create and update', async () => {
    const next = new Date('2026-07-09T03:00:00Z');
    const tasks = [
      { externalId: '\\TaskHub\\Nightly', name: 'Nightly', status: 'ACTIVE' as const, schedule: '0 3 * * *', nextRunTime: next }
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

  it('should delete tasks missing from the current platform list', async () => {
    mockPrisma.task.findMany.mockResolvedValue([{ id: 'stale-1' }, { id: 'stale-2' }]);

    const removed = await TaskService.removeStaleTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      ['\\Mikes\\StillExists']
    );

    expect(removed).toBe(2);
    expect(mockPrisma.task.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        platform: 'WINDOWS_TASK_SCHEDULER',
        externalId: { notIn: ['\\Mikes\\StillExists'] }
      },
      select: { id: true }
    });
    expect(mockPrisma.executionLog.deleteMany).toHaveBeenCalledWith({
      where: { taskId: { in: ['stale-1', 'stale-2'] } }
    });
    expect(mockPrisma.task.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['stale-1', 'stale-2'] } }
    });
  });

  it('should not delete anything when no tasks are stale', async () => {
    mockPrisma.task.findMany.mockResolvedValue([]);

    const removed = await TaskService.removeStaleTasks(
      'user-1',
      'WINDOWS_TASK_SCHEDULER' as any,
      ['\\Mikes\\Task1']
    );

    expect(removed).toBe(0);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});
