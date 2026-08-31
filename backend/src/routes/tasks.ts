import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma, PlatformType, TaskStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { syncOutcomeOf, type AgentToolInput } from '../connectors/platform.interface.js';
import { connectorRegistry } from '../connectors/registry.js';
import { AuthRequest } from '../auth/auth.js';
import { serializeConfig, deserializeConfig } from '../auth/connectionConfig.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import { agentManager } from '../ws/AgentManager.js';
import { TaskService } from '../services/TaskService.js';
import { validateJob, NativeJob } from '../services/NativeTaskExecutor.js';
import { buildNativeJob } from '../services/nativeJob.js';
import { missingSecretRefs, secretRefsIn } from '../services/jobSecrets.js';
import {
  deleteTaskSecret,
  listTaskSecretNames,
  setTaskSecret,
  TaskSecretError
} from '../services/taskSecrets.js';
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
import { recordCapability, runVerbSucceeded, verbDeclaredUnsupported } from '../services/platformCapabilities.js';
import { taskSourceKey } from '../services/taskSource.js';
import { ensureClaudeConnection } from '../services/claudeConnection.js';
import {
  archiveTaskBeforeDelete,
  buildNativeTaskBundle,
  ArchiveWriteError
} from '../services/taskArchive.js';
import { createNativeTask, NativeTaskCreateError } from '../services/nativeTaskCreate.js';
import { parseTaskBundle, TaskImportError } from '../services/taskImport.js';

const router = Router();

// Unexpected errors thrown below (or from rejected promises) fall through to
// the app-level error handler — routes only catch what they can act on.

const platformSchema = z.enum(PlatformType, { message: 'Invalid platform' });

import { isValidCron } from '../utils/cron.js';
import { previewSchedule } from '../services/schedulePreview.js';

// List all tasks (with a flattened last-run summary for the dashboard)
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const [tasks, favorites, memberships] = await Promise.all([
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
    prisma.taskFavorite.findMany({ where: { userId }, select: { taskId: true } }),
    // Scoped through the collection's owner, not the task's: a membership row is
    // reachable only from a collection, so this is the join that cannot return
    // another tenant's grouping even if a task id were somehow shared.
    prisma.taskCollectionMember.findMany({
      where: { collection: { userId } },
      select: { taskId: true, collectionId: true }
    })
  ]);
  const favoriteIds = new Set(favorites.map(f => f.taskId));
  const collectionsByTask = new Map<string, string[]>();
  for (const m of memberships) {
    const list = collectionsByTask.get(m.taskId);
    if (list) list.push(m.collectionId);
    else collectionsByTask.set(m.taskId, [m.collectionId]);
  }
  res.json(tasks.map(({ executions, ...task }) => ({
    ...task,
    lastRunStatus: executions[0]?.status ?? null,
    lastRunAt: executions[0]?.triggeredAt ?? null,
    lastRunDurationMs: executions[0]?.durationMs ?? null,
    // Per-viewer, from the TaskFavorite join — never a column on Task, which in a
    // multi-tenant DB would make one user's star everyone's.
    isFavorite: favoriteIds.has(task.id),
    // Which hand-picked collections hold this task. Same per-viewer join rule as
    // `isFavorite` — a collection belongs to a user, not to the task. Sent as
    // ids rather than names so a rename is one write and never a re-sync of
    // every task row.
    collectionIds: collectionsByTask.get(task.id) ?? [],
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
    throw new HttpError(400, `Editing schedules is not supported for ${task.platform}.`);
  }

  // Converted for the platforms that register a native trigger, and passed as an
  // option rather than as *the* schedule. This used to throw 400 whenever the
  // conversion failed — which is right for Windows and wrong for any platform
  // whose schedule already *is* a cron: a Claude routine takes 5-field UTC cron
  // directly, so a reschedule Anthropic would have accepted was being refused
  // here over a Windows trigger nobody in that path was going to use.
  const conversion = convertCronToWindowsTrigger(schedule);

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: task.platform } }
  });

  // Config is encrypted at rest (AES-256-GCM); decrypt before use.
  const result = await connector.updateSchedule(
    task.externalId,
    schedule,
    { ...deserializeConfig(connection?.config), userId },
    { trigger: conversion.trigger }
  );
  await recordCapability(userId, task.platform, 'updateSchedule', result.success, result.message);
  if (!result.success) {
    // `clientError` distinguishes "this request can never work" from "the
    // platform failed" — a 502 tells the user to retry something that will
    // refuse identically every time.
    // The warnings describe what the *Windows* conversion had to give up, so
    // they only travel to the platform that consumes that trigger. Attaching
    // them everywhere told a Gemini user their cron would be "REPLACED with a
    // fixed hourly trigger" — a sentence about a platform not in the request,
    // beside a refusal that had nothing to do with fidelity.
    throw result.clientError
      ? new HttpError(400, result.message || 'The schedule cannot be used on this platform', {
          ...(task.platform === PlatformType.WINDOWS_TASK_SCHEDULER && conversion.warnings.length
            ? { warnings: conversion.warnings }
            : {})
        })
      : new HttpError(502, result.message || 'The platform failed to update the schedule');
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
  // A lossy conversion has to travel with the SUCCESS too, not only the refusal.
  // The create route has always returned this; update dropped it, and that gap
  // only became reachable when the converter stopped mis-reporting a multi-value
  // hour as an exact match: those used to die at the agent with a 502, so nobody
  // could receive a silent "200" over a schedule that had been replaced with an
  // hourly trigger. Refusing instead would be the wrong lever — `0 4 1 1 *` has
  // always been accepted-and-replaced, and one unexpressible cron may not answer
  // differently from another. Spread rather than nested, so existing readers of
  // the task fields are untouched.
  res.json(conversion.lossy ? { ...updatedTask, conversion } : updatedTask);
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
    throw new HttpError(400, `Editing actions is not supported for ${task.platform}.`);
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
  command: z.string().trim().min(1, 'command is required'),
  /**
   * Claude Code only: the git repositories the routine may check out and work
   * in. Never defaulted — a routine with no sources still runs, it simply has
   * no checkout, whereas attaching the wrong repository to an agent that can
   * commit is not a mistake the user can see before it happens.
   */
  repositoryUrls: z.array(z.string().trim().url()).max(10).optional(),
  /**
   * Claude Code only: the routine's tool allowlist (`["Bash","Read",…]`).
   * Absent means the platform's own default — Cronsole does not narrow it
   * silently, because a routine that cannot do its job fails at 3am rather
   * than at the click that created it.
   */
  allowedTools: z.array(z.string().trim().min(1)).max(50).optional(),
  /**
   * Gemini only: what the agent may use, and what its sandbox may reach.
   *
   * **The one place in this schema that accepts a credential.** `headers` on an
   * MCP server is a bearer token, and it is validated here like any other
   * boundary input and then never stored — `createTrigger` puts it in the
   * request body and Cronsole keeps no copy. That is why `agentTools` is an
   * input type with no stored counterpart.
   *
   * Bounded deliberately: ten tools, five headers each, and a URL that must
   * parse. An unbounded header map on a create route is a place to stuff
   * arbitrary data into somebody else's HTTP request.
   */
  agentTools: z
    .array(
      z.object({
        type: z.string().trim().min(1),
        name: z.string().trim().min(1).max(100).optional(),
        url: z.string().trim().url().max(500).optional(),
        headers: z.record(z.string().trim().min(1).max(100), z.string().max(4096)).optional(),
        // A saved MCP server by name. Resolved by the connector, never here:
        // which store a preset lives in is a fact about the platform.
        preset: z.string().trim().min(1).max(60).optional()
      })
    )
    .max(10)
    .optional(),
  /**
   * Gemini only: domains the sandbox may contact. Absent means none, which is
   * the default and the safe direction — an agent that can reach nothing is a
   * smaller problem than one that can reach the wrong thing.
   */
  agentAllowlist: z.array(z.string().trim().min(1).max(253)).max(20).optional()
});

// Create a new task (New Task modal Windows path, cloning, custom creation)
router.post('/', validateBody(createTaskSchema), async (req: Request, res: Response) => {
  const { name, platform, category, schedule, command, folder, createFolder, repositoryUrls, allowedTools, agentTools, agentAllowlist } = req.body;
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

  // Same reason as sync: with a readable Claude Code session the platform is
  // reachable before any connection row exists, and refusing the create over a
  // missing row would be Cronsole declining to do something it can do.
  if (platform === PlatformType.CLAUDE_CODE) {
    await ensureClaudeConnection(userId);
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
    {
      trigger,
      folder: finalFolder,
      createFolder: createFolder === true,
      // Native-only: it writes its own row, so the label rides along with the
      // create rather than being applied to a row the caller upserted.
      ...(category ? { category } : {}),
      // Claude-only, and never defaulted. A routine with no repositories still
      // runs; attaching the wrong one to an agent with write access is the
      // mistake a user cannot see before it happens.
      ...(repositoryUrls ? { repositoryUrls } : {}),
      ...(allowedTools ? { allowedTools } : {}),
      // Gemini-only, same rule as repositoryUrls above and for the same reason:
      // never defaulted. The connector refuses a tool type it does not know
      // rather than dropping it, so a typo cannot quietly produce a trigger with
      // less reach than the form showed.
      ...(agentTools ? { agentTools } : {}),
      ...(agentAllowlist ? { agentAllowlist } : {})
    }
  );

  await recordCapability(userId, platform, 'create', result.success, result.message);

  if (!result.success) {
    // foldersCreated rides the ERROR too. A create can build the folder chain
    // and then fail to register into it, and Cronsole does not delete folders —
    // so the folder is real, needs an admin to remove, and the one response the
    // caller will ever see must say so rather than reporting a clean failure.
    // Same split as setStatus: a platform with no create API at all is a 400,
    // not a 500. Claude routines are made at claude.ai and nowhere else.
    // **A refusal the connector reached without calling out is a 400.** It was
    // a flat 500 for anything on a platform that declares `create`, which put
    // "you named a saved server that does not exist" — a mistake with the fix in
    // the message — in the same register as "the platform is down". A 500 tells
    // the caller to retry, and retrying an identical bad request never helps.
    const clientMistake = verbDeclaredUnsupported(platform, 'create') || result.refusedBeforeCalling === true;
    return res.status(clientMistake ? 400 : 500).json({
      error: result.message || 'Failed to create task',
      ...(result.foldersCreated?.length ? { foldersCreated: result.foldersCreated } : {})
    });
  }

  // Cronsole-native writes its OWN row inside the connector, job spec included —
  // for that platform the row *is* the task. The upsert below would overwrite
  // `metadata` with the `{schedule, command, state}` shape every other platform
  // carries, dropping `metadata.job` and leaving a task the executor refuses to
  // run ("Task has no job spec in metadata.job") after a create that reported
  // success. So it is read back rather than written again. (The template-apply
  // route has skipped native for this reason since native shipped; this path did
  // not, and the defect was unreachable only because nothing created a native
  // task through the connector.)
  if (platform === PlatformType.TASKHUB_NATIVE) {
    const created = await prisma.task.update({
      where: { platform_externalId: { platform, externalId: result.externalId! } },
      data: category ? { category } : {}
    });
    notifyTasksChanged(userId);
    return res.json({
      message: 'Task created successfully',
      task: created,
      conversion: { warnings: conversionWarnings, lossy: conversionLossy },
      foldersCreated: []
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
    // **The connector's own sentence wins when it has one.** `describeGrant`
    // states what a Gemini create actually granted — the tools, the domains, and
    // where a supplied credential now lives — and §9 requires the confirmation to
    // say it, because reach is the consequential half of creating an autonomous
    // task and this is the last moment anyone reads before it starts running on a
    // schedule. It was being built and then overwritten with the line below:
    // every caller saw "Task created successfully" and the grant reached nobody.
    // #65's shape — grep the thing you produce, and if every hit writes it, the
    // feature is half-built however green the suite is.
    message: result.message || 'Task created successfully',
    task: upserted[0],
    conversion: { warnings: conversionWarnings, lossy: conversionLossy },
    // Always present (empty array when nothing was created), never conditional:
    // Cronsole creating a folder is the exception to a standing invariant, so
    // the caller must be able to read the answer rather than infer it from an
    // absent key.
    foldersCreated: result.foldersCreated ?? []
  });
});

const createNativeSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  category: z.string().trim().min(1).optional(),
  schedule: z.string().trim().min(1, 'schedule is required'),
  job: z.unknown(), // semantic validation stays in validateJob (shared with the executor)
  /**
   * Secret name → value, encrypted at rest and never returned (ADR 0003).
   *
   * Accepted on **create only**, so that making a task and giving it its
   * credential is one gesture. Every other write is per secret
   * (`PUT /:id/secrets/:name`), because a whole-set write is what destroys the
   * secrets a client forgot to resend — and there is no read path to notice
   * with. Name and length rules live in `validateSecret`, one definition shared
   * with those routes.
   */
  secrets: z.record(z.string(), z.string()).optional()
});

// Create a Cronsole-native task (scheduled + executed by the backend itself —
// docs/resources/Native_Tasks.md). Richer than the connector createTask path
// because it takes a full job spec instead of a command string.
router.post('/native', validateBody(createNativeSchema), async (req: Request, res: Response) => {
  const { name, category, schedule, job, secrets } = req.body;
  const userId = (req as AuthRequest).user!.id;

  // Normalization, cron validation, the row, the capability evidence and the UI
  // notification all live in `createNativeTask`, shared with the import and
  // archive-restore paths — see the note there for why the split is at this line.
  const created = await createNativeTask(userId, { name, category, schedule, job, secrets })
    .catch(rethrowNativeCreate);
  // `missingSecrets` is always present, empty when there is nothing to say —
  // same rule as `foldersCreated` on the generic create, and for the same
  // reason: an absent key is not an answer.
  res.json({
    message: 'Native task created',
    task: created.task,
    missingSecrets: created.missingSecrets
  });
});

/** A create refusal is bad input, not a bug — 400, with the reason it gave. */
function rethrowNativeCreate(err: unknown): never {
  if (err instanceof NativeTaskCreateError) throw new HttpError(400, err.message);
  throw err;
}

/**
 * Import a Cronsole task file — the read half of `GET /api/tasks/:id/export`.
 *
 * The body **is** the file: no wrapper, no options, so "import this" is one POST
 * of exactly what Export downloaded, the same way `POST /api/templates/import`
 * takes a template file verbatim.
 *
 * **One file, one task, deliberately.** Nothing in Cronsole produces a
 * multi-task JSON — per-task export is per task, and the bulk export is Windows
 * XML — so a batch form would be a shape with no producer, and it would owe the
 * five-outcome `bulkOutcome` contract that every real bulk verb here carries.
 *
 * **Cronsole-native only**, and that is a property of the format rather than a
 * limitation of this route: a native task's row *is* the task, so it round-trips;
 * a Windows task's definition lives on the machine and comes back as Task
 * Scheduler XML through `POST /api/tools/restore/tasks`. `parseTaskBundle`
 * refuses the others by name and points at that route.
 *
 * The imported task is **ACTIVE**, like every other create path — the bundle
 * records no status, so pausing it would be inventing a state the file does not
 * contain. `nextRunTime` comes back in the response so the caller can say when
 * it will first fire rather than leaving that to be discovered.
 *
 * Declared here rather than on `/api/tools` because it creates one task — it is
 * a sibling of `/native`, not a cross-task report. It is a single path segment,
 * so it competes with no `/:id` route (there is no `POST /:id`).
 */
router.post('/import', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;

  let parsed;
  try {
    parsed = parseTaskBundle(req.body);
  } catch (err) {
    if (err instanceof TaskImportError) throw new HttpError(400, err.message);
    throw err;
  }

  const created = await createNativeTask(userId, parsed).catch(rethrowNativeCreate);
  // A bundle carries a job that *names* its secrets and holds none of them —
  // deliberately, since a value in a downloaded file is the thing ADR 0003
  // exists to prevent. So the honest answer to "did this import?" is "yes, and
  // here is what it still needs", not a refusal and not silence.
  res.status(201).json({
    message: 'Task imported',
    task: created.task,
    nextRunTime: created.task.nextRunTime,
    missingSecrets: created.missingSecrets
  });
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

  // Secrets are untouched by a job edit, and that is the whole reason they live
  // in their own row rather than inside the job (ADR 0003): this route
  // *replaces* the job, so a secret stored inside one would be destroyed by
  // every schedule-adjacent edit. What the new job may have changed is which
  // secrets it *needs* — reported, never silently left for 3am.
  const stored = await listTaskSecretNames(id);

  // The write IS the change here, so success is known rather than reported —
  // unlike the Windows path, which records only after the agent confirms.
  await recordCapability(userId, PlatformType.TASKHUB_NATIVE, 'updateAction', true);
  notifyTasksChanged(userId);
  res.json({ ...updated, missingSecrets: missingSecretRefs(nativeJob, stored.names) });
});

/**
 * The secrets a Cronsole-native job refers to — **names only, always** (ADR 0003).
 *
 * There is no route anywhere that returns a value. That is not a filter this
 * handler applies and a future one could forget; it is the absence of a read
 * path, which is why the values live in a relation Prisma does not load by
 * default rather than in a column every task read would carry.
 *
 * `referenced` is what the *job* asks for and `stored` is what the task *has*,
 * reported separately rather than merged into one list. They disagree in both
 * directions and the two disagreements mean different things: a referenced
 * secret that is not stored is a task that will refuse to run, while a stored
 * secret nothing references is harmless clutter left behind by an edit. One
 * merged list would have to pick which of those to be wrong about.
 *
 * `unreadable` is a third state and never collapses into "none". A row that
 * exists and cannot be decrypted (`ENCRYPTION_KEY` changed) reports zero names
 * either way, and calling that "no secrets" would tell the user to set values
 * that are already there — absence of evidence is `unknown`, never `ok`.
 */
router.get('/:id/secrets', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw new HttpError(404, 'Task not found');
  requireNativeForSecrets(task.platform);

  const stored = await listTaskSecretNames(id);
  const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? (task.metadata as Record<string, unknown>)
    : {};

  res.json({
    stored: stored.names,
    referenced: secretRefsIn(meta.job),
    missing: missingSecretRefs(meta.job, stored.names),
    unreadable: stored.unreadable,
    // One timestamp for the row, and named for the event that writes it. A
    // per-secret `updatedAt` would be a real timestamp of the wrong thing, which
    // is the shape troubleshooting #42 is about.
    secretsUpdatedAt: stored.updatedAt
  });
});

const putSecretSchema = z.object({ value: z.string() });

/**
 * Store one secret. Write-only: the response says what the task now holds, by
 * name, and never echoes what was sent.
 *
 * **`PUT` on a named secret rather than `POST` to a collection**, because
 * setting a secret and replacing it are the same act — a credential is rotated
 * far more often than it is first entered, and a create/replace split would make
 * the common case the one that needs to know whether it already exists.
 */
router.put('/:id/secrets/:name', validateBody(putSecretSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const name = req.params.name as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw new HttpError(404, 'Task not found');
  requireNativeForSecrets(task.platform);

  let stored: string[];
  try {
    stored = await setTaskSecret(id, name, req.body.value);
  } catch (err) {
    if (err instanceof TaskSecretError) throw new HttpError(400, err.message);
    throw err;
  }

  const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? (task.metadata as Record<string, unknown>)
    : {};
  notifyTasksChanged(userId);
  res.json({ message: `Secret "${name}" saved`, stored, missing: missingSecretRefs(meta.job, stored) });
});

/**
 * Remove one secret.
 *
 * Deleting one the job still references is **allowed and reported**, not
 * refused: you may well be removing it precisely because you are about to edit
 * the job, and a delete that refuses until the job changes first makes the two
 * halves of one intention block each other. The response names what the task
 * will now refuse to run on.
 */
router.delete('/:id/secrets/:name', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const name = req.params.name as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw new HttpError(404, 'Task not found');
  requireNativeForSecrets(task.platform);

  const removed = await deleteTaskSecret(id, name);
  if (!removed) throw new HttpError(404, `This task has no secret called "${name}".`);

  const stored = await listTaskSecretNames(id);
  const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? (task.metadata as Record<string, unknown>)
    : {};
  notifyTasksChanged(userId);
  res.json({
    message: `Secret "${name}" removed`,
    stored: stored.names,
    missing: missingSecretRefs(meta.job, stored.names)
  });
});

/**
 * Secrets belong to a Cronsole-native job, and the refusal says why rather than
 * 404ing on a route that exists.
 *
 * Every other platform owns its own definition, so a credential Cronsole stored
 * would never reach the thing that runs the task — it would be a secret with no
 * consumer, which is worse than none.
 */
function requireNativeForSecrets(platform: PlatformType): void {
  if (platform !== PlatformType.TASKHUB_NATIVE) {
    throw new HttpError(
      400,
      `Task secrets belong to a Cronsole-native job; this one is ${platform}. Cronsole runs native ` +
        'jobs itself, so it can substitute a stored secret into one — every other platform owns its ' +
        'own definition, and a secret Cronsole held would never reach the thing that runs the task.'
    );
  }
}

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
    // .trackedCategories). This is what a plain "Sync" sends: the caller must NOT
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

  // A Claude Code session on this machine makes the platform reachable with no
  // setup step, but sync only ever looks at connection rows — so without this a
  // user with routines Cronsole can already read would sync and see nothing,
  // with the Platforms tab still inviting them to paste per-routine tokens.
  await ensureClaudeConnection(userId);

  const connections = await prisma.platformConnection.findMany({
    where: { userId, isActive: true }
  });

  const results = [];

  for (const conn of connections) {
    const connector = connectorRegistry.getConnector(conn.platform);
    if (connector) {
      // One platform failing must not abort the others' sync.
      try {
        const connectorConfig = { ...deserializeConfig(conn.config), userId };
        // A connector may return a bare list or a `SyncOutcome` that also says
        // what it *looked at*. Normalized once, here, so nothing downstream has
        // to know which form it got.
        const outcome = syncOutcomeOf(await connector.syncTasks(connectorConfig));
        let tasks = outcome.tasks;
        const allExternalIds = tasks.map(t => t.externalId);

        // Resolve the include-set. `scope: 'tracked'` is computed per platform;
        // an empty set legitimately means "sync nothing here", so it must still
        // filter rather than fall through to "sync everything" — hence the
        // `!== undefined` check, not truthiness.
        //
        // **A connector may declare its own tracked set**, and one does. The
        // default — categories that already hold stored rows — encodes how a
        // folder becomes tracked on Windows: you pick it in the discovery modal,
        // and the rows are the only record that you did. GitHub Actions keeps
        // that record in its config instead (the repositories you watch), so
        // deriving from rows made adding a repository unable to adopt anything:
        // no rows yet, empty include-set, every workflow filtered out, and
        // **Sync reporting success over nothing on every press**. Asking the
        // connector keeps the platform-specific half inside the connector layer,
        // where §9 requires it.
        const include = scope === 'tracked'
          ? connector.trackedCategories?.(connectorConfig)
            ?? await TaskService.trackedCategories(userId, conn.platform)
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
        // `scope: 'tracked'` (the plain Sync) deliberately does NOT clear: it is a
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
        // #20): a plain Sync cannot discover a new folder, so tasks can sit one
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
        //
        // **And never on a partial view.** A connector that saw less than the
        // whole platform says so (`outcome.partial`), and a task absent from a
        // narrowed enumeration is not evidence the task is gone — it is evidence
        // the reader was narrowed. Retiring on one is how an unelevated agent
        // declared 86 healthy tasks MISSING (#74); the 50%-retention guard does
        // not help, because a plausible-looking partial read is the dangerous
        // kind.
        let missing = 0;
        if (conn.platform !== 'TASKHUB_NATIVE' && allExternalIds.length > 0 && !outcome.partial) {
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
        results.push({
          platform: conn.platform,
          count: tasks.length,
          missing,
          untracked,
          exclusionsCleared,
          // What this sync covered, in the connector's own words. Present only
          // where a connector has something to add: "found nothing" and "looked
          // at nothing" are the same on screen otherwise, and that ambiguity has
          // now hidden a real defect once (troubleshooting #75).
          ...(outcome.notes?.length ? { notes: outcome.notes } : {}),
          ...(outcome.warnings?.length ? { warnings: outcome.warnings } : {})
        });
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
        const { tasks } = syncOutcomeOf(await connector.syncTasks({ ...deserializeConfig(conn.config), userId }));
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
      throw new HttpError(400, `Deleting tasks is not supported for ${task.platform}. Remove the task on its own platform instead.`);
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

  /**
   * Archive a native task before destroying it — the same precondition the MCP
   * delete route has always had.
   *
   * This path did not archive until 2026-08-17, which made the archive a
   * property of *which door you deleted through*: an agent's delete was
   * recoverable and the user's own Delete button was not. Nobody would have
   * predicted that from either screen, and the difference only shows up at the
   * moment someone goes looking for the task they just deleted.
   *
   * Native only, and that is the format's boundary rather than a shortcut: a
   * Windows task's definition lives on the machine and reaching it needs an
   * online agent, which cannot be a precondition of a delete. Archiving one
   * anyway would store a bundle whose `job` is null — a record that looks like a
   * backup and cannot restore anything, which is the failure mode the throwing
   * archive was built to avoid.
   */
  let archiveId: string | null = null;
  if (task.platform === PlatformType.TASKHUB_NATIVE) {
    try {
      ({ archiveId } = await archiveTaskBeforeDelete(task, { deletedVia: 'ui' }));
    } catch (err) {
      if (err instanceof ArchiveWriteError) throw new HttpError(500, err.message);
      throw err;
    }
  }

  await prisma.$transaction([
    prisma.executionLog.deleteMany({ where: { taskId: id } }),
    prisma.task.delete({ where: { id } })
  ]);

  notifyTasksChanged(userId);
  // `archived` is always present, never conditional — a caller must be able to
  // read whether this is recoverable rather than infer it from a missing key.
  res.json({ message: 'Task deleted', archived: archiveId !== null, archiveId });
});

/**
 * Delete a Cronsole-native task, archiving its definition first.
 *
 * This is the narrow sibling of `DELETE /:id`, and it exists so the MCP server
 * has a delete verb whose blast radius is bounded. Two things it will not do:
 *
 *  1. **It refuses any platform but TASKHUB_NATIVE.** Not because those
 *     platforms cannot be deleted — Windows deletes fine through the elevated
 *     agent, which is exactly the problem — but because destroying a real Task
 *     Scheduler entry should have a human at a confirm dialog rather than an
 *     agent inferring intent. The UI keeps `DELETE /:id` and its full reach.
 *     This is *not* `verbDeclaredUnsupported`: that reports a boundary of the
 *     platform, and this is a boundary of the route. A caller who wants a
 *     Windows task off the dashboard wants `POST /api/tools/tasks/untrack`,
 *     which leaves the real task running.
 *
 *  2. **It will not delete anything it could not archive first.** The archive
 *     write is a precondition, so an archive failure aborts the delete with the
 *     task still intact. The alternative — delete anyway, log the archive
 *     failure — is worse than having no archive at all, because the caller
 *     proceeds believing the task is recoverable.
 *
 * Why the restriction lives here and not in `mcp-server/`: the wrapper owns no
 * logic, and a platform check written there would be a *client-side* check that
 * the REST route still ignores. The guarantee has to be a property of the route
 * or it is not a guarantee.
 */
router.delete('/:id/native', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  if (task.platform !== PlatformType.TASKHUB_NATIVE) {
    throw new HttpError(
      400,
      `This route deletes Cronsole-native tasks only, and this task is on ${task.platform}. ` +
        'Deleting it would remove the real scheduled task from the machine, which is deliberately ' +
        'not available here. To take it off the Cronsole dashboard while leaving it running, ' +
        'untrack it instead; to genuinely destroy it, use the task modal in the Cronsole UI.'
    );
  }

  // Before the transaction below, and allowed to abort it. Translated to a 500
  // rather than swallowed: the caller has to be able to tell "deleted" from
  // "refused because I could not back it up", and those must not share a shape.
  let archiveId: string;
  let executionsArchived: number;
  try {
    ({ archiveId, executionsArchived } = await archiveTaskBeforeDelete(task, {
      deletedVia: 'mcp'
    }));
  } catch (err) {
    if (err instanceof ArchiveWriteError) {
      throw new HttpError(500, err.message);
    }
    throw err;
  }

  // Native deletes never reach a connector — the DB row *is* the task — so the
  // evidence is recorded here, the same way reschedule and export do it.
  await recordCapability(userId, task.platform, 'delete', true);

  await prisma.$transaction([
    prisma.executionLog.deleteMany({ where: { taskId: id } }),
    prisma.task.delete({ where: { id } })
  ]);

  notifyTasksChanged(userId);
  res.json({
    message: 'Task deleted',
    archived: true,
    archiveId,
    executionsArchived
  });
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

/**
 * Load a task the caller owns, plus its connector and decrypted config.
 *
 * The three lines every platform-run route repeats, in one place — the
 * ownership check most of all: run history and run *output* are the two things
 * on a task most worth an IDOR, since the second is whatever an agent was told
 * to produce.
 */
async function ownedTaskWithConnector(id: string, userId: string) {
  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) throw new HttpError(404, 'Task not found');

  const connector = connectorRegistry.getConnector(task.platform);
  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform: task.platform } }
  });
  // Config is encrypted at rest (AES-256-GCM); decrypt before use.
  return { task, connector, config: { ...deserializeConfig(connection?.config), userId } };
}

const rotateCredentialsSchema = z.object({
  /**
   * The complete replacement tool list, with fresh credentials.
   *
   * **Complete, not a patch.** The platform's stored `headers` are unreadable —
   * Cronsole never parses them and could not send back what it does not have —
   * so a partial update would silently drop the credentials of every tool the
   * caller did not mention. Asking for the whole list makes what the replacement
   * will hold explicit at the one moment somebody is looking at it.
   */
  agentTools: z
    .array(
      z.object({
        type: z.string().trim().min(1),
        name: z.string().trim().min(1).max(100).optional(),
        url: z.string().trim().url().max(500).optional(),
        headers: z.record(z.string().trim().min(1).max(100), z.string().max(4096)).optional(),
        // A saved MCP server by name. Resolved by the connector, never here:
        // which store a preset lives in is a fact about the platform.
        preset: z.string().trim().min(1).max(60).optional()
      })
    )
    .max(10),
  agentAllowlist: z.array(z.string().trim().min(1).max(253)).max(20).optional(),
  /**
   * A new prompt and/or schedule to build the replacement with.
   *
   * **Optional in the other direction from `agentTools`.** The tool list is
   * always complete because the platform's credentials are unreadable; these two
   * are read back off the platform a moment before the rebuild, so an omitted
   * field means "keep what is there" and a *changed* one is the whole reason
   * somebody opened this dialog. Absent is not the same as empty: an empty
   * prompt would be a trigger that instructs an agent to do nothing.
   */
  prompt: z.string().trim().min(1).max(10000).optional(),
  /** 5-field cron **in UTC** — the storage contract. Converted at the browser's edge. */
  schedule: z.string().trim().min(1).optional()
});

/**
 * Recreate a task on the platform — new credentials, prompt or schedule.
 *
 * **A rebuild route, because a token outlives nothing and this platform's task
 * definition is immutable.** Gemini's `PATCH` accepts a status and a display
 * name; an MCP bearer token lives inside the interaction, which nothing can
 * edit — and so does the prompt, which is the field people actually iterate on.
 * Without this, the day a token expires (or a prompt needs one more sentence)
 * the only path is "delete it and rebuild it from memory" — and the memory
 * Cronsole could offer is exactly the part it deliberately does not store.
 *
 * **The path stays `/rotate-credentials` while the verb has grown.** Renaming a
 * route to match a widened meaning costs every caller and buys a word; what
 * matters is that the *contract* says what it does, which the schema and this
 * comment do. `PATCH /:id/schedule` and `/:id/actions` remain the in-place
 * edits, and remain unsupported here — a recreate is a different act with a new
 * platform id at the end of it, and the UI names it as one.
 *
 * **The row is rekeyed, not replaced.** The platform assigns a new id, but the
 * `Task` row keeps its own primary key — so favourites, collections, run
 * history and the Cronsole name survive a rotation, which is the whole
 * difference between this and deleting the task and making another one.
 * `(platform, externalId)` stays unique because the old trigger is gone.
 */
router.post('/:id/rotate-credentials', validateBody(rotateCredentialsSchema), async (req: Request, res: Response) => {
  const { task, connector, config } = await ownedTaskWithConnector(
    req.params.id as string,
    (req as AuthRequest).user!.id
  );

  if (!connector?.rotateCredentials) {
    throw new HttpError(400, `${task.platform} cannot be recreated with changes by Cronsole.`);
  }

  const { agentTools, agentAllowlist, prompt, schedule } = req.body as {
    agentTools: AgentToolInput[];
    agentAllowlist?: string[];
    prompt?: string;
    schedule?: string;
  };

  // Validated here rather than in the schema, from `isValidCron` — the one
  // definition every other schedule-taking route uses. A cron the platform will
  // reject is the caller's mistake, and a 400 that names it beats a 502 that
  // hands back somebody else's parser error.
  if (schedule && !isValidCron(schedule)) {
    throw new HttpError(400, `Invalid cron expression: "${schedule}". Use 5 fields, in UTC.`);
  }

  const result = await connector.rotateCredentials(
    task.externalId,
    agentTools,
    agentAllowlist ?? [],
    config,
    { ...(prompt ? { prompt } : {}), ...(schedule ? { schedule } : {}) }
  );

  if (!result.success || !result.newExternalId) {
    // A 502: the platform declined. The original is untouched by construction —
    // the connector creates the replacement before removing anything.
    throw new HttpError(502, result.message || 'The platform could not replace this credential.');
  }

  await prisma.task.update({
    where: { id: task.id },
    data: {
      externalId: result.newExternalId,
      // **Written from the platform's report of the replacement, never from the
      // request.** A schedule change that showed on the dashboard only after the
      // next sync would leave the calendar drawing the old cadence over a
      // trigger that no longer runs it; echoing the request instead would state
      // what Cronsole asked for. `null` means the platform said nothing, and
      // then the old value is still the best thing known.
      ...(result.newSchedule ? { schedule: result.newSchedule } : {}),
      nextRunTime: result.newNextRunTime ?? null,
      // The stored metadata describes the OLD trigger's reach. Clearing the two
      // reach fields rather than guessing keeps the task honest until the next
      // sync reads what the replacement actually holds — inventing them from the
      // request would state what Cronsole *asked for*, not what exists. The
      // prompt is different in kind: the platform hands it straight back, so it
      // is evidence rather than a guess and is written rather than dropped.
      metadata: withPrompt(stripReach(task.metadata), result.newPrompt)
    }
  });

  notifyTasksChanged((req as AuthRequest).user!.id);

  res.json({
    rotated: true,
    externalId: result.newExternalId,
    // **Surfaced, never folded into `rotated`.** False means the replacement is
    // live and the original is ALSO still running, so this schedule now fires
    // twice — the one outcome that must not read as a plain success.
    oldRemoved: result.oldRemoved !== false,
    message: result.message
  });
});

/**
 * The prompt the replacement actually carries, or none at all.
 *
 * A `null` from the connector means the platform did not report one, and a
 * stale prompt over a rebuilt trigger is the kind of quiet lie #82 was: the key
 * is removed rather than left describing a trigger that no longer exists.
 */
function withPrompt(metadata: Prisma.InputJsonValue, prompt: string | null | undefined): Prisma.InputJsonValue {
  const meta = { ...(metadata as Record<string, unknown>) };
  if (prompt) meta.prompt = prompt;
  else delete meta.prompt;
  return meta as Prisma.InputJsonValue;
}

/** Metadata with the platform-reported reach removed, pending the next sync. */
function stripReach(metadata: unknown): Prisma.InputJsonValue {
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  delete meta.tools;
  delete meta.networkAllowlist;
  return meta as Prisma.InputJsonValue;
}

/**
 * Runs the **platform** performed — read live, never stored.
 *
 * Deliberately a second endpoint rather than more rows on `/:id/executions`.
 * That one serves `ExecutionLog`, which holds only what *Cronsole* did, and the
 * separation is load-bearing: a Windows task firing on its own schedule writes
 * nothing there on purpose, so merging a platform's own history into it would
 * quietly turn a table with a precise meaning into one with none.
 *
 * Keeping them apart also keeps them honest about failure. This can be offline,
 * rate-limited, or refused by a revoked credential while Cronsole's own log is
 * perfectly readable — and the tab has to be able to show one and say why the
 * other is missing, rather than rendering a short list as a complete one.
 *
 * A platform that cannot serve this gets a **400 by absence**, the convention
 * every optional verb already follows.
 */
router.get('/:id/platform-runs', async (req: Request, res: Response) => {
  const { task, connector, config } = await ownedTaskWithConnector(
    req.params.id as string,
    (req as AuthRequest).user!.id
  );

  if (!connector?.listPlatformRuns) {
    throw new HttpError(400, `${task.platform} does not publish its own run history.`);
  }

  const result = await connector.listPlatformRuns(task.externalId, config);
  if (!result.success) {
    // The platform declining to answer is a gateway problem, not a bad request:
    // the same call may well work in a minute, which is the distinction a status
    // code is for.
    throw new HttpError(502, result.message || 'The platform could not be asked for its run history.');
  }
  res.json({ runs: result.runs ?? [] });
});

/**
 * What one platform run produced.
 *
 * Its own request because the payload is large and almost always unwanted — the
 * list says which runs have something to read, and this fetches the one that was
 * clicked. See `PlatformConnector.getRunOutput`.
 *
 * **A run with no readable output is a `200` carrying the reason, not a `404`.**
 * "Still running", "failed before producing anything" and "aged out of the
 * platform's list" are three different true statements, and each is worth more
 * to the person reading it than an error code that flattens all three into
 * *not found*.
 */
router.get('/:id/platform-runs/:runId/output', async (req: Request, res: Response) => {
  const { task, connector, config } = await ownedTaskWithConnector(
    req.params.id as string,
    (req as AuthRequest).user!.id
  );

  if (!connector?.getRunOutput) {
    throw new HttpError(400, `${task.platform} does not publish what a run produced.`);
  }

  const result = await connector.getRunOutput(task.externalId, req.params.runId as string, config);
  res.json(
    result.success
      ? { available: true, output: result.output }
      : { available: false, reason: result.message ?? 'This run has no readable output.' }
  );
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

/**
 * Export a user's *actual* tracked task, in one of two formats — and the two
 * answer different questions, which is why neither can be dropped.
 *
 * **`native` (default) — "put this exact task back on this platform."** Windows
 * exports as Task Scheduler XML retrieved through the agent (round-trips into
 * any Windows machine); a Cronsole-native task's DB row *is* the task, so it
 * exports as the `cronsoleTaskVersion` JSON `POST /api/tasks/import` reads back.
 *
 * **`template` — "recreate what this task does, anywhere."** A Registry v1
 * template: target-agnostic (Trigger → Action → Execution Target), compiled to a
 * platform's native config at apply time, and accepted verbatim by
 * `POST /api/templates/import`.
 *
 * **A single universal format cannot serve both**, and trying is the dangerous
 * option rather than the elegant one. Faithfully restoring a Windows task means
 * carrying its principal, logon type, run level and every action — at which
 * point the format *is* Task Scheduler XML with extra steps. Portability means
 * deliberately dropping exactly those fields, because no other platform can
 * honour them. Merge the two and you get a file that **looks** like a faithful
 * backup and silently is not: restore it and the task runs as the wrong account,
 * succeeding, so nothing warns you. That is the same failure family as an
 * archive that cannot restore.
 *
 * `template` reuses `buildTemplateFromTask` — the same builder
 * `POST /:id/save-as-template` uses — so the portable file and the saved
 * template can never become two different shapes. The difference is only the
 * side effect: **this route writes nothing**, which is the whole point. Wanting
 * a portable file used to cost a row in your catalog.
 */
router.get('/:id/export', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const format = typeof req.query.format === 'string'
    ? req.query.format.trim().toLowerCase()
    : 'native';
  if (format !== 'native' && format !== 'template') {
    throw new HttpError(
      400,
      `Unknown export format "${format}". Use "native" (this platform's own definition, which ` +
        'restores onto it) or "template" (a portable Registry v1 template, which recreates the ' +
        'task anywhere but drops platform-specific settings).'
    );
  }

  const task = await prisma.task.findFirst({ where: { id, userId } });
  if (!task) {
    throw new HttpError(404, 'Task not found');
  }

  if (format === 'template') {
    // Before the platform branches on purpose: a template is built from the DB
    // row and reaches no platform at all, so it works where a native export
    // cannot — a Claude routine has no native definition Cronsole can fetch,
    // and this still describes what it runs.
    let template;
    try {
      template = buildTemplateFromTask(task);
    } catch (err) {
      // The honest refusals: no 5-field cron (a boot/logon trigger is not
      // expressible as one), multiple actions, or no capturable command. Each
      // names itself rather than producing a template that quietly means
      // something else.
      if (err instanceof SaveAsTemplateError) throw new HttpError(400, err.message);
      throw err;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cronsole-template-${safeFilePart(task.name)}.json"`
    );
    // Deliberately NO recordCapability: nothing was asked of the platform, so
    // recording `export` here would mark the verb `verified` on evidence that
    // never touched it — and on Windows the native export needs an online agent
    // this path never uses. A verdict comes from what happened.
    return res.json(template);
  }

  if (task.platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    const connector = connectorRegistry.getConnector(task.platform);
    if (!connector?.exportTask) {
      throw new HttpError(400, `Exporting is not supported for ${task.platform}.`);
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
    // One definition, shared with the pre-delete archive (`taskArchive.ts`).
    // Two copies of the export shape would drift, and the drift would only
    // surface when someone tried to restore from an archive.
    const bundle = buildNativeTaskBundle(task);
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
  //
  // Which is why the predicate is `ran`, not `success`. They are orthogonal
  // (`PlatformConnector.runTask`), and row three of that table — `success:
  // false, ran: true` — is a native job that **executed** and reported failure.
  // A CHECK finding a missing file is the check *working*; recording it as a
  // `run` capability failure marks Cronsole-native's own Run verb broken for 15
  // minutes over a fact about the user's disk, and puts "1 verb failed more
  // recently than it succeeded" on the Sources tab of a platform that is fine.
  // That is troubleshooting #59 one layer up: the response branch below already
  // draws this line, and this call was left on the wrong side of it. Only
  // "could not be started at all" is a failure of the verb.
  const couldRun = runVerbSucceeded(result);
  await recordCapability(userId, task.platform, 'run', couldRun, couldRun ? null : result.message);

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
  } else if (result.ran) {
    // The job EXECUTED and reported failure. That is not a transport problem,
    // so it is a 200 carrying a failing verdict — the request succeeded, and
    // its answer is bad news about the user's system.
    //
    // This is the whole reason CHECK exists: a check that fails is the check
    // WORKING. Answering 502 here (as this route did until 2026-08-15) says
    // "the gateway had a problem, retry", so `run_task` threw and an agent
    // could not tell "your disk is full" from "monitoring is broken" — two
    // findings that demand opposite actions (troubleshooting #59).
    //
    // Native is the only platform that can reach this branch, because it is the
    // only one where dispatch and execution are the same act. Windows and Claude
    // keep the 502 below: there, a failure IS a failure to dispatch.
    res.json({
      ...result,
      // After the spread: a connector that returned no message must not blank
      // the one field a human reads to find out what failed.
      message: result.message || 'Task ran and reported failure',
      executionId: execution.id
    });
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
