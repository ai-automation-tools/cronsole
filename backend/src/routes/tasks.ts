import { Router, Request, Response } from 'express';
import { PrismaClient, PlatformType } from '@prisma/client';
import { connectorRegistry } from '../connectors/registry.js';
import { agentManager } from '../ws/AgentManager.js';
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

// Update a task (e.g., category)
router.patch('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { category } = req.body;

  try {
    const task = await prisma.task.update({
      where: { id },
      data: { category }
    });
    res.json(task);
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Create a new task (can be used for cloning or custom creation)
router.post('/', async (req: Request, res: Response) => {
  const { name, platform, category, schedule, command } = req.body;
  const userId = 'cli_user_placeholder'; // For MVP

  try {
    if (!name || !schedule || !command || !platform) {
      return res.status(400).json({ error: 'Missing required fields: name, schedule, command, platform' });
    }

    // Verify if platform is a valid PlatformType
    if (!Object.values(PlatformType).includes(platform as PlatformType)) {
      return res.status(400).json({ error: `Invalid platform type: ${platform}` });
    }

    const connection = await prisma.platformConnection.findUnique({
      where: { userId_platform: { userId, platform: platform as PlatformType } }
    });

    if (!connection) {
      return res.status(400).json({ error: `No connection found for platform ${platform}` });
    }

    const connector = connectorRegistry.getConnector(platform as PlatformType);
    if (!connector) {
      return res.status(400).json({ error: `No connector registered for platform ${platform}` });
    }

    const result = await connector.createTask(
      name,
      schedule,
      command,
      { ...(connection.config as object), userId }
    );

    if (result.success) {
      // In TaskService.upsertTasks, it is called when syncing, but let's upsert the created task right away so the frontend shows it immediately!
      const externalId = result.externalId || `\\${name}`; // fallback if not returned
      const newTasks = [{
        externalId,
        name,
        status: 'ACTIVE' as const,
        metadata: { schedule, command, state: 'Ready' }
      }];
      const upserted = await TaskService.upsertTasks(userId, platform as PlatformType, newTasks);
      
      // Let's also update the category if specified!
      if (category && upserted.length > 0) {
        await prisma.task.update({
          where: { id: upserted[0].id },
          data: { category }
        });
        upserted[0].category = category;
      }

      res.json({ message: 'Task created successfully', task: upserted[0] });
    } else {
      res.status(500).json({ error: result.message || 'Failed to create task' });
    }
  } catch (error: any) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get health for all connectors
router.get('/health', async (req: Request, res: Response) => {
  const userId = 'cli_user_placeholder';
  try {
    let connections = await prisma.platformConnection.findMany({
      where: { userId }
    });

    // Auto-initialize Windows connection for MVP if it doesn't exist
    if (connections.length === 0) {
      const newConn = await prisma.platformConnection.create({
        data: {
          userId,
          platform: PlatformType.WINDOWS_TASK_SCHEDULER,
          config: {},
          isActive: true,
          healthState: 'HEALTHY'
        }
      });
      connections = [newConn];
    }

    const results = [];
    for (const conn of connections) {
      const connector = connectorRegistry.getConnector(conn.platform);
      if (connector) {
        const health = await connector.getHealth({ ...(conn.config as object), userId });
        results.push({
          platform: conn.platform,
          ...health
        });

        // Update health in DB
        await prisma.platformConnection.update({
          where: { id: conn.id },
          data: {
            healthState: health.state,
            healthReason: health.reason,
            lastSync: health.lastSync
          }
        });
      }
    }

    res.json(results);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({ error: 'Failed to check connector health' });
  }
});

// Sync tasks from all platforms (Legacy - now selective)
router.post('/sync', async (req: Request, res: Response) => {
  const userId = 'cli_user_placeholder';
  const { categories } = req.body; // Optional list of categories to INCLUDE

  try {
    const connections = await prisma.platformConnection.findMany({
      where: { userId, isActive: true }
    });

    const results = [];

    for (const conn of connections) {
      const connector = connectorRegistry.getConnector(conn.platform);
      if (connector) {
        try {
          let tasks = await connector.syncTasks({ ...conn.config as object, userId });

          // Filter by categories if provided
          if (categories && Array.isArray(categories)) {
            tasks = tasks.filter(t => {
              // Use the same logic as TaskService.extractCategory to check if it should be included
              const cat = TaskService.extractCategory(t.externalId, conn.platform);
              return categories.includes(cat);
            });
          }

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

// Discover tasks available for import
router.get('/discover', async (req: Request, res: Response) => {
  const userId = 'cli_user_placeholder';
  console.log(`[Discovery] Starting discovery for user: ${userId}`);

  try {
    const registeredSocket = agentManager.getSocket(userId);
    console.log(`[Discovery] AgentManager has socket for ${userId}: ${!!registeredSocket} (ID: ${registeredSocket?.id || 'none'})`);

    const connections = await prisma.platformConnection.findMany({
      where: { userId, isActive: true }
    });

    console.log(`[Discovery] Found ${connections.length} active connections`);
    const discovery = [];

    for (const conn of connections) {
      console.log(`[Discovery] Probing platform: ${conn.platform}`);
      const connector = connectorRegistry.getConnector(conn.platform);
      if (connector) {
        try {
          const tasks = await connector.syncTasks({ ...conn.config as object, userId });
          console.log(`[Discovery] Connector returned ${tasks.length} tasks for ${conn.platform}`);

          const categories = Array.from(new Set(tasks.map(t => TaskService.extractCategory(t.externalId, conn.platform))));       
          console.log(`[Discovery] Extracted categories: ${categories.join(', ')}`);

          discovery.push({
            platform: conn.platform,
            categories: categories.map(name => ({
              name,
              count: tasks.filter(t => TaskService.extractCategory(t.externalId, conn.platform) === name).length
            }))
          });
        } catch (err: any) {
          console.error(`[Discovery] Error for ${conn.platform}:`, err);
        }
      } else {
        console.warn(`[Discovery] No connector found for platform: ${conn.platform}`);
      }
    }

    console.log(`[Discovery] Final discovery payload:`, JSON.stringify(discovery));
    res.json(discovery);
  } catch (error) {
    console.error('[Discovery] Global error:', error);
    res.status(500).json({ error: 'Failed to discover tasks' });
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
          status: 'SUCCESS', // Started successfully
          log: result.message || 'Triggered from web dashboard',
          platformRunId: result.platformRunId
        }
      });
      res.json({ message: 'Task run command sent', ...result });
    } else {
      await prisma.executionLog.create({
        data: {
          taskId: id,
          status: 'FAILURE',
          log: result.message || 'Failed to trigger'
        }
      });
      res.status(500).json({ error: result.message || 'Failed to trigger task' });
    }
  } catch (error) {
    console.error('Error running task:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
