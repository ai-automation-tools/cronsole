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
import { queueFailureNotification } from '../services/FailureNotificationService.js';
import { computeNextRun } from '../utils/cron-next.js';
import { convertCronToWindowsTrigger, WindowsTrigger } from '../utils/scheduler-conversion.js';
import { toStructuredAction } from '../utils/commandParser.js';
import { HttpError } from '../middleware/errorHandler.js';
import { assertWindowsTaskNameAvailable } from '../utils/windowsTaskName.js';
import {
  DEFAULT_TASK_FOLDER,
  normalizeWindowsTaskFolder,
  windowsTaskFolderError,
  windowsTaskPath
} from '../utils/windowsTaskFolder.js';
import { validateBody } from '../middleware/validate.js';
import { importTemplates } from '../catalog/importCatalog.js';
import { buildTemplateFromTask, SaveAsTemplateError } from '../catalog/templateFromTask.js';
import { toTaskXmlBuffer } from '../services/bulkExport.js';

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
    lastRunDurationMs: executions[0]?.durationMs ?? null,
    // Server-owned verdict, not a rule the browser re-derives. "Is this the OS's
    // task or mine?" already has exactly one definition here (the same one
    // summarizeUntracked uses), and a second copy in the frontend is the shape
    // that let a renamed category silently stop syncing (#20a). The dashboard
    // gets the answer; it never gets the predicate.
    isSystem: TaskService.isSystemTask(task.externalId, task.platform)
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

const patchTaskStatusSchema = z.object({
  status: z.enum([TaskStatus.ACTIVE, TaskStatus.DISABLED], { message: 'Invalid status' })
});

// Enable/Disable a task (contacts the platform, then updates the DB)
router.patch('/:id/status', validateBody(patchTaskStatusSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;
  const { status } = req.body;

  // Scope by userId so one user can't mutate another's task (IDOR).
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  const connector = connectorRegistry.getConnector(task.platform);
  if (!connector) {
    throw new HttpError(400, 'Platform connector not found');
  }

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: task.platform } }
  });

  const config = {
    ...deserializeConfig(connection?.config),
    userId
  };

  const enabled = status === TaskStatus.ACTIVE;
  const result = await connector.setTaskStatus(task.externalId, enabled, config);
  if (!result.success) {
    throw new HttpError(502, result.message || 'The platform failed to update the task status');
  }

  // Update DB status. For TASKHUB_NATIVE it is already updated by the connector,
  // but doing it here guarantees consistency and handles platforms where connector doesn't update DB.
  const updatedTask = await prisma.task.update({
    where: { id },
    data: {
      status,
      nextRunTime: enabled ? undefined : null
    }
  });

  notifyTasksChanged(userId);
  res.json(updatedTask);
});

const patchTaskScheduleSchema = z.object({
  schedule: z.string().trim().min(1, 'schedule is required')
});

// Edit the schedule of an existing task. For TaskHub-native tasks, the backend
// owns the scheduler, so it can update the cron + nextRunTime directly. For
// Windows the agent rebuilds only the task's trigger (action/principal/settings
// preserved) via a signed task:update_schedule; the DB row's schedule/trigger
// are updated only after the platform confirms — same ack-before-write ordering
// as delete/status. Other platforms get an honest 400.
router.patch('/:id/schedule', validateBody(patchTaskScheduleSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;
  const { schedule } = req.body;

  // Scope by userId so one user can't edit another's task (IDOR).
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  if (!isValidCron(schedule)) {
    throw new HttpError(400, 'Schedule must be a 5-field cron expression (min hour dom month dow).');
  }

  if (task.platform === PlatformType.TASKHUB_NATIVE) {
    const nextRunTime = computeNextRun(schedule);
    if (!nextRunTime) {
      throw new HttpError(400, 'Schedule must be a valid 5-field cron expression (UTC).');
    }
    const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {};
    const updatedTask = await prisma.task.update({
      where: { id },
      data: {
        schedule,
        nextRunTime,
        metadata: { ...meta, schedule } as unknown as Prisma.InputJsonValue
      }
    });
    notifyTasksChanged(userId);
    return res.json(updatedTask);
  }

  const connector = connectorRegistry.getConnector(task.platform);
  if (!connector?.updateSchedule) {
    throw new HttpError(400, `Editing schedules is not supported for ${task.platform} yet.`);
  }

  const conversion = convertCronToWindowsTrigger(schedule);
  if (!conversion.trigger) {
    throw new HttpError(400, 'Schedule cannot be converted to a Windows trigger.', {
      warnings: conversion.warnings
    });
  }

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: task.platform } }
  });

  // Config is encrypted at rest (AES-256-GCM); decrypt before use.
  const result = await connector.updateSchedule(task.externalId, conversion.trigger, {
    ...deserializeConfig(connection?.config),
    userId
  });
  if (!result.success) {
    throw new HttpError(502, result.message || 'The platform failed to update the schedule');
  }

  // Only after platform confirmation: store the new schedule + trigger, leaving
  // every other field (command/actions/name/category/status) untouched.
  const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? (task.metadata as Record<string, unknown>)
    : {};
  const updatedTask = await prisma.task.update({
    where: { id },
    data: {
      schedule,
      nextRunTime: computeNextRun(schedule) ?? task.nextRunTime,
      metadata: { ...meta, schedule, trigger: conversion.trigger } as unknown as Prisma.InputJsonValue
    }
  });

  notifyTasksChanged(userId);
  res.json(updatedTask);
});

const patchTaskActionsSchema = z.object({
  command: z.string().trim().min(1, 'command is required'),
  workingDirectory: z.string().trim().optional(),
  description: z.string().trim().max(1024, 'description is too long').optional(),
  runLevel: z.enum(['least', 'highest'], { message: "runLevel must be 'least' or 'highest'" })
});

// Edit the action (executable + args + working dir) and selected settings
// (description, run level) of an existing platform task. For Windows the agent
// replaces the task's first exec action + updates the description/run level,
// preserving its trigger, principal identity, and other settings, via a signed
// task:update. The DB metadata is refreshed only after the platform confirms —
// same ack-before-write ordering as schedule/delete/status. Platforms without
// an updateActions implementation get an honest 400.
router.patch('/:id/actions', validateBody(patchTaskActionsSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;
  const { command, workingDirectory, description, runLevel } = req.body;

  // Scope by userId so one user can't edit another's task (IDOR).
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  const connector = connectorRegistry.getConnector(task.platform);
  if (!connector?.updateActions) {
    throw new HttpError(400, `Editing actions is not supported for ${task.platform} yet.`);
  }

  // Structure the command server-side (no shell) so a value can never split
  // into a second process — same model as create. An empty executable is a 400.
  const action = toStructuredAction(command);
  if (!action.executable) {
    throw new HttpError(400, 'Command must start with an executable.');
  }

  const workingDir = workingDirectory ?? '';
  const desc = description ?? '';

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: task.platform } }
  });

  // Config is encrypted at rest (AES-256-GCM); decrypt before use.
  const result = await connector.updateActions(
    task.externalId,
    { action, workingDirectory: workingDir, description: desc, runLevel },
    { ...deserializeConfig(connection?.config), userId }
  );
  if (!result.success) {
    throw new HttpError(502, result.message || 'The platform failed to update the task');
  }

  // Only after platform confirmation: refresh the action/description/run-level
  // metadata (optimistic — the next sync overwrites it with the agent's
  // authoritative report), leaving schedule/trigger/name/category untouched.
  const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? (task.metadata as Record<string, unknown>)
    : {};
  const updatedTask = await prisma.task.update({
    where: { id },
    data: {
      metadata: {
        ...meta,
        command,
        actions: [{
          type: 'Exec',
          path: action.executable,
          arguments: action.args.join(' ') || null,
          workingDirectory: workingDir || null
        }],
        description: desc || null,
        runLevel: runLevel === 'highest' ? 'Highest' : 'LUA'
      } as unknown as Prisma.InputJsonValue
    }
  });

  notifyTasksChanged(userId);
  res.json(updatedTask);
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
    trigger: conversion.trigger,
    // Discriminates the two 0.7 registers the score alone conflates: a derived
    // step that drifts ('approximated') vs. a discarded cron replaced with an
    // hourly default ('replaced'). Absent on an exact or invalid schedule.
    lossy: conversion.lossy
  });
});

const createTaskSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  platform: platformSchema,
  category: z.string().trim().min(1).optional(),
  /**
   * Windows only: the native Task Scheduler folder to create the task in
   * (default \TaskHub). Validated with windowsTaskFolderError — it is signed
   * into the agent command, and the agent re-validates before registering.
   */
  folder: z.string().optional(),
  schedule: z.string().trim().min(1, 'schedule is required'),
  command: z.string().trim().min(1, 'command is required')
});

// Create a new task (New Task modal Windows path, cloning, custom creation)
router.post('/', validateBody(createTaskSchema), async (req: Request, res: Response) => {
  const { name, platform, category, schedule, command, folder } = req.body;
  const userId = (req as AuthRequest).user!.id;

  if (!isValidCron(schedule)) {
    throw new HttpError(400, 'Schedule must be a 5-field cron expression (min hour dom month dow).');
  }

  // Windows registers a real structured trigger, not the raw cron — same
  // conversion path as the template apply route (Templates.md §6).
  let trigger: WindowsTrigger | null = null;
  let conversionWarnings: string[] = [];
  let conversionLossy: 'approximated' | 'replaced' | undefined;
  let finalFolder = DEFAULT_TASK_FOLDER;
  if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    // Invalid folder or name → 400; name colliding with a tracked task IN THAT
    // FOLDER → 409 (RegisterTaskDefinition would silently overwrite it). The
    // collision is per-folder: \Work\Backup and \TaskHub\Backup are different
    // tasks, while two \Work\Backup are the same one.
    if (typeof folder === 'string' && folder.trim()) {
      const folderProblem = windowsTaskFolderError(folder);
      if (folderProblem) {
        throw new HttpError(400, folderProblem);
      }
      finalFolder = normalizeWindowsTaskFolder(folder);
    }
    await assertWindowsTaskNameAvailable(userId, name, finalFolder);

    const conversion = convertCronToWindowsTrigger(schedule);
    if (!conversion.trigger) {
      throw new HttpError(400, 'Schedule cannot be converted to a Windows trigger.', {
        warnings: conversion.warnings
      });
    }
    trigger = conversion.trigger;
    conversionWarnings = conversion.warnings;
    conversionLossy = conversion.lossy;
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
    { trigger, folder: finalFolder }
  );

  if (!result.success) {
    return res.status(500).json({ error: result.message || 'Failed to create task' });
  }

  // Upsert the created task right away so the frontend shows it immediately
  // (sync would pick it up later otherwise).
  // Fallback must match where the agent actually registers — built from
  // finalFolder, not a hardcoded \TaskHub, or a task created in \Work would be
  // tracked under the wrong externalId (blinding the duplicate-name guard to
  // this row, and every later run/delete/edit).
  const externalId = result.externalId || windowsTaskPath(finalFolder, name);
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
    conversion: { warnings: conversionWarnings, lossy: conversionLossy }
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
/**
 * Real native folders a task can be created in, for the Apply/New Task pickers.
 * Windows only today — a platform without a native folder hierarchy gets an
 * honest 400 rather than a made-up list.
 *
 * Read-only. Unwritable folders (\Microsoft\…) are returned with
 * `writable: false` rather than filtered out, so the UI can say WHY instead of
 * silently omitting them and leaving the user wondering where their folder went.
 */
router.get('/folders', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const platform = (req.query.platform as string) || PlatformType.WINDOWS_TASK_SCHEDULER;

  if (platform !== PlatformType.WINDOWS_TASK_SCHEDULER) {
    throw new HttpError(400, `${platform} has no native task folders.`);
  }

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: platform as PlatformType } }
  });
  if (!connection) {
    throw new HttpError(400, `No connection found for platform ${platform}`);
  }

  const connector = connectorRegistry.getConnector(platform as PlatformType);
  if (!connector?.listFolders) {
    throw new HttpError(400, `${platform} does not support listing folders.`);
  }

  const result = await connector.listFolders({
    ...deserializeConfig(connection.config),
    userId
  });

  if (!result.success) {
    // The agent being offline is not a server fault — say so honestly rather
    // than returning an empty list the UI would render as "no folders exist".
    return res.status(502).json({ error: result.message || 'Could not list folders' });
  }

  res.json({ folders: result.folders, defaultFolder: DEFAULT_TASK_FOLDER });
});

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

const syncSchema = z
  .object({
    // Explicit categories to INCLUDE — what the Import flow sends, straight from
    // GET /discover, so these are already path-derived names.
    categories: z.array(z.string()).optional(),
    // 'tracked' = refresh the folders this user already tracks, resolved
    // server-side from the stored tasks' native paths (TaskService
    // .trackedCategories). This is what "Sync Now" sends: the caller must NOT
    // echo back stored `category` values, because those are user-renameable and
    // would silently drop a whole folder from the filter.
    scope: z.literal('tracked').optional()
  })
  .refine(v => !(v.categories && v.scope), {
    message: 'pass either `categories` or `scope`, not both'
  });

// Sync tasks from all platforms (selective: by category, by tracked scope, or all)
router.post('/sync', validateBody(syncSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { categories, scope } = req.body;

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

        // Resolve the include-set. `scope: 'tracked'` is computed per platform
        // from the tasks already stored; an empty set legitimately means "sync
        // nothing here", so it must still filter rather than fall through to
        // "sync everything" — hence the `!== undefined` check, not truthiness.
        const include = scope === 'tracked'
          ? await TaskService.trackedCategories(userId, conn.platform)
          : categories;

        if (include !== undefined) {
          tasks = tasks.filter(t =>
            include.includes(TaskService.extractCategory(t.externalId, conn.platform))
          );
        }

        // An explicit `categories` import is the user asking for those folders by
        // name — the same gesture that started tracking them — so it forgets any
        // prior untracks inside them. Doing this BEFORE reading the exclusion set
        // is what makes import the honest way back; if it ran after, the import
        // would clear the fence and still skip the tasks this one time, which
        // reads as "import didn't work" one sync later.
        //
        // `scope: 'tracked'` (Sync Now) deliberately does NOT clear: it is a
        // refresh, not a request for anything new, and having a routine refresh
        // undo a deliberate removal is the invisible-fence failure exactly.
        let exclusionsCleared = 0;
        if (scope !== 'tracked' && categories !== undefined) {
          exclusionsCleared = await TaskService.clearExclusionsForCategories(
            userId, conn.platform, categories
          );
        }

        const excluded = await TaskService.excludedExternalIds(userId, conn.platform);
        tasks = TaskService.filterExcluded(tasks, excluded);

        // What this sync deliberately left out. Selective import is the design,
        // but its invisibility cost a full debugging session (troubleshooting
        // #20): Sync Now cannot discover a new folder, so tasks can sit one
        // fence away indefinitely while every sync reports success. Computed
        // from the enumeration we already have — no extra agent round-trip.
        const untracked = TaskService.summarizeUntracked(allExternalIds, include, conn.platform, excluded);

        await TaskService.upsertTasks(userId, conn.platform, tasks);

        // Reconcile tasks absent from the platform: flip them to MISSING (not
        // delete — absence isn't proof they're gone; see reconcileMissingTasks).
        // Upsert ran first, so a task that reappeared this sync is already back
        // to ACTIVE/DISABLED and won't be re-marked. Skip TASKHUB_NATIVE (its
        // connector returns [] — the DB itself is the source of truth) and skip
        // empty lists as a safety net against flipping a whole platform.
        let missing = 0;
        if (conn.platform !== 'TASKHUB_NATIVE' && allExternalIds.length > 0) {
          missing = await TaskService.reconcileMissingTasks(userId, conn.platform, allExternalIds);
        }

        results.push({ platform: conn.platform, count: tasks.length, missing, untracked, exclusionsCleared });
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

        // Importing a category forgets the untracks inside it (see POST /sync),
        // so the count of what would come back is reported per category — the
        // number arrives BEFORE the action rather than as a surprise after it.
        // Deliberately not silent: silently resurrecting rows a user removed on
        // purpose is the same class of failure as silently withholding them.
        const excluded = await TaskService.excludedExternalIds(userId, conn.platform);

        discovery.push({
          platform: conn.platform,
          categories: categories.map(name => ({
            name,
            count: tasks.filter(t => TaskService.extractCategory(t.externalId, conn.platform) === name).length,
            excludedCount: tasks.filter(t =>
              TaskService.extractCategory(t.externalId, conn.platform) === name &&
              excluded.has(t.externalId)
            ).length
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

// Bulk-remove every task the last sync found absent from its platform.
//
// MUST stay above `DELETE /:id` — Express matches in declaration order, so the
// parameterised route would otherwise swallow "missing" as a task id and answer
// 404.
//
// Unlike the single delete below this deliberately does NOT ask the platform to
// delete anything: MISSING means the platform already reported the task gone, so
// there is nothing left to remove and no confirmation to obtain. It only drops
// TaskHub's own rows (and their logs). Benign in the race where a task came back
// but no sync has run yet: the row is deleted, then the next sync re-imports it,
// because reconciliation is what set MISSING in the first place.
router.delete('/missing', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;

  // Non-negotiable guard, and the reason this route is written defensively: a
  // stale generated client makes `TaskStatus.MISSING` undefined, and Prisma
  // *ignores* undefined in a `where` clause rather than erroring — so
  // `{ userId, status: undefined }` would silently widen to EVERY task this user
  // owns and delete the whole dashboard. Same root cause as troubleshooting #22,
  // but where that one under-wrote a status, this one would over-delete rows.
  if (TaskStatus.MISSING === undefined) {
    throw new HttpError(
      500,
      'Generated Prisma client is stale: TaskStatus.MISSING is undefined, so this delete would ' +
      'match every task instead of only the missing ones. Run: docker compose exec backend ' +
      'npx prisma generate && docker restart taskhub-backend-1 (see docs/troubleshooting/README.md #22)'
    );
  }

  const missing = await prisma.task.findMany({
    where: { userId, status: TaskStatus.MISSING },
    select: { id: true }
  });

  if (missing.length === 0) {
    res.json({ message: 'No missing tasks to clear', deleted: 0 });
    return;
  }

  const ids = missing.map(t => t.id);
  await prisma.$transaction([
    prisma.executionLog.deleteMany({ where: { taskId: { in: ids } } }),
    prisma.task.deleteMany({ where: { id: { in: ids } } })
  ]);

  notifyTasksChanged(userId);
  res.json({ message: `Cleared ${ids.length} missing task${ids.length === 1 ? '' : 's'}`, deleted: ids.length });
});

// Untrack: remove a task from TaskHub while LEAVING IT ON THE PLATFORM.
//
// MUST stay above `DELETE /:id`'s sibling routes only in spirit — it is a POST
// on a distinct path, so declaration order doesn't bite here the way it does for
// `DELETE /missing`. It is placed next to the deletes deliberately, because the
// two operations must be read together to be understood.
//
// This is the *other* removal, and the whole point is that it is not a delete:
// `DELETE /api/tasks/:id` removes the real Task Scheduler entry via a signed
// agent command, which was the only removal a user had. So an over-import — a
// folder imported by accident, which the Import modal makes one click away — had
// no undo that didn't destroy someone's actual scheduled tasks.
//
// It makes NO platform call at all (the mechanism `DELETE /missing` already
// proved), and it records a TaskExclusion so the next sync doesn't quietly
// re-import what the user just removed.
router.post('/:id/untrack', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  // TASKHUB_NATIVE tasks live nowhere else: the DB row IS the task, so
  // "untrack but keep it" is not a thing that can be true. Refuse honestly
  // rather than silently doing a delete under a gentler name — that would be a
  // destructive action wearing a reversible label, which is the one mistake
  // this feature exists to prevent.
  if (task.platform === PlatformType.TASKHUB_NATIVE) {
    throw new HttpError(
      400,
      'TaskHub-native tasks exist only inside TaskHub, so there is nothing to keep. ' +
      'Use Delete to remove it, or disable it to stop it running.'
    );
  }

  await prisma.$transaction([
    prisma.executionLog.deleteMany({ where: { taskId: id } }),
    prisma.task.delete({ where: { id } }),
    // Upsert, not create: re-untracking a task that was re-imported and removed
    // again must not 409 on the unique key.
    prisma.taskExclusion.upsert({
      where: {
        userId_platform_externalId: {
          userId,
          platform: task.platform,
          externalId: task.externalId
        }
      },
      create: { userId, platform: task.platform, externalId: task.externalId },
      update: {}
    })
  ]);

  notifyTasksChanged(userId);
  res.json({
    message: 'Removed from TaskHub',
    // Said out loud in the response, not just in the button copy: the caller
    // (including an MCP client with no UI to read) must be able to tell this
    // apart from a delete.
    externalId: task.externalId,
    platformEntryKept: true,
    detail: `"${task.name}" is no longer tracked by TaskHub. It still exists on its platform and will keep running on its own schedule. Re-import its category to track it again.`
  });
});

// Delete a task. TaskHub-native rows are backend-owned, so the DB delete is the
// whole operation. For agent-backed platforms (Windows) the connector must
// remove the real scheduler entry first (signed task:delete to the agent) — the
// DB row only goes away once the platform confirms, so TaskHub never claims a
// task is gone while it still exists (and runs) on the machine. Platforms
// without a deleteTask implementation still get the honest 400.
router.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  if (task.platform !== PlatformType.TASKHUB_NATIVE) {
    const connector = connectorRegistry.getConnector(task.platform);
    if (!connector?.deleteTask) {
      throw new HttpError(400, `Deleting tasks is not supported for ${task.platform} yet. Remove the task on its own platform instead.`);
    }

    const connection = await prisma.platformConnection.findUnique({
      where: { userId_platform: { userId, platform: task.platform } }
    });

    // Config is encrypted at rest (AES-256-GCM); decrypt before use.
    const result = await connector.deleteTask(task.externalId, {
      ...deserializeConfig(connection?.config),
      userId
    });
    if (!result.success) {
      throw new HttpError(502, result.message || 'The platform failed to delete the task');
    }
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

const saveAsTemplateSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).optional(),
  category: z.string().trim().max(100).optional()
});

// Save an existing task as a reusable catalog template ("grow the catalog from
// real tasks"). Derives a Registry v1 template from the task's command +
// schedule (buildTemplateFromTask) and routes it through the same import
// pipeline as file import (schema + {{placeholder}} resolvability + upsert), so
// the new template is validated exactly like any other catalog content.
router.post('/:id/save-as-template', validateBody(saveAsTemplateSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  let template;
  try {
    template = buildTemplateFromTask(task, req.body);
  } catch (err) {
    if (err instanceof SaveAsTemplateError) throw new HttpError(400, err.message);
    throw err;
  }

  const result = await importTemplates(template);
  if (result.created.length === 0) {
    throw new HttpError(400, result.errors[0]?.error || 'Could not save this task as a template.');
  }

  const created = await prisma.template.findUnique({ where: { id: result.created[0] } });
  res.status(201).json({ message: 'Task saved as template', template: created });
});

// Only allow safe chars in a downloaded filename (avoid header issues / odd chars).
const safeFilePart = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'task';

// Export a user's *actual* tracked task (distinct from template export). A
// Windows task exports as native Task Scheduler XML (retrieved through the
// agent — round-trips into any Windows machine); a TaskHub-native task has no
// Windows XML equivalent, so it exports as TaskHub JSON built from the DB row.
router.get('/:id/export', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  if (task.platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    const connector = connectorRegistry.getConnector(task.platform);
    if (!connector?.exportTask) {
      throw new HttpError(400, `Exporting is not supported for ${task.platform} yet.`);
    }
    const connection = await prisma.platformConnection.findUnique({
      where: { userId_platform: { userId, platform: task.platform } }
    });
    const result = await connector.exportTask(task.externalId, {
      ...deserializeConfig(connection?.config),
      userId
    });
    if (!result.success || !result.xml) {
      throw new HttpError(502, result.message || 'The agent could not export this task');
    }
    // Deliver the definition byte-identical to what Export-ScheduledTask / the
    // Task Scheduler UI's Export produce: UTF-16 LE + BOM, keeping the native
    // encoding="UTF-16" declaration. Every Windows re-import path is built around
    // that exact format — declaring UTF-8 instead breaks the COM / `-Xml` string
    // import with "unable to switch the encoding" (verified against real Task
    // Scheduler). res.send(Buffer) writes raw bytes with no transcoding.
    //
    // Shared with the bulk export (`/api/tools/export/tasks`) so the format has
    // exactly one definition — two copies would let one drift and produce
    // archives Windows silently refuses to re-import.
    const body = toTaskXmlBuffer(result.xml);
    res.setHeader('Content-Type', 'application/xml; charset=utf-16le');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilePart(task.name)}.xml"`);
    return res.send(body);
  }

  if (task.platform === PlatformType.TASKHUB_NATIVE) {
    const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? (task.metadata as Record<string, unknown>)
      : {};
    const bundle = {
      taskhubTaskVersion: '1.0',
      exportedAt: new Date().toISOString(),
      task: {
        name: task.name,
        platform: task.platform,
        category: task.category,
        schedule: task.schedule,
        job: meta.job ?? null
      }
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilePart(task.name)}.json"`);
    return res.json(bundle);
  }

  throw new HttpError(400, `Exporting is not supported for ${task.platform} tasks.`);
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

  const execution = await prisma.executionLog.create({
    data: {
      taskId: id,
      status: result.success ? 'SUCCESS' : 'FAILURE',
      log: result.message || (result.success ? 'Triggered from web dashboard' : 'Failed to trigger'),
      platformRunId: result.success ? result.platformRunId : undefined,
      durationMs
    }
  });
  if (!result.success) {
    queueFailureNotification({
      task,
      trigger: 'manual',
      status: 'FAILURE',
      message: result.message || 'Failed to trigger',
      durationMs,
      executionId: execution.id,
      triggeredAt: execution.triggeredAt
    });
  }
  notifyTasksChanged(userId);

  if (result.success) {
    res.json({ message: 'Task run command sent', ...result });
  } else {
    res.status(500).json({ error: result.message || 'Failed to trigger task' });
  }
});

export default router;
