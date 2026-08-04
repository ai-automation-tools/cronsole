/**
 * Bulk export of Windows Task Scheduler tasks as native XML.
 *
 * The single-task path (`GET /api/tasks/:id/export`) exports a *tracked* task —
 * it is keyed on a Cronsole DB row. This module exports what is actually **on the
 * machine**, tracked or not, because the thing it exists to prevent is data
 * loss: deleting one Task Scheduler folder can take dozens of tasks with it, and
 * the ones Cronsole never imported are exactly the ones nothing else is holding.
 *
 * That is possible with no agent protocol change: `task:export` takes a raw
 * `taskPath` and does not check that the path belongs to a tracked task (it is
 * read-only and unsigned, like `task:list`). The restriction lived entirely in
 * the route.
 *
 * Everything here except {@link runBulkExport} is pure — selection, naming, and
 * manifest building are decided without a socket so they can be tested without
 * one.
 */

import type { TaskInfo } from '../connectors/platform.interface.js';

/**
 * First folder segment that means "Windows owns this". Compared
 * case-insensitively, matching `windowsTaskFolder.ts`'s write-side guard.
 *
 * Note this is a *default exclusion*, not a refusal. Writing under \Microsoft\
 * is refused outright because a name collision there silently overwrites a real
 * system task with elevation. Reading is merely noisy: on a real machine the
 * split is ~95 user tasks against ~257 system ones, so including them by default
 * would bury the tasks the user actually came for. Opting in is legitimate.
 */
const SYSTEM_FOLDER_ROOT = 'microsoft';

/** Bytes Windows rejects in a filename, plus the separators we build paths with. */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1f]/g;

const MAX_SEGMENT_LENGTH = 120;

/** How many exports are in flight at once. */
export const DEFAULT_EXPORT_CONCURRENCY = 4;

export interface ExportCandidate {
  /** The task's full Task Scheduler path — also its `externalId`. */
  externalId: string;
  /** Leaf name, as Task Scheduler reports it. */
  name: string;
  /** Containing folder, normalized (`\` for the root). */
  folder: string;
}

export interface BulkExportSelection {
  /**
   * `all` = every folder on the machine; `folder` = one folder; `selection` =
   * exactly the tasks named in `externalIds` — what the dashboard's bulk bar
   * sends for a hand-picked set of rows.
   */
  scope: 'all' | 'folder' | 'selection';
  /** Required when `scope === 'folder'`. */
  folder?: string;
  /** Required when `scope === 'selection'`: the native paths to export. */
  externalIds?: string[];
  /** Include tasks under \Microsoft\. Default false. Ignored by `selection`. */
  includeSystem?: boolean;
  /** For `scope: 'folder'`, also take nested folders. Default true. */
  includeSubfolders?: boolean;
}

export interface SelectionResult {
  selected: ExportCandidate[];
  /** How many tasks were dropped for being Windows' own. Reported, never silent. */
  skippedSystem: number;
  /** Everything the agent enumerated, before any filter. */
  totalSeen: number;
  /**
   * Only for `scope: 'selection'` — native paths the caller asked for that the
   * machine did not report.
   *
   * The whole reason the selection scope needs its own field. `all` and
   * `folder` describe a *region* of the machine, so whatever is there is the
   * answer. A selection names specific tasks, and a named task that isn't there
   * is a fact about the request: it was deleted natively, or its row is
   * `MISSING`, or it is a Cronsole-native task that was never on Windows at
   * all. Exporting the other 19 and reporting "19 tasks exported" would be an
   * archive silently missing the one thing the user most needed backed up.
   */
  requestedMissing: string[];
}

export interface ExportedFile {
  /** Path inside the archive / chosen directory, `/`-separated. */
  relativePath: string;
  externalId: string;
  bytes: Buffer;
}

export interface ExportFailure {
  externalId: string;
  name: string;
  message: string;
}

/**
 * The containing folder of a task path, normalized.
 * `\A\B\Task` → `\A\B`; `\Task` → `\`.
 */
export function taskFolderOf(externalId: string): string {
  const segments = String(externalId).split(/[\\/]/).filter(Boolean);
  // The last segment is the task itself, never part of its folder.
  const folderSegments = segments.slice(0, -1);
  return folderSegments.length === 0 ? '\\' : '\\' + folderSegments.join('\\');
}

/** Canonical folder form so user input and agent output compare equal. */
export function normalizeFolder(folder: string): string {
  const segments = String(folder).split(/[\\/]/).filter(Boolean);
  return segments.length === 0 ? '\\' : '\\' + segments.join('\\');
}

/**
 * True when the task lives under \Microsoft\ — i.e. Windows' own.
 *
 * Tested against the task's *folder*, not its raw path, so a user task named
 * "Microsoft" sitting in the root is not mistaken for a system task.
 */
export function isSystemTaskPath(externalId: string): boolean {
  const segments = taskFolderOf(externalId).split('\\').filter(Boolean);
  return segments.length > 0 && segments[0].toLowerCase() === SYSTEM_FOLDER_ROOT;
}

/** True when `folder` is `parent` or nested inside it. */
export function isWithinFolder(folder: string, parent: string): boolean {
  const a = normalizeFolder(folder).toLowerCase();
  const b = normalizeFolder(parent).toLowerCase();
  if (b === '\\') return true;
  return a === b || a.startsWith(b + '\\');
}

/**
 * Decide what to export from the agent's full enumeration.
 *
 * `tasks` is the unfiltered `syncTasks` result — every task on the machine,
 * including the ones Cronsole never imported. That is the point.
 */
export function selectExportCandidates(
  tasks: TaskInfo[],
  selection: BulkExportSelection
): SelectionResult {
  const includeSubfolders = selection.includeSubfolders !== false;
  const target = selection.scope === 'folder' ? normalizeFolder(selection.folder ?? '\\') : null;

  // Matched case-insensitively, like every other Task Scheduler path comparison
  // here: the agent's enumeration and a stored `externalId` can differ in case
  // and mean the same task, and a case-sensitive miss would report a task the
  // user is looking at as absent from their own machine.
  const wanted =
    selection.scope === 'selection'
      ? new Map((selection.externalIds ?? []).map(id => [id.toLowerCase(), id]))
      : null;

  let skippedSystem = 0;
  const selected: ExportCandidate[] = [];

  for (const task of tasks) {
    const externalId = String(task.externalId ?? '');
    if (!externalId) continue;

    const folder = taskFolderOf(externalId);

    if (wanted !== null) {
      // An explicit selection is an explicit request, so `includeSystem` does
      // not apply: if the user ticked a \Microsoft\ task, exporting it is what
      // they asked for, and reading is harmless (writing there is what is
      // refused, in the backend and again in the agent). Same rule as
      // `filterExcluded` — a fence must never swallow a direct request.
      if (!wanted.delete(externalId.toLowerCase())) continue;
    } else {
      if (!selection.includeSystem && isSystemTaskPath(externalId)) {
        skippedSystem++;
        continue;
      }

      if (target !== null) {
        const inScope = includeSubfolders
          ? isWithinFolder(folder, target)
          : normalizeFolder(folder).toLowerCase() === target.toLowerCase();
        if (!inScope) continue;
      }
    }

    selected.push({
      externalId,
      name: task.name || externalId.split(/[\\/]/).filter(Boolean).pop() || 'task',
      folder
    });
  }

  return {
    selected,
    skippedSystem,
    totalSeen: tasks.length,
    // Whatever is left in `wanted` was asked for and never seen. Deleting on
    // match is what makes this the remainder rather than a second pass that
    // could disagree with the first.
    requestedMissing: wanted ? [...wanted.values()] : []
  };
}

/** One path segment made safe as a filename, without becoming empty. */
function safeSegment(segment: string): string {
  const cleaned = segment
    .replace(UNSAFE_FILENAME_CHARS, '_')
    .replace(/[. ]+$/, '') // Windows silently strips trailing dots/spaces
    .slice(0, MAX_SEGMENT_LENGTH)
    .trim();
  return cleaned || '_';
}

/**
 * Where a task's XML goes inside the archive (or the chosen directory).
 *
 * Mirrors the Task Scheduler folder tree — `\Work\Backups\Nightly` becomes
 * `Work/Backups/Nightly.xml` — so the export reads like the thing it backed up
 * and two same-named tasks in different folders cannot collide.
 *
 * `taken` carries the paths already used; a residual collision (two names that
 * sanitize identically inside one folder) gets a numeric suffix rather than one
 * file silently overwriting the other.
 */
export function exportRelativePath(candidate: ExportCandidate, taken: Set<string>): string {
  const folderSegments = candidate.folder.split('\\').filter(Boolean).map(safeSegment);
  const base = safeSegment(candidate.name);
  const prefix = folderSegments.length ? folderSegments.join('/') + '/' : '';

  let attempt = `${prefix}${base}.xml`;
  let counter = 2;
  while (taken.has(attempt.toLowerCase())) {
    attempt = `${prefix}${base} (${counter}).xml`;
    counter++;
  }
  taken.add(attempt.toLowerCase());
  return attempt;
}

/**
 * Encode Task Scheduler XML the way Windows re-imports it: UTF-16 LE with a BOM,
 * keeping the native `encoding="UTF-16"` declaration.
 *
 * This is the one encoding every Windows import path is built around — declaring
 * UTF-8 instead breaks the COM / `-Xml` import with "unable to switch the
 * encoding" (verified against real Task Scheduler). Shared with the single-task
 * export route so there is exactly one definition of the format.
 */
export function toTaskXmlBuffer(xml: string): Buffer {
  return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]);
}

type ExportOne = (externalId: string) => Promise<{ success: boolean; xml?: string; message?: string }>;

/**
 * Export every candidate, a few at a time.
 *
 * Bounded concurrency because each export is a socket round-trip with its own
 * 15s timeout: firing 95 at once would start 95 timers against an agent that
 * services them one at a time, and the tail would time out for no reason other
 * than queueing. The agent correlates responses by `taskExternalId`, so several
 * in flight is safe.
 *
 * A task that fails is recorded and the run continues. A backup that aborts
 * because one task of 95 was unreadable is worse than a backup that saves 94 and
 * says which one it missed.
 */
export async function runBulkExport(
  candidates: ExportCandidate[],
  exportOne: ExportOne,
  options: { concurrency?: number } = {}
): Promise<{ files: ExportedFile[]; failures: ExportFailure[] }> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_EXPORT_CONCURRENCY);
  const taken = new Set<string>();

  // Names are assigned up front, in enumeration order, so the same selection
  // always produces the same filenames regardless of which export finishes first.
  const planned = candidates.map(candidate => ({
    candidate,
    relativePath: exportRelativePath(candidate, taken)
  }));

  const files: ExportedFile[] = [];
  const failures: ExportFailure[] = [];
  let cursor = 0;

  const worker = async () => {
    while (cursor < planned.length) {
      const item = planned[cursor++];
      try {
        const result = await exportOne(item.candidate.externalId);
        if (!result.success || !result.xml) {
          failures.push({
            externalId: item.candidate.externalId,
            name: item.candidate.name,
            message: result.message || 'The agent returned no XML for this task'
          });
          continue;
        }
        files.push({
          relativePath: item.relativePath,
          externalId: item.candidate.externalId,
          bytes: toTaskXmlBuffer(result.xml)
        });
      } catch (err: any) {
        failures.push({
          externalId: item.candidate.externalId,
          name: item.candidate.name,
          message: err?.message || 'Export failed'
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, planned.length) }, worker));

  // Deterministic output order — workers finish out of order.
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  failures.sort((a, b) => a.externalId.localeCompare(b.externalId));

  return { files, failures };
}

export interface ExportManifest {
  cronsoleExportVersion: string;
  exportedAt: string;
  machineScope: BulkExportSelection;
  counts: {
    enumerated: number;
    selected: number;
    exported: number;
    failed: number;
    skippedSystem: number;
    /** Only meaningful for `scope: 'selection'`. */
    requestedMissing: number;
  };
  files: { relativePath: string; taskPath: string }[];
  failures: ExportFailure[];
  /**
   * Native paths that were asked for and not found on the machine. Written into
   * the archive, not just returned to the browser: the manifest is what the
   * archive can still say about itself a year later, and "this backup is
   * missing these three tasks on purpose" is exactly the kind of thing nobody
   * remembers.
   */
  requestedMissing?: string[];
}

/**
 * A machine-readable record of what the export actually contains.
 *
 * Written into the export so the archive can answer "is this everything?"
 * without the user having to remember what they ticked — including what was
 * deliberately skipped and what failed. An export that quietly omits things and
 * looks complete is the failure mode worth spending a file to avoid.
 */
export function buildManifest(
  selection: BulkExportSelection,
  selectionResult: SelectionResult,
  files: ExportedFile[],
  failures: ExportFailure[],
  now: Date
): ExportManifest {
  return {
    cronsoleExportVersion: '1.0',
    exportedAt: now.toISOString(),
    machineScope: {
      scope: selection.scope,
      folder: selection.scope === 'folder' ? normalizeFolder(selection.folder ?? '\\') : undefined,
      // Recorded for a selection so the archive says *what was asked for*, not
      // only what came back — the two differ exactly when it matters.
      externalIds: selection.scope === 'selection' ? selection.externalIds : undefined,
      includeSystem: !!selection.includeSystem,
      includeSubfolders: selection.includeSubfolders !== false
    },
    counts: {
      enumerated: selectionResult.totalSeen,
      selected: selectionResult.selected.length,
      exported: files.length,
      failed: failures.length,
      skippedSystem: selectionResult.skippedSystem,
      requestedMissing: selectionResult.requestedMissing.length
    },
    files: files.map(f => ({ relativePath: f.relativePath, taskPath: f.externalId })),
    failures,
    ...(selectionResult.requestedMissing.length > 0
      ? { requestedMissing: selectionResult.requestedMissing }
      : {})
  };
}
