import { Router, Request, Response } from 'express';
import { PrismaClient, PlatformType } from '@prisma/client';
import { connectorRegistry } from '../connectors/registry.js';
import { TaskService } from '../services/TaskService.js';

const prisma = new PrismaClient();
const router = Router();

// List all tasks
router.get('/', async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Sync tasks from all platforms
router.post('/sync', async (req: Request, res: Response) => {
  const userId = 'cli_user_placeholder'; // MVP placeholder
  try {
    const connections = await prisma.platformConnection.findMany({
      where: { userId, isActive: true }
    });

    const results = [];

    for (const conn of connections) {
      const connector = connectorRegistry.getConnector(conn.platform);
      if (connector) {
        try {
          const tasks = await connector.syncTasks(conn.config);
          await TaskService.upsertTasks(userId, conn.platform, tasks);
          results.push({ platform: conn.platform, count: tasks.length });
        } catch (err: any) {
          results.push({ platform: conn.platform, error: err.message });
        }
      }
    }

    res.json({ message: 'Sync complete', results });
  } catch (error) {
    console.error('Sync error:', error);
    res.status(500).json({ error: 'Failed to sync tasks' });
  }
});

// Trigger a task
router.post('/:id/run', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      res.status(404).json({ error: 'Task not found' });
      return;
    }

    const connector = connectorRegistry.getConnector(task.platform);
    if (!connector) {
      res.status(400).json({ error: 'Platform connector not found' });
      return;
    }

    // Get connection config
    const connection = await prisma.platformConnection.findUnique({
      where: { userId_platform: { userId: task.userId, platform: task.platform } }
    });

    // In a real system, we'd decrypt the config here
    const config = { 
      ...(connection?.config as any || {}),
      userId: task.userId 
    };

    const result = await connector.runTask(task.externalId, config);

    if (result.success) {
      await prisma.executionLog.create({
        data: {
          taskId: id,
          status: 'PENDING',
          log: result.message || 'Triggered from web dashboard',
          platformRunId: result.platformRunId
        }
      });
      res.json({ message: 'Task run command sent', ...result });
    } else {
      res.status(500).json({ error: result.message || 'Failed to trigger task' });
    }
  } catch (error) {
    console.error('Error running task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
