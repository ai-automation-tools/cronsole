import axios, { type AxiosInstance } from 'axios';
import { N8N_SCHEDULE_NODE_TYPES, type N8nScheduleNode } from './n8nSchedule.js';

/**
 * **The n8n public API surface Cronsole reads.**
 *
 * `{base}/api/v1`, one `X-N8N-API-KEY` header, one instance per key — self-hosted
 * or cloud alike. Every function here is a `GET`: the connector's verbs are
 * sync, run history and run output, and nothing in this file writes.
 *
 * Two facts about the response shape matter more than the endpoints:
 *
 * **A workflow body is the draft, not what runs.** n8n has a draft/publish
 * model: `nodes` holds the latest edits, and the graph actually scheduled is
 * `activeVersion` — the two differ exactly when `versionId !== activeVersionId`.
 * {@link toWorkflow} picks the published graph, and says so when it cannot.
 *
 * **A workflow carries credentials-adjacent data, so most of it is dropped at
 * the parse.** An HTTP node's parameters can hold a hardcoded header token, and
 * `shared[].project` carries the owner's email. Only schedule nodes keep their
 * parameters; every other node is reduced to `{ name, type, disabled }`. Same
 * rule as `toToolSummary`: a field never parsed is a field no reader downstream
 * can leak.
 */

/** How long any one n8n request may take before it is a failure. */
const REQUEST_TIMEOUT_MS = 15_000;

/** The public API's maximum page size for `/workflows`. */
const WORKFLOW_PAGE_LIMIT = 250;

/**
 * Pages read before a listing is declared truncated. 4,000 workflows is far past
 * any instance this is for; the cap exists so a cursor that never ends cannot
 * hang a sync, and hitting it sets `truncated` rather than passing as complete.
 */
const MAX_WORKFLOW_PAGES = 16;

export type N8nResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

/** Which graph {@link N8nWorkflow.nodes} came from. */
export type N8nGraphSource =
  /** The published graph, read from `activeVersion`. */
  | 'published'
  /** The body, which is identical to what is published (or nothing is published). */
  | 'body'
  /** The body is a draft that differs from what is published, and the published graph was not in the response. */
  | 'draft-only';

export interface N8nWorkflow {
  id: string;
  name: string;
  /** Published and running. An unpublished workflow fires nothing. */
  active: boolean;
  isArchived: boolean;
  /** `settings.timezone`, verbatim — `DEFAULT` and null both mean "the instance's". */
  timezone: string | null;
  nodes: N8nScheduleNode[];
  graph: N8nGraphSource;
  updatedAt: string | null;
  tags: string[];
}

export interface N8nExecution {
  id: string;
  /** The workflow it belongs to, or null when the row did not say. */
  workflowId: string | null;
  /** n8n's own word — `success`, `error`, `crashed`, `canceled`, `running`, `waiting`, … Not mapped. */
  status: string;
  /** `trigger` for a scheduled fire, `manual` for a click in the editor, `webhook`, `retry`, … */
  mode: string;
  startedAt: string | null;
  stoppedAt: string | null;
  finished: boolean;
}

export interface N8nExecutionDetail extends N8nExecution {
  /** Nodes that ran, in the order they started. */
  steps: string[];
  /** The execution-level error message, when it failed. */
  errorMessage: string | null;
  /** The node n8n says ran last — where a failed run stopped. */
  lastNodeExecuted: string | null;
}

/**
 * The address the user pastes, normalized to the instance root.
 *
 * People paste what is in their address bar (`…/home/workflows`) or what the
 * API docs show (`…/api/v1`); both reduce to the origin plus any path prefix
 * n8n is served under. Exported because the connector stores this form.
 */
export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  url = url.replace(/\/(api\/v1|home\/workflows|workflows?|signin)(\/.*)?$/i, '');
  return url.replace(/\/+$/, '');
}

function client(baseUrl: string, apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: `${normalizeBaseUrl(baseUrl)}/api/v1`,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'X-N8N-API-KEY': apiKey,
      Accept: 'application/json',
      'User-Agent': 'Cronsole'
    },
    validateStatus: () => true
  });
}

function describeError(status: number, body: unknown, what: string): string {
  const apiMessage =
    body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string'
      ? (body as { message: string }).message
      : null;

  switch (status) {
    case 401:
      // n8n answers 401 two ways, and they point at different layers: "header
      // required" means the key never arrived (a proxy stripped it), "unauthorized"
      // means it arrived and n8n does not know it.
      return apiMessage && /header required/i.test(apiMessage)
        ? 'n8n did not receive the API key (401: header required). Something between Cronsole and n8n — ' +
            'a reverse proxy or access gate — is dropping the X-N8N-API-KEY header.'
        : `n8n rejected the API key (401${apiMessage ? `: ${apiMessage}` : ''}). Check it was copied in full, ` +
            'is not expired, and belongs to this instance — or create a new one under Settings › n8n API.';
    case 403:
      return (
        `n8n refused access (403)${apiMessage ? `: ${apiMessage}` : ''}. An API key with scopes ` +
        'needs workflow:read and execution:read.'
      );
    case 404:
      return (
        `n8n returned 404 for ${what}. If this is the first request, the base URL is probably wrong — ` +
        'use the address you open n8n at, without /api/v1 — or the public API is disabled on this instance.'
      );
    case 429:
      return 'n8n rate limit reached (429). Cronsole only reads, so this clears on its own.';
    case 500:
    case 502:
    case 503:
      return `n8n server error (${status}). Safe to retry.`;
    default:
      return apiMessage ? `n8n error ${status}: ${apiMessage}` : `n8n error ${status} for ${what}.`;
  }
}

async function attempt<T>(
  what: string,
  run: () => Promise<{ status: number; data: unknown }>,
  map: (data: unknown) => T
): Promise<N8nResult<T>> {
  let response;
  try {
    response = await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, message: `Could not reach n8n for ${what}: ${message}` };
  }
  if (response.status >= 200 && response.status < 300) return { ok: true, data: map(response.data) };
  return { ok: false, status: response.status, message: describeError(response.status, response.data, what) };
}

/**
 * The connect-time check: one workflow, so a bad key or URL fails at the click.
 * Not called from `getHealth` — sync is the user's probe, as on every hosted source.
 */
export async function verifyKey(baseUrl: string, apiKey: string): Promise<N8nResult<true>> {
  return attempt('the workflow list', () => client(baseUrl, apiKey).get('/workflows', { params: { limit: 1 } }), () => true as const);
}

/**
 * Every workflow on the instance, following the cursor.
 *
 * `truncated` is the connector's `partial`: a listing that stopped at the page
 * cap is a narrowed reader, and must not retire a single row.
 */
export async function listWorkflows(
  baseUrl: string,
  apiKey: string
): Promise<N8nResult<{ workflows: N8nWorkflow[]; truncated: boolean }>> {
  const http = client(baseUrl, apiKey);
  const workflows: N8nWorkflow[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < MAX_WORKFLOW_PAGES; page++) {
    const result = await attempt(
      'the workflow list',
      () => http.get('/workflows', { params: { limit: WORKFLOW_PAGE_LIMIT, ...(cursor ? { cursor } : {}) } }),
      data => data as { data?: unknown; nextCursor?: unknown }
    );
    if (!result.ok) return result;

    const rows = Array.isArray(result.data?.data) ? result.data.data : [];
    for (const row of rows) {
      const workflow = toWorkflow(row);
      if (workflow) workflows.push(workflow);
    }
    const next = result.data?.nextCursor;
    if (typeof next !== 'string' || !next) return { ok: true, data: { workflows, truncated: false } };
    cursor = next;
  }
  return { ok: true, data: { workflows, truncated: true } };
}

/** One workflow — the fallback when a listing returned a draft without its published graph. */
export async function getWorkflow(baseUrl: string, apiKey: string, id: string): Promise<N8nResult<N8nWorkflow | null>> {
  return attempt(
    `the workflow ${id}`,
    () => client(baseUrl, apiKey).get(`/workflows/${encodeURIComponent(id)}`),
    toWorkflow
  );
}

/** A workflow's most recent executions, newest first. */
export async function listExecutions(
  baseUrl: string,
  apiKey: string,
  workflowId: string,
  limit = 20
): Promise<N8nResult<N8nExecution[]>> {
  return attempt(
    `the executions of ${workflowId}`,
    () => client(baseUrl, apiKey).get('/executions', { params: { workflowId, limit } }),
    data => {
      const rows = (data as { data?: unknown })?.data;
      return (Array.isArray(rows) ? rows : []).map(toExecution).filter((e): e is N8nExecution => e !== null);
    }
  );
}

/** One execution with its run data, reduced to what a person reads. */
export async function getExecution(
  baseUrl: string,
  apiKey: string,
  executionId: string
): Promise<N8nResult<N8nExecutionDetail | null>> {
  return attempt(
    `the execution ${executionId}`,
    () => client(baseUrl, apiKey).get(`/executions/${encodeURIComponent(executionId)}`, { params: { includeData: true } }),
    toExecutionDetail
  );
}

/**
 * n8n's word for a clean run. One definition, shared by the connector and
 * `taskHealth` — Gemini's #83 was a scorer and a connector disagreeing about
 * exactly this.
 */
export const isN8nSuccessStatus = (status: string): boolean => status === 'success';

/**
 * Still going, or not started: not an outcome yet. `waiting` is a Wait node
 * holding the run open, which can last days and is not a failure.
 */
export const isN8nPendingStatus = (status: string): boolean =>
  status === 'running' || status === 'waiting' || status === 'new';

const SCHEDULE_TYPES: readonly string[] = N8N_SCHEDULE_NODE_TYPES;

/**
 * A node as Cronsole keeps it — parameters only on schedule nodes.
 * Exported for its own test.
 */
export function toNode(raw: unknown): N8nScheduleNode | null {
  const n = (raw ?? {}) as Record<string, unknown>;
  if (typeof n.type !== 'string') return null;
  const node: N8nScheduleNode = {
    name: typeof n.name === 'string' ? n.name : n.type,
    type: n.type,
    ...(n.disabled === true ? { disabled: true } : {})
  };
  if (SCHEDULE_TYPES.includes(n.type) && n.parameters && typeof n.parameters === 'object') {
    node.parameters = n.parameters as Record<string, unknown>;
  }
  return node;
}

function toNodes(raw: unknown): N8nScheduleNode[] {
  return (Array.isArray(raw) ? raw : []).map(toNode).filter((n): n is N8nScheduleNode => n !== null);
}

/** A raw workflow as Cronsole reads it — exported for its own test. */
export function toWorkflow(raw: unknown): N8nWorkflow | null {
  const w = (raw ?? {}) as Record<string, unknown>;
  if (typeof w.id !== 'string' || !w.id) return null;

  const activeVersion = w.activeVersion as { nodes?: unknown } | null | undefined;
  const activeVersionId = typeof w.activeVersionId === 'string' ? w.activeVersionId : null;
  const versionId = typeof w.versionId === 'string' ? w.versionId : null;

  let nodes: N8nScheduleNode[];
  let graph: N8nGraphSource;
  if (activeVersion && Array.isArray(activeVersion.nodes)) {
    nodes = toNodes(activeVersion.nodes);
    graph = 'published';
  } else {
    nodes = toNodes(w.nodes);
    // An instance that predates draft/publish has no version ids at all, and
    // its body is what runs. So does one where nothing is published.
    graph = activeVersionId && versionId && activeVersionId !== versionId ? 'draft-only' : 'body';
  }

  const settings = (w.settings ?? {}) as { timezone?: unknown };
  return {
    id: w.id,
    name: typeof w.name === 'string' && w.name ? w.name : w.id,
    active: w.active === true,
    isArchived: w.isArchived === true,
    timezone: typeof settings.timezone === 'string' && settings.timezone ? settings.timezone : null,
    nodes,
    graph,
    updatedAt: typeof w.updatedAt === 'string' ? w.updatedAt : null,
    tags: (Array.isArray(w.tags) ? w.tags : [])
      .map(t => (t && typeof t === 'object' ? (t as { name?: unknown }).name : t))
      .filter((t): t is string => typeof t === 'string' && t.length > 0)
  };
}

/** Exported for its own test. */
export function toExecution(raw: unknown): N8nExecution | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const id = typeof e.id === 'string' || typeof e.id === 'number' ? String(e.id) : null;
  if (!id) return null;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    id,
    workflowId: typeof e.workflowId === 'string' || typeof e.workflowId === 'number' ? String(e.workflowId) : null,
    // Older instances report only `finished`; fall back to it rather than to a guess.
    status: str(e.status) ?? (e.finished === true ? 'success' : 'unknown'),
    mode: str(e.mode) ?? 'unknown',
    startedAt: str(e.startedAt),
    stoppedAt: str(e.stoppedAt),
    finished: e.finished === true
  };
}

/**
 * Exported for its own test.
 *
 * `steps` comes from `data.resultData.runData`, keyed by node name, each an
 * array of runs with a `startTime`. Ordered by first start, because object key
 * order is insertion order and nothing promises n8n inserts in run order.
 * Only node *names* leave this function — never a node's input or output data.
 */
export function toExecutionDetail(raw: unknown): N8nExecutionDetail | null {
  const base = toExecution(raw);
  if (!base) return null;

  const resultData = ((raw as { data?: { resultData?: unknown } })?.data?.resultData ?? {}) as {
    runData?: unknown;
    error?: { message?: unknown } | null;
    lastNodeExecuted?: unknown;
  };

  const runData = resultData.runData && typeof resultData.runData === 'object'
    ? (resultData.runData as Record<string, unknown>)
    : {};
  const steps = Object.entries(runData)
    .map(([name, runs]) => {
      const first = Array.isArray(runs) ? (runs[0] as { startTime?: unknown } | undefined) : undefined;
      return { name, start: typeof first?.startTime === 'number' ? first.startTime : Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.start - b.start)
    .map(s => s.name);

  return {
    ...base,
    steps,
    errorMessage: typeof resultData.error?.message === 'string' ? resultData.error.message : null,
    lastNodeExecuted: typeof resultData.lastNodeExecuted === 'string' ? resultData.lastNodeExecuted : null
  };
}
