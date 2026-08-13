import axios, { AxiosError } from 'axios';

/**
 * **The Claude Code triggers API — door 2.** See `claudeOAuth.ts` for why there
 * are two doors and why the credential this uses is never stored.
 *
 * A "trigger" is what claude.ai calls a **routine**: a saved prompt plus its
 * repositories, tools and MCP connections, fired by a cron schedule, a GitHub
 * event, or an HTTP call. This module is a thin, typed wrapper over the endpoint
 * family Claude Code itself drives, and it owns no policy — the connector
 * decides what to do with the results.
 *
 * ## What is verified, and what that is worth
 *
 * Every shape below was checked against the live API on 2026-08-13, not inferred
 * from the client binary:
 *
 * - `POST /v1/code/triggers/{id}` is a genuine **partial** update — a name-only
 *   write left `job_config`, `cron_expression` and `enabled` untouched. This is
 *   the single most load-bearing fact here: if it were a replace, every
 *   `setTaskStatus` call would silently destroy the routine's prompt.
 * - `cron_expression` is 5-field **UTC**, day-of-week 1 = Monday (`30 4 * * 1`
 *   resolved to Monday 04:32Z). That matches Cronsole's storage contract
 *   exactly, so no conversion happens anywhere in this path.
 * - `next_run_at` carries **server-side jitter** of up to ~3 minutes. It is the
 *   platform's answer and is reported as-is; Cronsole must not recompute it from
 *   the cron, or the dashboard and claude.ai will disagree by a few minutes
 *   forever with no way to tell which is right.
 * - **There is no DELETE.** Not "not implemented here" — the endpoint does not
 *   exist. A routine can be disabled and forgotten, never removed by API.
 *
 * ## The standing caveat
 *
 * This API is undocumented and gated behind a dated beta header. It can change
 * or vanish without notice, which is exactly why the connector keeps door 1
 * working underneath it rather than migrating onto this and burning the bridge.
 * When a call here fails in a way that suggests the surface moved (404 on a
 * collection, 400 naming the beta), that is reported as itself and not dressed
 * up as a user error.
 */

/** The beta gate. A dated value: when it stops being accepted, that is the signal. */
const TRIGGERS_BETA = 'ccr-triggers-2026-01-30';

const API_BASE = process.env.ANTHROPIC_BASE_URL?.trim() || 'https://api.anthropic.com';

/** Long enough for a cold API, short enough not to hold a dashboard poll open. */
const REQUEST_TIMEOUT_MS = 20_000;

export interface TriggerSessionContext {
  sources?: Array<{ git_repository?: { url?: string } }>;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  model?: string;
}

export interface ClaudeTrigger {
  id: string;
  name: string;
  /** 5-field cron in UTC. **Empty string** when the routine has no schedule. */
  cron_expression: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
  last_fired_at?: string;
  next_run_at?: string;
  /** Zero-value `0001-01-01T…` when unscheduled — see {@link parseTimestamp}. */
  suspension_reason?: string;
  api_token_hint?: string;
  job_config?: {
    ccr?: {
      environment_id?: string;
      session_context?: TriggerSessionContext;
      events?: Array<{ data?: { message?: { content?: string; role?: string } } }>;
    };
  };
}

export interface ClaudeRunSession {
  id?: string;
  session_id?: string;
  title?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  url?: string;
}

/** Every call returns this rather than throwing — the connector never try/catches. */
export type TriggerResult<T> =
  | { ok: true; data: T }
  | { ok: false; status?: number; message: string; surfaceMoved?: boolean };

/**
 * The API's zero timestamp is `0001-01-01T00:00:00Z`, which `new Date()` parses
 * happily into the year 1. Rendering that as a next-run time would put "runs in
 * -2025 years" on the dashboard, so a pre-epoch value is treated as absent —
 * which is what it means: this routine has no schedule.
 */
export function parseTimestamp(raw: string | undefined | null): Date | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.getUTCFullYear() < 2000) return null;
  return parsed;
}

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'anthropic-version': '2023-06-01',
    'anthropic-beta': TRIGGERS_BETA,
    'content-type': 'application/json'
  };
}

/**
 * Turn a failure into something that names the cause.
 *
 * The two that matter most are the ones that are not really the user's fault:
 * a **401** here means the Claude Code session expired (fix: `/login`, not
 * anything in Cronsole), and a **404 on a collection** or a **400 naming the
 * beta** means this undocumented surface moved — which the connector needs to
 * distinguish so it can fall back to door 1 instead of telling the user their
 * routine is missing.
 */
function describeError(error: unknown, path: string): TriggerResult<never> {
  const err = error as AxiosError<any>;
  const status = err?.response?.status;
  const apiMessage: string | undefined =
    err?.response?.data?.error?.message ?? err?.response?.data?.message;

  const betaRejected =
    status === 400 && typeof apiMessage === 'string' && /beta|anthropic-beta/i.test(apiMessage);
  const collectionGone = status === 404 && !/\/triggers\/[^/]/.test(path);

  if (betaRejected || collectionGone) {
    return {
      ok: false,
      status,
      surfaceMoved: true,
      message:
        `The Claude Code routines API rejected this call (${status}${apiMessage ? `: ${apiMessage}` : ''}). ` +
        'This API is undocumented and beta-gated, so it may have changed. ' +
        'Cronsole will fall back to per-routine API tokens.'
    };
  }

  switch (status) {
    case 401:
      return {
        ok: false,
        status,
        message:
          'Your Claude Code session was rejected (401). Refresh it in the Claude Code CLI (`/login`).'
      };
    case 403:
      return {
        ok: false,
        status,
        message:
          'No access (403). Routines need a Pro, Max, Team or Enterprise plan with Claude Code on the web enabled.'
      };
    case 404:
      return { ok: false, status, message: 'That routine no longer exists (404). It may have been deleted at claude.ai.' };
    case 429: {
      const retryAfter = err?.response?.headers?.['retry-after'];
      return {
        ok: false,
        status,
        message:
          'Rate limited (429)' +
          (retryAfter ? `, retry after ${retryAfter}s` : '') +
          '. Routine runs draw on a daily cap plus your Claude Code subscription usage.'
      };
    }
    case 500:
      return { ok: false, status, message: 'Anthropic server error (500). Safe to retry with backoff.' };
    case 503:
      return { ok: false, status, message: 'Anthropic temporarily overloaded (503). Retry shortly.' };
    default:
      return {
        ok: false,
        status,
        message: apiMessage ?? (err?.message || 'Unknown error calling the Claude Code routines API')
      };
  }
}

async function call<T>(
  method: 'get' | 'post',
  path: string,
  token: string,
  body?: unknown
): Promise<TriggerResult<T>> {
  try {
    const response = await axios.request<T>({
      method,
      url: `${API_BASE}${path}`,
      headers: headers(token),
      timeout: REQUEST_TIMEOUT_MS,
      ...(body !== undefined ? { data: body } : {})
    });
    return { ok: true, data: response.data };
  } catch (error) {
    return describeError(error, path);
  }
}

/** Every routine on the account. The read that makes a real sync possible. */
export async function listTriggers(token: string): Promise<TriggerResult<ClaudeTrigger[]>> {
  const result = await call<{ data?: ClaudeTrigger[] }>('get', '/v1/code/triggers', token);
  if (!result.ok) return result;
  return { ok: true, data: Array.isArray(result.data?.data) ? result.data.data : [] };
}

export async function getTrigger(token: string, id: string): Promise<TriggerResult<ClaudeTrigger>> {
  const result = await call<{ trigger?: ClaudeTrigger } | ClaudeTrigger>(
    'get',
    `/v1/code/triggers/${encodeURIComponent(id)}`,
    token
  );
  if (!result.ok) return result;
  const trigger = (result.data as any)?.trigger ?? result.data;
  return { ok: true, data: trigger as ClaudeTrigger };
}

export interface CreateTriggerInput {
  name: string;
  /** 5-field UTC cron. Omit for a routine with no schedule. */
  cronExpression?: string;
  prompt: string;
  environmentId: string;
  enabled?: boolean;
  /** Git repositories the routine may work in. */
  repositoryUrls?: string[];
  allowedTools?: string[];
  model?: string;
}

/**
 * Create a routine.
 *
 * `clear_mcp_connections: true` is deliberate and matters: without it the server
 * attaches **every MCP connector on the account** to the new routine — nine of
 * them on a real account, including Gmail and Google Drive. A routine Cronsole
 * created on a one-line request must not silently come with the user's mailbox
 * attached. Connectors are added at claude.ai, deliberately, per routine.
 */
export async function createTrigger(
  token: string,
  input: CreateTriggerInput
): Promise<TriggerResult<ClaudeTrigger>> {
  const body: Record<string, unknown> = {
    name: input.name,
    enabled: input.enabled ?? true,
    clear_mcp_connections: true,
    job_config: {
      ccr: {
        environment_id: input.environmentId,
        session_context: {
          sources: (input.repositoryUrls ?? []).map(url => ({ git_repository: { url } })),
          ...(input.allowedTools ? { allowed_tools: input.allowedTools } : {}),
          ...(input.model ? { model: input.model } : {})
        },
        events: [
          {
            data: {
              session_id: '',
              type: 'user',
              parent_tool_use_id: null,
              message: { content: input.prompt, role: 'user' }
            }
          }
        ]
      }
    }
  };
  if (input.cronExpression) body.cron_expression = input.cronExpression;

  const result = await call<{ trigger?: ClaudeTrigger }>('post', '/v1/code/triggers', token, body);
  if (!result.ok) return result;
  const trigger = result.data?.trigger;
  if (!trigger?.id) {
    return {
      ok: false,
      message: 'The routine was created but its id did not come back — check claude.ai/code/routines.'
    };
  }
  return { ok: true, data: trigger };
}

/**
 * Partial update. **Only the named fields change** — verified, and relied upon:
 * `setTaskStatus` sends `{enabled}` alone and must not disturb the prompt.
 */
export async function updateTrigger(
  token: string,
  id: string,
  patch: { name?: string; enabled?: boolean; cronExpression?: string }
): Promise<TriggerResult<ClaudeTrigger>> {
  const body: Record<string, unknown> = {};
  if (patch.name !== undefined) body.name = patch.name;
  if (patch.enabled !== undefined) body.enabled = patch.enabled;
  if (patch.cronExpression !== undefined) body.cron_expression = patch.cronExpression;

  if (Object.keys(body).length === 0) {
    return { ok: false, message: 'Nothing to update.' };
  }

  const result = await call<{ trigger?: ClaudeTrigger }>(
    'post',
    `/v1/code/triggers/${encodeURIComponent(id)}`,
    token,
    body
  );
  if (!result.ok) return result;
  return { ok: true, data: (result.data?.trigger ?? {}) as ClaudeTrigger };
}

/**
 * Fire a routine now — **with no per-routine token**, which is the whole point
 * of door 2. The `text` field is left unset for the same reason
 * `ClaudeConnector` stopped sending it through door 1: it is delivered to the
 * routine as an untrusted payload block, and filler there displaces the real
 * context a routine that opts in expects to find.
 */
export async function runTrigger(
  token: string,
  id: string
): Promise<TriggerResult<{ sessionId?: string }>> {
  const result = await call<any>('post', `/v1/code/triggers/${encodeURIComponent(id)}/run`, token, {});
  if (!result.ok) return result;
  const sessionId =
    typeof result.data?.session_id === 'string'
      ? result.data.session_id
      : typeof result.data?.session?.id === 'string'
        ? result.data.session.id
        : undefined;
  return { ok: true, data: { sessionId } };
}

/**
 * Recent run sessions for a routine.
 *
 * Carries a caveat worth repeating wherever this is rendered: a fire that never
 * created a session — a paused routine, a run cap, a failed repository preflight
 * — leaves **no row here**. So an empty list is not proof the routine never
 * fired, and must never be labelled "never run". Same rule as `ExecutionLog`
 * recording runs Cronsole performed rather than runs that happened.
 */
export async function listTriggerSessions(
  token: string,
  triggerId: string,
  limit = 20
): Promise<TriggerResult<ClaudeRunSession[]>> {
  const query = new URLSearchParams({ trigger_id: triggerId, limit: String(limit) });
  const result = await call<{ data?: ClaudeRunSession[]; sessions?: ClaudeRunSession[] }>(
    'get',
    `/v1/code/sessions?${query}`,
    token
  );
  if (!result.ok) return result;
  const rows = result.data?.data ?? result.data?.sessions ?? [];
  return { ok: true, data: Array.isArray(rows) ? rows : [] };
}

/**
 * The environment a new routine runs in, taken from the routines that already
 * exist.
 *
 * The canonical source is `GET /v1/environment_providers`, which needs an
 * organization UUID header and therefore a second auth surface to discover and
 * maintain. Every existing routine already names a working environment, so this
 * reads one back instead — no extra endpoint, no org lookup, and the answer is
 * guaranteed to be one that works for this account because it is already in use.
 *
 * The cost is an honest boundary: an account with **no** routines has nothing to
 * copy, and Cronsole says so rather than guessing an id. Creating the first
 * routine at claude.ai or with `/schedule` is a one-time step, and after it
 * Cronsole can create the rest.
 */
export function environmentIdFrom(triggers: ClaudeTrigger[]): string | null {
  for (const trigger of triggers) {
    const id = trigger.job_config?.ccr?.environment_id;
    if (typeof id === 'string' && id.startsWith('env_')) return id;
  }
  return null;
}

/** The routine's saved prompt, for display. Absent on a malformed job config. */
export function promptOf(trigger: ClaudeTrigger): string | null {
  const content = trigger.job_config?.ccr?.events?.[0]?.data?.message?.content;
  return typeof content === 'string' && content ? content : null;
}

/** Repositories the routine works in — useful context on a task row. */
export function repositoriesOf(trigger: ClaudeTrigger): string[] {
  const sources = trigger.job_config?.ccr?.session_context?.sources ?? [];
  return sources
    .map(source => source?.git_repository?.url)
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
}
