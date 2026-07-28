/**
 * The Connect Pack — downloadable instructions that teach *another* AI tool to
 * drive a running TaskHub.
 *
 * Deliberately NOT the repo's own `skills/taskhub/` skill. That one teaches an
 * agent to work **on** the TaskHub codebase (catalogSync, normalize.ts, registry
 * publishing, the repo's internal traps) and is the wrong document for someone
 * who just wants their CLI to schedule a job. What ships here is the *usage*
 * surface: the tool table, the invariants, the schedule traps, and how to verify
 * from outside TaskHub.
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
export const CONNECT_PACK_VERSION = '1.1';

/** Where a reader should look for a newer copy than the one in their hand. */
export const CONNECT_PACK_HOME = 'https://taskhub.mikesailab.com';

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
 * Archive layout for the skill download: `taskhub/…` so the folder drops
 * straight into `.claude/skills/` without the user having to rename anything.
 */
const SKILL_PREFIX = 'taskhub/';

export const CONNECT_PACK_DOWNLOADS: ConnectPackDownload[] = [
  {
    id: 'connect-pack',
    title: 'Full Connect Pack',
    description: 'Everything below in one archive, plus install instructions per host.',
    filename: `taskhub-connect-pack-v${CONNECT_PACK_VERSION}.zip`,
    contentType: 'application/zip',
    kind: 'zip',
    contents: ['README.md', 'SKILL.md', 'references/task-authoring.md', 'AGENTS.md', 'mcp-config.json']
  },
  {
    id: 'skill',
    title: 'TaskHub skill',
    description: 'For hosts that support skills (Claude Code, Claude Desktop). Unzip into your skills folder.',
    filename: `taskhub-skill-v${CONNECT_PACK_VERSION}.zip`,
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
    filename: 'taskhub-task-authoring.md',
    contentType: 'text/markdown; charset=utf-8',
    kind: 'markdown',
    contents: ['references/task-authoring.md']
  },
  {
    id: 'mcp-config',
    title: 'MCP server config',
    description: 'The wiring snippet for your MCP host, with the setup traps documented inline.',
    filename: 'taskhub-mcp-config.json',
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
 * The skill archive is prefixed with `taskhub/` so it unzips into a correctly
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
