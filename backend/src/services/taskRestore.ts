/**
 * Restore of Windows Task Scheduler tasks from native XML — the other half of
 * `bulkExport.ts`.
 *
 * Export is read-only and could afford to be optimistic. Restore registers
 * scheduled tasks on the user's machine through an **elevated** agent, from files
 * the user supplies, so the shape of this module is deliberately different: it
 * decides *everything it can* before a single write happens, and it says what it
 * decided.
 *
 * That is what {@link planRestore} is. Every file gets one of four honest verbs —
 * create / overwrite / skip / refuse — worked out from the machine's existing
 * tasks and folders, both of which are already readable through **read-only**
 * agent verbs that ship today. So the preview costs no writes, needs no agent
 * republish, and puts the count in front of the click instead of after it.
 *
 * Everything here is pure. The socket lives in the route.
 */

import { isSystemTaskPath, normalizeFolder, taskFolderOf } from './bulkExport.js';

/** Name of the manifest `bulkExport` writes into every archive. */
export const EXPORT_MANIFEST_NAME = '_cronsole-export.json';

/** What the plan decided to do with one file. */
export type RestoreAction = 'create' | 'overwrite' | 'skip' | 'refuse';

/** Where a file's destination task path came from. Reported, never assumed. */
export type RestoreTargetSource = 'manifest' | 'uri' | 'filename';

export interface RestoreInputFile {
  /** Path as the user supplied it — inside the archive or relative to the picked folder. */
  relativePath: string;
  bytes: Buffer;
}

export interface RestorePlanItem {
  relativePath: string;
  /** Full Task Scheduler path this file would be registered at; null when unresolvable. */
  taskPath: string | null;
  /** Which of the three sources decided `taskPath`. */
  source: RestoreTargetSource | null;
  /** Task name, for display — the leaf of `taskPath`. */
  name: string | null;
  action: RestoreAction;
  /** Why, for anything that is not a plain `create`. */
  reason?: string;
  /** Folders this file needs that do not exist yet, outermost first. */
  foldersToCreate: string[];
}

export interface RestorePlan {
  items: RestorePlanItem[];
  /** Every folder the whole restore would create, deduped, outermost first. */
  foldersToCreate: string[];
  counts: {
    files: number;
    create: number;
    overwrite: number;
    skip: number;
    refuse: number;
  };
}

export interface RestoreMachineState {
  /** Every task path on the machine, tracked or not. */
  existingTaskPaths: string[];
  /** Every Task Scheduler folder that exists. */
  existingFolders: string[];
}

export interface RestoreOptions {
  /** Replace a task that already exists instead of skipping it. */
  overwrite: boolean;
  /** Recreate a missing folder chain instead of refusing. */
  createFolders: boolean;
}

/** Decoded file, or the honest reason it could not be read. */
export type DecodedTaskFile =
  | { relativePath: string; xml: string; error?: undefined }
  | { relativePath: string; xml?: undefined; error: string };

const lower = (s: string) => s.toLowerCase();

/**
 * Decode a Task Scheduler XML file to text.
 *
 * Windows writes these as **UTF-16 LE with a BOM** — that is what `bulkExport`
 * produces and the only encoding every Windows import path accepts. But a user
 * restoring a backup may hand us a file that came from somewhere else, so the
 * three other forms anyone actually produces are read too. Guessing is confined
 * to this one function, and a file whose bytes don't decode into something that
 * looks like a task definition is **refused by name** rather than passed to the
 * elevated agent to fail obscurely.
 */
export function decodeTaskXml(bytes: Buffer): { xml: string } | { error: string } {
  if (bytes.length === 0) return { error: 'The file is empty.' };

  let xml: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    xml = bytes.subarray(2).toString('utf16le');
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    // UTF-16 BE. Node has no decoder for it, so swap to LE first — swap16
    // mutates, hence the copy.
    xml = Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    xml = bytes.subarray(3).toString('utf8');
  } else {
    xml = bytes.toString('utf8');
  }

  // Strip a leading U+FEFF left by a double-BOM, which some editors produce when
  // they re-save an already-BOM'd file. Written as an escape, not the literal
  // character: an invisible non-ASCII byte in source is the trap that makes a
  // file unreviewable (troubleshooting #17's cousin).
  xml = xml.replace(/^\uFEFF/, '');

  if (!/<\s*Task[\s>]/i.test(xml)) {
    return {
      error: 'This is not a Task Scheduler task definition — no <Task> element was found.'
    };
  }

  return { xml };
}

/**
 * The task path Windows itself recorded inside the XML.
 *
 * Task Scheduler writes `<RegistrationInfo><URI>\Folder\Name</URI>` into every
 * modern export, which makes it a better source than the filename for a file
 * that did not come from one of our archives — the filename went through
 * `safeSegment` on the way out and is therefore lossy by construction.
 */
export function readTaskUri(xml: string): string | null {
  const match = /<URI>([\s\S]*?)<\/URI>/i.exec(xml);
  if (!match) return null;
  const uri = decodeXmlEntities(match[1]).trim();
  if (!uri) return null;
  const segments = uri.split(/[\\/]/).filter(Boolean);
  return segments.length === 0 ? null : '\\' + segments.join('\\');
}

/** The five predefined XML entities — enough for a path, which is all this reads. */
function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * The task path implied by a file's position in the archive, e.g.
 * `Work/Backups/Nightly.xml` → `\Work\Backups\Nightly`.
 *
 * Ranked last of the three sources: `exportRelativePath` sanitizes each segment
 * for the filesystem, so a task whose name contained a `:` came out as `_` and
 * cannot be reversed. It is a good guess, and it is labelled as a guess.
 */
export function restorePathFromRelative(relativePath: string): string | null {
  const segments = relativePath.split(/[\\/]/).filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1].replace(/\.xml$/i, '');
  if (!last) return null;
  return '\\' + [...segments.slice(0, -1), last].join('\\');
}

/**
 * Read `relativePath → taskPath` out of an export manifest, if the upload
 * carried one. Our own archives always do, which is what makes restoring one of
 * them exact rather than inferred.
 */
export function readExportManifest(files: RestoreInputFile[]): Map<string, string> {
  const map = new Map<string, string>();
  const manifest = files.find(f => manifestBasename(f.relativePath));
  if (!manifest) return map;

  try {
    const parsed = JSON.parse(manifest.bytes.toString('utf8'));
    if (!Array.isArray(parsed?.files)) return map;
    for (const entry of parsed.files) {
      if (typeof entry?.relativePath === 'string' && typeof entry?.taskPath === 'string') {
        map.set(lower(entry.relativePath.replace(/\\/g, '/')), entry.taskPath);
      }
    }
  } catch {
    // A corrupt manifest costs precision, not correctness — every file still
    // resolves through its <URI> or its filename, and the plan says which.
  }
  return map;
}

/** True when this file is the export manifest rather than a task. */
export function manifestBasename(relativePath: string): boolean {
  const base = relativePath.split(/[\\/]/).filter(Boolean).pop() ?? '';
  return lower(base) === EXPORT_MANIFEST_NAME;
}

/** True when the file is a task definition we should try to restore. */
export function isRestoreCandidate(relativePath: string): boolean {
  if (manifestBasename(relativePath)) return false;
  return /\.xml$/i.test(relativePath);
}

/** Every ancestor folder of a task path, outermost first: `\A\B\T` → [`\A`, `\A\B`]. */
export function folderChainFor(taskPath: string): string[] {
  const segments = taskFolderOf(taskPath).split('\\').filter(Boolean);
  return segments.map((_, i) => '\\' + segments.slice(0, i + 1).join('\\'));
}

/**
 * Decide what would happen to every file, without touching the machine.
 *
 * The refusals are the interesting part, and each one exists because the
 * alternative is a confident lie:
 *
 *  - `\Microsoft\` is refused outright. `RegisterTaskDefinition` silently
 *    overwrites a same-named task in the same folder and the agent is elevated,
 *    so an archive containing a system task could quietly replace a real one.
 *    The agent refuses this independently; this is the copy that can *explain* it.
 *  - Two files targeting one path refuses the second. Both would "succeed" and
 *    only one would survive, which is the worst kind of success.
 *  - A missing folder refuses unless `createFolders` — see the invariant carve-out
 *    in ROADMAP; creating a folder is a door only the user can close.
 */
export function planRestore(
  files: DecodedTaskFile[],
  manifest: Map<string, string>,
  machine: RestoreMachineState,
  options: RestoreOptions
): RestorePlan {
  const existingTasks = new Set(machine.existingTaskPaths.map(p => lower(normalizeFolder(p))));
  const existingFolders = new Set(machine.existingFolders.map(f => lower(normalizeFolder(f))));

  // Folders an earlier item in this same plan already accounted for, so the
  // second task in \Work\Backups doesn't report creating it twice.
  const plannedFolders = new Set<string>();
  const foldersToCreate: string[] = [];
  // Targets already claimed by an earlier file in this batch.
  const claimed = new Set<string>();

  const items: RestorePlanItem[] = files.map(file => {
    const base: RestorePlanItem = {
      relativePath: file.relativePath,
      taskPath: null,
      source: null,
      name: null,
      action: 'refuse',
      foldersToCreate: []
    };

    // `!== undefined`, not truthiness: an empty-string error is still the error
    // variant, so a truthy check would narrow the union the wrong way.
    if (file.error !== undefined) return { ...base, reason: file.error };

    const resolved = resolveTarget(file.relativePath, file.xml, manifest);
    if (!resolved) {
      return {
        ...base,
        reason: 'Could not work out which task this file is for — no manifest entry, no <URI> in the XML, and no usable filename.'
      };
    }

    const taskPath = resolved.taskPath;
    const name = taskPath.split('\\').filter(Boolean).pop() ?? null;
    const withTarget = { ...base, taskPath, source: resolved.source, name };

    if (isSystemTaskPath(taskPath)) {
      return {
        ...withTarget,
        reason: 'Refusing to restore under \\Microsoft\\ — Windows keeps its own scheduled tasks there, and a name collision would silently overwrite one.'
      };
    }

    const key = lower(taskPath);

    if (claimed.has(key)) {
      return {
        ...withTarget,
        reason: 'Another file in this restore already targets this task path, so this one would overwrite it.'
      };
    }

    if (existingTasks.has(key)) {
      if (!options.overwrite) {
        claimed.add(key);
        return {
          ...withTarget,
          action: 'skip',
          reason: 'A task already exists at this path. Turn on "Overwrite existing tasks" to replace it.'
        };
      }
      claimed.add(key);
      return { ...withTarget, action: 'overwrite' };
    }

    // A brand-new task: its folder has to exist, or be one we may create.
    const missing = folderChainFor(taskPath).filter(
      f => !existingFolders.has(lower(f)) && !plannedFolders.has(lower(f))
    );

    if (missing.length > 0 && !options.createFolders) {
      // Name the SHALLOWEST missing folder, not the task's own parent: telling
      // someone to create \Work\Backups when \Work doesn't exist either sends
      // them to do the wrong thing first.
      const shallowestMissing = folderChainFor(taskPath).find(f => !existingFolders.has(lower(f)));
      return {
        ...withTarget,
        reason: `Task Scheduler folder ${shallowestMissing} does not exist. Turn on "Recreate missing folders", or create it in Task Scheduler first.`
      };
    }

    for (const folder of missing) {
      plannedFolders.add(lower(folder));
      foldersToCreate.push(folder);
    }
    claimed.add(key);

    return { ...withTarget, action: 'create', foldersToCreate: missing };
  });

  return {
    items,
    foldersToCreate,
    counts: {
      files: items.length,
      create: items.filter(i => i.action === 'create').length,
      overwrite: items.filter(i => i.action === 'overwrite').length,
      skip: items.filter(i => i.action === 'skip').length,
      refuse: items.filter(i => i.action === 'refuse').length
    }
  };
}

/** How many restores are in flight at once — same reasoning as the export side. */
export const DEFAULT_RESTORE_CONCURRENCY = 4;

/** What actually happened to one file. Shares the agent's vocabulary exactly. */
export interface RestoreResultItem {
  relativePath: string;
  taskPath: string | null;
  name: string | null;
  /** What the plan intended. Kept beside the outcome so the two can disagree visibly. */
  action: RestoreAction;
  outcome: 'created' | 'replaced' | 'exists' | 'refused';
  message?: string;
  foldersCreated: string[];
}

type ImportOne = (
  taskPath: string,
  xml: string
) => Promise<{ success: boolean; outcome: RestoreResultItem['outcome']; message?: string; foldersCreated: string[] }>;

/**
 * Carry out a plan.
 *
 * Items the plan already settled — a skip, a refusal — never reach the agent;
 * they pass straight through with the reason the plan gave. Only `create` and
 * `overwrite` are writes.
 *
 * A task that fails is recorded and the run continues, for the same reason the
 * export does it: a restore that aborts on task 12 of 95 leaves the machine in a
 * state nobody chose. And `action` travels next to `outcome` so a plan that said
 * `create` and an agent that said `exists` are visibly in disagreement rather
 * than quietly reconciled — that gap is the machine changing under us, which is
 * worth seeing.
 */
export async function runRestore(
  plan: RestorePlan,
  xmlFor: (relativePath: string) => string | undefined,
  importOne: ImportOne,
  options: { concurrency?: number } = {}
): Promise<RestoreResultItem[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_RESTORE_CONCURRENCY);
  const results = new Array<RestoreResultItem>(plan.items.length);
  const writes: number[] = [];

  plan.items.forEach((item, index) => {
    if (item.action === 'create' || item.action === 'overwrite') {
      writes.push(index);
      return;
    }
    results[index] = {
      relativePath: item.relativePath,
      taskPath: item.taskPath,
      name: item.name,
      action: item.action,
      outcome: item.action === 'skip' ? 'exists' : 'refused',
      message: item.reason,
      foldersCreated: []
    };
  });

  let cursor = 0;
  const worker = async () => {
    while (cursor < writes.length) {
      const index = writes[cursor++];
      const item = plan.items[index];
      const xml = xmlFor(item.relativePath);

      if (!item.taskPath || xml === undefined) {
        results[index] = {
          relativePath: item.relativePath,
          taskPath: item.taskPath,
          name: item.name,
          action: item.action,
          outcome: 'refused',
          message: 'The file contents went missing between planning and restoring.',
          foldersCreated: []
        };
        continue;
      }

      try {
        const outcome = await importOne(item.taskPath, xml);
        results[index] = {
          relativePath: item.relativePath,
          taskPath: item.taskPath,
          name: item.name,
          action: item.action,
          outcome: outcome.outcome,
          message: outcome.message,
          foldersCreated: outcome.foldersCreated ?? []
        };
      } catch (err: any) {
        results[index] = {
          relativePath: item.relativePath,
          taskPath: item.taskPath,
          name: item.name,
          action: item.action,
          outcome: 'refused',
          message: err?.message || 'Restore failed',
          foldersCreated: []
        };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, writes.length) }, worker));
  return results;
}

/** Roll a set of results up into the numbers the UI and the toast report. */
export function summarizeRestore(results: RestoreResultItem[]) {
  const foldersCreated = new Set<string>();
  for (const r of results) for (const f of r.foldersCreated) foldersCreated.add(f);

  return {
    files: results.length,
    created: results.filter(r => r.outcome === 'created').length,
    replaced: results.filter(r => r.outcome === 'replaced').length,
    skipped: results.filter(r => r.outcome === 'exists').length,
    refused: results.filter(r => r.outcome === 'refused').length,
    foldersCreated: [...foldersCreated]
  };
}

/**
 * Where this file's task belongs: the manifest we wrote, else the URI Windows
 * wrote, else the filename. Ordered by how much each source actually knows.
 */
function resolveTarget(
  relativePath: string,
  xml: string,
  manifest: Map<string, string>
): { taskPath: string; source: RestoreTargetSource } | null {
  const fromManifest = manifest.get(lower(relativePath.replace(/\\/g, '/')));
  if (fromManifest) {
    return { taskPath: normalizeFolder(fromManifest), source: 'manifest' };
  }

  const fromUri = readTaskUri(xml);
  if (fromUri) return { taskPath: fromUri, source: 'uri' };

  const fromName = restorePathFromRelative(relativePath);
  if (fromName) return { taskPath: fromName, source: 'filename' };

  return null;
}
