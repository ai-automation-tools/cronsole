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
import { recordCapability, verbDeclaredUnsupported } from '../services/platformCapabilities.js';
import { taskSourceKey } from '../services/taskSource.js';

const router = Router();

// Unexpected errors thrown below (or from rejected promises) fall through to
// the app-level error handler — routes only catch what they can act on.

const platformSchema = z.enum(PlatformType, { message: 'Invalid platform' });

import { isValidCron } from '../utils/cron.js';
import { previewSchedule } from '../services/schedulePreview.js';

// List all tasks (with a flattened last-run summary for the dashboard)
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const [tasks, favorites] = await Promise.all([
    prisma.task.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      include: {
        executions: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: { status: true, triggeredAt: true, durationMs: true }
        }
      }
    }),
    prisma.taskFavorite.findMany({ where: { userId }, select: { taskId: true } })
  ]);
  const favoriteIds = new Set(favorites.map(f => f.taskId));
  res.json(tasks.map(({ executions, ...task }) => ({
    ...task,
    lastRunStatus: executions[0]?.status ?? null,
    lastRunAt: executions[0]?.triggeredAt ?? null,
    lastRunDurationMs: executions[0]?.durationMs ?? null,
    // Per-viewer, from the TaskFavorite join — never a column on Task, which in a
    // multi-tenant DB would make one user's star everyone's.
    isFavorite: favoriteIds.has(task.id),
    // Server-owned verdict, not a rule the browser re-derives. "Is this the OS's
    // task or mine?" already has exactly one definition here (the same one
    // summarizeUntracked uses), and a second copy in the frontend is the shape
    // that let a renamed category silently stop syncing (#20a). The dashboard
    // gets the answer; it never gets the predicate.
    isSystem: TaskService.isSystemTask(task.externalId, task.platform),
    // Which source bar entry this task belongs to. Server-derived for the same
    // reason `isSystem` is: it reads `metadata.job.jobType`, and a second copy of
    // "what kind of native task is this" in the browser is the drift shape of
    // #20a. Platform stays what it was — this is finer, and only the dashboard's
    // first-level axis reads it.
    source: taskSourceKey(task.platform, task.metadata)
  })));
});

const patchTaskSchema = z
  .object({
    category: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(200).optional()
  })
  .refine(v => v.category !== undefined || v.name !== undefined, {
    message: 'Provide a category, a name, or both'
  });

/**
 * Edit a task's Cronsole-side labels — its category and its name.
 *
 * **Both are Cronsole labels; neither is the machine.** That is already the rule
 * for category (a Windows task's folder is the machine, and relabelling it here
 * detaches the two on purpose, counted out loud by the bulk route). `name` joins
 * it, and the reason it can is worth writing down, because the obvious objection
 * is "won't the next sync overwrite it?":
 *
 * **No platform can supply a new name for an existing row.** A Windows task's
 * name is the last segment of its path, and its path is `externalId` — the
 * identity this row is keyed on. So renaming a task in Task Scheduler is not an
 * update, it is a *different task*: the old path goes MISSING and the new one
 * imports fresh. Measured on a real machine before this shipped: 354 Windows
 * tasks, **zero** whose stored name differed from their path leaf. Claude's name
 * comes from the registry the user declared, and a native task's row *is* the
 * task. `upsertTasks` therefore no longer writes `name` on update — it was
 * structurally a no-op that only ever had the power to undo a rename.
 *
 * Two consequences to keep honest. This is **DB-only**: nothing is renamed on
 * the machine, so a renamed Windows task still answers to its old path in Task
 * Scheduler — which is why the UI shows the real `externalId` beside a name that
 * no longer matches it. And a rename **cannot collide**: the Windows duplicate
 * guard exists because a created task's name becomes its path, and this one
 * never touches the path.
 */
router.patch('/:id', validateBody(patchTaskSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;
  const { category, name } = req.body as { category?: string; name?: string };

  // Scope by userId so one user can't mutate another's task (IDOR).
  const owned = await prisma.task.findFirst({ where: { id, userId } });
  if (!owned) {
    throw new HttpError(404, 'Task not found');
  }
  const task = await prisma.task.update({
    where: { id },
    data: {
      ...(category !== undefined ? { category } : {}),
      ...(name !== undefined ? { name } : {})
    }
  });
  notifyTasksChanged(userId);
  res.json(task);
});

// Star a task for the current user (idempotent — favoriting an already-favorited
// task is a no-op success). Owner-scoped: unlike a template, a task belongs to
// somebody, so favoriting one you don't own must 404 rather than write a row
// pointing at another tenant's task (IDOR).
//
// A favorite changes nothing on the platform — it is a Cronsole-side preference —
// so this never contacts the agent and works fine while it's offline.
router.post('/:id/favorite', async (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const owned = await prisma.task.findFirst({ where: { id: taskId, userId }, select: { id: true } });
  if (!owned) {
    throw new HttpError(404, 'Task not found');
  }

  await prisma.taskFavorite.upsert({
    where: { userId_taskId: { userId, taskId } },
    update: {},
    create: { userId, taskId }
  });
  res.json({ id: taskId, isFavorite: true });
});

// Un-star a task (idempotent — removing a non-favorite is a success; the desired
// end state already holds).
//
// Deliberately NOT owner-checked first: `deleteMany` is already scoped by userId,
// so it can only ever remove the caller's own row. Adding a 404 for a task you
// don't own would make this route a probe for which task ids exist.
router.delete('/:id/favorite', async (req: Request, res: Response) => {
  const taskId = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  await prisma.taskFavorite.deleteMany({ where: { userId, taskId } });
  res.json({ id: taskId, isFavorite: false });
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
  // Evidence for the Platforms matrix. Recorded from the platform's own answer,
  // before the refusal below — a failure is as much a fact about the capability
  // as a success, and only recording the happy path would make every verb look
  // either verified or untried.
  await recordCapability(userId, task.platform, 'setStatus', result.success, result.message);
  if (!result.success) {
    // 400, not 502, when the platform has no such API at all — 502 means "the
    // gateway had a problem", i.e. retry, and a Claude routine will never gain
    // a pause endpoint no matter how many times you click. The connector still
    // supplies the reason; this only decides how loudly to say it.
    const status = verbDeclaredUnsupported(task.platform, 'setStatus') ? 400 : 502;
    throw new HttpError(status, result.message || 'The platform failed to update the task status');
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

// Edit the schedule of an existing task. For Cronsole-native tasks, the backend
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
    // Native reschedules never touch a connector — the DB row is the task. The
    // matrix must still learn that the verb works here, or it would report
    // Cronsole-native as unable to do something it just did.
    await recordCapability(userId, task.platform, 'updateSchedule', true);
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
  await recordCapability(userId, task.platform, 'updateSchedule', result.success, result.message);
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
  await recordCapability(userId, task.platform, 'updateAction', result.success, result.message);
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

  // The whole body — score, warnings, trigger, the `lossy` discriminator, and
  // the upcoming run times — comes from one service so the New Task modal and
  // the Tools tab's schedule tester cannot answer the same question differently.
  res.json(previewSchedule(platform, schedule));
});

const createTaskSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  platform: platformSchema,
  category: z.string().trim().min(1).optional(),
  /**
   * Windows only: the native Task Scheduler folder to create the task in
   * (default \Cronsole). Validated with windowsTaskFolderError — it is signed
   * into the agent command, and the agent re-validates before registering.
   */
  folder: z.string().optional(),
  /**
   * Windows only: create `folder` when its chain is missing, instead of
   * refusing. Defaults to false — the safe direction, and the reason this is
   * opt-in at all: the agent is elevated, so a folder it creates carries an
   * administrator ACE and needs administrator rights to remove (#28). It never
   * widens WHERE a task may land; `\Microsoft\` is refused below with or
   * without it, and independently by the agent.
   */
  createFolder: z.boolean().optional().default(false),
  schedule: z.string().trim().min(1, 'schedule is required'),
  command: z.string().trim().min(1, 'command is required')
});

// Create a new task (New Task modal Windows path, cloning, custom creation)
router.post('/', validateBody(createTaskSchema), async (req: Request, res: Response) => {
  const { name, platform, category, schedule, command, folder, createFolder } = req.body;
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
    // collision is per-folder: \Work\Backup and \Cronsole\Backup are different
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
    { trigger, folder: finalFolder, createFolder: createFolder === true }
  );

  await recordCapability(userId, platform, 'create', result.success, result.message);

  if (!result.success) {
    // foldersCreated rides the ERROR too. A create can build the folder chain
    // and then fail to register into it, and Cronsole does not delete folders —
    // so the folder is real, needs an admin to remove, and the one response the
    // caller will ever see must say so rather than reporting a clean failure.
    // Same split as setStatus: a platform with no create API at all is a 400,
    // not a 500. Claude routines are made at claude.ai and nowhere else.
    return res.status(verbDeclaredUnsupported(platform, 'create') ? 400 : 500).json({
      error: result.message || 'Failed to create task',
      ...(result.foldersCreated?.length ? { foldersCreated: result.foldersCreated } : {})
    });
  }

  // Upsert the created task right away so the frontend shows it immediately
  // (sync would pick it up later otherwise).
  // Fallback must match where the agent actually registers — built from
  // finalFolder, not a hardcoded \Cronsole, or a task created in \Work would be
  // tracked under the wrong externalId (blinding the duplicate-name guard to
  // this row, and every later run/delete/edit).
  const externalId = result.externalId || windowsTaskPath(finalFolder, name);
  const upserted = await TaskService.upsertTasks(userId, platform, [{
    externalId,
    name,
    status: 'ACTIVE' as const,
    metadata: { schedule, command, state: 'Ready' }
  }]);

  // We know the cron for Cronsole-created tasks — store it (synced tasks
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
    conversion: { warnings: conversionWarnings, lossy: conversionLossy },
    // Always present (empty array when nothing was created), never conditional:
    // Cronsole creating a folder is the exception to a standing invariant, so
    // the caller must be able to read the answer rather than infer it from an
    // absent key.
    foldersCreated: result.foldersCreated ?? []
  });
});

/**
 * Build the stored job from validated input.
 *
 * Normalizing here rather than storing the request body means a field the client
 * invented never reaches `metadata.job`, and the executor only ever reads shapes
 * this function can produce.
 */
function buildNativeJob(job: Record<string, unknown>): NativeJob {
  if (job.jobType === 'EXEC') {
    const env = job.env as Record<string, string> | undefined;
    // A caller may send either a structured {executable, args[]} — what MCP and
    // the API use — or a `command` line, which is what a human types. The line is
    // tokenized **here**, by the same `toStructuredAction` the Windows create
    // path uses, so there is exactly one definition of "how a command line
    // becomes argv" and the browser never needs a copy of it. Whichever arrives,
    // what gets stored is always the structured form the executor reads.
    const structured = typeof job.command === 'string' && job.command.trim()
      ? toStructuredAction(job.command)
      : null;
    return {
      jobType: 'EXEC',
      executable: structured ? structured.executable : String(job.executable ?? '').trim(),
      args: structured
        ? structured.args
        : Array.isArray(job.args) ? (job.args as string[]) : undefined,
      workingDirectory: job.workingDirectory ? String(job.workingDirectory).trim() : undefined,
      env: env && Object.keys(env).length ? env : undefined,
      timeoutMs: job.timeoutMs !== undefined ? Number(job.timeoutMs) : undefined
    };
  }
  if (job.jobType !== 'HTTP') {
    // Hand an unrecognized — or missing — discriminator straight through, so
    // `validateJob` rejects it **by name** rather than this function silently
    // coercing it into an HTTP job. A typo'd `jobType` that quietly becomes a
    // working HTTP task is worse than a 400: the caller gets a task that is not
    // the one they described.
    return job as unknown as NativeJob;
  }
  return {
    jobType: 'HTTP',
    url: String(job.url).trim(),
    method: String(job.method || 'GET').toUpperCase(),
    headers: (job.headers as Record<string, string>) || undefined,
    body: job.body ? String(job.body) : undefined
  };
}

const createNativeSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  category: z.string().trim().min(1).optional(),
  schedule: z.string().trim().min(1, 'schedule is required'),
  job: z.unknown() // semantic validation stays in validateJob (shared with the executor)
});

// Create a Cronsole-native task (scheduled + executed by the backend itself —
// docs/resources/Native_Tasks.md). Richer than the connector createTask path
// because it takes a full job spec instead of a command string.
router.post('/native', validateBody(createNativeSchema), async (req: Request, res: Response) => {
  const { name, category, schedule, job } = req.body;
  const userId = (req as AuthRequest).user!.id;

  const nextRunTime = computeNextRun(schedule);
  if (!nextRunTime) {
    throw new HttpError(400, 'Schedule must be a valid 5-field cron expression (UTC).');
  }
  // Normalize first, then validate **what will actually be stored** rather than
  // what arrived. The two differ for an EXEC job sent as a `command` line, and
  // validating the input would check a shape the executor never sees.
  const nativeJob: NativeJob = buildNativeJob(job as Record<string, unknown>);
  const jobError = validateJob(nativeJob);
  if (jobError) {
    throw new HttpError(400, jobError);
  }

  const task = await prisma.task.create({
    data: {
      userId,
      platform: PlatformType.TASKHUB_NATIVE,
      externalId: `native_${randomBytes(8).toString('hex')}`,
      name,
      category: category ?? 'Cronsole',
      schedule,
      nextRunTime,
      status: TaskStatus.ACTIVE,
      metadata: { job: nativeJob } as unknown as Prisma.InputJsonValue
    }
  });

  await recordCapability(userId, PlatformType.TASKHUB_NATIVE, 'create', true);
  notifyTasksChanged(userId);
  res.json({ message: 'Native task created', task });
});

const patchNativeJobSchema = z.object({
  job: z.unknown() // semantic validation stays in validateJob (shared with the executor)
});

/**
 * Change what a Cronsole-native task **does** — the counterpart to
 * `PATCH /:id/actions`, which is the Windows path.
 *
 * Two routes rather than one because the thing being edited is genuinely
 * different, not merely differently shaped. `/actions` asks an elevated agent to
 * rewrite a task on the machine, and only records anything once the platform has
 * confirmed it. Here the DB row **is** the task: the write is the change, there
 * is nothing to confirm, and it works with the agent offline. Folding them into
 * one endpoint would mean one handler where half the paths need a platform round
 * trip and half are a lie if they wait for one.
 *
 * **Replaces the job, does not patch it** — same contract as `/actions`, and for
 * a sharper reason here: the two job types share no fields, so a merge would let
 * `{jobType: 'EXEC', executable}` land on top of a stored HTTP job and leave
 * `url` behind as a field the executor never reads and a reader cannot explain.
 * Send the whole spec.
 *
 * **Switching job type is allowed, and never accidental.** `buildNativeJob`
 * passes an unrecognized or missing `jobType` straight through so `validateJob`
 * rejects it *by name*, so a switch requires naming the new type. It moves the
 * task between Dashboard sources (`TASKHUB_NATIVE` ↔ `TASKHUB_NATIVE:EXEC`),
 * which is derived server-side per request and follows on its own.
 *
 * Normalization and validation are the **same two functions the create route
 * uses**, which is the only thing that keeps an edited task in the shape the
 * executor can run. A second definition here is how an edit produces a job that
 * creation would have refused.
 */
router.patch('/:id/job', validateBody(patchNativeJobSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;
  const { job } = req.body;

  // Scope by userId so one user can't edit another's task (IDOR).
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  if (task.platform !== PlatformType.TASKHUB_NATIVE) {
    throw new HttpError(
      400,
      `A job spec belongs to a Cronsole-native task; this one is ${task.platform}. ` +
      'Use PATCH /api/tasks/:id/actions to change what a Windows task runs.'
    );
  }

  // Normalize first, then validate **what will actually be stored** — the two
  // differ for an EXEC job sent as a `command` line, and validating the input
  // would check a shape the executor never sees.
  const nativeJob: NativeJob = buildNativeJob(job as Record<string, unknown>);
  const jobError = validateJob(nativeJob);
  if (jobError) {
    throw new HttpError(400, jobError);
  }

  // Merge at the metadata level, replace at the job level. Everything else on
  // `metadata` (a `savedFrom` template id, notes a future feature adds) belongs
  // to the task rather than to the job, and dropping it would make this route
  // quietly destructive well outside what its name claims.
  const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? (task.metadata as Record<string, unknown>)
    : {};

  const updated = await prisma.task.update({
    where: { id },
    data: { metadata: { ...meta, job: nativeJob } as unknown as Prisma.InputJsonValue }
  });

  // The write IS the change here, so success is known rather than reported —
  // unlike the Windows path, which records only after the agent confirms.
  await recordCapability(userId, PlatformType.TASKHUB_NATIVE, 'updateAction', true);
  notifyTasksChanged(userId);
  res.json(updated);
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

  await recordCapability(userId, platform as PlatformType, 'listFolders', result.success, result.message);

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
        isActive: true
        // No healthState: it defaults to UNKNOWN, and that is the truth for a
        // row created a microsecond ago. It used to be hardcoded `'HEALTHY'`,
        // which asserted the agent was online before anything had asked it —
        // a verdict from the row existing. The loop below derives the real one
        // in this same request, so nothing is lost by not guessing.
      }
    });
    connections = [newConn];
  }

  const results = [];
  for (const conn of connections) {
    const connector = connectorRegistry.getConnector(conn.platform);
    if (connector) {
      const health = await connector.getHealth({ ...deserializeConfig(conn.config), userId });
      // A health probe is not a sync, and neither is a reply. `lastSync` comes
      // from ONE place — the column POST /sync writes, where a sync really
      // happened — and a connector cannot override it, because there is no
      // longer a field for it to override it with.
      //
      // It used to be `health.lastSync ?? conn.lastSync`, and the Windows
      // connector filled `health.lastSync` with the time of its last inbound
      // event of any kind. That is a real timestamp of the wrong thing, which
      // read as "Synced 7m ago" over a task list from the previous day
      // (troubleshooting #41). Liveness is reported separately, under its own
      // name, because it is genuinely useful and genuinely not this.
      results.push({
        platform: conn.platform,
        ...health,
        lastSync: conn.lastSync ?? undefined
      });

      // Update health in DB. `lastSync` is deliberately not written here: this
      // endpoint observes, it does not sync. (Prisma treats `undefined` as
      // "leave alone", so the stored value survives regardless — but saying so
      // by omission is what troubleshooting #22 warns against.)
      await prisma.platformConnection.update({
        where: { id: conn.id },
        data: {
          healthState: health.state,
          // `?? null` and not bare `health.reason`: Prisma reads `undefined` as
          // "leave this column alone", so a recovered platform would keep the
          // reason from the last time it was unhealthy — a stale explanation
          // filed under a healthy state.
          healthReason: health.reason ?? null
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

        // The one place a sync actually happened, so the one place allowed to
        // stamp it. `lastSync` used to be written only by the health probe,
        // from a `new Date()` the probe invented — which made the dashboard's
        // "synced N ago" chip a clock reading rather than a fact. Written here,
        // after the upsert landed, it means what it says.
        //
        // TASKHUB_NATIVE gets `null` for the same reason it is skipped by
        // reconciliation above: its connector returns [] because this database
        // IS the source of truth, so there is no external state to be stale
        // against. It is cleared rather than left alone because the chip takes
        // the newest lastSync across ALL platforms — so the fabricated values
        // the old probe already wrote would keep the whole dashboard reading
        // "synced just now" however stale Windows really was. `null` renders as
        // "Never" in Settings, which is exactly true: it has never synced,
        // because there is nothing for it to sync from.
        await prisma.platformConnection.update({
          where: { id: conn.id },
          data: { lastSync: conn.platform === 'TASKHUB_NATIVE' ? null : new Date() }
        });

        await recordCapability(userId, conn.platform, 'sync', true);
        results.push({ platform: conn.platform, count: tasks.length, missing, untracked, exclusionsCleared });
      } catch (err: any) {
        await recordCapability(userId, conn.platform, 'sync', false, err?.message);
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
// Cronsole's own rows (and their logs). Benign in the race where a task came back
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

// Untrack: remove a task from Cronsole while LEAVING IT ON THE PLATFORM.
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
      'Cronsole-native tasks exist only inside Cronsole, so there is nothing to keep. ' +
      'Use Delete to remove it, or disable it to stop it running.'
    );
  }

  // Claude is the same refusal one platform over, and it is worth spelling out
  // because the mechanism looks like Windows and is not.
  //
  // `ClaudeConnector.syncTasks` returns the routines the user **declared** — the
  // registry inside `PlatformConnection.config` IS the platform here. So the
  // exclusion this route would write is a fence against the user's own config
  // rather than against a machine, and the declaration it is fencing off stays
  // put: the routine keeps its slot in the Platforms panel, keeps its token, and
  // comes straight back the moment anything clears the fence (importing the
  // Claude category does exactly that, by design). That is not a hypothetical —
  // it is the loop this refusal was added to end (troubleshooting #47).
  //
  // Refused rather than quietly widened to "remove the routine too", because
  // this control's label says nothing about credentials and the stored token
  // cannot be recovered — claude.ai shows it once. A task-level button must not
  // spend something that costs a regeneration at Anthropic to replace. The
  // routine control says so in its own confirmation; this one points at it.
  if (task.platform === PlatformType.CLAUDE_CODE) {
    throw new HttpError(
      400,
      'A Claude routine is tracked because you declared it, so this row is not the thing to remove — ' +
      'the routine would still be in the Claude connection and the next sync would bring it back. ' +
      'Remove the routine itself under Platforms → Claude, which also forgets its API token. ' +
      'The routine keeps running at claude.ai either way.'
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
    message: 'Removed from Cronsole',
    // Said out loud in the response, not just in the button copy: the caller
    // (including an MCP client with no UI to read) must be able to tell this
    // apart from a delete.
    externalId: task.externalId,
    platformEntryKept: true,
    detail: `"${task.name}" is no longer tracked by Cronsole. It still exists on its platform and will keep running on its own schedule. Re-import its category to track it again.`
  });
});

// Delete a task. Cronsole-native rows are backend-owned, so the DB delete is the
// whole operation. For agent-backed platforms (Windows) the connector must
// remove the real scheduler entry first (signed task:delete to the agent) — the
// DB row only goes away once the platform confirms, so Cronsole never claims a
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
    await recordCapability(userId, task.platform, 'delete', result.success, result.message);
    if (!result.success) {
      throw new HttpError(502, result.message || 'The platform failed to delete the task');
    }
  } else {
    // Native tasks are deleted by the transaction below, not by a connector.
    await recordCapability(userId, task.platform, 'delete', true);
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
// agent — round-trips into any Windows machine); a Cronsole-native task has no
// Windows XML equivalent, so it exports as Cronsole JSON built from the DB row.
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
    await recordCapability(userId, task.platform, 'export', Boolean(result.success && result.xml), result.message);
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
      cronsoleTaskVersion: '1.0',
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
    // Native exports never reach a connector either — same reason as reschedule.
    await recordCapability(userId, task.platform, 'export', true);
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

  // For Windows this records that the agent *accepted the start* — the same
  // thing `ExecutionLog.SUCCESS` means here, and no more. The matrix cell says
  // "Cronsole can trigger a run on this platform", which is exactly that claim;
  // whether the task then did its job is Windows' `lastTaskResult`, elsewhere.
  await recordCapability(userId, task.platform, 'run', result.success, result.message);

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
    // 502, not 500: the run failed *upstream*, and 500 claims Cronsole broke.
    // Almost every real cause here is the platform answering — a paused Claude
    // routine ("Refused (400): Routine is paused."), an offline agent, an ACL
    // denial — none of which is a server fault, and all of which a 500 sends
    // someone to debug in the wrong place. Matches the code the setStatus route
    // already returns for a platform refusal.
    res.status(502).json({ error: result.message || 'Failed to trigger task' });
  }
});

export default router;
