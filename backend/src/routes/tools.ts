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
import { deserializeConfig } from '../auth/connectionConfig.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
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
    scope: z.enum(['all', 'folder']),
    folder: z.string().trim().max(512).optional(),
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

  const selection: BulkExportSelection = {
    scope: body.scope,
    folder: body.folder,
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
    // has no JSON body to report "3 of 95 failed" in.
    res.setHeader('X-Cronsole-Export-Counts', JSON.stringify(manifest.counts));
    return res.send(archive);
  }

  // base64, not a JSON string: the XML is UTF-16 LE with a BOM, and putting
  // those bytes through JSON as text is exactly how the MCP export tool ended up
  // decoding UTF-16 as UTF-8 into mojibake. base64 round-trips the exact bytes,
  // so what the browser writes to disk is byte-identical to what Windows sent.
  res.json({
    counts: manifest.counts,
    failures,
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

  res.json({
    dryRun: false,
    plan: { counts: plan.counts, foldersToCreate: plan.foldersToCreate },
    counts: summarizeRestore(results),
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

export default router;
