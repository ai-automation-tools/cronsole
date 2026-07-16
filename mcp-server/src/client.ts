import axios, { AxiosInstance, isAxiosError } from 'axios';

/**
 * Thin HTTP client over the TaskHub REST API. The MCP server owns no business
 * logic — every tool is a call through here, so the backend stays the single
 * source of truth (auth scoping, command structuring, agent signing all live
 * server-side). See docs/ROADMAP.md › P3 "MCP server: thin wrapper over routes".
 */

/** A backend error surfaced with the status + message the API actually returned. */
export class TaskHubApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'TaskHubApiError';
  }
}

/** What the HTTP client needs. Deliberately nothing about tool policy. */
export interface TaskHubClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

/**
 * What the server needs: the client's config plus the tool-surface policy. Kept
 * separate because the HTTP client has no business knowing which tools exist —
 * it would be a field it never reads.
 */
export interface TaskHubServerConfig extends TaskHubClientConfig {
  /**
   * Whether the irreversible tools (delete_task) are registered at all. Off by
   * default: an MCP host may call a tool with far less deliberation than a user
   * clicking through the UI's confirm dialog, and the agent that carries the
   * deletion out runs elevated.
   *
   * This is deliberately an ENV setting rather than a tool parameter. A
   * `confirm: true` argument is not a gate — the model fills it in itself, so it
   * is the caller asserting to itself that it is sure. An env var is out-of-band:
   * the human sets it, and no amount of agent reasoning reaches it.
   */
  allowDestructive: boolean;
}

/**
 * An `${VAR}` / `${VAR:-default}` that the MCP host never expanded. Claude Code
 * documents that an unset variable referenced from `.mcp.json` is passed through
 * as its *literal* text, so a bare emptiness check isn't enough: the literal is
 * non-empty, sails past the guard, and the backend rejects it as `403 Invalid or
 * expired token` — which reads as an expired JWT and sends you debugging auth
 * instead of your config. Treat it as unset.
 */
const UNEXPANDED_PLACEHOLDER = /^\$\{[^}]*\}$/;

/**
 * Read config from the environment and fail fast with an actionable message if
 * it's missing — an MCP server that boots without credentials would only fail
 * later, one confusing tool call at a time.
 */
export function configFromEnv(): TaskHubServerConfig {
  const baseUrl = (process.env.TASKHUB_API_URL || 'http://localhost:3000/api').replace(/\/+$/, '');
  const rawToken = (process.env.TASKHUB_TOKEN || '').trim();
  const token = UNEXPANDED_PLACEHOLDER.test(rawToken) ? '' : rawToken;
  if (!token) {
    throw new Error(
      (rawToken
        ? `TASKHUB_TOKEN was passed through unexpanded as the literal "${rawToken}", which means the ` +
          'variable is not set in the environment your MCP host was launched from. '
        : 'TASKHUB_TOKEN is not set. ') +
      'The MCP server needs a user JWT to call the TaskHub API. Export it in the environment ' +
      'you launch the MCP host from — .mcp.json references it as ${TASKHUB_TOKEN} and never ' +
      'holds the literal secret. See mcp-server/.env.example for how to mint one.'
    );
  }
  const timeoutMs = process.env.TASKHUB_TIMEOUT_MS
    ? Number(process.env.TASKHUB_TIMEOUT_MS)
    : 15000;
  return { baseUrl, token, timeoutMs, allowDestructive: readAllowDestructive() };
}

/**
 * Opt in to the irreversible tools. Strict on purpose: only an explicit, exact
 * "true"/"1" (case/space-insensitive) opens the gate, so a typo, an empty
 * string, or the unexpanded `${TASKHUB_MCP_ALLOW_DESTRUCTIVE}` literal all fail
 * CLOSED. The asymmetry is intentional — a false negative costs a missing tool
 * and an obvious error message, while a false positive hands an agent a deletion
 * verb the user never meant to grant.
 */
function readAllowDestructive(): boolean {
  const raw = (process.env.TASKHUB_MCP_ALLOW_DESTRUCTIVE || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export class TaskHubClient {
  private readonly http: AxiosInstance;

  constructor(config: TaskHubClientConfig) {
    this.http = axios.create({
      baseURL: config.baseUrl,
      timeout: config.timeoutMs ?? 15000,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json'
      }
    });
  }

  async get<T = unknown>(path: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>('get', path, undefined, params);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('post', path, body);
  }

  async patch<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('patch', path, body);
  }

  async delete<T = unknown>(path: string): Promise<T> {
    return this.request<T>('delete', path);
  }

  /**
   * GET a response as raw bytes, for a route whose body is not JSON or UTF-8.
   *
   * `GET /tasks/:id/export` is the reason this exists: a Windows task exports as
   * Task Scheduler XML delivered **UTF-16 LE + BOM**, because that is the only
   * encoding every Windows re-import path accepts (a UTF-8 declaration is
   * rejected outright with "unable to switch the encoding"). Axios would decode
   * those bytes as UTF-8 and hand back mojibake, so the caller needs the buffer
   * and decodes it itself.
   */
  async getBuffer(path: string): Promise<{ data: Buffer; contentType: string }> {
    try {
      const res = await this.http.request<ArrayBuffer>({
        method: 'get',
        url: path,
        responseType: 'arraybuffer'
      });
      return {
        data: Buffer.from(res.data),
        contentType: String(res.headers['content-type'] ?? '')
      };
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  private async request<T>(
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: unknown,
    params?: Record<string, unknown>
  ): Promise<T> {
    try {
      const res = await this.http.request<T>({ method, url: path, data: body, params });
      return res.data;
    } catch (err) {
      throw this.normalizeError(err);
    }
  }

  /**
   * Turn an Axios failure into a TaskHubApiError that carries the backend's own
   * honest error message and status (the API returns `{ error }` or `{ message,
   * warnings }`), so the MCP caller sees "Task not found" rather than a raw
   * "Request failed with status code 404".
   */
  private normalizeError(err: unknown): TaskHubApiError {
    if (isAxiosError(err)) {
      if (err.response) {
        const status = err.response.status;
        const data = this.decodeErrorBody(err.response.data);
        const message =
          data?.error ||
          data?.message ||
          `TaskHub API returned HTTP ${status}`;
        return new TaskHubApiError(message, status, data ?? err.response.data);
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new TaskHubApiError(
          `Could not reach the TaskHub backend at ${this.http.defaults.baseURL} (${err.code}). ` +
          'Is the backend running, and is TASKHUB_API_URL correct?'
        );
      }
      return new TaskHubApiError(err.message);
    }
    return new TaskHubApiError(err instanceof Error ? err.message : String(err));
  }

  /**
   * Recover the API's `{ error }` body regardless of how axios decoded it.
   *
   * A failed `getBuffer` request carries its error body as raw BYTES, because
   * responseType is per-request and applies to the error path too. Reading
   * `data.error` off a Buffer yields undefined, so the honest backend message
   * ("Task not found", "The agent could not export this task") would be replaced
   * by a generic "HTTP 502" — the client would lose exactly the thing it exists
   * to preserve. Anything undecodable falls through to null and the caller's
   * status-based fallback.
   */
  private decodeErrorBody(raw: unknown): { error?: string; message?: string } | null {
    if (raw === null || raw === undefined) return null;
    if (Buffer.isBuffer(raw) || raw instanceof ArrayBuffer) {
      try {
        return JSON.parse(Buffer.from(raw as Buffer).toString('utf8'));
      } catch {
        return null;
      }
    }
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    if (typeof raw === 'object') return raw as { error?: string; message?: string };
    return null;
  }
}
