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
        },
        create: {
          userId,
          platform,
          externalId: t.externalId,
          name: t.name,
          status: t.status === 'ACTIVE' ? TaskStatus.ACTIVE : TaskStatus.DISABLED,
          metadata: t.metadata
        }
      });
      results.push(task);
    }
    return results;
  }
}
