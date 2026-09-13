/**
 * The Connect Pack — downloadable instructions that teach *another* AI tool to
 * drive a running Cronsole.
 *
 * Deliberately NOT the repo's own `skills/cronsole/` skill. That one teaches an
 * agent to work **on** the Cronsole codebase (catalogSync, normalize.ts, registry
 * publishing, the repo's internal traps) and is the wrong document for someone
 * who just wants their CLI to schedule a job. What ships here is the *usage*
 * surface: the tool table, the invariants, the schedule traps, and how to verify
 * from outside Cronsole.
 *
 * Content lives as real markdown under `connect-pack/` and is compiled into
 * `connectPackBundled.ts` — see generate-connect-pack.ts for why it is bundled
 * rather than read from disk.
 */

import JSZip from 'jszip';
import { CONNECT_PACK_FILES } from './connectPackBundled.js';

/**
 * Stamped into every artifact's text and reported in the manifest.
 *
 * A downloaded copy on someone else's machine is a mirror surface we can never
 * update — the one distance at which drift is unfixable. It cannot be kept
 * current, so it must at least be able to tell its reader how old it is.
 * `connectPack.test.ts` asserts every artifact's text carries this string.
 */
// Bump whenever the pack's *content* changes — the tool surface, an invariant, a
// trap. A downloaded copy lives on someone else's machine and can never be
// updated in place, so the stamp is the only way it can say how old it is.
// 1.1 (2026-07-28): untrack_task added to the surface (15 tools).
// 1.2 (2026-07-31): TaskHub became Cronsole; CONNECT_PACK_HOME moved to
//   cronsole.ai-automation-tools.dev. A v1.1 copy in someone's hand still points at the old
//   domain — which redirects today, so it degrades to a slow link rather than a dead
//   one — but "where to find a newer copy" changing IS a content change, and this
//   stamp is the only way that copy can tell its reader it predates the move.
// 1.3 (2026-07-31): the dashboard now authors schedules in the user's own zone
//   (Pacific by default) while the API stays UTC. The pack always said "convert on
//   the way in", but a reader could reasonably assume the user's "9am" was already
//   what the app would store. It isn't, and the caller cannot see that setting — so
//   the instruction is now to ASK the zone and confirm both readings back.
// 1.4 (2026-07-31): bulk enable/disable — `POST /api/tools/tasks/status`. New
//   surface, and a new reading rule: the answer is an outcome PER TASK, not a
//   count, because partial success is the normal case at real scale. A caller
//   that reads only `updated` will report a clean run over refusals.
// 1.5 (2026-08-04): the remaining bulk verbs — `POST /api/tools/tasks/category`,
//   `POST /api/tools/tasks/untrack`, and `scope: 'selection'` on the bulk export.
//   The per-task reading rule from 1.4 now covers all three, and one new claim a
//   caller can get wrong in the user's favour or against it: a category is a
//   LABEL, so recategorizing a Windows task does not move it on the machine.
//   Also corrects a claim that went false one day earlier and was caught by
//   /sync-surfaces rather than by anything failing: three artifacts still said a
//   folder "must already exist", after `createFolder` shipped 2026-08-04. A pack
//   in someone's hand cannot be corrected later, so stamping a new version over
//   a known-false invariant is the one thing this version number must not do.
// 1.6 (2026-08-11): favorites — `POST` / `DELETE /api/tasks/:id/favorite`, with
//   `isFavorite` on `GET /api/tasks`. Listed as REST-only *with the reason*: a
//   star is a per-user display preference, and `list_tasks` cannot see one
//   because the MCP layer does not forward the field. Without the row, a caller
//   asked to "star my nightly jobs" reads the tool surface, finds nothing, and
//   concludes Cronsole has no such thing — the pack's tables are read as
//   complete, so an omission from them is a claim, not a gap.
// 1.7 (2026-08-13): `delete_task` narrowed to Cronsole-native tasks and made
//   archive-first. Two corrections rather than one addition, and both were
//   *false claims* in someone's hand, which is the version number's real job:
//   the pack said delete "removes the real Task Scheduler entry", and its
//   management table pointed at `DELETE /api/tasks/:id`. An assistant reading
//   1.6 would refuse a legitimate native delete as too dangerous, or promise a
//   Windows delete the route now refuses with a 400 — wrong in both directions.
//   Adds the archive (`GET /api/tools/task-archives`) and, deliberately, a row
//   for deleting a *Windows* task that names no tool at all: an omission from
//   these tables reads as "Cronsole cannot", so a capability that exists but is
//   withheld from assistants has to say so, or a caller invents a workaround.
// 1.8 (2026-08-17): adds `get_diagnostics` / `GET /api/tools/diagnostics` — the
//   read-only report on whether CRONSOLE is working, as opposed to whether the
//   user's tasks are. An addition rather than a correction, but it earns a
//   version by the rule above: these tables are read as complete, so omitting
//   the one route that answers "why is nothing running" leaves an assistant to
//   diagnose from `task-health` — which reports every Windows task as unhealthy
//   whenever the agent is wedged, i.e. it produces a confident list of wrong
//   answers exactly when the real fault is elsewhere.
// 1.9 (2026-08-17): adds `import_task` / `POST /api/tasks/import`,
//   `list_task_archives` and `restore_task_archive` — the readers for the
//   `cronsoleTaskVersion` bundle, which until now nothing could read back. This
//   is a correction as much as an addition: the previous table listed the
//   archive as something to *read*, which an assistant can only report from,
//   and the "back it up first" promise beside `delete_task` had no verb that
//   spent the backup. It also has to name the split — a task `.json`, a template
//   `.json` and a Task Scheduler `.xml` each have exactly one route that reads
//   them, and guessing wrong is the failure these tables exist to prevent.
// 1.10 (2026-08-17): adds `export_task`'s `format: 'template'` /
//   `GET /api/tasks/:id/export?format=template`. A correction as much as an
//   addition: the single export row read as *the* way to export a task, so an
//   assistant asked to move a task to another machine would hand over Windows
//   XML — correct for a backup, useless on a Mac or another platform — and had
//   nothing to offer at all for a Claude routine, whose native export is a 400.
//   The row also has to carry the LOSS, because a template offered as a backup
//   is the one mistake this format makes possible.
// 1.11 (2026-08-17): drops the hardcoded "15 tools" from the surface table. It
//   had been wrong since 1.2 and was understating the surface by more than half
//   (33 registered) — a reader taking it literally would conclude a verb they
//   need is not there and reach for the REST fallback, or for nothing. Removed
//   rather than corrected: a count in prose is only ever right until the next
//   tool ships, and this one proved it across nine versions of otherwise
//   accurate content. Text-only, but the stamp still moves — two copies must
//   never carry the same version and different words, which is the one thing the
//   stamp exists to make impossible.
export const CONNECT_PACK_VERSION = '1.11';

/** Where a reader should look for a newer copy than the one in their hand. */
export const CONNECT_PACK_HOME = 'https://cronsole.ai-automation-tools.dev';

export interface ConnectPackDownload {
  id: string;
  title: string;
  /** One line: who this file is for. */
  description: string;
  filename: string;
  contentType: string;
  kind: 'zip' | 'markdown' | 'json';
  /** Source paths within the pack, in archive order. */
  contents: string[];
}

/**
 * Archive layout for the skill download: `cronsole/…` so the folder drops
 * straight into `.claude/skills/` without the user having to rename anything.
 */
const SKILL_PREFIX = 'cronsole/';

export const CONNECT_PACK_DOWNLOADS: ConnectPackDownload[] = [
  {
    id: 'connect-pack',
    title: 'Full Connect Pack',
    description: 'Everything below in one archive, plus install instructions per host.',
    filename: `cronsole-connect-pack-v${CONNECT_PACK_VERSION}.zip`,
    contentType: 'application/zip',
    kind: 'zip',
    contents: ['README.md', 'SKILL.md', 'references/task-authoring.md', 'AGENTS.md', 'mcp-config.json']
  },
  {
    id: 'skill',
    title: 'Cronsole skill',
    description: 'For hosts that support skills (Claude Code, Claude Desktop). Unzip into your skills folder.',
    filename: `cronsole-skill-v${CONNECT_PACK_VERSION}.zip`,
    contentType: 'application/zip',
    kind: 'zip',
    contents: ['SKILL.md', 'references/task-authoring.md']
  },
  {
    id: 'agents-md',
    title: 'System prompt (AGENTS.md)',
    description: 'For tools with no skill concept — one self-contained file to paste into a system prompt.',
    filename: 'AGENTS.md',
    contentType: 'text/markdown; charset=utf-8',
    kind: 'markdown',
    contents: ['AGENTS.md']
  },
  {
    id: 'task-authoring',
    title: 'Task authoring reference',
    description: 'The long form: creation paths, command recipes, quoting, folders, schedule traps, verification.',
    filename: 'cronsole-task-authoring.md',
    contentType: 'text/markdown; charset=utf-8',
    kind: 'markdown',
    contents: ['references/task-authoring.md']
  },
  {
    id: 'mcp-config',
    title: 'MCP server config',
    description: 'The wiring snippet for your MCP host, with the setup traps documented inline.',
    filename: 'cronsole-mcp-config.json',
    contentType: 'application/json; charset=utf-8',
    kind: 'json',
    contents: ['mcp-config.json']
  }
];

export function findDownload(id: string): ConnectPackDownload | undefined {
  return CONNECT_PACK_DOWNLOADS.find(d => d.id === id);
}

/** Raw text of one packed file. Throws if the bundle is missing it. */
export function packFile(path: string): string {
  const content = CONNECT_PACK_FILES[path];
  if (content === undefined) {
    throw new Error(`Connect pack is missing ${path} — regenerate with npm run connectpack:build`);
  }
  return content;
}

/**
 * Build a download's bytes.
 *
 * The skill archive is prefixed with `cronsole/` so it unzips into a correctly
 * named skill folder; the full pack keeps the README at the root, where someone
 * opening the archive will actually look for it.
 */
export async function buildDownload(download: ConnectPackDownload): Promise<Buffer> {
  if (download.kind !== 'zip') {
    return Buffer.from(packFile(download.contents[0]), 'utf8');
  }

  const zip = new JSZip();
  const prefixed = download.id === 'skill';
  for (const path of download.contents) {
    zip.file(prefixed ? `${SKILL_PREFIX}${path}` : path, packFile(path));
  }
  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  });
}

/** Byte size of a single-file download; zips are reported after assembly. */
export function textByteLength(path: string): number {
  return Buffer.byteLength(packFile(path), 'utf8');
}
