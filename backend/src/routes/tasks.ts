import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { Prisma, PlatformType, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { connectorRegistry } from '../connectors/registry.js';
import { AuthRequest } from '../auth/auth.js';
import { serializeConfig, deserializeConfig } from '../auth/connectionConfig.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { agentManager } from '../ws/AgentManager.js';
import { TaskService } from '../services/TaskService.js';
import { validateJob, NativeJob } from '../services/NativeTaskExecutor.js';
import { computeNextRun } from '../utils/cron-next.js';
import { convertCronToWindowsTrigger, WindowsTrigger } from '../utils/scheduler-conversion.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

// Unexpected errors thrown below (or from rejected promises) fall through to
// the app-level error handler — routes only catch what they can act on.

const platformSchema = z.enum(PlatformType, { message: 'Invalid platform' });

const isValidCron = (cron: string) => cron.trim().split(/\s+/).length === 5;

// List all tasks (with a flattened last-run summary for the dashboard)
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const tasks = await prisma.task.findMany({
    where: { userId },
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
});

const patchTaskSchema = z.object({
  category: z.string().trim().min(1).max(100).optional()
});

// Update a task (e.g., category)
router.patch('/:id', validateBody(patchTaskSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;
  const { category } = req.body;

  // Scope by userId so one user can't mutate another's task (IDOR).
  const owned = await prisma.task.findFirst({ where: { id, userId } });
  if (!owned) {
    throw new HttpError(404, 'Task not found');
  }
  const task = await prisma.task.update({
    where: { id },
    data: { category }
  });
  notifyTasksChanged(userId);
  res.json(task);
});

const previewSchema = z.object({
  platform: platformSchema,
  schedule: z.unknown()
});

// Preview how a cron converts for a platform (used by the New Task modal for
// live warnings before creating; mirrors POST /templates/:id/preview).
// Note: an unparseable schedule is a score-0 preview result, not a 400 — the
// modal renders it as a live warning while the user is still typing.
router.post('/preview', validateBody(previewSchema), async (req: Request, res: Response) => {
  const { platform, schedule } = req.body;

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

const createTaskSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  platform: platformSchema,
  category: z.string().trim().min(1).optional(),
  schedule: z.string().trim().min(1, 'schedule is required'),
  command: z.string().trim().min(1, 'command is required')
});

// Create a new task (New Task modal Windows path, cloning, custom creation)
router.post('/', validateBody(createTaskSchema), async (req: Request, res: Response) => {
  const { name, platform, category, schedule, command } = req.body;
  const userId = (req as AuthRequest).user!.id;

  if (!isValidCron(schedule)) {
    throw new HttpError(400, 'Schedule must be a 5-field cron expression (min hour dom month dow).');
  }

  // Windows registers a real structured trigger, not the raw cron — same
  // conversion path as the template apply route (Templates.md §6).
  let trigger: WindowsTrigger | null = null;
  let conversionWarnings: string[] = [];
  if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    const conversion = convertCronToWindowsTrigger(schedule);
    if (!conversion.trigger) {
      throw new HttpError(400, 'Schedule cannot be converted to a Windows trigger.', {
        warnings: conversion.warnings
      });
    }
    trigger = conversion.trigger;
    conversionWarnings = conversion.warnings;
  }

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform } }
  });
  if (!connection) {
    throw new HttpError(400, `No connection found for platform ${platform}`);
  }

  const connector = connectorRegistry.getConnector(platform);
  if (!connector) {
    throw new HttpError(400, `No connector registered for platform ${platform}`);
  }

  const result = await connector.createTask(
    name,
    schedule,
    command,
    { ...deserializeConfig(connection.config), userId },
    { trigger }
  );

  if (!result.success) {
    return res.status(500).json({ error: result.message || 'Failed to create task' });
  }

  // Upsert the created task right away so the frontend shows it immediately
  // (sync would pick it up later otherwise).
  const externalId = result.externalId || `\\${name}`; // fallback if not returned
  const upserted = await TaskService.upsertTasks(userId, platform, [{
    externalId,
    name,
    status: 'ACTIVE' as const,
    metadata: { schedule, command, state: 'Ready' }
  }]);

  // We know the cron for TaskHub-created tasks — store it (synced tasks
  // still lack schedule normalization; see analysis P1 #5).
  if (upserted.length > 0) {
    const updated = await prisma.task.update({
      where: { id: upserted[0].id },
      data: {
        schedule,
        ...(category ? { category } : {})
      }
    });
    upserted[0] = updated;
  }

  notifyTasksChanged(userId);
  res.json({
    message: 'Task created successfully',
    task: upserted[0],
    conversion: { warnings: conversionWarnings }
  });
});

const createNativeSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  category: z.string().trim().min(1).optional(),
  schedule: z.string().trim().min(1, 'schedule is required'),
  job: z.unknown() // semantic validation stays in validateJob (shared with the executor)
});

// Create a TaskHub-native task (scheduled + executed by the backend itself —
// docs/resources/Native_Tasks.md). Richer than the connector createTask path
// because it takes a full job spec instead of a command string.
router.post('/native', validateBody(createNativeSchema), async (req: Request, res: Response) => {
  const { name, category, schedule, job } = req.body;
  const userId = (req as AuthRequest).user!.id;

  const nextRunTime = computeNextRun(schedule);
  if (!nextRunTime) {
    throw new HttpError(400, 'Schedule must be a valid 5-field cron expression (UTC).');
  }
  const jobError = validateJob(job);
  if (jobError) {
    throw new HttpError(400, jobError);
  }

  const validated = job as { url: string; method?: string; headers?: Record<string, string>; body?: string };
  const nativeJob: NativeJob = {
    jobType: 'HTTP',
    url: validated.url.trim(),
    method: (validated.method || 'GET').toUpperCase(),
    headers: validated.headers || undefined,
    body: validated.body || undefined
  };

  const task = await prisma.task.create({
    data: {
      userId,
      platform: PlatformType.TASKHUB_NATIVE,
      externalId: `native_${randomBytes(8).toString('hex')}`,
      name,
      category: category ?? 'TaskHub',
      schedule,
      nextRunTime,
      status: TaskStatus.ACTIVE,
      metadata: { job: nativeJob } as unknown as Prisma.InputJsonValue
    }
  });

  notifyTasksChanged(userId);
  res.json({ message: 'Native task created', task });
});

// Get health for all connectors
router.get('/health', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  let connections = await prisma.platformConnection.findMany({
    where: { userId }
  });

  // Auto-initialize Windows connection for MVP if it doesn't exist
  if (connections.length === 0) {
    const newConn = await prisma.platformConnection.create({
      data: {
        userId,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        config: serializeConfig({}),
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
      const health = await connector.getHealth({ ...deserializeConfig(conn.config), userId });
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
});

const syncSchema = z.object({
  categories: z.array(z.string()).optional() // categories to INCLUDE
});

// Sync tasks from all platforms (Legacy - now selective)
router.post('/sync', validateBody(syncSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { categories } = req.body;

  const connections = await prisma.platformConnection.findMany({
    where: { userId, isActive: true }
  });

  const results = [];

  for (const conn of connections) {
    const connector = connectorRegistry.getConnector(conn.platform);
    if (connector) {
      // One platform failing must not abort the others' sync.
      try {
        let tasks = await connector.syncTasks({ ...deserializeConfig(conn.config), userId });
        const allExternalIds = tasks.map(t => t.externalId);

        if (categories) {
          tasks = tasks.filter(t =>
            categories.includes(TaskService.extractCategory(t.externalId, conn.platform))
          );
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

  notifyTasksChanged(userId);
  res.json({ message: 'Sync complete', results });
});

// Discover tasks available for import
router.get('/discover', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  console.log(`[Discovery] Starting discovery for user: ${userId}`);

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
      // A platform that fails to enumerate is skipped, not fatal to discovery.
      try {
        const tasks = await connector.syncTasks({ ...deserializeConfig(conn.config), userId });
        console.log(`[Discovery] Connector returned ${tasks.length} tasks for ${conn.platform}`);

        const categories = Array.from(new Set(tasks.map(t => TaskService.extractCategory(t.externalId, conn.platform))));

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

  res.json(discovery);
});

// Delete a task. Only TaskHub-native tasks for now — deleting a synced task
// would need the platform connector to remove the real entry (agent task:delete
// is still on the roadmap).
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }
  if (task.platform !== PlatformType.TASKHUB_NATIVE) {
    throw new HttpError(400, 'Only TaskHub-native tasks can be deleted. Synced tasks must be removed on their own platform.');
  }

  await prisma.$transaction([
    prisma.executionLog.deleteMany({ where: { taskId: id } }),
    prisma.task.delete({ where: { id } })
  ]);

  notifyTasksChanged(userId);
  res.json({ message: 'Task deleted' });
});

// Recent execution history for a task (manual runs + native scheduler fires)
router.get('/:id/executions', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  // Confirm the task is the caller's before exposing its run history (IDOR).
  const owned = await prisma.task.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) {
    throw new HttpError(404, 'Task not found');
  }
  const executions = await prisma.executionLog.findMany({
    where: { taskId: id },
    orderBy: { triggeredAt: 'desc' },
    take: 20
  });
  res.json(executions);
});

// Trigger a task
router.post('/:id/run', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  // Scope by userId so a user can only run their own tasks (IDOR → remote
  // command execution on someone else's agent otherwise).
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  const connector = connectorRegistry.getConnector(task.platform);
  if (!connector) {
    throw new HttpError(400, 'Platform connector not found');
  }

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId: task.userId, platform: task.platform } }
  });

  // Config is encrypted at rest (AES-256-GCM); decrypt before use.
  const config = {
    ...deserializeConfig(connection?.config),
    userId: task.userId
  };

  const runStartedAt = Date.now();
  const result = await connector.runTask(task.externalId, config);
  const durationMs = Date.now() - runStartedAt;

  await prisma.executionLog.create({
    data: {
      taskId: id,
      status: result.success ? 'SUCCESS' : 'FAILURE',
      log: result.message || (result.success ? 'Triggered from web dashboard' : 'Failed to trigger'),
      platformRunId: result.success ? result.platformRunId : undefined,
      durationMs
    }
  });
  notifyTasksChanged(userId);

  if (result.success) {
    res.json({ message: 'Task run command sent', ...result });
  } else {
    res.status(500).json({ error: result.message || 'Failed to trigger task' });
  }
});

export default router;
