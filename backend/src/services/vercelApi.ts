import axios, { type AxiosInstance } from 'axios';

/**
 * **The Vercel REST surface Cronsole reads, and nothing else.**
 *
 * This module is the whole of Cronsole's contact with Vercel, and every function
 * in it is a `GET`. That is not a stage — it is the shape of the connector.
 * Vercel Cron is Cronsole's **second** read-only observer, after GitHub Actions
 * proved the shape end to end on 2026-08-23.
 *
 * Three facts about the platform shape everything below, and each one is a
 * pointed contrast with GitHub.
 *
 * **The schedule *is* in the API, and one request returns all of them.** A
 * project object carries `crons.definitions[] = { host, path, schedule }`, so
 * unlike GitHub — where the cron lives in a workflow *file* and needs a second
 * Contents-API fetch per workflow — reading a project's whole cron set is one
 * call. This connector is therefore materially cheaper than GitHub's and has no
 * YAML parser, no size cap and no "could not read the file" branch.
 *
 * **`schedule` is 5-field UTC.** Vercel documents cron expressions as UTC with
 * no timezone support, which is Cronsole's storage contract exactly. Nothing is
 * converted anywhere in this connector — not at read, not at display.
 *
 * **There is no run history.** This is the one place Vercel gives *less* than
 * GitHub, and it decides how the connector reports health. GitHub returns a
 * `conclusion` per run (`success` / `failure` / `cancelled` / `timed_out`), so a
 * workflow can be scored. Vercel exposes cron invocations only as function logs,
 * behind no stable documented endpoint — so this connector reports
 * `reportsRunResult: false` and `taskHealth` answers `unknown`. Inventing a
 * verdict from `enabledAt` would be the confident-lie shape: "this cron is
 * configured" and "this cron is working" are different claims.
 */

/** The API host. Every read below is a documented, versioned REST endpoint. */
const BASE_URL = 'https://api.vercel.com';

/** How long any one Vercel request may take before it is a failure. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Vercel's maximum page size for the project list. */
const PROJECT_PAGE_LIMIT = 100;

/**
 * A Vercel call's outcome.
 *
 * A discriminated union rather than a throw, modelled on `githubActions.ts` and
 * `claudeTriggers.ts` for the same reason: every caller has a *specific* thing
 * to say when Vercel declines — a 404 on one project must not empty the sync for
 * the other four, and a 403 is a fact about the token rather than about the
 * project.
 */
export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

/** One `crons.definitions[]` entry, as Cronsole reads it. */
export interface VercelCronDefinition {
  /** The hostname the cron calls — the production deployment's, normally. */
  host: string;
  /** The path that is called, e.g. `/api/crons/sync?hello=world`. */
  path: string;
  /** A 5-field cron expression, in UTC. */
  schedule: string;
  /** `api` when created through the API; absent when it came from `vercel.json`. */
  source?: string;
  /** A human-readable description, when the definition carries one. */
  description?: string;
}

/**
 * A project's cron configuration.
 *
 * `enabledAt` / `disabledAt` are **project-level** and Cronsole reads them as
 * the status of every cron in the project: Vercel turns crons on with the first
 * deployment that outputs one, and off as a unit. There is no per-definition
 * enable, so a per-task toggle would be inventing a control the platform does
 * not have.
 */
export interface VercelProjectCrons {
  enabledAt: number | null;
  disabledAt: number | null;
  updatedAt: number | null;
  /** The deployment the definitions came from, or null. */
  deploymentId: string | null;
  definitions: VercelCronDefinition[];
}

export interface VercelProject {
  id: string;
  name: string;
  /**
   * Null when the project has never deployed a cron.
   *
   * Distinct from `{ definitions: [] }`, which means crons are configured for
   * the project and there are currently none — the same "absent versus present
   * and empty" split `reportsRunResult` draws one platform over, and the reason
   * the sync can tell "this project has no crons" from "Cronsole did not look".
   */
  crons: VercelProjectCrons | null;
  /** The team the project belongs to, or null for a personal-account project. */
  teamId?: string | null;
}

/**
 * One authenticated client per call site.
 *
 * Not a module-level singleton: the token belongs to a *user's* connection, and
 * a process-wide client holding one user's credential is exactly the shape that
 * makes a multi-user install leak across accounts. Cheap — axios instances are
 * plain objects.
 */
function client(token: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'Cronsole'
    },
    // We interpret every status ourselves — see `describeError`. Letting axios
    // throw on 4xx would turn "this project does not exist" into a stack trace
    // indistinguishable from a network fault.
    validateStatus: () => true
  });
}

/**
 * Turn a Vercel response into a sentence naming the actual cause.
 *
 * Two of these carry the weight, and both are cases where the raw status sends
 * people to the wrong place:
 *
 * A **404 on a project you can see in the dashboard** is almost always a
 * *scope* problem rather than a typo — a team project looked up without its
 * `teamId` resolves against the personal account and is genuinely not there.
 * That is the same misdirection GitHub's 404-means-missing-scope message exists
 * to correct, arriving through a different door.
 *
 * A **429** is a boundary that clears by itself, which is a different
 * instruction from every other refusal here.
 */
function describeError(status: number, body: unknown, what: string): string {
  const error = (body && typeof body === 'object' ? (body as { error?: unknown }).error : null) as
    | { message?: unknown; code?: unknown }
    | null;
  const apiMessage = typeof error?.message === 'string' ? error.message : null;

  switch (status) {
    case 401:
      return 'Vercel rejected the token (401). Access tokens expire — create a new one and reconnect.';
    case 403:
      return (
        `Vercel refused access (403)${apiMessage ? `: ${apiMessage}` : ''}. A token is scoped to the ` +
        'account or team it was created under, so one made for a personal account cannot read a team project.'
      );
    case 404:
      return (
        `Vercel returned 404 for ${what}. For a project owned by a team that usually means the lookup ` +
        'went to your personal account rather than that the name is wrong — paste the project\'s ' +
        'dashboard URL, which carries the team, instead of just its name.'
      );
    case 429:
      return 'Vercel rate limit reached (429). Cronsole only reads, so this clears on its own.';
    case 500:
    case 502:
    case 503:
      return `Vercel server error (${status}). Safe to retry.`;
    default:
      return apiMessage ? `Vercel error ${status}: ${apiMessage}` : `Vercel error ${status} for ${what}.`;
  }
}

/** Wrap a request so a transport failure reads like every other refusal. */
async function attempt<T>(
  what: string,
  run: () => Promise<{ status: number; data: unknown }>,
  map: (data: unknown) => T
): Promise<VercelResult<T>> {
  let response;
  try {
    response = await run();
  } catch (error) {
    // A timeout or DNS failure. No status, and saying `HTTP null` would be worse
    // than saying what happened.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, message: `Could not reach Vercel for ${what}: ${message}` };
  }

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, data: map(response.data) };
  }
  return { ok: false, status: response.status, message: describeError(response.status, response.data, what) };
}

/**
 * Who the token belongs to — the connect-time check.
 *
 * Called once, when a user saves a token, so a bad paste fails at the click
 * rather than at the first sync with a project name in the error. Deliberately
 * *not* called from `getHealth`: health runs on a 45-second poll per open tab,
 * and probing Vercel from it would put a steady stream of requests on someone's
 * rate limit to answer a question the next sync answers for free. Same
 * conclusion the Windows, Claude and GitHub connectors all reached — **sync is
 * the user's probe.**
 */
export async function verifyToken(token: string): Promise<VercelResult<{ username: string }>> {
  return attempt(
    'the authenticated user',
    () => client(token).get('/v2/user'),
    data => {
      const user = ((data as { user?: unknown })?.user ?? data ?? {}) as Record<string, unknown>;
      const name =
        (typeof user.username === 'string' && user.username) ||
        (typeof user.email === 'string' && user.email) ||
        'unknown';
      return { username: name };
    }
  );
}

/**
 * One project, by id or by name, with its cron definitions.
 *
 * `teamId` is a query parameter rather than a header because that is how Vercel
 * scopes a read: one access token reaches every team the user belongs to, and
 * *which* account a lookup resolves against is per request. Omitting it targets
 * the personal account, which is why a team project looked up bare 404s.
 */
export async function getProject(
  token: string,
  idOrName: string,
  teamId?: string,
  slug?: string
): Promise<VercelResult<VercelProject>> {
  return attempt(
    `the project ${idOrName}`,
    () =>
      client(token).get(`/v9/projects/${encodeURIComponent(idOrName)}`, {
        params: { ...(teamId ? { teamId } : {}), ...(slug ? { slug } : {}) }
      }),
    data => toProject(data, teamId ?? null)
  );
}

/**
 * Every project the token can see, one page deep.
 *
 * Used only by the connect flow, to offer a picker instead of making someone
 * type a name they are looking at in another tab. The sync reads each watched
 * project by id, so a truncated listing here can never narrow a sync — which is
 * why this returns `truncated` for the picker to say so and does not set
 * `partial` on anything.
 */
export async function listProjects(
  token: string,
  teamId?: string
): Promise<VercelResult<{ projects: VercelProject[]; truncated: boolean }>> {
  return attempt(
    'your projects',
    () =>
      client(token).get('/v10/projects', {
        params: { limit: PROJECT_PAGE_LIMIT, ...(teamId ? { teamId } : {}) }
      }),
    data => {
      const body = (data ?? {}) as { projects?: unknown; pagination?: { next?: unknown } };
      const rows = Array.isArray(body.projects) ? body.projects : [];
      return {
        projects: rows.map(r => toProject(r, teamId ?? null)).filter((p): p is VercelProject => p !== null),
        // `pagination.next` is a continuation token, so a non-null one is Vercel
        // saying "there are more" without making us count.
        truncated: body.pagination?.next !== null && body.pagination?.next !== undefined
      };
    }
  );
}

/**
 * The teams this token can act on behalf of.
 *
 * Read once at connect time so the project picker can cover a user whose work
 * lives under a team rather than their personal account — the default listing
 * would otherwise show them an empty account and no way to tell whether that was
 * the token, the plan, or the truth.
 */
export async function listTeams(token: string): Promise<VercelResult<{ id: string; name: string; slug: string }[]>> {
  return attempt(
    'your teams',
    () => client(token).get('/v2/teams', { params: { limit: 100 } }),
    data => {
      const rows = (data as { teams?: unknown })?.teams;
      return (Array.isArray(rows) ? rows : [])
        .map(raw => {
          const t = (raw ?? {}) as Record<string, unknown>;
          if (typeof t.id !== 'string') return null;
          return {
            id: t.id,
            name: typeof t.name === 'string' && t.name ? t.name : t.id,
            slug: typeof t.slug === 'string' ? t.slug : ''
          };
        })
        .filter((t): t is { id: string; name: string; slug: string } => t !== null);
    }
  );
}

/**
 * A raw project object as Cronsole reads it — exported for its own test.
 *
 * The interesting case is the difference between `crons: null` and
 * `crons: { definitions: [] }`, and it is preserved rather than flattened: the
 * first means this project has never deployed a cron, the second that it has
 * crons configured and none right now. Collapsing them would make "no crons
 * here" and "Cronsole could not tell" the same answer, which is the refusal rule
 * `parseWorkflowSchedules` and `ScheduleZoneHint` both exist to keep.
 */
export function toProject(raw: unknown, teamId: string | null): VercelProject {
  const p = (raw ?? {}) as Record<string, unknown>;
  const id = typeof p.id === 'string' ? p.id : '';
  return {
    id,
    name: typeof p.name === 'string' && p.name ? p.name : id,
    crons: toCrons(p.crons),
    teamId: typeof p.accountId === 'string' && p.accountId.startsWith('team_') ? p.accountId : teamId
  };
}

function toCrons(raw: unknown): VercelProjectCrons | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  const rows = Array.isArray(c.definitions) ? c.definitions : [];
  return {
    enabledAt: num(c.enabledAt),
    disabledAt: num(c.disabledAt),
    updatedAt: num(c.updatedAt),
    deploymentId: typeof c.deploymentId === 'string' ? c.deploymentId : null,
    definitions: rows
      .map(toDefinition)
      .filter((d): d is VercelCronDefinition => d !== null)
  };
}

function toDefinition(raw: unknown): VercelCronDefinition | null {
  const d = (raw ?? {}) as Record<string, unknown>;
  if (typeof d.path !== 'string' || typeof d.schedule !== 'string') return null;
  return {
    host: typeof d.host === 'string' ? d.host : '',
    path: d.path,
    // Vercel accepts runs of whitespace in a cron; Cronsole's storage contract
    // is a normalized 5-field string, so they collapse here rather than in four
    // call sites downstream. Same normalization `parseWorkflowSchedules` does.
    schedule: d.schedule.trim().replace(/\s+/g, ' '),
    ...(typeof d.source === 'string' ? { source: d.source } : {}),
    ...(typeof d.description === 'string' && d.description ? { description: d.description } : {})
  };
}
