import { z } from 'zod';

/**
 * **The GitHub connection's config** — a token and the repositories to watch.
 *
 * This is the second connection a user composes by hand, after Claude's, and it
 * is shaped differently for a reason worth stating: Anthropic mints a bearer
 * token **per routine**, so Claude's config is a list of `(id, token)` pairs and
 * the secret is per-row. GitHub issues **one** token per account, and it is what
 * makes every repository readable — so here the secret is a property of the
 * *connection* and the list holds no secrets at all.
 *
 * That difference has a visible consequence and it is the right one: removing a
 * repository here can never cost the user a credential, so it needs none of the
 * "re-adding is the rotation path" care the Claude panel carries.
 *
 * Two rules run through the module.
 *
 * **The token is write-only.** It goes in and never comes back — not from a
 * route, not into task metadata, not into a log line. {@link redactConfig} is
 * the only shape that leaves the server, and it reports `hasToken` plus the
 * *last four characters* rather than the value. There is no reveal endpoint:
 * GitHub shows a classic PAT once and cannot re-display it either, so
 * regenerating is the real recovery.
 *
 * **What the user has in their hand is a URL, not `owner/repo`.** They are
 * looking at the repository in a browser, so pasting the address bar is the
 * expected input, not an edge case. {@link normalizeRepository} accepts the URL,
 * the SSH remote, and the bare `owner/repo`, and refuses anything it cannot
 * reduce to two path segments rather than storing a name that would 404 at the
 * first sync.
 */

/** Separator between the repository and the workflow inside an `externalId`. */
export const WORKFLOW_SEP = '#';

export interface StoredRepository {
  owner: string;
  repo: string;
}

export interface GitHubConfig {
  /** The account PAT. Absent on a connection whose token was cleared. */
  token?: string;
  repositories: StoredRepository[];
}

/** What may leave the server: the repositories, and a fact about the token. */
export interface RedactedGitHubConfig {
  hasToken: boolean;
  /**
   * The last four characters of the stored token, or null.
   *
   * Not a masked value pretending to be revealable — four characters is enough
   * to answer *"is this the token I just made?"* when someone has two, and not
   * enough to be one. Omitted entirely when no token is stored, so "not
   * connected" and "connected with a token I cannot show you" stay different
   * answers on screen.
   */
  tokenHint: string | null;
  repositories: StoredRepository[];
}

/** `owner/repo`, the form used as a Cronsole category and in every message. */
export const repoFullName = (r: StoredRepository) => `${r.owner}/${r.repo}`;

/**
 * The `externalId` for one workflow — `owner/repo#<workflow id>`.
 *
 * The **numeric workflow id**, not the file path, and the choice matters.
 * `(platform, externalId)` is unique and is the identity every tracked row, star
 * and exclusion hangs off, so it has to survive the things that routinely happen
 * to a workflow: renaming `nightly.yml`, or changing the `name:` at the top of
 * it. GitHub's workflow id survives both. A path-keyed id would turn every
 * rename into "the old task went MISSING and a new one appeared", losing its
 * category and its star — the same failure `edit_claude_routine` exists to
 * prevent one platform over.
 *
 * The repository stays in the id because `owner/repo` is the **category**: it is
 * what `TaskService.extractCategory` reads back, so it must be derivable from
 * the id alone, exactly as a Windows task's folder is.
 */
export const workflowExternalId = (repo: StoredRepository, workflowId: number) =>
  `${repoFullName(repo)}${WORKFLOW_SEP}${workflowId}`;

/**
 * The `owner/repo` an `externalId` names, or null.
 *
 * One definition, exported, because `TaskService.extractCategory` and the
 * connector both need it — and a second copy of "how do you read a repository
 * out of an id" is the shape that silently took a folder out of every sync
 * (troubleshooting #20a).
 */
export function repositoryFromExternalId(externalId: string): string | null {
  const at = externalId.indexOf(WORKFLOW_SEP);
  if (at <= 0) return null;
  const full = externalId.slice(0, at);
  return full.includes('/') ? full : null;
}

/**
 * Reduce whatever the user pasted to `{ owner, repo }`.
 *
 * Accepts the browser URL (`https://github.com/owner/repo`, with or without a
 * trailing path — someone copying from the Actions tab arrives with
 * `/actions/workflows/nightly.yml`), the SSH remote
 * (`git@github.com:owner/repo.git`), and the bare `owner/repo`.
 *
 * Returns null when there are not two usable segments, which the caller turns
 * into a 400 that says what to paste. Deliberately does **not** validate the
 * characters GitHub allows in a name: that list is GitHub's and has changed,
 * and refusing a name GitHub accepts would be worse than a 404 that explains
 * itself — the same call the Claude route makes about `trig_` ids.
 */
export function normalizeRepository(input: string): StoredRepository | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Strip a scheme+host, or the SSH `git@github.com:` prefix, leaving a path.
  let path = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')
    .replace(/^git@[^:]+:/i, '')
    .replace(/^\/+/, '');

  // A `.git` suffix belongs to the clone URL, never to the name.
  path = path.replace(/\.git(?:\/.*)?$/i, '');

  const segments = path.split(/[/?#]/).filter(s => s.length > 0);
  if (segments.length < 2) return null;

  const [owner, repo] = segments;
  if (!owner || !repo) return null;
  return { owner, repo };
}

/** Read the stored config, tolerating a shape written by an older build. */
export function readConfig(raw: unknown): GitHubConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(c.repositories) ? c.repositories : [];
  return {
    ...(typeof c.token === 'string' && c.token ? { token: c.token } : {}),
    repositories: rows
      .map(r => {
        const row = (r ?? {}) as Record<string, unknown>;
        return typeof row.owner === 'string' && typeof row.repo === 'string'
          ? { owner: row.owner, repo: row.repo }
          : null;
      })
      .filter((r): r is StoredRepository => r !== null)
  };
}

/** Everything except the secret. The only shape that leaves the server. */
export function redactConfig(config: GitHubConfig): RedactedGitHubConfig {
  return {
    hasToken: Boolean(config.token),
    tokenHint: config.token ? config.token.slice(-4) : null,
    repositories: config.repositories
  };
}

/**
 * Add a repository, or leave the list alone if it is already there.
 *
 * Idempotent rather than 409-ing: a duplicate add is a user checking, not an
 * error, and the list has no per-row state that a re-add could rotate.
 * Case-insensitive, because GitHub treats owner and repository names that way
 * and storing both `Owner/Repo` and `owner/repo` would sync each workflow twice
 * under two categories.
 */
export function upsertRepository(
  repositories: StoredRepository[],
  next: StoredRepository
): StoredRepository[] {
  const key = repoFullName(next).toLowerCase();
  return repositories.some(r => repoFullName(r).toLowerCase() === key)
    ? repositories
    : [...repositories, next];
}

/** Drop a repository by name, case-insensitively. */
export function removeRepository(
  repositories: StoredRepository[],
  target: StoredRepository
): StoredRepository[] {
  const key = repoFullName(target).toLowerCase();
  return repositories.filter(r => repoFullName(r).toLowerCase() !== key);
}

/**
 * Does this look like a GitHub token?
 *
 * **Advisory, never enforced.** GitHub has shipped at least four token formats
 * (`ghp_`, `github_pat_`, the older 40-hex PAT, and installation tokens), and it
 * will ship more. Refusing one it later introduces would be a worse failure than
 * a 401 that names itself, so a mismatch is a warning beside a saved token — the
 * same call the Claude connect route makes.
 */
export const looksLikeGitHubToken = (token: string): boolean =>
  /^gh[pousr]_[A-Za-z0-9]{20,}$/.test(token) ||
  /^github_pat_[A-Za-z0-9_]{20,}$/.test(token) ||
  /^[a-f0-9]{40}$/.test(token);

export const tokenInputSchema = z.object({
  token: z.string().min(1, 'A token is required').max(512)
});

export const repositoryInputSchema = z.object({
  repository: z.string().min(1, 'A repository is required').max(512)
});
