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

export interface TaskHubClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
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
export function configFromEnv(): TaskHubClientConfig {
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
  return { baseUrl, token, timeoutMs };
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

  private async request<T>(
    method: 'get' | 'post',
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
        const data = err.response.data as { error?: string; message?: string } | undefined;
        const message =
          data?.error ||
          data?.message ||
          `TaskHub API returned HTTP ${status}`;
        return new TaskHubApiError(message, status, err.response.data);
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
}
