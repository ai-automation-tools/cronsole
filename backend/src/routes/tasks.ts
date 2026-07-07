import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { Prisma, PrismaClient, PlatformType, TaskStatus } from '@prisma/client';
import { connectorRegistry } from '../connectors/registry.js';
import { agentManager } from '../ws/AgentManager.js';
import { TaskService } from '../services/TaskService.js';
import { validateJob, NativeJob } from '../services/NativeTaskExecutor.js';
import { computeNextRun } from '../utils/cron-next.js';
import { convertCronToWindowsTrigger, WindowsTrigger } from '../utils/scheduler-conversion.js';

const prisma = new PrismaClient();
const router = Router();

// List all tasks (with a flattened last-run summary for the dashboard)
router.get('/', async (req: Request, res: Response) => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { updatedAt: 'desc' },
      include: {
        executions: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: { status: true, triggeredAt: true, durationMs: true }
        }
      }
    });
    res.json(tasks.map(({ executions, ...task }) => ({
      ...task,
      lastRunStatus: executions[0]?.status ?? null,
      lastRunAt: executions[0]?.triggeredAt ?? null,
      lastRunDurationMs: executions[0]?.durationMs ?? null
    })));
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

const isValidCron = (cron: string) => cron.trim().split(/\s+/).length === 5;

// Preview how a cron converts for a platform (used by the New Task modal for
// live warnings before creating; mirrors POST /templates/:id/preview).
router.post('/preview', async (req: Request, res: Response) => {
  const { platform, schedule } = req.body;

  if (!platform || !Object.values(PlatformType).includes(platform)) {
    return res.status(400).json({ error: `Invalid platform: ${platform}` });
  }
  if (typeof schedule !== 'string' || !isValidCron(schedule)) {
    return res.json({
      score: 0,
      warnings: ['Schedule must be a 5-field cron expression (min hour dom month dow).'],
      trigger: null
    });
  }
  if (platform !== PlatformType.WINDOWS_TASK_SCHEDULER) {
    return res.json({ score: 1, warnings: [], trigger: null });
  }
  const conversion = convertCronToWindowsTrigger(schedule.trim());
  res.json({
    score: conversion.confidence,
    warnings: conversion.warnings,
    trigger: conversion.trigger
  });
});

// Create a new task (New Task modal Windows path, cloning, custom creation)
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

    if (!isValidCron(schedule)) {
      return res.status(400).json({
        error: 'Schedule must be a 5-field cron expression (min hour dom month dow).'
      });
    }

    // Windows registers a real structured trigger, not the raw cron — same
    // conversion path as the template apply route (Templates.md §6).
    let trigger: WindowsTrigger | null = null;
    let conversionWarnings: string[] = [];
    if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
      const conversion = convertCronToWindowsTrigger(schedule.trim());
      if (!conversion.trigger) {
        return res.status(400).json({
          error: 'Schedule cannot be converted to a Windows trigger.',
          warnings: conversion.warnings
        });
      }
      trigger = conversion.trigger;
      conversionWarnings = conversion.warnings;
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
      { ...(connection.config as object), userId },
      { trigger }
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

      // We know the cron for TaskHub-created tasks — store it (synced tasks
      // still lack schedule normalization; see analysis P1 #5).
      if (upserted.length > 0) {
        const updated = await prisma.task.update({
          where: { id: upserted[0].id },
          data: {
            schedule: schedule.trim(),
            ...(category ? { category } : {})
          }
        });
        upserted[0] = updated;
      }

      res.json({
        message: 'Task created successfully',
        task: upserted[0],
        conversion: { warnings: conversionWarnings }
      });
    } else {
      res.status(500).json({ error: result.message || 'Failed to create task' });
    }
  } catch (error: any) {
    console.error('Error creating task:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create a TaskHub-native task (scheduled + executed by the backend itself —
// docs/resources/Native_Tasks.md). Richer than the connector createTask path
// because it takes a full job spec instead of a command string.
router.post('/native', async (req: Request, res: Response) => {
  const { name, category, schedule, job } = req.body;
  const userId = 'cli_user_placeholder'; // For MVP

  try {
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Missing required field: name' });
    }
    if (!schedule || typeof schedule !== 'string') {
      return res.status(400).json({ error: 'Missing required field: schedule' });
    }
    const nextRunTime = computeNextRun(schedule.trim());
    if (!nextRunTime) {
      return res.status(400).json({ error: 'Schedule must be a valid 5-field cron expression (UTC).' });
    }
    const jobError = validateJob(job);
    if (jobError) {
      return res.status(400).json({ error: jobError });
    }

    const nativeJob: NativeJob = {
      jobType: 'HTTP',
      url: job.url.trim(),
      method: (job.method || 'GET').toUpperCase(),
      headers: job.headers || undefined,
      body: job.body || undefined
    };

    const task = await prisma.task.create({
      data: {
        userId,
        platform: PlatformType.TASKHUB_NATIVE,
        externalId: `native_${randomBytes(8).toString('hex')}`,
        name: name.trim(),
        category: typeof category === 'string' && category.trim() ? category.trim() : 'TaskHub',
        schedule: schedule.trim(),
        nextRunTime,
        status: TaskStatus.ACTIVE,
        metadata: { job: nativeJob } as unknown as Prisma.InputJsonValue
      }
    });

    res.json({ message: 'Native task created', task });
  } catch (error: any) {
    console.error('Error creating native task:', error);
    res.status(500).json({ error: 'Failed to create native task' });
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
          const allExternalIds = tasks.map(t => t.externalId);

          // Filter by categories if provided
          if (categories && Array.isArray(categories)) {
            tasks = tasks.filter(t => {
              // Use the same logic as TaskService.extractCategory to check if it should be included
              const cat = TaskService.extractCategory(t.externalId, conn.platform);
              return categories.includes(cat);
            });
          }

          await TaskService.upsertTasks(userId, conn.platform, tasks);

          // Remove tasks deleted natively on the platform. Skip TASKHUB_NATIVE
          // (its connector returns [] — the DB itself is the source of truth)
          // and skip empty lists as a safety net against wiping a platform.
          let removed = 0;
          if (conn.platform !== 'TASKHUB_NATIVE' && allExternalIds.length > 0) {
            removed = await TaskService.removeStaleTasks(userId, conn.platform, allExternalIds);
          }

          results.push({ platform: conn.platform, count: tasks.length, removed });
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

// Delete a task. Only TaskHub-native tasks for now — deleting a synced task
// would need the platform connector to remove the real entry (agent task:delete
// is still on the roadmap).
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    if (task.platform !== PlatformType.TASKHUB_NATIVE) {
      return res.status(400).json({
        error: 'Only TaskHub-native tasks can be deleted. Synced tasks must be removed on their own platform.'
      });
    }

    await prisma.$transaction([
      prisma.executionLog.deleteMany({ where: { taskId: id } }),
      prisma.task.delete({ where: { id } })
    ]);

    res.json({ message: 'Task deleted' });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// Recent execution history for a task (manual runs + native scheduler fires)
router.get('/:id/executions', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    const executions = await prisma.executionLog.findMany({
      where: { taskId: id },
      orderBy: { triggeredAt: 'desc' },
      take: 20
    });
    res.json(executions);
  } catch (error) {
    console.error('Error fetching executions:', error);
    res.status(500).json({ error: 'Failed to fetch execution history' });
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

    const runStartedAt = Date.now();
    const result = await connector.runTask(task.externalId, config);
    const durationMs = Date.now() - runStartedAt;

    if (result.success) {
      await prisma.executionLog.create({
        data: {
          taskId: id,
          status: 'SUCCESS', // Started successfully
          log: result.message || 'Triggered from web dashboard',
          platformRunId: result.platformRunId,
          durationMs
        }
      });
      res.json({ message: 'Task run command sent', ...result });
    } else {
      await prisma.executionLog.create({
        data: {
          taskId: id,
          status: 'FAILURE',
          log: result.message || 'Failed to trigger',
          durationMs
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
