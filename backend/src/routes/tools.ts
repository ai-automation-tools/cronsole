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
import { PlatformType } from '@prisma/client';
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
 * Exports what is on the **machine**, not what TaskHub has imported. That is
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
      ? 'The Windows agent is offline, so TaskHub cannot read the machine\'s tasks.'
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
  const MANIFEST_NAME = '_taskhub-export.json';

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
    res.setHeader('Content-Disposition', `attachment; filename="taskhub-tasks-${timestampSlug(now)}.zip"`);
    // The counts the UI would otherwise lose on a binary response — a download
    // has no JSON body to report "3 of 95 failed" in.
    res.setHeader('X-TaskHub-Export-Counts', JSON.stringify(manifest.counts));
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
 * What an AI tool needs to drive this TaskHub — the instructions half of the
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
