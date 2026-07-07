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
    $transaction: vi.fn(async (ops: unknown[]) => ops)
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
