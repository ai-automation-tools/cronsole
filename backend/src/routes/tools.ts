/**
 * Utility endpoints that operate across tasks rather than on one — the API half
 * of the dashboard's Tools tab.
 *
 * Deliberately its own router rather than more surface on `tasks.ts`: every
 * route there competes with `/:id` in Express's declaration-order matching (the
 * trap that `DELETE /tasks/missing` had to be hoisted above `DELETE /tasks/:id`
 * to avoid), and a bulk export has no task id to be confused with. Mounting at
 * `/api/tools` sidesteps the ordering question entirely.
 */

import { Router, Request, Response } from 'express';
import JSZip from 'jszip';
import { z } from 'zod';
import { ExecutionStatus, PlatformType, TaskStatus, Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { connectorRegistry } from '../connectors/registry.js';
import { AuthRequest } from '../auth/auth.js';
import { deserializeConfig, serializeConfig } from '../auth/connectionConfig.js';
import {
  readRoutines,
  redactRoutines,
  upsertRoutine,
  normalizeRoutineId,
  looksLikeRoutineId,
  looksLikeRoutineToken,
  routineInputSchema,
  routineEditSchema
} from '../services/claudeRoutines.js';
import { getClaudeCredential } from '../services/claudeOAuth.js';
import {
  readConfig as readGitHubConfig,
  redactConfig as redactGitHubConfig,
  normalizeRepository,
  repoFullName,
  removeRepository,
  upsertRepository,
  looksLikeGitHubToken,
  repositoryFromExternalId,
  tokenInputSchema,
  repositoryInputSchema
} from '../services/githubRepositories.js';
import { listWorkflows, verifyToken as verifyGitHubToken } from '../services/githubActions.js';
import {
  readConfig as readVercelConfig,
  redactConfig as redactVercelConfig,
  normalizeProjectInput,
  removeProject,
  upsertProject,
  looksLikeVercelToken,
  projectFromExternalId,
  tokenInputSchema as vercelTokenInputSchema,
  projectInputSchema
} from '../services/vercelProjects.js';
import {
  getProject as getVercelProject,
  listProjects as listVercelProjects,
  listTeams as listVercelTeams,
  verifyToken as verifyVercelToken
} from '../services/vercelApi.js';
import {
  readConfig as readGeminiConfig,
  redactConfig as redactGeminiConfig,
  looksLikeGeminiKey,
  keyInputSchema as geminiKeyInputSchema,
  agentInputSchema as geminiAgentInputSchema,
  presetInputSchema as geminiPresetInputSchema,
  redactPreset as redactGeminiPreset,
  findPreset as findGeminiPreset,
  MAX_TOOL_PRESETS,
  DEFAULT_GEMINI_AGENT,
  type AgentToolPreset
} from '../services/geminiTriggers.js';
import { listTriggers as listGeminiTriggers } from '../services/geminiApi.js';
import { parseTaskBundle, TaskImportError } from '../services/taskImport.js';
import { createNativeTask, NativeTaskCreateError } from '../services/nativeTaskCreate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import {
  buildManifest,
  runBulkExport,
  selectExportCandidates,
  type BulkExportSelection
} from '../services/bulkExport.js';
import { syncOutcomeOf } from '../connectors/platform.interface.js';
import {
  csvFilename,
  historyWhere,
  runKindFor,
  summarizeHistory,
  toCsvBuffer,
  type RunHistoryRow
} from '../services/runHistory.js';
import {
  rankByHealth,
  scoreTask,
  summarizeHealth
} from '../services/taskHealth.js';
import { buildDiagnosticsReport } from '../services/diagnostics.js';
import {
  analyzeDurations,
  bucketByDay,
  findIdleTasks,
  isValidTimeZone,
  type DurationInput,
  type IdleInputTask
} from '../services/runAnalytics.js';
import {
  decodeTaskXml,
  isRestoreCandidate,
  planRestore,
  readExportManifest,
  runRestore,
  summarizeRestore,
  type DecodedTaskFile,
  type RestoreInputFile
} from '../services/taskRestore.js';
import {
  applyBulkStatus,
  summarizeBulkStatus,
  MAX_TASKS_PER_BULK_STATUS
} from '../services/bulkStatus.js';
import { MAX_TASKS_PER_BULK } from '../services/bulkOutcome.js';
import {
  idsToUpdate,
  planBulkCategory,
  summarizeBulkCategory,
  type BulkCategoryTask
} from '../services/bulkCategory.js';
import { planBulkUntrack, summarizeBulkUntrack } from '../services/bulkUntrack.js';
import { buildPlatformMatrix, recordCapability } from '../services/platformCapabilities.js';
import { TaskService } from '../services/TaskService.js';
import {
  buildDownload,
  findDownload,
  textByteLength,
  CONNECT_PACK_DOWNLOADS,
  CONNECT_PACK_HOME,
  CONNECT_PACK_VERSION
} from '../tools/connectPack.js';

const router = Router();

/**
 * Ceiling on one export. Not a performance limit — a sanity bound, so a
 * pathological machine cannot turn one click into thousands of agent
 * round-trips. Refused loudly with the real number rather than silently
 * truncated, because a backup that quietly stopped early is worse than no
 * backup.
 */
const MAX_TASKS_PER_EXPORT = 2000;

const exportTasksSchema = z
  .object({
    scope: z.enum(['all', 'folder', 'selection']),
    folder: z.string().trim().max(512).optional(),
    /**
     * For `scope: 'selection'` — Cronsole task ids, not native paths. The
     * caller is the dashboard, which has rows; resolving those to native paths
     * here is what keeps the request owner-scoped. Accepting raw paths would
     * let any authenticated caller export any task on the machine by naming it.
     */
    taskIds: z.array(z.string().min(1)).min(1).max(MAX_TASKS_PER_BULK).optional(),
    includeSystem: z.boolean().optional(),
    includeSubfolders: z.boolean().optional(),
    /**
     * `files` returns each XML base64-encoded so the browser can write them into
     * a directory the user picked. `zip` returns one archive for the fallback
     * path (and for anyone who just wants a single file).
     */
    format: z.enum(['files', 'zip']).default('files')
  })
  .refine(body => body.scope !== 'folder' || !!body.folder, {
    message: 'A folder is required when scope is "folder"',
    path: ['folder']
  })
  .refine(body => body.scope !== 'selection' || !!body.taskIds?.length, {
    message: 'taskIds are required when scope is "selection"',
    path: ['taskIds']
  });

const timestampSlug = (d: Date) => d.toISOString().replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);

/**
 * Export Windows Task Scheduler tasks in bulk as native XML.
 *
 * Exports what is on the **machine**, not what Cronsole has imported. That is
 * the whole point: the tasks most at risk of being lost are the ones nothing
 * else is tracking. The UI states which it did, because "Export all" that
 * silently means "all the ones we happen to know about" is the same invisible
 * fence that made un-imported tasks impossible to notice.
 */
router.post('/export/tasks', validateBody(exportTasksSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const body = req.body as z.infer<typeof exportTasksSchema>;
  const platform = PlatformType.WINDOWS_TASK_SCHEDULER;

  // A selection arrives as Cronsole task ids and has to become native paths.
  // Two things are decided here rather than in the exporter: ownership (scoped
  // by userId, so ids cannot be used to reach another user's tasks) and which
  // platforms can produce Task Scheduler XML at all.
  let unsupported: { taskId: string; name: string; platform: PlatformType; message: string }[] = [];
  let selectedExternalIds: string[] | undefined;

  if (body.scope === 'selection') {
    const rows = await prisma.task.findMany({
      where: { id: { in: [...new Set(body.taskIds ?? [])] }, userId },
      select: { id: true, name: true, platform: true, externalId: true }
    });
    if (rows.length === 0) {
      throw new HttpError(404, 'None of those tasks exist.');
    }

    // A Cronsole-native task has no Task Scheduler XML — it is not on the
    // machine at all. Reported per task rather than filtered out, because a
    // selection of 5 native tasks would otherwise produce an empty export with
    // nothing to explain it. `GET /api/tasks/:id/export` gives them as JSON.
    unsupported = rows
      .filter(r => r.platform !== platform)
      .map(r => ({
        taskId: r.id,
        name: r.name,
        platform: r.platform,
        message:
          'Only Windows Task Scheduler tasks export as native XML. Export this one on its own for JSON.'
      }));

    selectedExternalIds = rows.filter(r => r.platform === platform).map(r => r.externalId);
    if (selectedExternalIds.length === 0) {
      throw new HttpError(
        400,
        'None of the selected tasks are Windows Task Scheduler tasks, so there is no XML to export.'
      );
    }
  }

  const selection: BulkExportSelection = {
    scope: body.scope,
    folder: body.folder,
    externalIds: selectedExternalIds,
    includeSystem: !!body.includeSystem,
    includeSubfolders: body.includeSubfolders !== false
  };

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform } }
  });
  if (!connection) {
    throw new HttpError(400, 'No Windows Task Scheduler connection found. Connect the agent first.');
  }

  const connector = connectorRegistry.getConnector(platform);
  if (!connector?.exportTask) {
    throw new HttpError(400, `Exporting is not supported for ${platform}.`);
  }

  const config = { ...deserializeConfig(connection.config), userId };

  // The same unfiltered enumeration `/discover` reads — every task on the
  // machine with its real path. An offline agent throws here, and that is the
  // honest answer: we cannot know what is on the machine without asking it.
  let enumerated;
  try {
    enumerated = syncOutcomeOf(await connector.syncTasks(config)).tasks;
  } catch (err: any) {
    throw new HttpError(502, err?.message === 'Agent offline'
      ? 'The Windows agent is offline, so Cronsole cannot read the machine\'s tasks.'
      : err?.message || 'Could not enumerate tasks from the agent');
  }

  const selectionResult = selectExportCandidates(enumerated, selection);

  if (selectionResult.selected.length === 0) {
    if (body.scope === 'selection') {
      // Every selected task was absent from the machine. Named, not counted:
      // "0 of 5 exported" sends someone hunting a bug in the export, while the
      // paths say plainly that these tasks are no longer there.
      throw new HttpError(
        404,
        `None of the selected tasks were found on this machine — they may have been deleted in Task Scheduler: ${selectionResult.requestedMissing.join(', ')}`
      );
    }
    throw new HttpError(
      404,
      body.scope === 'folder'
        ? `No tasks found in ${body.folder}${selection.includeSubfolders ? ' or its subfolders' : ''}.`
        : 'No tasks found to export.'
    );
  }

  if (selectionResult.selected.length > MAX_TASKS_PER_EXPORT) {
    throw new HttpError(
      400,
      `That selection covers ${selectionResult.selected.length} tasks, above the ${MAX_TASKS_PER_EXPORT} limit for one export. Export a folder at a time.`
    );
  }

  const { files, failures } = await runBulkExport(
    selectionResult.selected,
    externalId => connector.exportTask!(externalId, config)
  );

  const now = new Date();
  const manifest = buildManifest(selection, selectionResult, files, failures, now);
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2), 'utf8');
  const MANIFEST_NAME = '_cronsole-export.json';

  if (body.format === 'zip') {
    const zip = new JSZip();
    for (const file of files) zip.file(file.relativePath, file.bytes);
    zip.file(MANIFEST_NAME, manifestBytes);

    const archive = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="cronsole-tasks-${timestampSlug(now)}.zip"`);
    // The counts the UI would otherwise lose on a binary response — a download
    // has no JSON body to report "3 of 95 failed" in. `unsupported` rides here
    // too: it is a fact about the *request* rather than about the machine, so
    // it does not belong in the archive's manifest, but the user still has to
    // be told their 3 native tasks were not in the file they just saved.
    res.setHeader(
      'X-Cronsole-Export-Counts',
      JSON.stringify({ ...manifest.counts, unsupported: unsupported.length })
    );
    return res.send(archive);
  }

  // base64, not a JSON string: the XML is UTF-16 LE with a BOM, and putting
  // those bytes through JSON as text is exactly how the MCP export tool ended up
  // decoding UTF-16 as UTF-8 into mojibake. base64 round-trips the exact bytes,
  // so what the browser writes to disk is byte-identical to what Windows sent.
  res.json({
    counts: { ...manifest.counts, unsupported: unsupported.length },
    failures,
    /** Selected but not on the machine — named, so the gap is not a subtraction. */
    requestedMissing: selectionResult.requestedMissing,
    /** Selected but not a Windows task, so there is no XML for them. */
    unsupported,
    files: [
      ...files.map(f => ({
        relativePath: f.relativePath,
        taskPath: f.externalId,
        contentBase64: f.bytes.toString('base64')
      })),
      {
        relativePath: MANIFEST_NAME,
        taskPath: null,
        contentBase64: manifestBytes.toString('base64')
      }
    ]
  });
});

/**
 * Ceiling on one restore, matching the export side. A restore is the more
 * dangerous direction, so the bound is a refusal with the real number rather
 * than a silent truncation — a restore that quietly stopped at 2000 would leave
 * a machine half-recovered and report success.
 */
const MAX_TASKS_PER_RESTORE = 2000;

const restoreTasksSchema = z
  .object({
    /** A whole `.zip` produced by the export, base64-encoded. */
    archiveBase64: z.string().min(1).optional(),
    /** Individually picked `.xml` files (or a picked directory). */
    files: z
      .array(
        z.object({
          relativePath: z.string().min(1).max(1024),
          contentBase64: z.string()
        })
      )
      .min(1)
      .optional(),
    overwrite: z.boolean().default(false),
    createFolders: z.boolean().default(false),
    /**
     * Work out what would happen and report it, writing nothing. Costs only the
     * two read-only agent verbs, so the preview is honest without being a
     * rehearsal that itself changes the machine.
     */
    dryRun: z.boolean().default(false)
  })
  .refine(body => !!body.archiveBase64 !== !!body.files, {
    message: 'Send either files[] or archiveBase64 — exactly one.',
    path: ['files']
  });

/**
 * Restore Windows Task Scheduler tasks from native XML — the other half of the
 * backup.
 *
 * Two phases, always in this order: **plan**, then (unless `dryRun`) **execute**.
 * The plan is computed from the machine's real tasks and folders via the two
 * read-only agent verbs, so the user is told what will happen — including what
 * will be skipped and what will be refused — before anything is written. That
 * ordering is the feature: `RegisterTaskDefinition` overwrites silently and the
 * agent is elevated, so "restore" must never be the first moment you learn what
 * a file was going to do.
 */
router.post('/restore/tasks', validateBody(restoreTasksSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const body = req.body as z.infer<typeof restoreTasksSchema>;
  const platform = PlatformType.WINDOWS_TASK_SCHEDULER;

  const supplied: RestoreInputFile[] = body.archiveBase64
    ? await expandArchive(body.archiveBase64)
    : (body.files ?? []).map(f => ({
        relativePath: f.relativePath,
        bytes: Buffer.from(f.contentBase64, 'base64')
      }));

  // The manifest is read from everything supplied, then dropped from the set of
  // things to restore — it maps filenames to task paths, it is not a task.
  const manifest = readExportManifest(supplied);
  const candidates = supplied.filter(f => isRestoreCandidate(f.relativePath));

  if (candidates.length === 0) {
    throw new HttpError(
      400,
      'No task XML files found. Pick the folder or .zip an export produced — restore reads .xml task definitions.'
    );
  }
  if (candidates.length > MAX_TASKS_PER_RESTORE) {
    throw new HttpError(
      400,
      `That is ${candidates.length} task files, above the ${MAX_TASKS_PER_RESTORE} limit for one restore. Restore a folder at a time.`
    );
  }

  const connection = await prisma.platformConnection.findUnique({
    where: { userId_platform: { userId, platform } }
  });
  if (!connection) {
    throw new HttpError(400, 'No Windows Task Scheduler connection found. Connect the agent first.');
  }

  const connector = connectorRegistry.getConnector(platform);
  if (!connector?.importTask || !connector.listFolders) {
    throw new HttpError(400, `Restoring is not supported for ${platform}.`);
  }

  const config = { ...deserializeConfig(connection.config), userId };

  // Read the machine before deciding anything. An offline agent fails here, and
  // that is the honest answer — a plan built without knowing what already exists
  // would confidently promise to create tasks that are already there.
  let existingTaskPaths: string[];
  let existingFolders: string[];
  try {
    const [synced, folders] = await Promise.all([
      connector.syncTasks(config),
      connector.listFolders(config)
    ]);
    existingTaskPaths = syncOutcomeOf(synced).tasks
      .map(t => String(t.externalId ?? ''))
      .filter(Boolean);
    if (!folders.success) {
      throw new Error(folders.message || 'Could not read this machine\'s Task Scheduler folders');
    }
    existingFolders = folders.folders.map(f => f.path);
  } catch (err: any) {
    throw new HttpError(502, err?.message === 'Agent offline'
      ? 'The Windows agent is offline, so Cronsole cannot see what is already on the machine — and it will not restore blind.'
      : err?.message || 'Could not read the machine\'s current tasks');
  }

  const decoded: DecodedTaskFile[] = candidates.map(file => {
    const result = decodeTaskXml(file.bytes);
    return 'error' in result
      ? { relativePath: file.relativePath, error: result.error }
      : { relativePath: file.relativePath, xml: result.xml };
  });

  const plan = planRestore(
    decoded,
    manifest,
    { existingTaskPaths, existingFolders },
    { overwrite: body.overwrite, createFolders: body.createFolders }
  );

  if (body.dryRun) {
    // Deliberately no XML in the response. The browser already holds these
    // files, and task XML carries full command lines and the account each task
    // runs as — there is nothing to gain by echoing it back through a log.
    return res.json({ dryRun: true, plan });
  }

  const xmlByPath = new Map(
    decoded.filter(d => d.xml !== undefined).map(d => [d.relativePath, d.xml as string])
  );

  const results = await runRestore(
    plan,
    relativePath => xmlByPath.get(relativePath),
    (taskPath, xml) =>
      connector.importTask!(taskPath, xml, {
        overwrite: body.overwrite,
        createFolders: body.createFolders
      }, config)
  );

  const counts = summarizeRestore(results);
  // Evidence only from a restore that actually registered something. A run whose
  // every file came back `exists` or `refused` proves the *plan* works, not the
  // write — counting it would let the matrix say "verified" about a verb never
  // exercised. And no failure is recorded from here: `refused` folds a platform
  // error together with Cronsole declining on policy (an existing task without
  // `overwrite`), and the second is the feature working. A verb that cannot tell
  // its own failure from its own correctness must not report either.
  if (counts.created + counts.replaced > 0) {
    await recordCapability(userId, platform, 'restore', true);
  }

  res.json({
    dryRun: false,
    plan: { counts: plan.counts, foldersToCreate: plan.foldersToCreate },
    counts,
    results
  });
});

/** Expand a base64 `.zip` into the files inside it. */
async function expandArchive(archiveBase64: string): Promise<RestoreInputFile[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(Buffer.from(archiveBase64, 'base64'));
  } catch (err: any) {
    throw new HttpError(400, `That file could not be read as a .zip archive: ${err?.message ?? 'unknown error'}`);
  }

  const files: RestoreInputFile[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    files.push({ relativePath: entry.name, bytes: await entry.async('nodebuffer') });
  }
  return files;
}

/**
 * Ceiling on one history read. Generous — a year of a busy machine fits — but
 * bounded, because an unbounded export is a memory profile, not a feature. The
 * response says when it was hit rather than silently returning a prefix.
 */
const MAX_HISTORY_ROWS = 50000;

/** Default window when the caller doesn't pick one: the last 30 days. */
const DEFAULT_HISTORY_DAYS = 30;

const historyQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** Repeatable or comma-separated: `?status=FAILURE,TIMEOUT`. */
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform(v => {
      if (!v) return undefined;
      const list = (Array.isArray(v) ? v : v.split(','))
        .map(s => s.trim().toUpperCase())
        .filter(Boolean);
      return list.length ? list : undefined;
    })
    .pipe(z.array(z.nativeEnum(ExecutionStatus)).optional()),
  platform: z.nativeEnum(PlatformType).optional(),
  taskId: z.string().optional(),
  limit: z.coerce.number().int().positive().max(MAX_HISTORY_ROWS).optional(),
  format: z.enum(['json', 'csv']).default('json')
});

/** Ceiling on `GET /task-health?limit=`. A guard, not a page size. */
const MAX_HEALTH_ROWS = 500;

/**
 * `GET /task-health` filters.
 *
 * **These belong to the route because the route also summarizes.** `counts` and
 * the returned list have to describe the same population or the response
 * contradicts itself — and it did: the MCP wrapper filtered client-side and
 * forwarded the server's unfiltered `counts`, printing *"Across 358 task(s): 25
 * critical"* directly above thirteen rows
 * ([#49](../../../docs/troubleshooting/README.md)). A filter applied anywhere
 * other than where the counting happens cannot be reconciled afterwards,
 * because neither side knows what the other did.
 *
 * **Every default is "everything", deliberately.** The dashboard's tier map
 * (`useTaskHealthTiers`) needs a verdict for *every* task and passes no
 * parameters, so an unparameterized request must behave exactly as it did
 * before these filters existed. `includeSystem` therefore defaults to `true`
 * here while the MCP tool defaults it to `false` — the same flag, different
 * audiences, and the caller states its own default rather than inheriting one.
 */
const taskHealthQuerySchema = z.object({
  tier: z.enum(['critical', 'attention', 'unknown', 'ok']).optional(),
  /**
   * Strict `'true' | 'false'`, so a typo is a 400 rather than a silent `true`.
   * A misread lens quietly changes which tasks the answer is about.
   */
  includeSystem: z
    .enum(['true', 'false'])
    .optional()
    .transform(v => v !== 'false'),
  limit: z.coerce.number().int().positive().max(MAX_HEALTH_ROWS).optional()
});

/**
 * The platform capability matrix — what Cronsole can actually do with each
 * connected platform, and how it knows.
 *
 * Read-only and asks no platform anything: opening the Platforms tab must not be
 * able to change what the tab reports. That also means the row's `lastSync` is
 * whatever really happened (or absent), never a timestamp this handler invented
 * — the mistake `getHealth` made (troubleshooting #40).
 *
 * Every cell carries its own evidence, so the UI never has to render a bare
 * claim: `verified` comes with the timestamp that earned it, `declared` says the
 * verb is reachable but unproven here, `unsupported` means the route would
 * refuse. See `services/platformCapabilities.ts` for why this cannot be derived
 * from the connector object alone.
 */
router.get('/platforms', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  res.json({ platforms: await buildPlatformMatrix(userId) });
});

/* -------------------------------------------------------------------------- *
 * Claude routines — the connection config a user actually composes.
 *
 * Every other platform gets its credentials another way: the Windows agent
 * pairs, Cronsole-native needs none. Claude is the first where the user types a
 * secret in, because Anthropic mints a **bearer token per routine** in the web
 * UI and offers no API to list or manage them — so the routine list is a
 * registry the user maintains and Cronsole stores encrypted.
 *
 * These are Claude-specific rather than a generic
 * `PUT /platforms/:platform/connection`, deliberately. A generic route would
 * imply the other platforms are configurable this way (they are not) and would
 * have to accept an arbitrary JSON blob into a field every connector trusts.
 * Each platform's config gets its own validated shape when it needs one.
 *
 * **The token is write-only across all three routes.** It goes in and never
 * comes back — `GET` reports `hasToken`, never the value. There is no reveal
 * endpoint and there should not be: claude.ai shows the token once and cannot
 * re-display it either, so regenerating is the only real recovery, and a
 * "reveal" here would be a second copy of a secret whose whole life is one hop.
 * -------------------------------------------------------------------------- */

/** Load the Claude connection and its routines, or a well-formed empty state. */
async function loadClaudeRoutines(userId: string) {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.CLAUDE_CODE }
  });
  return {
    connection,
    routines: connection ? readRoutines(deserializeConfig(connection.config)) : []
  };
}

/**
 * Write the routine list back, creating the connection on first use.
 *
 * `serializeConfig` is not optional here: `PlatformConnection.config` is
 * encrypted at rest (AES-256-GCM) and this is the one route that puts a live
 * third-party credential into it.
 */
async function saveClaudeRoutines(
  userId: string,
  connectionId: string | undefined,
  routines: ReturnType<typeof readRoutines>
) {
  const config = serializeConfig({ routines });
  if (connectionId) {
    await prisma.platformConnection.update({ where: { id: connectionId }, data: { config } });
  } else {
    await prisma.platformConnection.create({
      data: { userId, platform: PlatformType.CLAUDE_CODE, isActive: true, config }
    });
  }
  await refreshClaudeHealth(userId);
}

/**
 * Recompute and store this connection's health right after writing it.
 *
 * Without this a connection is born **`HEALTHY`** — `PlatformConnection.healthState`
 * is `@default(HEALTHY)` in the schema — so the Platforms card would say *Online*
 * from the instant a routine is added until the next `/api/tasks/health` poll
 * corrects it, having contacted Anthropic exactly never. That is the same
 * precondition-verdict as troubleshooting #40, one layer further down: the lie is
 * in the column default rather than in a connector.
 *
 * Safe to call here precisely because **Claude's `getHealth` does not probe** —
 * it reads the stored run evidence, so refreshing costs a DB read and cannot
 * fire anyone's routine. Do not copy this into a write path for a platform whose
 * health check talks to the platform.
 *
 * The real fix is a `HealthState.UNKNOWN` so "configured, never exercised" stops
 * borrowing a verdict; it is logged in ROADMAP.md, and the schema default is the
 * third instance of the shape.
 */
async function refreshClaudeHealth(userId: string): Promise<void> {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.CLAUDE_CODE }
  });
  if (!connection) return;

  const connector = connectorRegistry.getConnector(PlatformType.CLAUDE_CODE);
  if (!connector) return;

  try {
    const health = await connector.getHealth({ ...deserializeConfig(connection.config), userId });
    await prisma.platformConnection.update({
      where: { id: connection.id },
      // `?? null` and not a bare value: Prisma reads `undefined` as "leave the
      // column alone", which would keep a stale reason under a fresh state.
      data: { healthState: health.state, healthReason: health.reason ?? null }
    });
  } catch {
    // Health is a readout, not the operation. Failing to refresh it must not
    // fail the routine the user just saved — the next poll will correct it.
  }
}

/**
 * The routines this connection knows about — **without their tokens**.
 *
 * `taskCount` per routine is here because removing a routine breaks any tracked
 * task pointing at it, and the UI must be able to say so *before* the click
 * rather than after (the same reason bulk recategorize states `detachedFromFolder`
 * up front).
 */
router.get('/platforms/claude/routines', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { routines } = await loadClaudeRoutines(userId);

  const counts = await prisma.task.groupBy({
    by: ['externalId'],
    where: { userId, platform: PlatformType.CLAUDE_CODE },
    _count: { _all: true }
  });
  const byExternalId = new Map(counts.map(c => [c.externalId, c._count._all]));

  // Which door is open decides what this panel should even ask the user for.
  // With a Claude Code session readable, pasting a per-routine token buys
  // nothing they do not already have — and a UI that keeps asking for a
  // credential claude.ai issues **once** is asking them to spend something for
  // no gain. The registry stays visible and editable, because it is the
  // fallback if this undocumented API is withdrawn.
  const { credential, reason, problem } = getClaudeCredential();

  res.json({
    routines: redactRoutines(routines).map(r => ({ ...r, taskCount: byExternalId.get(r.id) ?? 0 })),
    session: {
      mode: credential ? 'oauth' : 'declared',
      active: credential !== null,
      source: credential?.source ?? null,
      ...(credential?.expiresAt ? { expiresAt: credential.expiresAt.toISOString() } : {}),
      ...(problem ? { problem } : {}),
      ...(reason ? { reason } : {})
    }
  });
});

/**
 * Add a routine, or rotate the token on one already stored.
 *
 * Re-adding an existing id **replaces** it rather than 409-ing, because that is
 * the rotation path: generating a token at claude.ai revokes its predecessor, so
 * the stored one is already dead by the time the user gets here. Making them
 * delete first would add a step to the only recovery there is.
 */
router.post(
  '/platforms/claude/routines',
  validateBody(routineInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const { id: rawId, token, name } = req.body as { id: string; token: string; name?: string };

    const id = normalizeRoutineId(rawId);
    if (!id) {
      throw new HttpError(
        400,
        'Could not read a routine id from that. Paste either the trig_… id or the whole fire URL ' +
          'shown in the routine\'s API trigger dialog.'
      );
    }

    const { connection, routines } = await loadClaudeRoutines(userId);
    const replaced = routines.some(r => r.id === id);
    await saveClaudeRoutines(
      userId,
      connection?.id,
      upsertRoutine(routines, { id, token, ...(name ? { name } : {}) })
    );

    // Advisory, never enforced: /fire is experimental behind a dated beta header
    // and neither format is promised to hold. Refusing an id Anthropic later
    // changes would be worse than a 404 that explains itself — but a silent
    // accept of an obviously wrong paste costs a confusing failure at first run.
    const warnings = [
      // Verified against the live UI on 2026-08-12: the routine's page URL
      // (/code/routines/trig_…) and the API trigger's Fire URL carry the SAME
      // trig_ id, so either is a valid place to copy it from. An earlier draft
      // of this warning claimed the page URL held a different id — it does not,
      // and saying so would have sent people back to a dialog they had already
      // read the right value from.
      looksLikeRoutineId(id)
        ? null
        : `"${id}" does not look like a routine id — claude.ai issues trig_… values, which you can copy from the routine's own page URL or from its API trigger dialog.`,
      looksLikeRoutineToken(token)
        ? null
        : 'That token does not start with sk-ant-oat01-, which is the form claude.ai issues for a routine API trigger.'
    ].filter((w): w is string => w !== null);

    res.status(replaced ? 200 : 201).json({
      routine: { id, ...(name ? { name } : {}), hasToken: true, taskCount: 0 },
      replaced,
      warnings
    });
  }
);

/**
 * Forget a routine. Cronsole-side only — the routine keeps running at Anthropic,
 * on its own schedule, exactly as before.
 *
 * That distinction is the whole reason this is not called "delete": Cronsole
 * cannot delete a Claude routine and never will (no API), so a label implying it
 * had would be the invisible-fence lie in reverse — a user believing they had
 * turned something off while it kept firing nightly.
 */
/**
 * Correct a connected routine's id or name, **keeping the stored token**.
 *
 * Without this, fixing a mistyped id costs a token: disconnect discards it, and
 * claude.ai shows a token once, so the only way back is to generate a new one —
 * which also revokes the old one anywhere else it is used. That is a real
 * penalty for a typo, and it is exactly the mistake the connect route already
 * expects (it warns when an id does not look like a `trig_…` value and saves it
 * anyway, because the format is not promised).
 *
 * **The tracked task moves with the id.** A Claude task's `externalId` *is* the
 * routine id, so re-pointing the config alone would strand the row: the old task
 * would go MISSING at the next sync and a fresh one would appear, losing its run
 * history, its star, and its category. Renaming the row in the same transaction
 * keeps the identity the user already has.
 */
router.patch(
  '/platforms/claude/routines/:id',
  validateBody(routineEditSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const currentId = String(req.params.id);
    const { id: rawNewId, name } = req.body as { id?: string; name?: string };

    const { connection, routines } = await loadClaudeRoutines(userId);
    const existing = routines.find(r => r.id === currentId);
    if (!existing) {
      throw new HttpError(404, `No routine ${currentId} is configured.`);
    }

    let nextId = currentId;
    if (rawNewId !== undefined) {
      const normalized = normalizeRoutineId(rawNewId);
      if (!normalized) {
        throw new HttpError(
          400,
          'Could not read a routine id from that. Paste either the trig_… id or the whole fire URL ' +
            'shown in the routine\'s API trigger dialog.'
        );
      }
      if (normalized !== currentId && routines.some(r => r.id === normalized)) {
        throw new HttpError(409, `A different routine is already connected as ${normalized}.`);
      }
      nextId = normalized;
    }

    const updated = {
      ...existing,
      id: nextId,
      ...(name !== undefined ? { name } : {})
    };
    const nextRoutines = routines.map(r => (r.id === currentId ? updated : r));

    // The task follows the id, in the same transaction as the config write would
    // ideally be — the config lives in an encrypted column on another row, so
    // they cannot share one, but the task move is atomic and idempotent.
    let taskMoved = 0;
    if (nextId !== currentId) {
      // A row may already exist under the new id (e.g. a previous partial fix).
      // Re-pointing onto it would violate the (platform, externalId) unique
      // constraint, so leave the stale row to the normal MISSING path instead of
      // failing the whole correction.
      const collision = await prisma.task.findFirst({
        where: { userId, platform: PlatformType.CLAUDE_CODE, externalId: nextId }
      });
      if (!collision) {
        const moved = await prisma.task.updateMany({
          where: { userId, platform: PlatformType.CLAUDE_CODE, externalId: currentId },
          data: { externalId: nextId, ...(name !== undefined ? { name } : {}) }
        });
        taskMoved = moved.count;
      }
    } else if (name !== undefined) {
      const renamed = await prisma.task.updateMany({
        where: { userId, platform: PlatformType.CLAUDE_CODE, externalId: currentId },
        data: { name }
      });
      taskMoved = renamed.count;
    }

    await saveClaudeRoutines(userId, connection?.id, nextRoutines);

    return res.json({
      routine: { id: updated.id, ...(updated.name ? { name: updated.name } : {}), hasToken: true },
      idChanged: nextId !== currentId,
      previousId: currentId,
      tasksRepointed: taskMoved,
      // Advisory, same rule as connect: the API is experimental, so shape is a
      // hint and never a refusal.
      warnings: looksLikeRoutineId(nextId)
        ? []
        : [`"${nextId}" does not look like a routine id — claude.ai issues trig_… values.`]
    });
  }
);

router.delete('/platforms/claude/routines/:id', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = String(req.params.id);

  const { connection, routines } = await loadClaudeRoutines(userId);
  if (!routines.some(r => r.id === id)) {
    throw new HttpError(404, `No routine ${id} is configured.`);
  }

  const remaining = routines.filter(r => r.id !== id);

  // Removing the last routine removes the connection, rather than leaving an
  // empty one behind. An empty connection is `configured: true` with nothing in
  // it, which health correctly calls DEGRADED — so the card would sit at amber
  // "No routines configured" indefinitely for someone who simply has not
  // finished setup, and amber is supposed to mean *go look at this*. With no
  // connection the card reads "Not connected", which is the true statement.
  // Capability evidence is keyed separately and survives, so verbs already
  // verified here stay verified.
  if (remaining.length === 0 && connection) {
    await prisma.platformConnection.delete({ where: { id: connection.id } });
  } else {
    await saveClaudeRoutines(userId, connection?.id, remaining);
  }

  // The tracked rows go with the declaration, in the same request.
  //
  // This route used to *count* them and leave them (`orphanedTasks`), which was
  // honest about the mess and still left it: a row whose routine is no longer
  // declared cannot be run (the config has no token for it) and cannot be
  // untracked (that route refuses for Claude, and rightly), so it stayed on the
  // dashboard forever, flipping to MISSING on the next sync. Absence of a task
  // row is what "removed" means here, so removing has to produce it.
  //
  // Safe to delete rather than mark MISSING — the usual reason for MISSING is
  // that absence isn't proof, but here the user just declared the absence
  // themselves. `TaskExclusion` is deliberately NOT written: the declaration is
  // the only thing that puts a Claude task in the list, so with it gone there is
  // nothing left to fence against, and a stale exclusion would silently swallow
  // the routine if it were ever re-added.
  const doomed = await prisma.task.findMany({
    where: { userId, platform: PlatformType.CLAUDE_CODE, externalId: id },
    select: { id: true }
  });
  const doomedIds = doomed.map(t => t.id);
  if (doomedIds.length) {
    await prisma.$transaction([
      // ExecutionLog has no cascade on its Task relation, so it must go first
      // or the delete violates the FK. TaskFavorite does cascade.
      prisma.executionLog.deleteMany({ where: { taskId: { in: doomedIds } } }),
      prisma.task.deleteMany({ where: { id: { in: doomedIds } } })
    ]);
    notifyTasksChanged(userId);
  }

  res.json({
    removed: id,
    // Named `tasksRemoved`, not `orphanedTasks`: the number means the opposite
    // thing now, and reusing the key would have let a caller keep rendering
    // "3 tasks stranded" over 3 tasks that are gone.
    tasksRemoved: doomedIds.length,
    connectionRemoved: remaining.length === 0
  });
});

/* ---------------------------------------------------------------------------
 * GitHub Actions connection — the second config a user composes by hand.
 *
 * Shaped deliberately unlike the Claude routes above, because the platforms are
 * shaped differently. Anthropic mints a bearer token **per routine**, so Claude's
 * config is a list of `(id, token)` pairs and every write touches a secret.
 * GitHub issues **one** token per account and it is what makes every repository
 * readable — so the token is a property of the *connection* and the repository
 * list holds no secrets at all.
 *
 * The visible payoff: removing a repository here can never cost the user a
 * credential, so none of the "re-adding is the rotation path" care the Claude
 * panel carries is needed. Adding one is idempotent rather than a 409.
 *
 * Still GitHub-specific rather than a generic
 * `PUT /platforms/:platform/connection`, for the reason stated over the Claude
 * block: a generic route would imply the other platforms are configurable this
 * way and would take an arbitrary blob into a field every connector trusts.
 *
 * **The token is write-only across all of these.** `GET` reports `hasToken` and
 * the last four characters — enough to answer *"is this the token I just
 * made?"*, not enough to be one. There is no reveal endpoint: GitHub shows a PAT
 * once and cannot re-display it either.
 * -------------------------------------------------------------------------- */

/** Load the GitHub connection and its config, or a well-formed empty state. */
async function loadGitHubConnection(userId: string) {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.GITHUB_ACTIONS }
  });
  return {
    connection,
    config: connection
      ? readGitHubConfig(deserializeConfig(connection.config))
      : readGitHubConfig({})
  };
}

/**
 * Write the config back, creating the connection on first use.
 *
 * `serializeConfig` is not optional: `PlatformConnection.config` is AES-256-GCM
 * encrypted at rest and this holds a live third-party credential.
 */
async function saveGitHubConnection(
  userId: string,
  connectionId: string | undefined,
  config: ReturnType<typeof readGitHubConfig>
) {
  const serialized = serializeConfig(config);
  if (connectionId) {
    await prisma.platformConnection.update({ where: { id: connectionId }, data: { config: serialized } });
  } else {
    await prisma.platformConnection.create({
      data: { userId, platform: PlatformType.GITHUB_ACTIONS, isActive: true, config: serialized }
    });
  }
  await refreshGitHubHealth(userId);
}

/**
 * Recompute and store this connection's health right after writing it.
 *
 * Same reason as `refreshClaudeHealth`: the dashboard's 45-second poll is the
 * only other writer of `PlatformConnection.healthState`, so without this the
 * card sits at whatever that poll last left until the next one runs.
 *
 * Safe here for one specific reason, and **only** that reason: the GitHub
 * connector's `getHealth` reads back stored `PlatformCapability` evidence and
 * does not probe. Do not copy this into a write path for a platform whose health
 * check talks to the platform.
 */
async function refreshGitHubHealth(userId: string): Promise<void> {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.GITHUB_ACTIONS }
  });
  if (!connection) return;

  const connector = connectorRegistry.getConnector(PlatformType.GITHUB_ACTIONS);
  if (!connector) return;

  try {
    const health = await connector.getHealth({ ...deserializeConfig(connection.config), userId });
    await prisma.platformConnection.update({
      where: { id: connection.id },
      // `?? null`, not a bare value: Prisma reads `undefined` as "leave the
      // column alone", which keeps a stale reason under a fresh state.
      data: { healthState: health.state, healthReason: health.reason ?? null }
    });
  } catch {
    // Health is a readout, not the operation. Failing to refresh it must not
    // fail the write the user just made.
  }
}

/**
 * The connection's state — repositories, whether a token is stored, and how many
 * workflows each repository currently accounts for.
 *
 * `taskCount` per repository is here for the same reason it is on the Claude
 * panel: removing a repository strands its tracked workflows, and the UI has to
 * be able to say so **before** the click rather than report it after.
 */
router.get('/platforms/github/connection', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { connection, config } = await loadGitHubConnection(userId);

  const tasks = await prisma.task.findMany({
    where: { userId, platform: PlatformType.GITHUB_ACTIONS },
    select: { externalId: true }
  });
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const repo = repositoryFromExternalId(t.externalId)?.toLowerCase();
    if (repo) counts.set(repo, (counts.get(repo) ?? 0) + 1);
  }

  const redacted = redactGitHubConfig(config);
  res.json({
    connected: Boolean(connection),
    hasToken: redacted.hasToken,
    tokenHint: redacted.tokenHint,
    repositories: redacted.repositories.map(r => ({
      ...r,
      fullName: repoFullName(r),
      taskCount: counts.get(repoFullName(r).toLowerCase()) ?? 0
    }))
  });
});

/**
 * Store (or rotate) the account token.
 *
 * **Verified before it is stored**, with one `GET /user`. That is the only place
 * in this connector that contacts GitHub outside a sync, and it is here rather
 * than in `getHealth` on purpose: a bad paste should fail at the click that made
 * it, while a health check runs on a 45-second poll per open tab and would spend
 * a rate limit answering a question sync answers for free.
 *
 * A token GitHub rejects is a **400**, not a 502 — the request is wrong, not the
 * gateway, and retrying the same paste cannot help. A token GitHub *accepts*
 * whose shape is unfamiliar is saved with a warning: GitHub has shipped four
 * token formats and will ship more, so refusing one it introduces later would be
 * worse than the 401 that names itself.
 */
router.put(
  '/platforms/github/connection',
  validateBody(tokenInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const token = String((req.body as { token: string }).token).trim();

    const verified = await verifyGitHubToken(token);
    if (!verified.ok) {
      throw new HttpError(verified.status === null ? 502 : 400, verified.message);
    }

    const { connection, config } = await loadGitHubConnection(userId);
    await saveGitHubConnection(userId, connection?.id, { ...config, token });

    res.json({
      login: verified.data.login,
      hasToken: true,
      tokenHint: token.slice(-4),
      repositories: config.repositories.map(r => ({ ...r, fullName: repoFullName(r) })),
      warnings: looksLikeGitHubToken(token)
        ? []
        : ['That token does not match a format GitHub currently issues. It verified, so it is saved.']
    });
  }
);

/**
 * Watch a repository.
 *
 * Idempotent: re-adding one already watched returns it unchanged rather than a
 * 409. A duplicate add is a user checking, and the row carries no state a re-add
 * could rotate — the opposite of the Claude route above, where re-adding an id
 * *is* the token-rotation path.
 *
 * **Verified against GitHub before it is stored**, by listing the repository's
 * workflows. A repository saved unverified fails much later, inside a sync, as
 * one line among several — and for a private repository GitHub answers 404
 * rather than 403, so that failure would read as a typo when it is a missing
 * `repo` scope. Checking here lets the message say which.
 */
router.post(
  '/platforms/github/repositories',
  validateBody(repositoryInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const raw = String((req.body as { repository: string }).repository);

    const repository = normalizeRepository(raw);
    if (!repository) {
      throw new HttpError(
        400,
        'Could not read an owner/repo from that. Paste the repository URL, or its owner and name — ' +
          'for example github.com/acme/website or acme/website.'
      );
    }

    const { connection, config } = await loadGitHubConnection(userId);
    if (!config.token) {
      throw new HttpError(400, 'Add a GitHub token first — Cronsole needs one to read a repository.');
    }

    const probe = await listWorkflows(config.token, repository.owner, repository.repo);
    if (!probe.ok) {
      throw new HttpError(probe.status === null ? 502 : 400, probe.message);
    }

    const already = config.repositories.some(
      r => repoFullName(r).toLowerCase() === repoFullName(repository).toLowerCase()
    );
    await saveGitHubConnection(userId, connection?.id, {
      ...config,
      repositories: upsertRepository(config.repositories, repository)
    });

    res.status(already ? 200 : 201).json({
      repository: { ...repository, fullName: repoFullName(repository), taskCount: 0 },
      already,
      // What syncing would find. Every workflow in the repository — how many are
      // *scheduled* needs each file read, which is the sync's job, so this
      // deliberately does not promise a number of tasks.
      workflowCount: probe.data.total
    });
  }
);

/**
 * Stop watching a repository, and remove the workflows it put on the dashboard.
 *
 * **Cronsole-side only** — the workflows keep running on GitHub exactly as
 * before, which is why the UI says *Stop watching* and never *Delete*.
 *
 * The tracked rows go with the declaration, in the same request, for the reason
 * the Claude disconnect route learned: a row whose repository is no longer
 * watched cannot be synced, cannot be run (nothing here can), and would sit on
 * the dashboard flipping to MISSING at the next sync. Absence of a row is what
 * "stopped watching" means, so stopping has to produce it.
 *
 * **No `TaskExclusion` is written**, deliberately, and the reasoning is Claude's
 * rather than Windows'. An exclusion exists to stop a *re-enumeration* putting
 * something back; here the declaration is the only thing that enumerates this
 * repository at all, so with it gone there is nothing to fence against — and a
 * stale exclusion would silently swallow the repository if it were ever
 * re-added. Untracking one workflow while still watching its repository is the
 * case exclusions *are* for, and that path (`untrack_task`) works normally.
 */
router.delete('/platforms/github/repositories/:owner/:repo', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const target = { owner: String(req.params.owner), repo: String(req.params.repo) };
  const fullName = repoFullName(target).toLowerCase();

  const { connection, config } = await loadGitHubConnection(userId);
  if (!config.repositories.some(r => repoFullName(r).toLowerCase() === fullName)) {
    throw new HttpError(404, `${repoFullName(target)} is not being watched.`);
  }

  const remaining = removeRepository(config.repositories, target);
  await saveGitHubConnection(userId, connection?.id, { ...config, repositories: remaining });

  const doomed = await prisma.task.findMany({
    where: { userId, platform: PlatformType.GITHUB_ACTIONS },
    select: { id: true, externalId: true }
  });
  const doomedIds = doomed
    .filter(t => repositoryFromExternalId(t.externalId)?.toLowerCase() === fullName)
    .map(t => t.id);

  if (doomedIds.length) {
    await prisma.$transaction([
      // ExecutionLog has no cascade on its Task relation, so it must go first or
      // the delete violates the FK. TaskFavorite does cascade.
      prisma.executionLog.deleteMany({ where: { taskId: { in: doomedIds } } }),
      prisma.task.deleteMany({ where: { id: { in: doomedIds } } })
    ]);
    notifyTasksChanged(userId);
  }

  res.json({ removed: repoFullName(target), tasksRemoved: doomedIds.length, watching: remaining.length });
});

/**
 * Disconnect GitHub entirely — forget the token, the repositories and the rows.
 *
 * The connection row is **deleted** rather than emptied, for the reason the
 * Claude route gives: an empty connection is `configured: true` with nothing in
 * it, so the card would sit at "connected, nothing to read" indefinitely for
 * someone who has actually left. With no connection the card reads *Not
 * connected*, which is the true statement. Capability evidence is keyed
 * separately and survives, so verbs already verified stay verified if GitHub is
 * reconnected later.
 */
router.delete('/platforms/github/connection', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { connection } = await loadGitHubConnection(userId);
  if (!connection) {
    throw new HttpError(404, 'GitHub is not connected.');
  }

  const doomed = await prisma.task.findMany({
    where: { userId, platform: PlatformType.GITHUB_ACTIONS },
    select: { id: true }
  });
  const doomedIds = doomed.map(t => t.id);

  await prisma.$transaction([
    ...(doomedIds.length
      ? [
          prisma.executionLog.deleteMany({ where: { taskId: { in: doomedIds } } }),
          prisma.task.deleteMany({ where: { id: { in: doomedIds } } })
        ]
      : []),
    prisma.platformConnection.delete({ where: { id: connection.id } })
  ]);
  if (doomedIds.length) notifyTasksChanged(userId);

  res.json({ disconnected: true, tasksRemoved: doomedIds.length });
});

/**
 * Cross-task run history — "which tasks failed this month?", which had no answer
 * anywhere in the product because `ExecutionLog` was readable only 20 rows at a
 * time, per task.
 *
 * Lives on `/api/tools` because it spans tasks and has no task id of its own.
 *
 * **What it contains, and what it does not:** rows are runs *Cronsole performed*
 * — a Windows task firing on its own schedule writes nothing here. Every row
 * carries a `runKind` so `status` is readable: `native-execution` is a real
 * outcome, `manual-trigger` means "the agent accepted the start". Saying that
 * out loud is the difference between a useful report and one where an empty
 * month reads as "nothing ran".
 */
router.get('/history', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const parsed = historyQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const query = parsed.data;

  const to = query.to ?? new Date();
  const from = query.from ?? new Date(to.getTime() - DEFAULT_HISTORY_DAYS * 86400000);
  if (from > to) {
    throw new HttpError(400, 'The start of the range is after its end.');
  }

  const limit = query.limit ?? MAX_HISTORY_ROWS;
  const where = historyWhere(userId, {
    from,
    to,
    status: query.status,
    platform: query.platform,
    taskId: query.taskId
  });

  // Counted over the WHOLE filtered set, not the returned page. The UI uses
  // this to say "this will export N runs" before the download, and a count that
  // silently meant "N, or the page size, whichever is smaller" would be wrong
  // exactly when it matters most — on the large export someone is about to run.
  const byStatus = await prisma.executionLog.groupBy({
    by: ['status'],
    where,
    _count: { _all: true }
  });
  const matched = {
    runs: byStatus.reduce((sum, g) => sum + g._count._all, 0),
    succeeded: byStatus.find(g => g.status === ExecutionStatus.SUCCESS)?._count._all ?? 0,
    failed:
      (byStatus.find(g => g.status === ExecutionStatus.FAILURE)?._count._all ?? 0) +
      (byStatus.find(g => g.status === ExecutionStatus.TIMEOUT)?._count._all ?? 0),
    pending: byStatus.find(g => g.status === ExecutionStatus.PENDING)?._count._all ?? 0
  };

  const records = await prisma.executionLog.findMany({
    where,
    orderBy: { triggeredAt: 'desc' },
    // One extra row purely to detect the ceiling, so "you hit the limit" is a
    // fact rather than an inference from a suspiciously round number.
    take: limit + 1,
    include: { task: { select: { id: true, name: true, externalId: true, platform: true, category: true } } }
  });

  const truncated = records.length > limit;
  const rows: RunHistoryRow[] = records.slice(0, limit).map(record => ({
    triggeredAt: record.triggeredAt,
    taskId: record.task.id,
    taskName: record.task.name,
    taskPath: record.task.externalId,
    platform: record.task.platform,
    category: record.task.category,
    status: record.status,
    runKind: runKindFor(record.task.platform),
    durationMs: record.durationMs,
    platformRunId: record.platformRunId,
    log: record.log
  }));

  if (query.format === 'csv') {
    const body = toCsvBuffer(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename(from, to)}"`);
    // The counts a binary-ish download has nowhere else to put, mirroring the
    // bulk export's header.
    res.setHeader('X-Cronsole-History-Counts', JSON.stringify({ ...summarizeHistory(rows), truncated }));
    return res.send(body);
  }

  res.json({
    range: { from, to },
    /** Everything the filters match — what an export would contain. */
    matched,
    /** What this response actually carries, and the span it covers. */
    returned: summarizeHistory(rows),
    truncated,
    limit,
    rows
  });
});

/**
 * Task definitions captured just before they were deleted.
 *
 * The read half of the pre-delete archive (`services/taskArchive.ts`). Without
 * it the archive would be write-only, which is most of the way back to having
 * no archive at all — a backup nobody can enumerate is one nobody will restore
 * from, and its absence would only be discovered at the moment it was needed.
 *
 * Cross-task, so it lives here rather than on `tasks.ts`, where `/archives`
 * would be swallowed by `/:id`.
 */
router.get('/task-archives', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const limit = Math.min(Number(req.query.limit) || 50, 200);

  const archives = await prisma.deletedTaskArchive.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  res.json({
    total: archives.length,
    archives: archives.map(a => ({
      id: a.id,
      taskId: a.taskId,
      name: a.name,
      platform: a.platform,
      externalId: a.externalId,
      deletedVia: a.deletedVia,
      deletedAt: a.createdAt,
      // The count, not the rows — the full run history is on the detail route.
      executionsArchived: Array.isArray(a.executions) ? a.executions.length : 0,
      // Carried on the list, not just the detail, so a list of deletions can show
      // which ones are actually recoverable without a request per row — and so a
      // Restore button never appears on an archive the route would refuse.
      restorable: archiveRestorability(a.bundle)
    }))
  });
});

/** One archived definition, with its bundle and captured run history. */
router.get('/task-archives/:id', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = req.params.id as string;

  // Scoped by userId: an archive holds a full job spec, including any headers
  // the task was configured with.
  const archive = await prisma.deletedTaskArchive.findFirst({ where: { id, userId } });
  if (!archive) {
    throw new HttpError(404, 'Archive not found');
  }

  res.json({
    id: archive.id,
    taskId: archive.taskId,
    name: archive.name,
    platform: archive.platform,
    externalId: archive.externalId,
    deletedVia: archive.deletedVia,
    deletedAt: archive.createdAt,
    bundle: archive.bundle,
    executions: archive.executions,
    // Whether the definition is actually complete enough to rebuild, decided by
    // the same parser the restore route uses — so a Restore button is never
    // offered on an archive that would refuse it.
    restorable: archiveRestorability(archive.bundle)
  });
});

/**
 * Can this archive be turned back into a task, and if not, why not.
 *
 * Derived from `parseTaskBundle` rather than from `platform === TASKHUB_NATIVE`,
 * so the list, the button and the route cannot disagree — a second rule here
 * would be a client-side judgement the restore route still ignores, which is the
 * shape that put a browser-side copy of `isSystem` into the dashboard.
 */
function archiveRestorability(bundle: unknown): { ok: boolean; reason?: string } {
  try {
    parseTaskBundle(bundle);
    return { ok: true };
  } catch (err) {
    if (err instanceof TaskImportError) return { ok: false, reason: err.message };
    throw err;
  }
}

/**
 * Rebuild a deleted task from its archive.
 *
 * The archive has been written before every native delete since it shipped, and
 * until now nothing could read one back — so the guarantee on offer was "we kept
 * a copy", with no way to use it. This is the verb that makes the precondition
 * worth having.
 *
 * **The restored task is a new task, and the response says so.** It gets a new
 * id and a fresh `externalId`; nothing reattaches the archived run history,
 * because those runs happened to a task that no longer exists and stapling them
 * to a new row would make the history claim continuity Cronsole cannot vouch for.
 *
 * **The archive is not consumed.** It is the record that the deletion happened,
 * so restoring from it must not erase it — and restoring twice is therefore
 * possible, which is honest: it produces two tasks and the response names the
 * one it just made.
 *
 * Cronsole-native only, refused by `parseTaskBundle` for everything else. That
 * is the format's boundary (a Windows definition is XML on the machine), not a
 * policy — which is why the refusal names the route that *can* do it.
 */
router.post('/task-archives/:id/restore', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = req.params.id as string;

  const archive = await prisma.deletedTaskArchive.findFirst({ where: { id, userId } });
  if (!archive) {
    throw new HttpError(404, 'Archive not found');
  }

  let parsed;
  try {
    parsed = parseTaskBundle(archive.bundle);
  } catch (err) {
    if (err instanceof TaskImportError) throw new HttpError(400, err.message);
    throw err;
  }

  let created;
  try {
    created = await createNativeTask(userId, parsed);
  } catch (err) {
    if (err instanceof NativeTaskCreateError) throw new HttpError(400, err.message);
    throw err;
  }

  res.status(201).json({
    message: 'Task restored',
    task: created.task,
    nextRunTime: created.task.nextRunTime,
    archiveId: archive.id,
    // Stated rather than implied: the caller is looking at a list of deletions
    // and needs to know this one is still in it.
    archiveKept: true,
    // The archive never held the task's secrets — they are destroyed with the
    // row by design (ADR 0003), because an archive that outlives the delete is
    // the last place a credential should survive it. So a restored task comes
    // back with its references intact and its values gone, and this names them
    // instead of leaving the first scheduled run to.
    missingSecrets: created.missingSecrets
  });
});

/**
 * Automation health — which tasks need attention, and **on what evidence**.
 *
 * Mounted here, not as `/api/tasks/health`: that route already exists and means
 * *per-platform connector health*. Two different questions ("is the agent up?"
 * vs "is this task healthy?") must not share a name.
 *
 * The response always carries each task's signals. A caller that renders only
 * the number is rendering a claim without its evidence, which is exactly the
 * failure this feature was warned about.
 *
 * **Filtering happens here, next to the counting** (`taskHealthQuerySchema`).
 * `tier`, `includeSystem` and `limit` used to live in the MCP wrapper, which
 * meant the summary described one population and the list another (#49).
 */
router.get('/task-health', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;

  const parsed = taskHealthQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  const { tier, includeSystem, limit } = parsed.data;

  const tasks = await prisma.task.findMany({
    where: { userId, status: { not: TaskStatus.DELETED } },
    select: {
      id: true,
      name: true,
      platform: true,
      category: true,
      // Needed for the system/personal verdict — the scorer asks
      // TaskService.isSystemTask, which reads the native path.
      externalId: true,
      status: true,
      schedule: true,
      nextRunTime: true,
      updatedAt: true,
      metadata: true,
      executions: {
        orderBy: { triggeredAt: 'desc' },
        take: HEALTH_EXECUTION_WINDOW,
        select: { status: true, triggeredAt: true, durationMs: true }
      }
    }
  });

  const now = new Date();
  // No cast. An `as HealthInputTask` here silenced the compiler when `externalId`
  // was added to the scorer's input and left out of the select above — and the
  // missing field only surfaced as a 500 against real data. A cast on a query
  // result is a promise the query cannot keep.
  const results = rankByHealth(tasks.map(task => scoreTask(task, now)));

  // The population the caller asked about. `counts` is taken **here** — after
  // the system lens, before the tier filter — for the same reason
  // `applyTaskFiltersExcept` exists on the dashboard: a count beside a control
  // describes the population that control governs. Counted after `tier` it
  // would report that tier and four zeros, which answers nothing; counted
  // before `includeSystem` it describes tasks the caller excluded, which is #49.
  const governed = includeSystem ? results : results.filter(r => !r.isSystem);
  const matchedList = tier ? governed.filter(r => r.tier === tier) : governed;
  const rows = limit ? matchedList.slice(0, limit) : matchedList;

  res.json({
    evaluatedAt: now,
    /**
     * What the numbers below are *about*. Without this a caller cannot tell
     * "25 across everything" from "13 among yours" — and `systemExcluded` is
     * named out loud because a lens that hides 257 tasks silently is the
     * invisible fence this project keeps refusing to build.
     */
    scope: {
      includeSystem,
      tier: tier ?? null,
      systemExcluded: results.length - governed.length
    },
    counts: summarizeHealth(governed),
    matched: matchedList.length,
    returned: rows.length,
    tasks: rows
  });
});

/**
 * How many recent runs feed a native task's signals. Enough to see a failure
 * streak and a duration baseline; small enough that scoring every task is one
 * bounded query rather than a full history load.
 */
const HEALTH_EXECUTION_WINDOW = 10;

/**
 * Ceiling on the rows one analytics read pulls into memory to bucket.
 *
 * Lower than the history export's, because this response holds the rows *and*
 * three analyses over them, and because the totals below do not depend on it —
 * they come from an exact aggregate. Hitting it narrows the window the trend
 * claims to cover rather than thinning the data inside it (see below).
 */
const MAX_ANALYTICS_ROWS = 20000;

const DEFAULT_ANALYTICS_DAYS = 30;

/** Default silence before a scheduled task is worth asking about. */
const DEFAULT_IDLE_DAYS = 30;

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(730).optional(),
  /** IANA zone the daily buckets are cut on. Validated, never trusted. */
  tz: z.string().min(1).max(64).optional(),
  idleDays: z.coerce.number().int().positive().max(3650).optional()
});

/**
 * Execution analytics — failure trend, duration trend, and idle tasks.
 *
 * The three questions `ExecutionLog` could not answer while it was readable only
 * 20 rows at a time, per task. The bulk read landed with the health score; this
 * is the analysis on top of it. No agent work: every input is already in the
 * database.
 *
 * **Each section draws on a different source for the same reason.** `ExecutionLog`
 * holds runs *Cronsole performed*, so it is the right source for a trend of what
 * Cronsole did, the right source for durations **only on native tasks** (a
 * Windows row times the agent handshake, not the job), and the *wrong* source
 * for "has this run lately?" on Windows — which reads Windows' own `lastRunTime`
 * from the sync snapshot instead. `runAnalytics.ts` carries the full argument.
 *
 * **Totals are exact; the trend can be honestly partial.** The counts come from
 * an aggregate over the whole window, so they never depend on the row ceiling.
 * If the ceiling is hit, the trend reports a *narrower* covered span — a
 * complete chart of a shorter period rather than a period-shaped chart with
 * holes in it.
 */
router.get('/analytics', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const parsed = analyticsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  }

  const timeZone = parsed.data.tz ?? 'UTC';
  if (!isValidTimeZone(timeZone)) {
    // A bad zone is refused rather than quietly swapped for UTC: a chart bucketed
    // in the wrong zone is indistinguishable from one bucketed in the right one.
    throw new HttpError(400, `Unknown time zone "${timeZone}". Use an IANA name such as America/Los_Angeles.`);
  }

  const days = parsed.data.days ?? DEFAULT_ANALYTICS_DAYS;
  const idleDays = parsed.data.idleDays ?? DEFAULT_IDLE_DAYS;
  const now = new Date();
  const from = new Date(now.getTime() - days * 86400000);
  const where = historyWhere(userId, { from, to: now });

  const [byStatus, records, tasks, lastNativeRuns] = await Promise.all([
    // Exact over the whole window, independent of the row ceiling below.
    prisma.executionLog.groupBy({ by: ['status'], where, _count: { _all: true } }),

    prisma.executionLog.findMany({
      where,
      orderBy: { triggeredAt: 'desc' },
      // One extra row purely to detect the ceiling, so "partial" is a fact
      // rather than an inference from a suspiciously round number.
      take: MAX_ANALYTICS_ROWS + 1,
      select: {
        triggeredAt: true,
        status: true,
        durationMs: true,
        taskId: true,
        task: { select: { name: true, platform: true } }
      }
    }),

    prisma.task.findMany({
      where: { userId, status: { not: TaskStatus.DELETED } },
      select: {
        id: true,
        name: true,
        platform: true,
        category: true,
        externalId: true,
        status: true,
        schedule: true,
        updatedAt: true,
        metadata: true
      }
    }),

    // Deliberately NOT restricted to the window. "Last ran 200 days ago" is the
    // answer the idle report exists to give, and a 30-day window would hide the
    // date and report the task as never-run instead.
    prisma.executionLog.groupBy({
      by: ['taskId'],
      where: historyWhere(userId, { platform: PlatformType.TASKHUB_NATIVE }),
      _max: { triggeredAt: true }
    })
  ]);

  const count = (status: ExecutionStatus) => byStatus.find(g => g.status === status)?._count._all ?? 0;
  const totals = {
    runs: byStatus.reduce((sum, g) => sum + g._count._all, 0),
    succeeded: count(ExecutionStatus.SUCCESS),
    failed: count(ExecutionStatus.FAILURE) + count(ExecutionStatus.TIMEOUT),
    pending: count(ExecutionStatus.PENDING)
  };

  const partial = records.length > MAX_ANALYTICS_ROWS;
  const rows = records.slice(0, MAX_ANALYTICS_ROWS);
  // Rows come back newest-first, so the oldest one we actually hold is the
  // earliest moment the trend can honestly speak for.
  const coveredFrom = partial && rows.length ? rows[rows.length - 1].triggeredAt : from;

  const durationRows: DurationInput[] = rows.map(row => ({
    taskId: row.taskId,
    taskName: row.task.name,
    platform: row.task.platform,
    triggeredAt: row.triggeredAt,
    durationMs: row.durationMs,
    status: row.status
  }));

  const lastRunByTask = new Map(lastNativeRuns.map(g => [g.taskId, g._max.triggeredAt]));
  const idleInput: IdleInputTask[] = tasks.map(task => ({
    ...task,
    lastExecutionAt: lastRunByTask.get(task.id) ?? null
  }));

  res.json({
    window: { from, to: now, days, timeZone },
    /** Exact over the whole window — never a function of the row ceiling. */
    totals,
    trend: {
      covered: { from: coveredFrom, to: now },
      /** True when the ceiling was hit and `covered` is narrower than `window`. */
      partial,
      days: bucketByDay(rows, { from: coveredFrom, to: now }, timeZone)
    },
    duration: analyzeDurations(durationRows),
    idle: findIdleTasks(idleInput, now, idleDays),
    /**
     * What the trend and duration sections are counting. Shipped in the payload
     * rather than only in the UI so an agent reading this over MCP or a script
     * gets the caveat too — an empty period means Cronsole triggered nothing,
     * not that nothing ran.
     */
    source: {
      runs: 'Runs Cronsole performed — manual runs from the dashboard and Cronsole-native scheduled jobs. A Windows task firing on its own schedule is not recorded.',
      idle: "Windows tasks are judged from Windows' own last-run time in the sync snapshot; Cronsole-native tasks from Cronsole's execution records."
    }
  });
});

/**
 * **Why is Cronsole not working?** — the read-only system report.
 *
 * Owner-scoped like every other cross-task read: the agent liveness, sync times
 * and API tokens it reports all belong to one user, and the checks that describe
 * shared process state (the scheduler loop, the catalog, the origin list) still
 * count only that user's rows.
 *
 * `GET` and read-only on purpose, and the constraint runs deeper than the verb:
 * **no check here repairs anything.** Three of the four agent-health entries in
 * the troubleshooting log were the readout lying rather than the agent failing,
 * so a repair button shipped before this panel existed would have been acting on
 * a diagnosis nobody could yet check. See the header of `services/diagnostics.ts`.
 *
 * It answers 200 whatever it finds. A report that a check failed is a successful
 * report — the failure is the payload, not the transport, which is the same
 * distinction `ran` draws for a run result (troubleshooting #59).
 */
router.get('/diagnostics', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  res.json(await buildDiagnosticsReport(userId));
});

/**
 * What an AI tool needs to drive this Cronsole — the instructions half of the
 * Tools tab.
 *
 * Read-only and content-only: these serve documentation the install already
 * carries, so they cannot fail on an offline agent and reveal nothing about the
 * user's tasks.
 */
router.get('/downloads', (_req: Request, res: Response) => {
  res.json({
    version: CONNECT_PACK_VERSION,
    home: CONNECT_PACK_HOME,
    downloads: CONNECT_PACK_DOWNLOADS.map(d => ({
      id: d.id,
      title: d.title,
      description: d.description,
      filename: d.filename,
      kind: d.kind,
      fileCount: d.contents.length,
      // Only meaningful for single-file downloads; a zip's size isn't known
      // until it is built, and building all of them to render a list would be
      // work done for a number nobody reads.
      bytes: d.kind === 'zip' ? null : textByteLength(d.contents[0])
    }))
  });
});

router.get('/downloads/:id', async (req: Request, res: Response) => {
  const download = findDownload(req.params.id as string);
  if (!download) {
    throw new HttpError(404, `Unknown download "${req.params.id}"`);
  }

  const body = await buildDownload(download);
  res.setHeader('Content-Type', download.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${download.filename}"`);
  return res.send(body);
});

const bulkStatusSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'Select at least one task.'),
  status: z.enum([TaskStatus.ACTIVE, TaskStatus.DISABLED])
});

/**
 * Enable or disable many tasks at once.
 *
 * Lives on `/api/tools` rather than `/api/tasks` because it is a **cross-task**
 * route, and everything on `tasks.ts` competes with `/:id` in Express's
 * declaration-order matching (CLAUDE.md §9).
 *
 * It adds **no new agent verb and no new authority** — every task goes through
 * the same signed `task:set_status` the single toggle uses, via the same
 * connector. What it adds is one place that reports a partially-successful
 * batch honestly: see `services/bulkStatus.ts` for why the outcome has five
 * states and why the run stops when the agent disappears.
 *
 * `ACTIVE`/`DISABLED` only. `MISSING` is a status the *sync* discovers, never
 * one a user sets, so accepting it here would let a caller assert a fact about
 * the platform that Cronsole has not observed.
 */
router.post('/tasks/status', validateBody(bulkStatusSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { taskIds, status } = req.body as z.infer<typeof bulkStatusSchema>;

  // De-duplicate before the size check so a repeated id can't inflate a
  // selection past the limit, and can't cause the same task to be toggled twice.
  const ids = [...new Set(taskIds)];
  if (ids.length > MAX_TASKS_PER_BULK_STATUS) {
    throw new HttpError(
      400,
      `That is ${ids.length} tasks, above the ${MAX_TASKS_PER_BULK_STATUS} limit for one bulk change. ` +
        'Narrow the selection and repeat — each task is a separate round trip to the agent.'
    );
  }

  // Scoped by userId, like every by-id task route, so a caller cannot reach
  // another user's tasks by guessing ids (IDOR).
  const found = await prisma.task.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, name: true, platform: true, externalId: true, status: true }
  });

  // An id that matched nothing is reported, not silently dropped — a caller who
  // asked for 12 and is told about 11 has no way to know which one vanished.
  const foundIds = new Set(found.map(t => t.id));
  const missingIds = ids.filter(id => !foundIds.has(id));
  if (found.length === 0) {
    throw new HttpError(404, 'None of those tasks exist.');
  }

  // Connections are read once per platform rather than once per task: the config
  // is identical for every task on a platform, and decrypting it N times would
  // be N AES operations for one value.
  const connections = await prisma.platformConnection.findMany({ where: { userId } });
  const configByPlatform = new Map<PlatformType, unknown>(
    connections.map(c => [c.platform, { ...deserializeConfig(c.config), userId }])
  );

  const report = await applyBulkStatus(found, status, platform => ({
    connector: connectorRegistry.getConnector(platform),
    config: configByPlatform.get(platform) ?? { userId }
  }));

  // Persist only what the platform confirmed. Same ack-before-write ordering as
  // the single toggle, delete, and schedule edit: a DB row that says DISABLED
  // while the machine says otherwise is exactly the drift this project treats as
  // the worst kind of bug.
  const changedIds = report.items.filter(i => i.outcome === 'updated').map(i => i.taskId);
  if (changedIds.length > 0) {
    await prisma.task.updateMany({
      where: { id: { in: changedIds }, userId },
      data: { status, ...(status === TaskStatus.ACTIVE ? {} : { nextRunTime: null }) }
    });
    notifyTasksChanged(userId);
  }

  res.json({
    ...report,
    notFound: missingIds,
    summary: summarizeBulkStatus(report)
  });
});

/**
 * De-duplicate a bulk request's ids and enforce the batch ceiling.
 *
 * **De-duplication happens before the size check**, deliberately: a repeated id
 * must not inflate a selection past the limit, and must not cause one task to be
 * acted on twice.
 */
function bulkIds(taskIds: string[]): string[] {
  const ids = [...new Set(taskIds)];
  if (ids.length > MAX_TASKS_PER_BULK) {
    throw new HttpError(
      400,
      `That is ${ids.length} tasks, above the ${MAX_TASKS_PER_BULK} limit for one bulk change. ` +
        'Narrow the selection and repeat.'
    );
  }
  return ids;
}

/**
 * Which requested ids matched nothing — and a 404 when *none* did.
 *
 * The ids are reported rather than silently dropped: a caller who asked for 12
 * and is told about 11 has no way to know which one vanished.
 *
 * Deliberately takes the rows a route has **already** fetched, rather than doing
 * the query itself with a caller-supplied `select`. That version existed and was
 * wrong: a generic over the select shape can only be satisfied with a cast on a
 * query result, which is [#30](../../docs/troubleshooting/README.md) exactly —
 * the compiler stops checking at the boundary most likely to drift, and the
 * failure moves to a 500 on real data. Each route runs its own `findMany` with a
 * literal select, so Prisma's inference does the checking; the ownership scoping
 * that keeps ids from reaching another user's tasks lives in that query's
 * `where`, next to the fields it selects.
 */
function bulkNotFound(ids: string[], found: readonly { id: string }[]): string[] {
  if (found.length === 0) {
    throw new HttpError(404, 'None of those tasks exist.');
  }
  const foundIds = new Set(found.map(t => t.id));
  return ids.filter(id => !foundIds.has(id));
}

const bulkCategorySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'Select at least one task.'),
  category: z.string().trim().min(1).max(100)
});

/**
 * Move many tasks into one category.
 *
 * The only bulk verb that touches nothing but Cronsole's own database — no
 * connector, no signed command, no agent. It is the bulk form of
 * `PATCH /api/tasks/:id`, and it is here rather than there for the usual
 * reason: cross-task routes cannot live on `tasks.ts`, where everything
 * competes with `/:id`.
 *
 * **A Windows task's category is a label, and this does not move the task on
 * the machine.** `services/bulkCategory.ts` carries the full argument; the
 * response carries `detachedFromFolder` so a user who has just relabelled
 * twenty tasks is told their dashboard now groups them differently from Task
 * Scheduler. Not a refusal — it is a legitimate thing to want, and it was
 * already possible one task at a time. Just never silent.
 */
router.post('/tasks/category', validateBody(bulkCategorySchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { taskIds, category } = req.body as z.infer<typeof bulkCategorySchema>;

  const ids = bulkIds(taskIds);
  // Scoped by userId, like every by-id task route, so a caller cannot reach
  // another user's tasks by guessing ids (IDOR).
  const found = await prisma.task.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, name: true, platform: true, externalId: true, category: true }
  });
  const notFound = bulkNotFound(ids, found);

  // The one definition of "which folder is this task in?" stays on TaskService
  // and is passed *into* the planner. Re-deriving a path rule elsewhere is the
  // shape that silently took a whole folder out of every sync (#20a).
  const targets: BulkCategoryTask[] = found.map(task => ({
    id: task.id,
    name: task.name,
    platform: task.platform,
    category: task.category,
    folderCategory: TaskService.extractCategory(task.externalId, task.platform)
  }));

  const report = planBulkCategory(targets, category);

  const changedIds = idsToUpdate(report);
  if (changedIds.length > 0) {
    await prisma.task.updateMany({
      where: { id: { in: changedIds }, userId },
      data: { category }
    });
    notifyTasksChanged(userId);
  }

  res.json({
    ...report,
    // What was asked for after de-duplication — not what was found, so a
    // selection holding an id that no longer exists still reports its own size.
    requested: ids.length,
    notFound,
    summary: summarizeBulkCategory(report)
  });
});

const bulkUntrackSchema = z.object({
  taskIds: z.array(z.string().min(1)).min(1, 'Select at least one task.')
});

/**
 * Untrack many tasks — remove them from Cronsole, leave them running.
 *
 * Mirrors `POST /api/tasks/:id/untrack` exactly, including the `TaskExclusion`
 * that stops the next sync quietly re-importing what the user just removed.
 * It makes **no platform call**, which is what makes it safe to offer beside
 * bulk delete and what makes it work while the agent is offline.
 *
 * The whole operation is one transaction. A partial untrack is the one outcome
 * worse than none: a deleted row whose exclusion never landed comes back on the
 * next sync, so the user does the work twice and the second time trusts it less.
 * That is affordable here precisely *because* there is no platform round-trip to
 * hold it open — `bulkStatus` cannot do the same, since each of its writes is
 * only legitimate after the machine has confirmed it.
 */
router.post('/tasks/untrack', validateBody(bulkUntrackSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { taskIds } = req.body as z.infer<typeof bulkUntrackSchema>;

  const ids = bulkIds(taskIds);
  const found = await prisma.task.findMany({
    where: { id: { in: ids }, userId },
    select: { id: true, name: true, platform: true, externalId: true }
  });
  const notFound = bulkNotFound(ids, found);

  const { report, plan } = planBulkUntrack(found);

  if (plan.length > 0) {
    const ids = plan.map(p => p.taskId);
    await prisma.$transaction([
      prisma.executionLog.deleteMany({ where: { taskId: { in: ids } } }),
      prisma.task.deleteMany({ where: { id: { in: ids }, userId } }),
      // Upsert, not create: re-untracking a task that was re-imported and
      // removed again must not 409 on the unique key.
      ...plan.map(entry =>
        prisma.taskExclusion.upsert({
          where: {
            userId_platform_externalId: {
              userId,
              platform: entry.platform,
              externalId: entry.externalId
            }
          },
          create: { userId, platform: entry.platform, externalId: entry.externalId },
          update: {}
        })
      )
    ]);
    notifyTasksChanged(userId);
  }

  res.json({
    ...report,
    // What was asked for after de-duplication — not what was found, so a
    // selection holding an id that no longer exists still reports its own size.
    requested: ids.length,
    notFound,
    // Said in the payload, not only in the button copy: an MCP client or script
    // has no UI to read, and this is the one fact that distinguishes untrack
    // from delete.
    platformEntriesKept: true,
    summary: summarizeBulkUntrack(report),
    detail:
      'These tasks are no longer tracked by Cronsole. They still exist on their platform and will ' +
      'keep running on their own schedules. Re-import their category to track them again.'
  });
});

/* ---------------------------------------------------------------------------
 * Vercel Cron connection — the third config a user composes by hand.
 *
 * Shaped like the GitHub block above rather than the Claude one, because Vercel
 * is shaped like GitHub: **one** access token per account, and it is what makes
 * every project readable, so the token is a property of the *connection* and the
 * project list holds no secrets at all. Removing a project can never cost the
 * user a credential, so none of the "re-adding is the rotation path" care the
 * Claude panel carries is needed here.
 *
 * Still Vercel-specific rather than a generic
 * `PUT /platforms/:platform/connection`, for the reason stated over both blocks
 * above: a generic route would imply the other platforms are configurable this
 * way and would take an arbitrary blob into a field every connector trusts.
 *
 * **The token is write-only across all of these.** `GET` reports `hasToken` and
 * the last four characters — enough to answer *"is this the token I just
 * made?"*, not enough to be one. There is no reveal endpoint: Vercel shows an
 * access token once and cannot re-display it either.
 *
 * One route has no GitHub counterpart — `GET .../discover`. GitHub cannot list
 * "your repositories" usefully (a token reaches thousands), but Vercel's project
 * list is small, is one request, and **already carries each project's crons**.
 * So the panel can offer a picker showing which projects actually have cron jobs
 * instead of asking someone to type a name they are looking at in another tab.
 * It is a read with no side effect and it stores nothing.
 * -------------------------------------------------------------------------- */

/** Load the Vercel connection and its config, or a well-formed empty state. */
async function loadVercelConnection(userId: string) {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.VERCEL_CRON }
  });
  return {
    connection,
    config: connection ? readVercelConfig(deserializeConfig(connection.config)) : readVercelConfig({})
  };
}

/**
 * Write the config back, creating the connection on first use.
 *
 * `serializeConfig` is not optional: `PlatformConnection.config` is AES-256-GCM
 * encrypted at rest and this holds a live third-party credential.
 */
async function saveVercelConnection(
  userId: string,
  connectionId: string | undefined,
  config: ReturnType<typeof readVercelConfig>
) {
  const serialized = serializeConfig(config);
  if (connectionId) {
    await prisma.platformConnection.update({ where: { id: connectionId }, data: { config: serialized } });
  } else {
    await prisma.platformConnection.create({
      data: { userId, platform: PlatformType.VERCEL_CRON, isActive: true, config: serialized }
    });
  }
  await refreshVercelHealth(userId);
}

/**
 * Recompute and store this connection's health right after writing it.
 *
 * Same reason as `refreshClaudeHealth` and `refreshGitHubHealth`: the
 * dashboard's 45-second poll is the only other writer of
 * `PlatformConnection.healthState`, so without this the card sits at whatever
 * that poll last left until the next one runs.
 *
 * Safe here for one specific reason, and **only** that reason: the Vercel
 * connector's `getHealth` reads back stored `PlatformCapability` evidence and
 * does not probe. Do not copy this into a write path for a platform whose health
 * check talks to the platform.
 */
async function refreshVercelHealth(userId: string): Promise<void> {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.VERCEL_CRON }
  });
  if (!connection) return;

  const connector = connectorRegistry.getConnector(PlatformType.VERCEL_CRON);
  if (!connector) return;

  try {
    const health = await connector.getHealth({ ...deserializeConfig(connection.config), userId });
    await prisma.platformConnection.update({
      where: { id: connection.id },
      // `?? null`, not a bare value: Prisma reads `undefined` as "leave the
      // column alone", which keeps a stale reason under a fresh state.
      data: { healthState: health.state, healthReason: health.reason ?? null }
    });
  } catch {
    // Health is a readout, not the operation. Failing to refresh it must not
    // fail the write the user just made.
  }
}

/**
 * The connection's state — projects, whether a token is stored, and how many
 * cron jobs each project currently accounts for.
 *
 * `taskCount` per project is here for the same reason it is on the GitHub and
 * Claude panels: removing a project strands its tracked crons, and the UI has to
 * be able to say so **before** the click rather than report it after.
 */
router.get('/platforms/vercel/connection', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { connection, config } = await loadVercelConnection(userId);

  const tasks = await prisma.task.findMany({
    where: { userId, platform: PlatformType.VERCEL_CRON },
    select: { externalId: true }
  });
  const counts = new Map<string, number>();
  for (const t of tasks) {
    const project = projectFromExternalId(t.externalId);
    if (project) counts.set(project, (counts.get(project) ?? 0) + 1);
  }

  const redacted = redactVercelConfig(config);
  res.json({
    connected: Boolean(connection),
    hasToken: redacted.hasToken,
    tokenHint: redacted.tokenHint,
    projects: redacted.projects.map(p => ({ ...p, taskCount: counts.get(p.name) ?? 0 }))
  });
});

/**
 * Store (or rotate) the account token.
 *
 * **Verified before it is stored**, with one `GET /v2/user`. That is one of only
 * two places in this connector that contacts Vercel outside a sync, and it is
 * here rather than in `getHealth` on purpose: a bad paste should fail at the
 * click that made it, while a health check runs on a 45-second poll per open tab
 * and would spend a rate limit answering a question sync answers for free.
 *
 * A token Vercel rejects is a **400**, not a 502 — the request is wrong, not the
 * gateway, and retrying the same paste cannot help. A token Vercel *accepts*
 * whose shape is unfamiliar is saved with a warning, the same call the GitHub
 * route makes: a token format is a fact about this year, not a contract.
 */
router.put(
  '/platforms/vercel/connection',
  validateBody(vercelTokenInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const token = String((req.body as { token: string }).token).trim();

    const verified = await verifyVercelToken(token);
    if (!verified.ok) {
      throw new HttpError(verified.status === null ? 502 : 400, verified.message);
    }

    const { connection, config } = await loadVercelConnection(userId);
    await saveVercelConnection(userId, connection?.id, { ...config, token });

    res.json({
      username: verified.data.username,
      hasToken: true,
      tokenHint: token.slice(-4),
      projects: config.projects,
      warnings: looksLikeVercelToken(token)
        ? []
        : ['That token does not match a format Vercel currently issues. It verified, so it is saved.']
    });
  }
);

/**
 * What this token can see — projects across the personal account and every team,
 * each with whether it actually has cron jobs.
 *
 * **A read, and only a read.** It stores nothing and watches nothing; the picker
 * it feeds still ends in an explicit add. The reason it exists at all is that
 * Vercel makes it nearly free — the project list is one request and already
 * carries `crons.definitions` — and the alternative is asking someone to
 * hand-type a name they can see in another tab, which is exactly the friction
 * the Windows discovery modal removes for its platform.
 *
 * A team whose listing fails is **named, not dropped**: an account whose team
 * projects silently vanished from the picker would look like an empty account,
 * which is the "found nothing versus looked at nothing" ambiguity one layer up
 * from where the sync fixes it.
 */
router.get('/platforms/vercel/discover', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { config } = await loadVercelConnection(userId);
  if (!config.token) {
    throw new HttpError(400, 'Add a Vercel token first — Cronsole needs one to list your projects.');
  }

  const warnings: string[] = [];
  const scopes: { teamId?: string; label: string }[] = [{ label: 'Personal account' }];

  const teams = await listVercelTeams(config.token);
  if (teams.ok) {
    for (const team of teams.data) scopes.push({ teamId: team.id, label: team.name });
  } else {
    warnings.push(`Could not list your teams: ${teams.message}`);
  }

  const watched = new Set(config.projects.map(p => p.id));
  const projects: {
    id: string;
    name: string;
    teamId?: string;
    scope: string;
    cronCount: number;
    hasCrons: boolean;
    watched: boolean;
  }[] = [];

  for (const scope of scopes) {
    const listed = await listVercelProjects(config.token, scope.teamId);
    if (!listed.ok) {
      warnings.push(`Could not list projects in ${scope.label}: ${listed.message}`);
      continue;
    }
    if (listed.data.truncated) {
      warnings.push(
        `${scope.label} has more projects than one page returns — Cronsole listed the first 100. ` +
          'Paste a project URL to watch one that is not shown.'
      );
    }
    for (const project of listed.data.projects) {
      projects.push({
        id: project.id,
        name: project.name,
        ...(scope.teamId ? { teamId: scope.teamId } : {}),
        scope: scope.label,
        // `crons: null` means the project has never deployed a cron; an empty
        // `definitions` means it has crons enabled and none right now. Both read
        // as "nothing to import", and the picker only needs the count — but the
        // two stay distinguishable in `hasCrons` so a project that *had* crons
        // and lost them is not offered as if it never had any.
        cronCount: project.crons?.definitions.length ?? 0,
        hasCrons: project.crons !== null,
        watched: watched.has(project.id)
      });
    }
  }

  res.json({ projects, warnings });
});

/**
 * Watch a project.
 *
 * Takes a dashboard URL, a bare name, or a `prj_…` id — someone doing this by
 * hand is looking at the project in a browser, so pasting the address bar is the
 * expected input rather than an edge case.
 *
 * **Verified against Vercel before it is stored**, by reading the project. A
 * project saved unverified fails much later, inside a sync, as one line among
 * several — and a *team* project looked up without its team resolves against the
 * personal account and 404s, so that failure would read as a typo when it is a
 * scope problem. Checking here lets the message say which.
 *
 * Idempotent, and a re-add **replaces** the stored row rather than being a no-op
 * (GitHub's leaves it alone). Nothing here is a secret, so nothing can be lost —
 * and a re-add is the only path that refreshes a stale name or a project that
 * moved under a team.
 */
router.post(
  '/platforms/vercel/projects',
  validateBody(projectInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const raw = String((req.body as { project: string }).project);
    const teamIdHint = typeof req.body?.teamId === 'string' && req.body.teamId ? String(req.body.teamId) : undefined;

    const ref = normalizeProjectInput(raw);
    if (!ref) {
      throw new HttpError(
        400,
        'Could not read a project from that. Paste the project\'s dashboard URL, its name, or its ' +
          'prj_… id — for example vercel.com/acme/website or website.'
      );
    }

    const { connection, config } = await loadVercelConnection(userId);
    if (!config.token) {
      throw new HttpError(400, 'Add a Vercel token first — Cronsole needs one to read a project.');
    }

    const idOrName = ref.kind === 'id' ? ref.id : ref.name;
    // The team slug from a pasted dashboard URL, or the id the picker sent.
    // Vercel accepts either as the scope of the lookup, and without one a team
    // project resolves against the personal account and is genuinely not found.
    const slug = ref.kind === 'name' ? ref.teamSlug : undefined;
    const read = await getVercelProject(config.token, idOrName, teamIdHint, slug);
    if (!read.ok) {
      throw new HttpError(read.status === null ? 502 : 400, read.message);
    }

    const project = {
      id: read.data.id,
      name: read.data.name,
      ...(read.data.teamId ? { teamId: read.data.teamId } : teamIdHint ? { teamId: teamIdHint } : {})
    };
    const already = config.projects.some(p => p.id === project.id);

    await saveVercelConnection(userId, connection?.id, {
      ...config,
      projects: upsertProject(config.projects, project)
    });

    res.status(already ? 200 : 201).json({
      project: { ...project, taskCount: 0 },
      already,
      // What syncing will find — and unlike GitHub's `workflowCount`, this is
      // exact, because a Vercel project hands over its cron definitions in the
      // same response. Nothing has to be read per task to know the number.
      cronCount: read.data.crons?.definitions.length ?? 0,
      hasCrons: read.data.crons !== null
    });
  }
);

/**
 * Stop watching a project, and remove the cron jobs it put on the dashboard.
 *
 * **Cronsole-side only** — the crons keep running on Vercel exactly as before,
 * which is why the UI says *Stop watching* and never *Delete*.
 *
 * The tracked rows go with the declaration, in the same request, for the reason
 * the Claude and GitHub disconnects learned: a row whose project is no longer
 * watched cannot be synced, cannot be run (nothing here can), and would sit on
 * the dashboard flipping to MISSING at the next sync. Absence of a row is what
 * "stopped watching" means, so stopping has to produce it.
 *
 * **No `TaskExclusion` is written**, deliberately. An exclusion exists to stop a
 * *re-enumeration* putting something back; here the declaration is the only
 * thing that enumerates this project at all, so with it gone there is nothing to
 * fence against — and a stale exclusion would silently swallow the project if it
 * were ever re-added. Untracking one cron while still watching its project is
 * the case exclusions *are* for, and `untrack_task` works normally.
 */
router.delete('/platforms/vercel/projects/:id', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = String(req.params.id);

  const { connection, config } = await loadVercelConnection(userId);
  const target = config.projects.find(p => p.id === id);
  if (!target) {
    throw new HttpError(404, 'That project is not being watched.');
  }

  const remaining = removeProject(config.projects, id);
  await saveVercelConnection(userId, connection?.id, { ...config, projects: remaining });

  const doomed = await prisma.task.findMany({
    where: { userId, platform: PlatformType.VERCEL_CRON },
    select: { id: true, externalId: true }
  });
  const doomedIds = doomed
    .filter(t => projectFromExternalId(t.externalId) === target.name)
    .map(t => t.id);

  if (doomedIds.length) {
    await prisma.$transaction([
      // ExecutionLog has no cascade on its Task relation, so it must go first or
      // the delete violates the FK. TaskFavorite does cascade.
      prisma.executionLog.deleteMany({ where: { taskId: { in: doomedIds } } }),
      prisma.task.deleteMany({ where: { id: { in: doomedIds } } })
    ]);
    notifyTasksChanged(userId);
  }

  res.json({ removed: target.name, tasksRemoved: doomedIds.length, watching: remaining.length });
});

/**
 * Disconnect Vercel entirely — forget the token, the projects and the rows.
 *
 * The connection row is **deleted** rather than emptied, for the reason the
 * Claude and GitHub routes give: an empty connection is `configured: true` with
 * nothing in it, so the card would sit at "connected, nothing to read"
 * indefinitely for someone who has actually left. With no connection the card
 * reads *Not connected*, which is the true statement. Capability evidence is
 * keyed separately and survives, so verbs already verified stay verified if
 * Vercel is reconnected later.
 */
router.delete('/platforms/vercel/connection', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { connection } = await loadVercelConnection(userId);
  if (!connection) {
    throw new HttpError(404, 'Vercel is not connected.');
  }

  const doomed = await prisma.task.findMany({
    where: { userId, platform: PlatformType.VERCEL_CRON },
    select: { id: true }
  });
  const doomedIds = doomed.map(t => t.id);

  await prisma.$transaction([
    ...(doomedIds.length
      ? [
          prisma.executionLog.deleteMany({ where: { taskId: { in: doomedIds } } }),
          prisma.task.deleteMany({ where: { id: { in: doomedIds } } })
        ]
      : []),
    prisma.platformConnection.delete({ where: { id: connection.id } })
  ]);
  if (doomedIds.length) notifyTasksChanged(userId);

  res.json({ disconnected: true, tasksRemoved: doomedIds.length });
});

/* ---------------------------------------------------------------------------
 * Gemini API Triggers connection — the fourth config a user composes by hand,
 * and by some distance the smallest.
 *
 * The three blocks above each carry a **list**: Claude a list of `(routine,
 * token)` pairs, GitHub a list of repositories, Vercel a list of projects. Each
 * list exists because a credential on those platforms reaches far more than the
 * user wants tracked, so naming a subset is a real gesture with real routes —
 * add, remove, and on Vercel a discovery read to make the add cheap.
 *
 * **Gemini has nothing to enumerate.** An API key is scoped to one Google Cloud
 * project, and that project's triggers are the whole tracked set. So there is no
 * add route, no remove route, no discover route, and no question anywhere in
 * here about what a refresh includes. What is left is a key, and one setting.
 *
 * That setting — `agent` — is the only field here that is not a credential, and
 * it is stored rather than compiled in for a specific reason:
 * `antigravity-preview-05-2026` is a **preview** id with a date inside it. A
 * constant in the source would mean creates that begin failing months after
 * this was written, with nothing in the product to change. Stored, it is a text
 * field; the panel shows it, and the default is shown as the placeholder so
 * clearing the field is a way back rather than a way to break it.
 *
 * **The key is write-only**, like every other credential here: `GET` reports
 * `hasKey` and the last four characters. There is no reveal endpoint — Google's
 * console is where a key is looked at, and it is a better place than this one.
 * -------------------------------------------------------------------------- */

/** Load the Gemini connection and its config, or a well-formed empty state. */
async function loadGeminiConnection(userId: string) {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.GEMINI_TRIGGERS }
  });
  return {
    connection,
    config: connection ? readGeminiConfig(deserializeConfig(connection.config)) : readGeminiConfig({})
  };
}

/**
 * Write the config back, creating the connection on first use.
 *
 * `serializeConfig` is not optional: `PlatformConnection.config` is AES-256-GCM
 * encrypted at rest and this holds a live third-party credential.
 */
async function saveGeminiConnection(
  userId: string,
  connectionId: string | undefined,
  config: ReturnType<typeof readGeminiConfig>
) {
  const serialized = serializeConfig(config);
  if (connectionId) {
    await prisma.platformConnection.update({ where: { id: connectionId }, data: { config: serialized } });
  } else {
    await prisma.platformConnection.create({
      data: { userId, platform: PlatformType.GEMINI_TRIGGERS, isActive: true, config: serialized }
    });
  }
  await refreshGeminiHealth(userId);
}

/**
 * Recompute and store this connection's health right after writing it.
 *
 * Same reason as the three `refresh*Health` helpers above: the dashboard's
 * 45-second poll is the only other writer of `PlatformConnection.healthState`,
 * so without this the card sits at whatever that poll last left until the next
 * one runs.
 *
 * Safe here for one specific reason, and **only** that reason: the Gemini
 * connector's `getHealth` reads back stored `PlatformCapability` evidence and
 * does not probe. Do not copy this into a write path for a platform whose health
 * check talks to the platform.
 */
async function refreshGeminiHealth(userId: string): Promise<void> {
  const connection = await prisma.platformConnection.findFirst({
    where: { userId, platform: PlatformType.GEMINI_TRIGGERS }
  });
  if (!connection) return;

  const connector = connectorRegistry.getConnector(PlatformType.GEMINI_TRIGGERS);
  if (!connector) return;

  try {
    const health = await connector.getHealth({ ...deserializeConfig(connection.config), userId });
    await prisma.platformConnection.update({
      where: { id: connection.id },
      // `?? null`, not a bare value: Prisma reads `undefined` as "leave the
      // column alone", which keeps a stale reason under a fresh state.
      data: { healthState: health.state, healthReason: health.reason ?? null }
    });
  } catch {
    // Health is a readout, not the operation. Failing to refresh it must not
    // fail the write the user just made.
  }
}

/**
 * The connection's state — whether a key is stored, which agent creates use, and
 * how many triggers are on the dashboard.
 *
 * `taskCount` is a single number rather than the per-repository breakdown the
 * GitHub and Vercel panels carry, because there is nothing to break it down by.
 * It is here for the same reason theirs is: disconnecting strands every tracked
 * trigger, and the UI has to be able to say how many **before** the click.
 */
router.get('/platforms/gemini/connection', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { connection, config } = await loadGeminiConnection(userId);

  const taskCount = await prisma.task.count({
    where: { userId, platform: PlatformType.GEMINI_TRIGGERS }
  });

  const redacted = redactGeminiConfig(config);
  res.json({
    connected: Boolean(connection),
    hasKey: redacted.hasKey,
    keyHint: redacted.keyHint,
    agent: redacted.agent,
    defaultAgent: redacted.defaultAgent,
    taskCount
  });
});

/**
 * Store (or rotate) the API key.
 *
 * **Verified before it is stored**, by listing triggers. Unlike the other three
 * connectors there is no separate identity endpoint to call — and there does not
 * need to be, because the thing this connection is *for* is the same request. A
 * key that can list triggers works; one that cannot has failed the only question
 * worth asking, and the answer names the count so a working key over an empty
 * project reads as working rather than as suspicious.
 *
 * This is the **one** place Cronsole contacts Gemini outside a sync or an
 * explicit user action, and it is here rather than in `getHealth` on purpose: a
 * bad paste should fail at the click that made it, while a health check runs on
 * a 45-second poll per open tab and would spend a metered quota answering a
 * question sync answers for free.
 *
 * A key Gemini rejects is a **400**, not a 502 — the request is wrong, not the
 * gateway, and retrying the same paste cannot help. A key Gemini *accepts* whose
 * shape is unfamiliar is saved with a warning, the same call the GitHub and
 * Vercel routes make: a key format is a fact about this year, not a contract.
 */
router.put(
  '/platforms/gemini/connection',
  validateBody(geminiKeyInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const apiKey = String((req.body as { apiKey: string }).apiKey).trim();

    const verified = await listGeminiTriggers(apiKey);
    if (!verified.ok) {
      throw new HttpError(verified.status === null ? 502 : 400, verified.message);
    }

    const { connection, config } = await loadGeminiConnection(userId);
    await saveGeminiConnection(userId, connection?.id, { ...config, apiKey });

    res.json({
      hasKey: true,
      keyHint: apiKey.slice(-4),
      agent: config.agent,
      defaultAgent: DEFAULT_GEMINI_AGENT,
      triggerCount: verified.data.length,
      warnings: looksLikeGeminiKey(apiKey)
        ? []
        : ['That key does not match a format Google currently issues. It verified, so it is saved.']
    });
  }
);

/**
 * Set which managed agent a Cronsole-created trigger runs.
 *
 * **Not verified against the platform**, and that is deliberate rather than
 * lazy. There is no endpoint that lists valid agent ids, so the only way to
 * "check" one would be to create a trigger with it — a write, with a side
 * effect, from a settings field. The honest alternative is to store what was
 * typed and let the create say plainly when Gemini rejects it, which
 * `describeError` already does with Google's own message attached.
 *
 * **Blank means the default**, which is why the schema allows an empty string:
 * clearing the field has to be a way back to the shipped value, or a user who
 * typed a wrong id is stuck guessing the right one.
 */
router.put(
  '/platforms/gemini/agent',
  validateBody(geminiAgentInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const typed = String((req.body as { agent: string }).agent).trim();

    const { connection, config } = await loadGeminiConnection(userId);
    if (!connection) {
      throw new HttpError(400, 'Add a Gemini API key first — there is no connection to configure yet.');
    }

    await saveGeminiConnection(userId, connection.id, {
      ...config,
      agent: typed || DEFAULT_GEMINI_AGENT
    });

    res.json({ agent: typed || DEFAULT_GEMINI_AGENT, defaultAgent: DEFAULT_GEMINI_AGENT });
  }
);


/**
 * **Saved MCP servers on the Gemini connection.**
 *
 * The store behind these four routes is `GeminiConfig.toolPresets` — inside the
 * same AES-256-GCM blob as the API key, because a preset holds a credential and
 * the key sitting beside it is the larger one.
 *
 * **No route here returns a header value.** `redactGeminiPreset` is the only
 * shape that leaves, and it answers *whether* a credential is set. There is no
 * reveal endpoint for the same reason there is none for the API key: the value
 * exists to be sent to Gemini, and a user who needs to read it has the service
 * that issued it.
 *
 * `usedBy` is counted by **URL**, not by name, and that is why two presets may
 * not share one. A synced trigger reports its MCP servers as `{type, name, url}`
 * and nothing more, so the URL is the only thing that survives the round trip
 * and can identify the server a live trigger is pointed at.
 */
router.get('/platforms/gemini/tool-presets', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { config } = await loadGeminiConnection(userId);
  const presets = config.toolPresets ?? [];

  const usage = await countPresetUsage(userId, presets);

  res.json({
    presets: presets.map(p => ({ ...redactGeminiPreset(p), usedBy: usage.get(p.url) ?? 0 })),
    max: MAX_TOOL_PRESETS
  });
});

/**
 * Save or update one preset.
 *
 * **Upsert by name**, so the same form creates and edits — there is nothing a
 * separate create route would say differently, and two routes would be two
 * places for the duplicate-URL rule to live.
 *
 * **Omitting `headers` on an existing preset keeps the stored ones.** That is
 * what makes fixing a typo in a URL possible without retyping a token the user
 * may not have to hand — the exact friction this whole feature exists to remove.
 * Sending `{}` clears the credential explicitly, so both intents are sayable and
 * neither is the accident of leaving a field blank.
 */
router.put(
  '/platforms/gemini/tool-presets',
  validateBody(geminiPresetInputSchema),
  async (req: Request, res: Response) => {
    const userId = (req as AuthRequest).user!.id;
    const body = req.body as { name: string; url: string; headers?: Record<string, string> };
    const name = body.name.trim();
    const url = body.url.trim();

    const { connection, config } = await loadGeminiConnection(userId);
    if (!connection) {
      throw new HttpError(400, 'Add a Gemini API key first — there is no connection to save a server on.');
    }

    const presets = [...(config.toolPresets ?? [])];
    const existingIndex = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());

    // **Refused rather than silently allowed**, because a second preset on one
    // URL cannot be told apart on a synced trigger — the platform reports a
    // tool's URL and no reference to which stored credential built it. Allowing
    // it would make "which triggers use this preset" unanswerable and a rotation
    // would rebuild triggers belonging to the other one.
    const urlClash = presets.findIndex(
      (p, i) => i !== existingIndex && p.url.toLowerCase() === url.toLowerCase()
    );
    if (urlClash !== -1) {
      throw new HttpError(
        400,
        `"${presets[urlClash]!.name}" already points at that URL. A trigger reports only its server's ` +
          'URL, so two saved servers sharing one could not be told apart on a synced trigger — edit ' +
          'that one instead, or give this a different endpoint.'
      );
    }

    if (existingIndex === -1 && presets.length >= MAX_TOOL_PRESETS) {
      throw new HttpError(400, `A connection may hold ${MAX_TOOL_PRESETS} saved servers.`);
    }

    const kept = existingIndex === -1 ? undefined : presets[existingIndex]!.headers;
    const headers = body.headers ?? kept;
    const preset: AgentToolPreset = {
      name,
      url,
      ...(headers && Object.keys(headers).length ? { headers } : {})
    };

    if (existingIndex === -1) presets.push(preset);
    else presets[existingIndex] = preset;

    await saveGeminiConnection(userId, connection.id, { ...config, toolPresets: presets });

    res.json({ preset: redactGeminiPreset(preset), created: existingIndex === -1 });
  }
);

/**
 * Forget a preset.
 *
 * **Triggers already built from it are untouched**, and the response says how
 * many, because they keep running with the credential Gemini holds — deleting
 * the Cronsole-side reference cannot reach into a trigger that already exists.
 * What is lost is the ability to rotate them in one gesture, which is worth
 * saying at the moment somebody removes it rather than discovering later.
 */
router.delete('/platforms/gemini/tool-presets/:name', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const name = String(req.params.name);

  const { connection, config } = await loadGeminiConnection(userId);
  const preset = connection ? findGeminiPreset(config, name) : undefined;
  if (!connection || !preset) {
    throw new HttpError(404, `No saved server called "${name}".`);
  }

  const usage = await countPresetUsage(userId, [preset]);
  const usedBy = usage.get(preset.url) ?? 0;

  await saveGeminiConnection(userId, connection.id, {
    ...config,
    toolPresets: (config.toolPresets ?? []).filter(p => p.name.toLowerCase() !== name.toLowerCase())
  });

  res.json({
    removed: true,
    usedBy,
    message: usedBy
      ? `Removed. ${usedBy} trigger${usedBy === 1 ? '' : 's'} still using that server keep running — ` +
        'Gemini holds their credentials. They can no longer be rotated together.'
      : 'Removed.'
  });
});

/**
 * **Re-apply a preset to every trigger that uses it — the rotation fan-out.**
 *
 * The reason the whole preset feature exists. Before it, rotating one MCP token
 * meant opening every Gemini task and retyping the token into each, from memory,
 * with nothing on any screen saying which tasks were affected — and a task missed
 * fails silently, later, on a schedule.
 *
 * Three properties, each one already a rule somewhere else in this codebase:
 *
 * **It reports per task, never per batch** (§9). Partial success is the normal
 * case here: each task is an independent create-then-delete against somebody
 * else's API, and one verdict over the set would be a lie in one direction or
 * the other. `bulkOutcome`'s vocabulary is deliberately not reused — this is not
 * a bulk *operation* over a selection, it is one credential change fanning out to
 * the tasks that reference it, and the caller needs the new external ids.
 *
 * **A surviving original is a failure, not a note.** `rotateCredentials` returns
 * `oldRemoved: false` when the replacement exists and the old trigger could not
 * be deleted, which means the schedule now fires twice. It is surfaced per task
 * for exactly that reason.
 *
 * **Each task's other tools are preserved.** The tool list sent is rebuilt from
 * what the platform reports for *that* trigger, with this preset's entry swapped
 * in by URL. Sending only the preset would silently strip every other tool the
 * trigger had, which is the "refused with the list, never narrowed" rule in the
 * form it would actually take here.
 */
router.post('/platforms/gemini/tool-presets/:name/apply', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const name = String(req.params.name);

  const { connection, config } = await loadGeminiConnection(userId);
  const preset = connection ? findGeminiPreset(config, name) : undefined;
  if (!connection || !preset) {
    throw new HttpError(404, `No saved server called "${name}".`);
  }

  const connector = connectorRegistry.getConnector(PlatformType.GEMINI_TRIGGERS);
  if (!connector?.rotateCredentials) {
    throw new HttpError(400, 'This build cannot rebuild Gemini triggers.');
  }

  const tasks = await prisma.task.findMany({
    where: { userId, platform: PlatformType.GEMINI_TRIGGERS }
  });
  const affected = tasks.filter(t => reachOf(t.metadata).tools.some(tool => sameUrl(tool.url, preset.url)));

  if (!affected.length) {
    res.json({
      applied: [],
      message: `No trigger uses "${preset.name}" yet, so there was nothing to rebuild.`
    });
    return;
  }

  const applied: {
    taskId: string;
    name: string;
    ok: boolean;
    oldRemoved: boolean;
    message?: string;
  }[] = [];

  for (const task of affected) {
    const reach = reachOf(task.metadata);
    // The trigger's own tools, with this preset's entry replaced by a reference
    // the connector resolves. Every other tool travels as the platform reported
    // it — which for another MCP server means **without its credential**, because
    // Cronsole never read one. That is stated in the result rather than hidden:
    // a trigger carrying a second, unsaved MCP server cannot be rebuilt intact.
    const others = reach.tools.filter(t => !sameUrl(t.url, preset.url));
    const unsavable = others.filter(t => t.type === 'mcp_server' && !findGeminiPreset(config, t.name ?? ''));

    if (unsavable.length) {
      applied.push({
        taskId: task.id,
        name: task.name,
        ok: false,
        oldRemoved: true,
        message:
          `Skipped: this trigger also uses ${unsavable.map(t => t.name || t.url).join(', ')}, which is not ` +
          'saved here, so rebuilding it would drop that credential. Save that server as a preset first, ' +
          'or use Replace credentials on the task and retype both.'
      });
      continue;
    }

    const toolList = [
      ...others.map(t => ({
        type: t.type,
        ...(t.name ? { name: t.name } : {}),
        ...(t.url ? { url: t.url } : {}),
        ...(t.type === 'mcp_server' && t.name ? { preset: t.name } : {})
      })),
      { type: 'mcp_server', preset: preset.name }
    ];

    const result = await connector.rotateCredentials(task.externalId, toolList, reach.allowlist, config);

    if (!result.success || !result.newExternalId) {
      applied.push({
        taskId: task.id,
        name: task.name,
        ok: false,
        oldRemoved: true,
        message: result.message || 'The platform declined to rebuild this trigger.'
      });
      continue;
    }

    await prisma.task.update({
      where: { id: task.id },
      data: { externalId: result.newExternalId, metadata: stripReachMetadata(task.metadata) }
    });

    applied.push({
      taskId: task.id,
      name: task.name,
      ok: true,
      oldRemoved: result.oldRemoved !== false,
      ...(result.message ? { message: result.message } : {})
    });
  }

  notifyTasksChanged(userId);

  const ok = applied.filter(a => a.ok).length;
  const doubled = applied.filter(a => a.ok && !a.oldRemoved).length;
  res.json({
    applied,
    message:
      `Rebuilt ${ok} of ${applied.length} trigger${applied.length === 1 ? '' : 's'} with the saved credential.` +
      (doubled
        ? ` ${doubled} left the original trigger in place on Gemini — those schedules now fire twice.`
        : '')
  });
});

/** Count how many tracked triggers point at each preset's URL. */
async function countPresetUsage(userId: string, presets: AgentToolPreset[]) {
  const counts = new Map<string, number>();
  if (!presets.length) return counts;

  const tasks = await prisma.task.findMany({
    where: { userId, platform: PlatformType.GEMINI_TRIGGERS },
    select: { metadata: true }
  });

  for (const preset of presets) {
    const n = tasks.filter(t => reachOf(t.metadata).tools.some(tool => sameUrl(tool.url, preset.url))).length;
    counts.set(preset.url, n);
  }
  return counts;
}

/**
 * The reach a sync recorded on a task.
 *
 * Read defensively: this is platform-reported JSON that a rotation deliberately
 * *clears* until the next sync, so "absent" is a normal state rather than a
 * corrupt one.
 */
function reachOf(metadata: unknown): {
  tools: { type: string; name?: string; url?: string }[];
  allowlist: string[];
} {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  const tools = Array.isArray(meta.tools)
    ? meta.tools.flatMap(raw => {
        const t = (raw ?? {}) as { type?: unknown; name?: unknown; url?: unknown };
        if (typeof t.type !== 'string') return [];
        return [{
          type: t.type,
          ...(typeof t.name === 'string' ? { name: t.name } : {}),
          ...(typeof t.url === 'string' ? { url: t.url } : {})
        }];
      })
    : [];
  const allowlist = Array.isArray(meta.networkAllowlist)
    ? meta.networkAllowlist.filter((d): d is string => typeof d === 'string')
    : [];
  return { tools, allowlist };
}

/** URLs compared case-insensitively, trailing slash ignored. */
function sameUrl(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const norm = (u: string) => u.trim().toLowerCase().replace(/\/+$/, '');
  return norm(a) === norm(b);
}

/** Metadata with platform-reported reach removed, pending the next sync. */
function stripReachMetadata(metadata: unknown): Prisma.InputJsonValue {
  const meta = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, unknown>) }
    : {};
  delete meta.tools;
  delete meta.networkAllowlist;
  return meta as Prisma.InputJsonValue;
}

/**
 * Disconnect Gemini entirely — forget the key and the tracked triggers.
 *
 * **Cronsole-side only.** The triggers keep running on Gemini exactly as before;
 * nothing here calls `DELETE /v1beta/triggers`, which is what the *Delete*
 * button on a task is for. That distinction is why this control says
 * *Disconnect* and never *Delete*.
 *
 * The connection row is **deleted** rather than emptied, for the reason the
 * Claude, GitHub and Vercel routes give: an empty connection is
 * `configured: true` with nothing behind it, which renders as a connected source
 * that cannot do anything. The tracked rows go with it in the same transaction,
 * because a row whose connection is gone cannot be synced and would sit on the
 * dashboard flipping to MISSING.
 *
 * **No `TaskExclusion` is written**, deliberately. An exclusion exists to stop a
 * re-enumeration putting something back; with the key gone there is nothing to
 * enumerate at all, and a stale exclusion would silently swallow the trigger if
 * Gemini were reconnected later.
 */
router.delete('/platforms/gemini/connection', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { connection } = await loadGeminiConnection(userId);
  if (!connection) {
    throw new HttpError(404, 'Gemini is not connected.');
  }

  const doomed = await prisma.task.findMany({
    where: { userId, platform: PlatformType.GEMINI_TRIGGERS },
    select: { id: true }
  });
  const doomedIds = doomed.map(t => t.id);

  await prisma.$transaction([
    ...(doomedIds.length
      ? [
          // ExecutionLog has no cascade on its Task relation, so it must go first
          // or the delete violates the FK. TaskFavorite does cascade.
          prisma.executionLog.deleteMany({ where: { taskId: { in: doomedIds } } }),
          prisma.task.deleteMany({ where: { id: { in: doomedIds } } })
        ]
      : []),
    prisma.platformConnection.delete({ where: { id: connection.id } })
  ]);
  if (doomedIds.length) notifyTasksChanged(userId);

  res.json({ disconnected: true, tasksRemoved: doomedIds.length });
});

export default router;
