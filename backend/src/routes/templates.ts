import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PlatformType } from '@prisma/client';
import { prisma } from '../db.js';
import { connectorRegistry } from '../connectors/registry.js';
import { AuthRequest } from '../auth/auth.js';
import { deserializeConfig } from '../auth/connectionConfig.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import {
  convertCronToWindowsTrigger,
  getTemplateConfidence,
  WindowsTrigger
} from '../utils/scheduler-conversion.js';
import { StructuredAction } from '../utils/commandParser.js';
import {
  resolveTemplateParams,
  substituteStructuredCommand,
  substitutePlainCommand,
  substituteNativeJob
} from '../utils/templateCommand.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
import { assertWindowsTaskNameAvailable } from '../utils/windowsTaskName.js';
import {
  DEFAULT_TASK_FOLDER,
  normalizeWindowsTaskFolder,
  windowsTaskFolderError,
  windowsTaskPath
} from '../utils/windowsTaskFolder.js';
import { TaskService } from '../services/TaskService.js';
import { recordCapability, verbDeclaredUnsupported } from '../services/platformCapabilities.js';
import { ensureClaudeConnection } from '../services/claudeConnection.js';
import { exportCatalog } from '../catalog/exportCatalog.js';
import { importTemplates } from '../catalog/importCatalog.js';
import { denormalizeTemplate } from '../catalog/denormalize.js';

const router = Router();

// Unexpected errors (and TemplateParamError from the substitution helpers)
// fall through to the app-level error handler.

const platformSchema = z.enum(PlatformType, { message: 'Invalid platform' });

import { isValidCron } from '../utils/cron.js';

/**
 * Resolve the platform-native trigger for a schedule. Only Windows needs a
 * converted trigger today; other platforms consume the cron directly.
 */
const resolveTrigger = (
  platform: PlatformType,
  schedule: string
): { trigger: WindowsTrigger | null; confidence: number; warnings: string[]; lossy?: 'approximated' | 'replaced' } => {
  if (platform !== PlatformType.WINDOWS_TASK_SCHEDULER) {
    return { trigger: null, confidence: 1.0, warnings: [] };
  }
  const result = convertCronToWindowsTrigger(schedule);
  return { trigger: result.trigger, confidence: result.confidence, warnings: result.warnings, lossy: result.lossy };
};

// List all templates (starters first, then alphabetical — the frontend re-sorts
// and groups anyway; upvotes were removed as a fake/static signal). Each template
// is enriched with a per-user `isFavorite` flag (the shared catalog is unchanged;
// favorites live in the TemplateFavorite join).
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const [templates, favorites] = await Promise.all([
    prisma.template.findMany({ orderBy: [{ isStarter: 'desc' }, { name: 'asc' }] }),
    prisma.templateFavorite.findMany({ where: { userId }, select: { templateId: true } })
  ]);
  const favoriteIds = new Set(favorites.map(f => f.templateId));
  res.json(templates.map(t => ({ ...t, isFavorite: favoriteIds.has(t.id) })));
});

// Only allow safe chars in a downloaded filename (avoid header injection / odd
// characters from a template name).
const safeFilePart = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'catalog';

// Export the catalog (or a subset) as a portable Registry v1 JSON download.
//   GET /export            -> whole catalog, as an { cronsoleCatalogVersion, ... } bundle
//   GET /export?ids=a,b    -> just those templates, same bundle shape
//   GET /export?id=x       -> a single template as a bare v1 object (nice to hand-edit)
// Reads the DB (what the user actually sees) and lowers each row to v1 via
// denormalizeTemplate; the file round-trips straight back through POST /import.
router.get('/export', async (req: Request, res: Response) => {
  const singleId = typeof req.query.id === 'string' ? req.query.id.trim() : '';

  if (singleId) {
    const row = await prisma.template.findUnique({ where: { id: singleId } });
    if (!row) throw new HttpError(404, 'Template not found');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition',
      `attachment; filename="cronsole-template-${safeFilePart(singleId)}.json"`);
    return res.json(denormalizeTemplate(row));
  }

  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  const bundle = await exportCatalog(new Date().toISOString(), ids);
  const stamp = bundle.exportedAt.slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="cronsole-catalog-${safeFilePart(stamp)}.json"`);
  res.json(bundle);
});

// Import Registry v1 templates into the shared catalog. Accepts a bundle
// ({ templates: [...] }), a bare array, or a single template object. Each entry
// is schema-validated and put through the same {{placeholder}} resolvability
// check Apply uses; bad entries are reported per-item without failing the batch.
// 400 when nothing could be imported (empty/all-invalid), 200 on partial/full
// success — the frontend re-fetches ['templates'] on success.
router.post('/import', async (req: Request, res: Response) => {
  const result = await importTemplates(req.body);
  const importedCount = result.created.length + result.updated.length;
  res.status(importedCount === 0 ? 400 : 200).json(result);
});

// Mark a template as a favorite for the current user (idempotent — favoriting an
// already-favorited template is a no-op success). Favorites are per-user and
// never touch the shared seeded catalog.
router.post('/:id/favorite', async (req: Request, res: Response) => {
  const templateId = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  const template = await prisma.template.findUnique({ where: { id: templateId } });
  if (!template) {
    throw new HttpError(404, 'Template not found');
  }

  await prisma.templateFavorite.upsert({
    where: { userId_templateId: { userId, templateId } },
    update: {},
    create: { userId, templateId }
  });
  res.json({ id: templateId, isFavorite: true });
});

// Remove a template from the current user's favorites (idempotent — removing a
// non-favorite is a success; the desired end state already holds).
router.delete('/:id/favorite', async (req: Request, res: Response) => {
  const templateId = req.params.id as string;
  const userId = (req as AuthRequest).user!.id;

  await prisma.templateFavorite.deleteMany({ where: { userId, templateId } });
  res.json({ id: templateId, isFavorite: false });
});

const previewSchema = z.object({
  platform: platformSchema,
  schedule: z.string().optional(),
  scheduleExpression: z.string().optional()
});

// Preview how a template + schedule converts for a target platform, so the
// Apply modal can warn about lossy cron→trigger conversions before creating.
// An unparseable schedule is a score-0 preview result, not a 400.
router.post('/:id/preview', validateBody(previewSchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { platform, schedule, scheduleExpression } = req.body;

  const template = await prisma.template.findUnique({ where: { id } });
  if (!template) {
    throw new HttpError(404, 'Template not found');
  }

  const finalSchedule =
    [schedule, scheduleExpression].find(s => typeof s === 'string' && s.trim())?.trim() ||
    template.scheduleExpression;

  if (!isValidCron(finalSchedule)) {
    return res.json({
      score: 0,
      warnings: ['Schedule must be a 5-field cron expression (min hour dom month dow).'],
      trigger: null
    });
  }

  const conversion = resolveTrigger(platform, finalSchedule);
  const compat = getTemplateConfidence(
    { ...template, scheduleExpression: finalSchedule },
    platform
  );

  res.json({
    score: Math.min(compat.score, conversion.confidence),
    warnings: [...new Set([...compat.warnings, ...conversion.warnings])],
    trigger: conversion.trigger,
    lossy: conversion.lossy
  });
});

const applySchema = z.object({
  platform: platformSchema,
  name: z.string().optional(),
  /**
   * Windows only: the native Task Scheduler folder to create the task in
   * (default \Cronsole). Validated with windowsTaskFolderError — it is signed
   * into the agent command, and the agent re-validates before registering.
   */
  folder: z.string().optional(),
  schedule: z.string().optional(),
  scheduleExpression: z.string().optional(),
  /** Deprecated: pre-substituted command string (legacy clients). */
  command: z.string().optional(),
  /**
   * Raw parameter values — the server owns {{placeholder}} substitution
   * (utils/templateCommand.ts validates shape and semantics for granular
   * per-parameter errors, so the boundary schema stays permissive here).
   */
  parameters: z.unknown().optional(),
  /**
   * Claude Code only: the git repositories the created routine may check out and
   * work in. Same rule as `POST /api/tasks` — never defaulted, because a routine
   * with no sources still runs (it just has no checkout) while attaching the
   * *wrong* repository to an agent that can commit is not a mistake the user can
   * see before it happens. Applying a Claude template without this creates a
   * routine that runs against nothing, which is why it is offered at all.
   */
  repositoryUrls: z.array(z.string().trim().url()).max(10).optional()
});

// Apply a template to a platform
router.post('/:id/apply', validateBody(applySchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { platform, command, schedule, scheduleExpression, name, parameters, folder, repositoryUrls } = req.body;
  const userId = (req as AuthRequest).user!.id;

  const template = await prisma.template.findUnique({
    where: { id }
  });
  if (!template) {
    throw new HttpError(404, 'Template not found');
  }

  // Resolve the task to create. Accept both `schedule` (what the modal sends)
  // and `scheduleExpression` (the template field name).
  const finalName =
    typeof name === 'string' && name.trim() ? name.trim() : template.name;

  // Windows: resolve the destination folder, then reject an invalid folder or
  // name (400) and a name that collides with a task Cronsole already tracks IN
  // THAT FOLDER (409) — RegisterTaskDefinition would otherwise silently
  // overwrite it. The collision is per-folder because that is how Windows'
  // overwrite works: \Work\Backup and \Cronsole\Backup are different tasks.
  let finalFolder = DEFAULT_TASK_FOLDER;
  if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    if (typeof folder === 'string' && folder.trim()) {
      const folderProblem = windowsTaskFolderError(folder);
      if (folderProblem) {
        throw new HttpError(400, folderProblem);
      }
      finalFolder = normalizeWindowsTaskFolder(folder);
    }
    await assertWindowsTaskNameAvailable(userId, finalName, finalFolder);
  }

  const finalSchedule =
    [schedule, scheduleExpression].find(s => typeof s === 'string' && s.trim())?.trim() ||
    template.scheduleExpression;

  // Command resolution. Preferred path: the client sends raw `parameters` and
  // the server owns {{placeholder}} substitution per-token, so a parameter is
  // always exactly one argument regardless of quotes/spaces in its value (see
  // utils/templateCommand.ts). Legacy path: a pre-substituted `command` string
  // (deprecated — kept for API compatibility; it gets re-tokenized downstream).
  let finalCommand: string;
  let structuredAction: StructuredAction | undefined;
  if (parameters !== undefined) {
    const commandTemplate = template.commandTemplate || template.command || '';
    const values = resolveTemplateParams(template.parameters, parameters);
    // Per-token substitution for every platform that ends up running a
    // *program*, so a parameter value containing spaces or quotes is exactly one
    // argument. Cronsole-native joined Windows here on 2026-08-13, when native
    // gained `EXEC` jobs: substituting into the string and re-tokenizing it
    // afterwards would split `C:\Program Files\app.exe` back into two arguments,
    // which is the injection-adjacent bug the structured path exists to prevent.
    // A Claude routine's "command" is a natural-language prompt, so it takes the
    // plain substitution — there is no argv to protect.
    if (
      platform === PlatformType.WINDOWS_TASK_SCHEDULER ||
      platform === PlatformType.TASKHUB_NATIVE
    ) {
      const resolved = substituteStructuredCommand(commandTemplate, values);
      structuredAction = resolved.action;
      finalCommand = resolved.command;
    } else {
      finalCommand = substitutePlainCommand(commandTemplate, values);
    }
  } else {
    finalCommand =
      typeof command === 'string' && command.trim()
        ? command.trim()
        : template.command || '';
  }

  /**
   * A template whose action is a native SCRIPT or CHECK carries its spec in
   * `nativeJob`, because neither can round-trip through a command line — a
   * script body has newlines and a probe has structure. `command` for those is a
   * human-readable description, and nothing runs it.
   *
   * Substitution walks the JSON's string values, which is the safest form there
   * is: each field is exactly one value with no tokenizer downstream, so a
   * parameter cannot split into extra arguments the way it can on a command line.
   */
  const finalNativeJob =
    template.nativeJob && parameters !== undefined
      ? substituteNativeJob(
          template.nativeJob,
          resolveTemplateParams(template.parameters, parameters)
        )
      : template.nativeJob ?? undefined;

  // Never register a task with unfilled {{placeholders}} (see Templates.md §5).
  // The parameters path already threw on unfilled keys; this guards the legacy path.
  if (finalCommand.includes('{{')) {
    throw new HttpError(400, 'Command still contains unfilled placeholders');
  }

  if (!isValidCron(finalSchedule)) {
    throw new HttpError(400, 'Schedule must be a 5-field cron expression (min hour dom month dow).');
  }

  // Convert the cron to a platform-native trigger so the agent registers the
  // real schedule instead of guessing (see docs/resources/Templates.md §6).
  const conversion = resolveTrigger(platform, finalSchedule);
  if (platform === PlatformType.WINDOWS_TASK_SCHEDULER && !conversion.trigger) {
    throw new HttpError(400, 'Schedule cannot be converted to a Windows trigger.', {
      warnings: conversion.warnings
    });
  }

  // Same reason as POST /api/tasks: with a readable Claude Code session the
  // platform is reachable before any connection row exists, and refusing over a
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

  // Call createTask on the connector. When the server resolved the command
  // from raw parameters, pass the structured action so the connector doesn't
  // re-tokenize the display string.
  const result = await connector.createTask(
    finalName,
    finalSchedule,
    finalCommand,
    { ...deserializeConfig(connection.config), userId },
    {
      trigger: conversion.trigger,
      action: structuredAction,
      folder: finalFolder,
      ...(finalNativeJob !== undefined ? { nativeJob: finalNativeJob } : {}),
      ...(repositoryUrls ? { repositoryUrls } : {})
    }
  );

  // Applying a template IS a create through the connector, so it is evidence
  // about this install exactly like `POST /api/tasks` is — a platform whose only
  // successful create came from the Templates tab must not read `declared`.
  await recordCapability(userId, platform, 'create', result.success, result.message);

  if (!result.success) {
    // A platform with no create API at all is a client error, not a server one —
    // the same split `POST /api/tasks` makes. A `500` invites a retry that can
    // never succeed.
    return res.status(verbDeclaredUnsupported(platform, 'create') ? 400 : 500)
      .json({ error: result.message || 'Failed to apply template' });
  }

  // Track the created task right away (mirrors POST /tasks): the dashboard shows
  // it without waiting for a sync, and the duplicate-name guard above sees it
  // immediately — so a back-to-back re-apply with the same name 409s instead of
  // silently overwriting the task that was just created.
  //
  // **Cronsole-native is excluded, and it is the only exclusion.**
  // `CronsoleNativeConnector.createTask` writes its own row with `metadata.job`
  // — the job spec IS the task there — and this upsert would replace metadata
  // with the `{schedule, command, state}` shape, leaving a task the executor
  // refuses to run. Claude joined the tracked set on 2026-08-13, when creating a
  // routine became possible: without this, applying a Claude template created a
  // real routine at Anthropic and showed nothing until the next sync.
  if (platform !== PlatformType.TASKHUB_NATIVE) {
    // Prefer the id the platform actually registered. The fallback is **Windows
    // only** — there a task's path is derivable, and it must be built from
    // finalFolder rather than a hardcoded \Cronsole, or a task created in \Work
    // is tracked under the wrong externalId and every later run/delete/edit
    // misses it. Nowhere else is an id guessable: a Claude routine's `trig_…` is
    // minted by Anthropic, so a fabricated one would track a row that points at
    // nothing.
    const externalId = result.externalId
      || (platform === PlatformType.WINDOWS_TASK_SCHEDULER
        ? windowsTaskPath(finalFolder, finalName)
        : null);
    const upserted = externalId ? await TaskService.upsertTasks(userId, platform, [{
      externalId,
      name: finalName,
      status: 'ACTIVE' as const,
      metadata: { schedule: finalSchedule, command: finalCommand, state: 'Ready' }
    }]) : [];
    if (upserted.length > 0) {
      await prisma.task.update({
        where: { id: upserted[0].id },
        data: { schedule: finalSchedule }
      });
    }
  }

  notifyTasksChanged(userId);
  res.json({
    message: 'Template applied successfully',
    externalId: result.externalId,
    conversion: { confidence: conversion.confidence, warnings: conversion.warnings, lossy: conversion.lossy }
  });
});

export default router;
