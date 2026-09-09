import { z } from 'zod';

/**
 * **The Vercel connection's config** — a token and the projects to watch.
 *
 * The third connection a user composes by hand, and it is shaped like GitHub's
 * rather than Claude's, for the reason that decided GitHub's: Anthropic mints a
 * bearer token **per routine**, so Claude's config is a list of `(id, token)`
 * pairs and the secret is per-row. Vercel issues **one** token per account (or
 * per team), and it is what makes every project readable — so the secret is a
 * property of the *connection* and the project list holds none.
 *
 * Consequence, and it is the right one: removing a project here can never cost
 * the user a credential, so it needs none of the "re-adding is the rotation
 * path" care the Claude panel carries.
 *
 * Three rules run through the module.
 *
 * **The token is write-only.** It goes in and never comes back — not from a
 * route, not into task metadata, not into a log line. {@link redactConfig} is
 * the only shape that leaves the server, and it reports `hasToken` plus the
 * *last four characters* rather than the value. There is no reveal endpoint:
 * Vercel shows an access token once and cannot re-display it either, so
 * regenerating is the real recovery.
 *
 * **What the user has in their hand is a dashboard URL, not a project id.** They
 * are looking at the project in a browser, so pasting the address bar is the
 * expected input. {@link normalizeProjectInput} accepts
 * `vercel.com/<team>/<project>`, the bare project name, and a `prj_…` id, and
 * refuses what it cannot reduce to one of those rather than storing something
 * that would 404 at the first sync.
 *
 * **A project is stored by id *and* name, and both are load-bearing.** The `id`
 * (`prj_…`) is the stable address every API call uses and survives a rename; the
 * `name` is the Cronsole **category**, so it is what appears in the rail and
 * inside every `externalId`. That mirrors GitHub, where `owner/repo` is the
 * category and rides in the id for the same reason — and it inherits GitHub's
 * one caveat: renaming the project on the platform re-keys its rows, so the old
 * ones retire and new ones arrive. Stated rather than worked around, because the
 * alternative (an opaque `prj_…` in the rail) makes every day worse to spare a
 * rare one.
 */

/** Separator between the project and the cron path inside an `externalId`. */
export const CRON_SEP = '#';

export interface StoredProject {
  /** `prj_…` — the stable address, unaffected by a rename. */
  id: string;
  /** The project's name, which is also its Cronsole category. */
  name: string;
  /**
   * The team the project belongs to, or absent for a personal-account project.
   *
   * Stored per project rather than on the connection: one Vercel access token
   * reaches every team the user is a member of, and `teamId` is a *query
   * parameter* on each read, not a second credential. A connection-level team
   * would make a user with a personal project and a team project need two
   * connections to a platform that only ever issued them one token.
   */
  teamId?: string;
}

export interface VercelConfig {
  /** The account access token. Absent on a connection whose token was cleared. */
  token?: string;
  projects: StoredProject[];
}

/** What may leave the server: the projects, and a fact about the token. */
export interface RedactedVercelConfig {
  hasToken: boolean;
  /**
   * The last four characters of the stored token, or null.
   *
   * Not a masked value pretending to be revealable — four characters is enough
   * to answer *"is this the token I just made?"* when someone has two, and not
   * enough to be one. Null when no token is stored, so "not connected" and
   * "connected with a token I cannot show you" stay different answers on screen.
   */
  tokenHint: string | null;
  projects: StoredProject[];
}

/**
 * The `externalId` for one cron job — `<project name>#<path>`.
 *
 * **Keyed on the path, not on the schedule**, and the choice matters.
 * `(platform, externalId)` is unique and is the identity every tracked row, star
 * and exclusion hangs off, so it has to survive the thing that routinely happens
 * to a cron: someone edits its schedule in `vercel.json`. A schedule-keyed id
 * would turn every reschedule into "the old task went MISSING and a new one
 * appeared", losing its category and its star.
 *
 * A project may declare the *same path* twice with two schedules — Vercel's own
 * docs show it. Those collapse into one row whose `metadata.allSchedules` names
 * every cron, exactly as a GitHub workflow with several `on: schedule` entries
 * does. One row that says "and 1 more schedule" is honest; two rows sharing an
 * id is not representable, and two rows fighting over one is worse.
 *
 * The project name stays in the id because it is the **category**: it is what
 * `TaskService.extractCategory` reads back, so it must be derivable from the id
 * alone, exactly as a Windows task's folder is.
 */
export const cronExternalId = (project: StoredProject, path: string) =>
  `${project.name}${CRON_SEP}${path}`;

/**
 * The project name an `externalId` names, or null.
 *
 * One definition, exported, because `TaskService.extractCategory` and the
 * connector both need it — and a second copy of "how do you read a project out
 * of an id" is the drift that silently took a whole folder out of every sync
 * (troubleshooting #20a).
 *
 * `indexOf`, not `split`: a cron path contains slashes and may contain a query
 * string with its own `#`-free punctuation, so only the **first** separator is
 * the boundary.
 */
export function projectFromExternalId(externalId: string): string | null {
  const at = externalId.indexOf(CRON_SEP);
  if (at <= 0) return null;
  return externalId.slice(0, at);
}

/** What a user pasted, reduced to the one thing we can look up. */
export type ProjectRef =
  | { kind: 'id'; id: string }
  | { kind: 'name'; name: string; teamSlug?: string };

/**
 * Reduce whatever the user pasted to something `GET /v9/projects/:idOrName` takes.
 *
 * Accepts the dashboard URL (`https://vercel.com/acme/website`, with or without
 * a trailing path — someone copying from the Cron Jobs tab arrives with
 * `/settings/cron-jobs`), a bare `prj_…` id, and a bare project name.
 *
 * The team slug is carried out of a dashboard URL because Vercel's project
 * lookup is scoped: `GET /v9/projects/website` with no team resolves against the
 * *personal* account and 404s for a team project the token can plainly see. That
 * 404 would read as a typo, which is the exact misdirection GitHub's 404-vs-403
 * message exists to prevent one platform over.
 *
 * Returns null for anything with no usable segment, which the caller turns into
 * a 400 that says what to paste. Deliberately does **not** validate the
 * characters Vercel allows in a project name: that list is Vercel's and has
 * changed, and refusing a name Vercel accepts would be worse than a 404 that
 * explains itself — the same call the GitHub and Claude routes make.
 */
export function normalizeProjectInput(input: string): ProjectRef | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^prj_[A-Za-z0-9]+$/.test(trimmed)) return { kind: 'id', id: trimmed };

  // Strip a scheme+host, leaving a path. A bare name has no host to strip.
  const hadHost = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?vercel\.com\//i.test(trimmed);
  const path = trimmed
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')
    .replace(/^(?:www\.)?vercel\.com\//i, '')
    .replace(/^\/+/, '');

  const segments = path.split(/[/?#]/).filter(s => s.length > 0);
  if (segments.length === 0) return null;

  // A dashboard URL is `/<team-or-user>/<project>`. A single segment after the
  // host is a team page, not a project, so it is refused rather than guessed at.
  if (hadHost) {
    if (segments.length < 2) return null;
    const [teamSlug, name] = segments;
    if (!teamSlug || !name) return null;
    return { kind: 'name', name, teamSlug };
  }

  // No host: `acme/website` is still a team-qualified name, `website` is not.
  if (segments.length >= 2) {
    const [teamSlug, name] = segments;
    return { kind: 'name', name: name!, teamSlug: teamSlug! };
  }
  return { kind: 'name', name: segments[0]! };
}

/** Read the stored config, tolerating a shape written by an older build. */
export function readConfig(raw: unknown): VercelConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const rows = Array.isArray(c.projects) ? c.projects : [];
  return {
    ...(typeof c.token === 'string' && c.token ? { token: c.token } : {}),
    projects: rows
      .map(r => {
        const row = (r ?? {}) as Record<string, unknown>;
        if (typeof row.id !== 'string' || typeof row.name !== 'string') return null;
        return {
          id: row.id,
          name: row.name,
          ...(typeof row.teamId === 'string' && row.teamId ? { teamId: row.teamId } : {})
        };
      })
      .filter((r): r is StoredProject => r !== null)
  };
}

/** Everything except the secret. The only shape that leaves the server. */
export function redactConfig(config: VercelConfig): RedactedVercelConfig {
  return {
    hasToken: Boolean(config.token),
    tokenHint: config.token ? config.token.slice(-4) : null,
    projects: config.projects
  };
}

/**
 * Add a project, or replace the stored row when it is already there.
 *
 * Idempotent rather than 409-ing: a duplicate add is a user checking, not an
 * error. Unlike GitHub's it **replaces** rather than leaves alone, because a
 * re-add is the only path that refreshes a stale `name` or a `teamId` the
 * project moved under — and neither is a secret, so nothing can be lost by it.
 * Keyed on `id`, which is what survives a rename.
 */
export function upsertProject(projects: StoredProject[], next: StoredProject): StoredProject[] {
  const at = projects.findIndex(p => p.id === next.id);
  if (at < 0) return [...projects, next];
  return projects.map((p, i) => (i === at ? next : p));
}

/** Drop a project by id. */
export function removeProject(projects: StoredProject[], id: string): StoredProject[] {
  return projects.filter(p => p.id !== id);
}

/**
 * Does this look like a Vercel access token?
 *
 * **Advisory, never enforced**, the same call `looksLikeGitHubToken` makes.
 * Vercel's dashboard tokens are 24 lowercase alphanumerics today and that is a
 * fact about this year, not a contract. Refusing a format Vercel introduces
 * later would be a worse failure than the 403 that names itself, so a mismatch
 * is a warning beside a saved token.
 */
export const looksLikeVercelToken = (token: string): boolean => /^[A-Za-z0-9]{20,}$/.test(token);

export const tokenInputSchema = z.object({
  token: z.string().min(1, 'A token is required').max(512)
});

export const projectInputSchema = z.object({
  project: z.string().min(1, 'A project is required').max(512)
});
