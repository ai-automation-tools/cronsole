import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskService } from '../TaskService.js';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    task: {
      upsert: vi.fn()
    }
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
});
