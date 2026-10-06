import axios from 'axios';
import { normalizeBaseUrl, type N8nResult } from './n8nApi.js';

/**
 * **n8n's instance-level MCP server — the one door that starts a workflow.**
 *
 * The public REST API (`services/n8nApi.ts`) has no execute endpoint, and that
 * is still true. What n8n added instead (1.121, *Enable MCP Access*) is a
 * Model Context Protocol server at `{base}/mcp-server/http` whose
 * `execute_workflow` tool runs a workflow's **published** version through its
 * **Schedule Trigger** in `production` mode. That is the scheduled invocation —
 * same graph, same trigger node, recorded by n8n on the workflow's own
 * execution list — which is exactly what a webhook call is not, and the reason
 * `run` was refused until now.
 *
 * This file speaks just enough of the protocol to call that one tool: a
 * streamable-HTTP JSON-RPC session (`initialize` → `notifications/initialized`
 * → `tools/call`), closed afterwards. No SDK — the backend has none, and three
 * requests do not earn a dependency. **Every function here is a tool call on
 * the user's own instance, authenticated by a token they generated for this.**
 *
 * The server answers a request as plain JSON or as a one-message SSE stream,
 * at its discretion, so both are read.
 */

/** Path n8n serves its instance MCP server on, relative to the instance root. */
export const N8N_MCP_PATH = '/mcp-server/http';

/** The protocol revision this client speaks. */
const PROTOCOL_VERSION = '2025-06-18';

/** `execute_workflow` returns as soon as the run is started, so a long wait is a transport failure. */
const REQUEST_TIMEOUT_MS = 20_000;

/** The tool `run` depends on; `verifyMcpToken` checks it is served. */
export const EXECUTE_TOOL = 'execute_workflow';

export interface N8nMcpExecution {
  /** n8n's execution id, or null when the run could not be started. */
  executionId: string | null;
  status: 'started' | 'error';
  /** n8n's own sentence when `status` is `error`. */
  error?: string;
}

type JsonRpcResponse = {
  id?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** One short-lived session: a handle to the server, and the session id it hands back. */
class McpSession {
  private sessionId: string | null = null;
  private nextId = 1;
  private readonly url: string;

  constructor(baseUrl: string, private readonly token: string) {
    this.url = `${normalizeBaseUrl(baseUrl)}${N8N_MCP_PATH}`;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': PROTOCOL_VERSION,
      'User-Agent': 'Cronsole',
      ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {})
    };
  }

  /** Send one JSON-RPC message. A notification (no `id`) expects no reply. */
  private async post(body: Record<string, unknown>, what: string): Promise<N8nResult<JsonRpcResponse | null>> {
    let response;
    try {
      response = await axios.post(this.url, body, {
        headers: this.headers(),
        timeout: REQUEST_TIMEOUT_MS,
        responseType: 'text',
        transformResponse: [v => v],
        validateStatus: () => true
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, status: null, message: `Could not reach n8n's MCP server for ${what}: ${message}` };
    }

    const sessionHeader = response.headers['mcp-session-id'];
    if (typeof sessionHeader === 'string' && sessionHeader) this.sessionId = sessionHeader;

    if (response.status < 200 || response.status >= 300) {
      return { ok: false, status: response.status, message: describeHttpError(response.status, String(response.data ?? ''), what) };
    }
    if (body.id === undefined) return { ok: true, data: null };

    const parsed = readJsonRpc(String(response.data ?? ''), response.headers['content-type'], body.id);
    if (!parsed) {
      return { ok: false, status: response.status, message: `n8n's MCP server answered ${what} with something that is not a JSON-RPC response.` };
    }
    if (parsed.error) {
      return { ok: false, status: response.status, message: `n8n's MCP server refused ${what}: ${parsed.error.message ?? `error ${parsed.error.code ?? ''}`.trim()}` };
    }
    return { ok: true, data: parsed };
  }

  async initialize(): Promise<N8nResult<true>> {
    const init = await this.post(
      {
        jsonrpc: '2.0',
        id: this.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'cronsole', version: '1' }
        }
      },
      'the MCP handshake'
    );
    if (!init.ok) return init;
    const done = await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, 'the MCP handshake');
    if (!done.ok) return done;
    return { ok: true, data: true };
  }

  async request(method: string, params: Record<string, unknown>, what: string): Promise<N8nResult<unknown>> {
    const reply = await this.post({ jsonrpc: '2.0', id: this.nextId++, method, params }, what);
    if (!reply.ok) return reply;
    return { ok: true, data: reply.data?.result };
  }

  /** Best effort: a server that keeps sessions should not keep this one. */
  async close(): Promise<void> {
    if (!this.sessionId) return;
    try {
      await axios.delete(this.url, { headers: this.headers(), timeout: 5_000, validateStatus: () => true });
    } catch {
      // The session expires on its own; nothing to report.
    }
  }
}

/**
 * Pull the JSON-RPC response with this `id` out of the body — a plain JSON
 * document, or an SSE stream of `data:` lines. Exported for its test.
 */
export function readJsonRpc(body: string, contentType: unknown, id: unknown): JsonRpcResponse | null {
  const isStream = typeof contentType === 'string' && /text\/event-stream/i.test(contentType);
  const candidates = isStream ? sseDataBlocks(body) : [body];
  for (const text of candidates) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const messages = Array.isArray(parsed) ? parsed : [parsed];
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue;
      const m = message as JsonRpcResponse;
      if (m.id === id && ('result' in m || 'error' in m)) return m;
    }
  }
  return null;
}

/** Each SSE event's `data:` lines joined, in order. */
function sseDataBlocks(body: string): string[] {
  const blocks: string[] = [];
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, ''));
    if (data.length) blocks.push(data.join('\n'));
  }
  return blocks;
}

function describeHttpError(status: number, body: string, what: string): string {
  const snippet = body.trim().slice(0, 160);
  switch (status) {
    case 401:
      return (
        'n8n rejected the MCP access token (401). Generate one under Settings › MCP access in n8n and paste it ' +
        'in full — it is shown once.'
      );
    case 403:
      return (
        `n8n refused ${what} (403${snippet ? `: ${snippet}` : ''}). Check that MCP access is enabled for the ` +
        'instance (Settings › MCP access) and that the token belongs to this instance.'
      );
    case 404:
      return (
        `n8n has no MCP server at ${N8N_MCP_PATH} (404). Instance-level MCP access needs n8n 1.121 or newer ` +
        'and the Enable MCP Access switch turned on under Settings.'
      );
    case 429:
      return 'n8n rate limit reached (429) on the MCP server. Try again in a moment.';
    default:
      return `n8n's MCP server answered ${status} for ${what}${snippet ? `: ${snippet}` : '.'}`;
  }
}

/**
 * The connect-time check: a handshake and a tool listing, so a bad paste fails
 * at the click. Succeeds only when `execute_workflow` is actually served —
 * a token for a server without it would store a promise `run` cannot keep.
 */
export async function verifyMcpToken(baseUrl: string, token: string): Promise<N8nResult<true>> {
  const session = new McpSession(baseUrl, token);
  try {
    const init = await session.initialize();
    if (!init.ok) return init;
    const listed = await session.request('tools/list', {}, 'the tool list');
    if (!listed.ok) return listed;
    const tools = (listed.data as { tools?: { name?: unknown }[] } | undefined)?.tools;
    const names = Array.isArray(tools) ? tools.map(t => t?.name).filter((n): n is string => typeof n === 'string') : [];
    if (!names.includes(EXECUTE_TOOL)) {
      return {
        ok: false,
        status: 200,
        message:
          `n8n's MCP server is reachable but does not offer ${EXECUTE_TOOL}` +
          (names.length ? ` (it offers: ${names.join(', ')})` : '') +
          '. Workflow execution over MCP needs a newer n8n, or the feature is turned off on this instance.'
      };
    }
    return { ok: true, data: true };
  } finally {
    await session.close();
  }
}

/**
 * Start a workflow's published version through its own trigger.
 *
 * `triggerNodeName` picks the trigger when the workflow has several (n8n
 * 2.36+); omitted, n8n runs the one eligible trigger or refuses naming them.
 * `error` on the result is n8n's refusal, e.g. an unpublished workflow or a
 * trigger that needs input — a refusal, not a transport failure.
 */
export async function executeWorkflow(
  baseUrl: string,
  token: string,
  workflowId: string,
  triggerNodeName?: string
): Promise<N8nResult<N8nMcpExecution>> {
  const session = new McpSession(baseUrl, token);
  try {
    const init = await session.initialize();
    if (!init.ok) return init;
    const called = await session.request(
      'tools/call',
      {
        name: EXECUTE_TOOL,
        arguments: {
          workflowId,
          executionMode: 'production',
          ...(triggerNodeName ? { triggerNodeName } : {})
        }
      },
      'the run'
    );
    if (!called.ok) return called;
    return readExecution(called.data);
  } finally {
    await session.close();
  }
}

/** The tool's answer: `structuredContent` when present, else the first JSON text block. Exported for its test. */
export function readExecution(result: unknown): N8nResult<N8nMcpExecution> {
  const r = (result && typeof result === 'object' ? result : {}) as {
    isError?: unknown;
    structuredContent?: unknown;
    content?: { type?: unknown; text?: unknown }[];
  };
  const texts = Array.isArray(r.content)
    ? r.content.filter(c => c?.type === 'text' && typeof c.text === 'string').map(c => c.text as string)
    : [];

  let payload: unknown = r.structuredContent;
  if (payload === undefined) {
    for (const text of texts) {
      try {
        payload = JSON.parse(text);
        break;
      } catch {
        // Not JSON; the next block may be.
      }
    }
  }

  if (r.isError === true) {
    const said = texts.join(' ').trim();
    return { ok: false, status: 200, message: `n8n refused the run${said ? `: ${said}` : '.'}` };
  }

  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const executionId = typeof p.executionId === 'string' && p.executionId ? p.executionId : null;
  const status = p.status === 'started' ? 'started' : 'error';
  const error = typeof p.error === 'string' && p.error ? p.error : undefined;
  if (status === 'error' || (!executionId && payload === undefined)) {
    return {
      ok: true,
      data: { executionId: null, status: 'error', error: error ?? (texts.join(' ').trim() || 'n8n did not say why.') }
    };
  }
  return { ok: true, data: { executionId, status: 'started' } };
}
