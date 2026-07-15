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
  substitutePlainCommand
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
import { exportCatalog } from '../catalog/exportCatalog.js';
import { importTemplates } from '../catalog/importCatalog.js';
import { denormalizeTemplate } from '../catalog/denormalize.js';

const router = Router();

// Unexpected errors (and TemplateParamError from the substitution helpers)
// fall through to the app-level error handler.

const platformSchema = z.enum(PlatformType, { message: 'Invalid platform' });

const isValidCron = (cron: string) => cron.trim().split(/\s+/).length === 5;

/**
 * Resolve the platform-native trigger for a schedule. Only Windows needs a
 * converted trigger today; other platforms consume the cron directly.
 */
const resolveTrigger = (
  platform: PlatformType,
  schedule: string
): { trigger: WindowsTrigger | null; confidence: number; warnings: string[] } => {
  if (platform !== PlatformType.WINDOWS_TASK_SCHEDULER) {
    return { trigger: null, confidence: 1.0, warnings: [] };
  }
  const result = convertCronToWindowsTrigger(schedule);
  return { trigger: result.trigger, confidence: result.confidence, warnings: result.warnings };
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
//   GET /export            -> whole catalog, as an { taskhubCatalogVersion, ... } bundle
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
      `attachment; filename="taskhub-template-${safeFilePart(singleId)}.json"`);
    return res.json(denormalizeTemplate(row));
  }

  const ids = typeof req.query.ids === 'string'
    ? req.query.ids.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;

  const bundle = await exportCatalog(new Date().toISOString(), ids);
  const stamp = bundle.exportedAt.slice(0, 10);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition',
    `attachment; filename="taskhub-catalog-${safeFilePart(stamp)}.json"`);
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
    trigger: conversion.trigger
  });
});

const applySchema = z.object({
  platform: platformSchema,
  name: z.string().optional(),
  /**
   * Windows only: the native Task Scheduler folder to create the task in
   * (default \TaskHub). Validated with windowsTaskFolderError — it is signed
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
  parameters: z.unknown().optional()
});

// Apply a template to a platform
router.post('/:id/apply', validateBody(applySchema), async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { platform, command, schedule, scheduleExpression, name, parameters, folder } = req.body;
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
  // name (400) and a name that collides with a task TaskHub already tracks IN
  // THAT FOLDER (409) — RegisterTaskDefinition would otherwise silently
  // overwrite it. The collision is per-folder because that is how Windows'
  // overwrite works: \Work\Backup and \TaskHub\Backup are different tasks.
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
    if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
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
    { trigger: conversion.trigger, action: structuredAction, folder: finalFolder }
  );

  if (!result.success) {
    return res.status(500).json({ error: result.message || 'Failed to apply template' });
  }

  // Track a Windows task right away (mirrors POST /tasks): the dashboard
  // shows it without waiting for a sync, and the duplicate-name guard above
  // sees it immediately — so a back-to-back re-apply with the same name 409s
  // instead of silently overwriting the task that was just created.
  // Windows ONLY: TaskHubNativeConnector.createTask writes its own row (with
  // metadata.job — an upsert here would wipe it and break the task), and no
  // other connector can succeed today.
  if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    // Prefer the path the agent actually registered; fall back to the folder we
    // asked for. The fallback must use finalFolder, not a hardcoded \TaskHub —
    // otherwise a task created in \Work would be tracked under the wrong
    // externalId and every later run/delete/edit would miss it.
    const externalId = result.externalId || windowsTaskPath(finalFolder, finalName);
    const upserted = await TaskService.upsertTasks(userId, platform, [{
      externalId,
      name: finalName,
      status: 'ACTIVE' as const,
      metadata: { schedule: finalSchedule, command: finalCommand, state: 'Ready' }
    }]);
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
    conversion: { confidence: conversion.confidence, warnings: conversion.warnings }
  });
});

export default router;
