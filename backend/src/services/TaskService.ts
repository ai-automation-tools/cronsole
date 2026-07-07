import { PrismaClient, PlatformType, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

export interface NormalizedTask {
  externalId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  metadata?: any;
}

export class TaskService {
  static async upsertTasks(userId: string, platform: PlatformType, tasks: NormalizedTask[]) {
    const results = [];
    for (const t of tasks) {
      // Extract initial category from native path if applicable
      const initialCategory = this.extractCategory(t.externalId, platform);

      const task = await prisma.task.upsert({
        where: {
          platform_externalId: {
            platform,
            externalId: t.externalId
          }
        },
        update: {
          name: t.name,
          status: t.status === 'ACTIVE' ? TaskStatus.ACTIVE : TaskStatus.DISABLED,
          metadata: t.metadata
          // Note: We DO NOT update category here to preserve user overrides
        },
        create: {
          userId,
          platform,
          externalId: t.externalId,
          name: t.name,
          category: initialCategory, // Only set on initial import
          status: t.status === 'ACTIVE' ? TaskStatus.ACTIVE : TaskStatus.DISABLED,
          metadata: t.metadata
        }
      });
      results.push(task);
    }
    return results;
  }

  /**
   * Delete DB tasks that no longer exist on the platform. `currentExternalIds`
   * must be the connector's FULL task list (pre category-filtering) — a task
   * absent from it was deleted natively, regardless of which categories the
   * user chose to import.
   */
  static async removeStaleTasks(userId: string, platform: PlatformType, currentExternalIds: string[]) {
    const stale = await prisma.task.findMany({
      where: { userId, platform, externalId: { notIn: currentExternalIds } },
      select: { id: true }
    });
    if (stale.length === 0) return 0;

    const ids = stale.map(s => s.id);
    await prisma.$transaction([
      prisma.executionLog.deleteMany({ where: { taskId: { in: ids } } }),
      prisma.task.deleteMany({ where: { id: { in: ids } } })
    ]);
    return ids.length;
  }

  public static extractCategory(externalId: string, platform: PlatformType): string {
    if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
      // Windows paths: \Folder\Subfolder\TaskName or \TaskName
      // Use regex to split by both backslash and forward slash to handle different environments
      const parts = externalId.split(/[\\\/]/).filter(p => p.length > 0);
      
      // If parts.length > 1, the task is in a folder. 
      // The first part of the filtered list is the ROOT folder.
      if (parts.length > 1) {
        return parts[0];
      }
    }
    return 'Uncategorized';
  }
}
