import axios, { type AxiosInstance } from 'axios';
import yaml from 'js-yaml';

/**
 * **The GitHub REST surface Cronsole reads, and nothing else.**
 *
 * This module is the whole of Cronsole's contact with GitHub, and every function
 * in it is a `GET`. That is not a stage — it is the shape of the connector.
 * GitHub Actions is Cronsole's first **read-only observer**: it can say what
 * scheduled workflows exist, when they claim to run, and how the last run
 * actually went, and it can do nothing about any of it. The capability matrix
 * has been able to render that honestly since it learned `unsupported`
 * (2026-08-12), which is what makes an observer a finished product state rather
 * than a half-built controller.
 *
 * Three facts about the platform shape everything below.
 *
 * **A workflow's schedule is not in the API.** `GET /actions/workflows` returns
 * the id, name, path and state — never the triggers. The cron lives in the
 * workflow *file*, so reading a schedule means fetching YAML from the Contents
 * API and parsing it. That is why {@link workflowSchedules} exists and why a
 * workflow whose file cannot be read reports **no schedule** rather than a
 * guessed one.
 *
 * **`on: schedule` cron is already UTC.** GitHub documents it as UTC with no
 * timezone support at all, which makes it the only platform Cronsole talks to
 * whose stored form needs no conversion whatsoever — not at read, not at write,
 * not at display. Windows carries a trigger conversion with a lossy-warning
 * layer; Claude's `cron_expression` is UTC but only 5-field by convention. This
 * one matches the storage contract exactly.
 *
 * **The run history is real.** `GET /actions/workflows/{id}/runs` returns each
 * run's `conclusion` — `success`, `failure`, `cancelled`, `timed_out` — which is
 * the *outcome of the work*, not "the scheduler accepted a start". Windows can
 * only offer the latter through Cronsole (`ExecutionLog` records runs Cronsole
 * *performed*), so health scoring here is better-founded than on the platform
 * Cronsole controls most. Reported into task metadata and read by
 * `services/taskHealth.ts`.
 */

/** The API version header GitHub asks every caller to pin. */
const API_VERSION = '2022-11-28';

const BASE_URL = 'https://api.github.com';

/**
 * Cap on a workflow file we will parse.
 *
 * A workflow is a config file; 512 kB is already absurd for one. The cap is not
 * about disk — it bounds what `yaml.load` is asked to chew on, since anchor
 * expansion is quadratic and the file comes from a repository Cronsole does not
 * own. A file over the cap reports no schedule with a reason, which is the same
 * answer an unparseable one gets.
 */
const MAX_WORKFLOW_BYTES = 512 * 1024;

/** How long any one GitHub request may take before it is a failure. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * A GitHub call's outcome.
 *
 * Modelled on `services/claudeTriggers.ts`: a discriminated union rather than a
 * throw, because every caller here has a *specific* thing to say when GitHub
 * declines — a 404 on one repository must not empty the sync for the other four,
 * and a 401 is a fact about the token rather than about the repository.
 */
export type GitHubResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

export interface GitHubWorkflow {
  id: number;
  /** The workflow's `name:`, or its path when it has none. */
  name: string;
  /** Repo-relative path, e.g. `.github/workflows/nightly.yml`. */
  path: string;
  /** `active`, `disabled_manually`, `disabled_inactivity`, `disabled_fork`. */
  state: string;
  html_url: string;
}

export interface GitHubRun {
  conclusion: string | null;
  status: string | null;
  run_started_at: string | null;
  updated_at: string | null;
  html_url: string;
  /** What actually triggered it — `schedule`, `push`, `workflow_dispatch`, … */
  event: string | null;
}

/**
 * The schedules a workflow file declares, and whether we could read it at all.
 *
 * `crons: []` and `reason: '…'` are different answers and the caller acts on the
 * difference: an empty list from a file we *read* means the workflow genuinely
 * has no `schedule:` trigger (it runs on push, or on dispatch), while a reason
 * means we do not know. Collapsing the two would let an unreadable file render
 * as "this workflow has no schedule", which is the confident-lie shape.
 */
export interface WorkflowSchedules {
  crons: string[];
  /** Present only when the file could not be read or parsed. */
  reason?: string;
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
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': 'Cronsole'
    },
    // We interpret every status ourselves — see `describeError`. Letting axios
    // throw on 4xx would turn "this repository does not exist" into a stack
    // trace indistinguishable from a network fault.
    validateStatus: () => true
  });
}

/**
 * Turn a GitHub response into a sentence naming the actual cause.
 *
 * Two of these matter far more than the rest and are the reason this is not a
 * generic `HTTP ${status}`. A **404 on a repository you can see in a browser**
 * is almost always a token without `repo` scope rather than a typo — GitHub
 * returns 404 rather than 403 for a private resource the token cannot reach, on
 * purpose, so "not found" is the *expected* symptom of an under-scoped token and
 * sends people to check their spelling. And a **403 with a rate-limit reset**
 * is a boundary that clears by itself, which is a different instruction from
 * every other 403.
 */
function describeError(status: number, body: unknown, headers: Record<string, unknown>, what: string): string {
  const apiMessage =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : null;

  switch (status) {
    case 401:
      return 'GitHub rejected the token (401). Personal access tokens expire — generate a new one and reconnect.';
    case 403: {
      const remaining = headers['x-ratelimit-remaining'];
      const reset = headers['x-ratelimit-reset'];
      if (remaining === '0' || String(apiMessage ?? '').toLowerCase().includes('rate limit')) {
        const at = typeof reset === 'string' ? new Date(Number(reset) * 1000) : null;
        return (
          'GitHub rate limit reached (403)' +
          (at && !Number.isNaN(at.getTime()) ? `, resets at ${at.toISOString()}` : '') +
          '. Cronsole only reads, so this clears on its own.'
        );
      }
      return `GitHub refused access (403)${apiMessage ? `: ${apiMessage}` : ''}.`;
    }
    case 404:
      return (
        `GitHub returned 404 for ${what}. For a private repository that usually means the token is ` +
        'missing the `repo` scope rather than that the name is wrong — GitHub answers 404, not 403, ' +
        'for anything a token cannot see.'
      );
    case 422:
      return `GitHub rejected the request (422)${apiMessage ? `: ${apiMessage}` : ''}.`;
    case 500:
    case 502:
    case 503:
      return `GitHub server error (${status}). Safe to retry.`;
    default:
      return apiMessage ? `GitHub error ${status}: ${apiMessage}` : `GitHub error ${status} for ${what}.`;
  }
}

/** Wrap a request so a transport failure reads like every other refusal. */
async function attempt<T>(
  what: string,
  run: () => Promise<{ status: number; data: unknown; headers: Record<string, unknown> }>,
  map: (data: unknown) => T
): Promise<GitHubResult<T>> {
  let response;
  try {
    response = await run();
  } catch (error) {
    // A timeout or DNS failure. No status, and saying `HTTP null` would be
    // worse than saying what happened.
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, message: `Could not reach GitHub for ${what}: ${message}` };
  }

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, data: map(response.data) };
  }
  return {
    ok: false,
    status: response.status,
    message: describeError(response.status, response.data, response.headers ?? {}, what)
  };
}

/**
 * Who the token belongs to — the connect-time check.
 *
 * Called once, when a user saves a token, so a bad paste fails at the click
 * rather than at the first sync with a repository name in the error. This is
 * deliberately *not* called from `getHealth`: health runs on a 45-second poll
 * per open tab, and probing GitHub from it would put a steady stream of requests
 * on someone's rate limit to answer a question the next sync answers for free.
 * Same conclusion the Windows and Claude connectors reached — **sync is the
 * user's probe.**
 */
export async function verifyToken(token: string): Promise<GitHubResult<{ login: string }>> {
  return attempt(
    'the authenticated user',
    () => client(token).get('/user'),
    data => ({ login: String((data as { login?: unknown })?.login ?? 'unknown') })
  );
}

/**
 * Every workflow defined in a repository — scheduled or not.
 *
 * Filtering to scheduled ones happens in the connector, after the files are
 * read, because *whether* a workflow is scheduled is not knowable from this
 * response. Paginated at GitHub's maximum: a repository with more than 100
 * workflows is beyond anything this observer is for, and the connector says so
 * rather than silently reading the first hundred.
 */
export async function listWorkflows(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubResult<{ workflows: GitHubWorkflow[]; total: number }>> {
  return attempt(
    `the workflows in ${owner}/${repo}`,
    () => client(token).get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows`, {
      params: { per_page: 100 }
    }),
    data => {
      const body = (data ?? {}) as { workflows?: unknown; total_count?: unknown };
      const rows = Array.isArray(body.workflows) ? body.workflows : [];
      return {
        total: typeof body.total_count === 'number' ? body.total_count : rows.length,
        workflows: rows
          .map(toWorkflow)
          .filter((w): w is GitHubWorkflow => w !== null)
      };
    }
  );
}

function toWorkflow(raw: unknown): GitHubWorkflow | null {
  const w = (raw ?? {}) as Record<string, unknown>;
  if (typeof w.id !== 'number' || typeof w.path !== 'string') return null;
  return {
    id: w.id,
    name: typeof w.name === 'string' && w.name ? w.name : w.path,
    path: w.path,
    state: typeof w.state === 'string' ? w.state : 'unknown',
    html_url: typeof w.html_url === 'string' ? w.html_url : ''
  };
}

/**
 * The workflow file's `on: schedule` crons, on the repository's default branch.
 *
 * **The default branch, deliberately.** GitHub only ever schedules the workflow
 * file as it exists on the default branch — a `schedule:` trigger on a feature
 * branch never fires. Reading `ref`-less (which the Contents API answers from
 * the default branch) is therefore not a simplification: it is the only ref
 * whose content is a fact about what will actually run.
 */
export async function workflowSchedules(
  token: string,
  owner: string,
  repo: string,
  path: string
): Promise<GitHubResult<WorkflowSchedules>> {
  const result = await attempt(
    `${path} in ${owner}/${repo}`,
    () =>
      client(token).get(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`
      ),
    data => data as Record<string, unknown>
  );

  if (!result.ok) return result;

  const body = result.data;
  if (body?.encoding !== 'base64' || typeof body.content !== 'string') {
    return { ok: true, data: { crons: [], reason: 'GitHub did not return the workflow file as text.' } };
  }
  if (typeof body.size === 'number' && body.size > MAX_WORKFLOW_BYTES) {
    return {
      ok: true,
      data: { crons: [], reason: `The workflow file is ${body.size} bytes, past the ${MAX_WORKFLOW_BYTES}-byte cap Cronsole parses.` }
    };
  }

  const text = Buffer.from(body.content, 'base64').toString('utf8');
  return { ok: true, data: parseWorkflowSchedules(text) };
}

/**
 * Pull `on.schedule[].cron` out of a workflow file.
 *
 * Exported for its own test, because the interesting cases are all in the YAML
 * and none of them need a network. Three of them are worth naming:
 *
 * **`on` is a keyword-shaped key.** Under YAML 1.1 the bare word `on` is the
 * boolean `true`, which is why `"on":` appears quoted in so many workflow files.
 * js-yaml v4 follows YAML 1.2 core, where it is the string `on` — but a file
 * written defensively as `"on":` or `True:` must still read, so both the string
 * and the boolean key are checked.
 *
 * **A cron with only whitespace differences is still one cron.** GitHub accepts
 * `0  9 * * *`; Cronsole's storage contract is a normalized 5-field string, so
 * runs of whitespace collapse here rather than in four call sites downstream.
 *
 * **An unparseable file yields a reason, never an empty list.** Declining to
 * answer and answering "no schedule here" must not be the same code path — the
 * rule `ScheduleZoneHint` learned the expensive way (troubleshooting #60).
 */
export function parseWorkflowSchedules(text: string): WorkflowSchedules {
  let doc: unknown;
  try {
    doc = yaml.load(text);
  } catch (error) {
    return {
      crons: [],
      reason: `Cronsole could not parse the workflow file: ${error instanceof Error ? error.message : String(error)}`
    };
  }

  if (!doc || typeof doc !== 'object') {
    return { crons: [], reason: 'The workflow file did not parse into a YAML mapping.' };
  }

  const root = doc as Record<string, unknown>;
  // `on`, `"on"` and the YAML-1.1 boolean it can collapse into. All three name
  // the same block; which one is present is an accident of how the file was
  // written and of which parser read it.
  const triggers = root.on ?? root['true'];
  if (triggers === undefined) {
    return { crons: [], reason: 'The workflow file has no `on:` block.' };
  }

  // `on: push` or `on: [push, schedule]` — a schedule named without a cron is
  // not a schedule GitHub can run, so this is an honest empty rather than a
  // reason: the file parsed, and it declares no cron.
  if (typeof triggers === 'string' || Array.isArray(triggers)) return { crons: [] };
  if (typeof triggers !== 'object') return { crons: [] };

  const schedule = (triggers as Record<string, unknown>).schedule;
  if (schedule === undefined) return { crons: [] };
  if (!Array.isArray(schedule)) {
    return { crons: [], reason: '`on.schedule` is not a list, so Cronsole could not read a cron from it.' };
  }

  const crons = schedule
    .map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const cron = (entry as Record<string, unknown>).cron;
      return typeof cron === 'string' ? cron.trim().replace(/\s+/g, ' ') : null;
    })
    .filter((c): c is string => c !== null && c.length > 0);

  return { crons };
}

/**
 * The most recent runs of one workflow.
 *
 * `per_page` is small on purpose: the connector wants the last outcome and a
 * short streak, not a history. `ExecutionLog` is not involved and must not be —
 * it records runs **Cronsole performed**, and Cronsole performs none of these.
 * A GitHub run is exactly the kind of run that "happened" without Cronsole, so
 * it lives in task metadata and is read from there.
 */
export async function listWorkflowRuns(
  token: string,
  owner: string,
  repo: string,
  workflowId: number,
  perPage = 5
): Promise<GitHubResult<GitHubRun[]>> {
  return attempt(
    `runs of workflow ${workflowId} in ${owner}/${repo}`,
    () =>
      client(token).get(
        `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${workflowId}/runs`,
        // `schedule` only: a workflow that also runs on push would otherwise
        // have its scheduled health judged by whatever someone last pushed,
        // which is a different question and usually a healthier-looking one.
        { params: { per_page: perPage, event: 'schedule', exclude_pull_requests: true } }
      ),
    data => {
      const rows = (data as { workflow_runs?: unknown })?.workflow_runs;
      return (Array.isArray(rows) ? rows : []).map(toRun);
    }
  );
}

function toRun(raw: unknown): GitHubRun {
  const r = (raw ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    conclusion: str(r.conclusion),
    status: str(r.status),
    run_started_at: str(r.run_started_at),
    updated_at: str(r.updated_at),
    html_url: str(r.html_url) ?? '',
    event: str(r.event)
  };
}
