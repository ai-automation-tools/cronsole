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

  private static extractCategory(externalId: string, platform: PlatformType): string {
    if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
      // Windows paths: \Folder\Subfolder\TaskName or \TaskName
      // Remove leading backslash if it exists to make splitting cleaner
      const cleanPath = externalId.startsWith('\\') ? externalId.substring(1) : externalId;
      const parts = cleanPath.split('\\');
      
      if (parts.length > 1) {
        // The last part is the task name, everything before is the "folder"
        return parts.slice(0, -1).join('\\');
      }
    }
    return 'Uncategorized';
  }
}
