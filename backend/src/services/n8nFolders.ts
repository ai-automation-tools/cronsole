import { PrismaClient } from '@prisma/client';

/**
 * **Which n8n folder each workflow is in, read from n8n's own database.**
 *
 * The public API cannot answer this: `parentFolderId` is write-only on a
 * workflow, `/workflows` takes no folder filter, the folder listing carries
 * counts but no members, and the package export that does carry them needs a
 * licensed feature and ships whole workflow bodies (troubleshooting #96). The
 * internal `/rest` API carries it but refuses API keys, so reaching it means
 * storing an owner's password.
 *
 * So this reads Postgres, through a role the user grants **only these five
 * columns** — `workflow_entity(id, "parentFolderId")` and
 * `folder(id, name, "parentFolderId")`. That is less reach than the API key
 * already has: no node, no credential, no execution is readable through it.
 * The query names its columns for that reason; `SELECT *` would fail under a
 * column grant, which is the point of the grant.
 *
 * Opt-in and decorative: a failure here is a warning on the sync, never a
 * failed sync — the schedule, status and run history do not depend on it.
 *
 * ponytail: assumes n8n's default table names; an instance with
 * `DB_TABLE_PREFIX` set needs the prefix threaded through here.
 */

/** Workflow id → folder names from the project root down. Root-level workflows are absent. */
export type FolderPaths = Map<string, string[]>;

export type FolderReadResult = { ok: true; data: FolderPaths } | { ok: false; message: string };

// Depth-capped so a corrupted parent chain cannot recurse forever. Paths are
// arrays, not a joined string, because a folder name may contain `/`.
const FOLDER_PATHS_SQL = `
WITH RECURSIVE tree AS (
  SELECT id, ARRAY[name]::text[] AS path, 1 AS depth
  FROM folder WHERE "parentFolderId" IS NULL
  UNION ALL
  SELECT f.id, tree.path || f.name::text, tree.depth + 1
  FROM folder f JOIN tree ON f."parentFolderId" = tree.id
  WHERE tree.depth < 32
)
SELECT w.id AS "workflowId", tree.path AS "path"
FROM workflow_entity w JOIN tree ON tree.id = w."parentFolderId"`;

export function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\/[^\s]+$/i.test(value.trim());
}

/** `host:port/db` — what the panel may show. Never the user or password. */
export function describeDbUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return null;
  }
}

export async function readFolderPaths(dbUrl: string): Promise<FolderReadResult> {
  const client = new PrismaClient({ datasourceUrl: withLightPool(dbUrl) });
  try {
    const rows = await client.$queryRawUnsafe<{ workflowId: string; path: string[] }[]>(FOLDER_PATHS_SQL);
    return { ok: true, data: new Map(rows.map(r => [r.workflowId, r.path])) };
  } catch (err) {
    return { ok: false, message: describeError(err, dbUrl) };
  } finally {
    await client.$disconnect().catch(() => {});
  }
}

/** One connection, short waits — this runs inside a user's Sync click. */
function withLightPool(dbUrl: string): string {
  try {
    const u = new URL(dbUrl);
    if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
    if (!u.searchParams.has('connect_timeout')) u.searchParams.set('connect_timeout', '10');
    return u.toString();
  } catch {
    return dbUrl;
  }
}

/**
 * A sentence for the panel and the sync warning. The URL holds a password, so
 * it is scrubbed out of whatever the driver said before anything is returned.
 */
function describeError(err: unknown, dbUrl: string): string {
  const raw = err instanceof Error ? err.message : String(err);
  // A connection failure is a PrismaClientInitializationError whose `errorCode`
  // is often left undefined (measured: refused port), so the code alone never
  // matched and every connection failure fell through to the driver's sentence.
  // The message is the reliable signal there.
  const e = err as { code?: string; errorCode?: string } | null;
  const code = e?.errorCode ?? e?.code;
  if (code === 'P1000' || /authentication failed/i.test(raw)) return 'n8n database rejected the user name or password.';
  if (code === 'P1001' || /can't reach database server|database server is running/i.test(raw)) {
    return 'Could not reach the n8n database — check the host, port and firewall.';
  }
  if (code === 'P1003') return 'That database does not exist on the server.';
  if (/permission denied/i.test(raw)) {
    return 'The database user cannot read the folder columns. Run the GRANT statements from the n8n source guide.';
  }
  if (/relation .* does not exist/i.test(raw)) {
    return 'No n8n folder tables in that database — is it the one n8n uses, and is the schema right?';
  }
  const scrubbed = raw.split(dbUrl).join('<database url>').replace(/postgres(ql)?:\/\/\S+/gi, '<database url>');
  return `Could not read n8n folders: ${scrubbed.trim().split('\n').pop()}`;
}
