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
import { ExecutionStatus, PlatformType, TaskStatus } from '@prisma/client';
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
  routineInputSchema
} from '../services/claudeRoutines.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';
import {
  buildManifest,
  runBulkExport,
  selectExportCandidates,
  type BulkExportSelection
} from '../services/bulkExport.js';
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
    throw new HttpError(400, `Exporting is not supported for ${platform} yet.`);
  }

  const config = { ...deserializeConfig(connection.config), userId };

  // The same unfiltered enumeration `/discover` reads — every task on the
  // machine with its real path. An offline agent throws here, and that is the
  // honest answer: we cannot know what is on the machine without asking it.
  let enumerated;
  try {
    enumerated = await connector.syncTasks(config);
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
    throw new HttpError(400, `Restoring is not supported for ${platform} yet.`);
  }

  const config = { ...deserializeConfig(connection.config), userId };

  // Read the machine before deciding anything. An offline agent fails here, and
  // that is the honest answer — a plan built without knowing what already exists
  // would confidently promise to create tasks that are already there.
  let existingTaskPaths: string[];
  let existingFolders: string[];
  try {
    const [tasks, folders] = await Promise.all([
      connector.syncTasks(config),
      connector.listFolders(config)
    ]);
    existingTaskPaths = tasks.map(t => String(t.externalId ?? '')).filter(Boolean);
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

  res.json({
    routines: redactRoutines(routines).map(r => ({ ...r, taskCount: byExternalId.get(r.id) ?? 0 }))
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

  // Counted out loud. These task rows survive and stay visible; their Run button
  // now fails with "not in this connection's config" until the routine is
  // re-added. Reported so the caller can say what it just broke.
  const orphanedTasks = await prisma.task.count({
    where: { userId, platform: PlatformType.CLAUDE_CODE, externalId: id }
  });

  res.json({ removed: id, orphanedTasks, connectionRemoved: remaining.length === 0 });
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
 * Automation health — which tasks need attention, and **on what evidence**.
 *
 * Mounted here, not as `/api/tasks/health`: that route already exists and means
 * *per-platform connector health*. Two different questions ("is the agent up?"
 * vs "is this task healthy?") must not share a name.
 *
 * The response always carries each task's signals. A caller that renders only
 * the number is rendering a claim without its evidence, which is exactly the
 * failure this feature was warned about.
 */
router.get('/task-health', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;

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

  res.json({
    evaluatedAt: now,
    counts: summarizeHealth(results),
    tasks: results
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

export default router;
