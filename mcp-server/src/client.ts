import axios, { AxiosInstance, isAxiosError } from 'axios';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Thin HTTP client over the Cronsole REST API. The MCP server owns no business
 * logic — every tool is a call through here, so the backend stays the single
 * source of truth (auth scoping, command structuring, agent signing all live
 * server-side). See docs/ROADMAP.md › P3 "MCP server: thin wrapper over routes".
 */

/** A backend error surfaced with the status + message the API actually returned. */
export class CronsoleApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'CronsoleApiError';
  }
}

/** What the HTTP client needs. Deliberately nothing about tool policy. */
export interface CronsoleClientConfig {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
}

/**
 * What the server needs: the client's config plus the tool-surface policy. Kept
 * separate because the HTTP client has no business knowing which tools exist —
 * it would be a field it never reads.
 */
export interface CronsoleServerConfig extends CronsoleClientConfig {
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
/**
 * The environment-variable prefix this project used before the 2026-07-31
 * rename. Assembled from parts on purpose: a bare "TASKHUB" literal here is
 * exactly what a future rename pass would helpfully rewrite, which would turn
 * this fallback into `CRONSOLE_x || CRONSOLE_x` — a tautology that reads
 * correct, still compiles, and silently drops the compatibility it exists to
 * provide. That already happened once, during stage 2 of this very rename, and
 * it took the guarding *test* with it.
 */
const LEGACY_PREFIX = ['TASK', 'HUB'].join('');

/**
 * Read `CRONSOLE_<name>`, falling back to the pre-rename name.
 *
 * The rename would otherwise break every already-configured host at the moment
 * the code changed — the variable lives in the *user's* environment, not in this
 * repo, and on Windows it needs a fresh terminal to even re-read (troubleshooting
 * #8/#8a). A rename that silently invalidates someone's working setup is the same
 * class of failure as any other confident break, so the old name keeps working
 * and says so once.
 */
function env(name: string): string | undefined {
  const current = process.env[`CRONSOLE_${name}`];
  if (current !== undefined && current !== '') return current;

  const legacy = process.env[`${LEGACY_PREFIX}_${name}`];
  if (legacy !== undefined && legacy !== '') {
    if (!warnedLegacy.has(name)) {
      warnedLegacy.add(name);
      console.error(
        `[cronsole] Using ${LEGACY_PREFIX}_${name}; it was renamed to CRONSOLE_${name}. ` +
        'The old name still works — rename it when convenient.'
      );
    }
    return legacy;
  }
  return undefined;
}
const warnedLegacy = new Set<string>();

function resolveFallbackToken(): string | undefined {
  if (process.env.VITEST) return undefined;

  // 1. On Windows, check user environment via registry
  if (process.platform === 'win32') {
    for (const key of ['CRONSOLE_TOKEN', `${LEGACY_PREFIX}_TOKEN`]) {
      try {
        const out = execSync(`reg query HKCU\\Environment /v ${key}`, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 2000
        });
        const match = out.match(new RegExp(`${key}\\s+REG_SZ\\s+(.+)`, 'i'));
        if (match && match[1]?.trim()) {
          const val = match[1].trim();
          if (!UNEXPANDED_PLACEHOLDER.test(val)) {
            console.error(`[cronsole] Resolved ${key} from Windows User environment.`);
            return val;
          }
        }
      } catch {
        // Ignore registry query failure
      }
    }
  }

  // 2. Check .env file in mcp-server or parent directories
  try {
    const searchDirs = [
      process.cwd(),
      fileURLToPath(new URL('..', import.meta.url)),
      fileURLToPath(new URL('../..', import.meta.url))
    ];
    for (const dir of searchDirs) {
      const envPath = resolve(dir, '.env');
      if (existsSync(envPath)) {
        const content = readFileSync(envPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
          const [k, ...v] = trimmed.split('=');
          const varName = k.trim();
          if (varName === 'CRONSOLE_TOKEN' || varName === `${LEGACY_PREFIX}_TOKEN`) {
            let val = v.join('=').trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (val && !UNEXPANDED_PLACEHOLDER.test(val)) {
              console.error(`[cronsole] Resolved ${varName} from ${envPath}.`);
              return val;
            }
          }
        }
      }
    }
  } catch {
    // Ignore fs errors
  }

  return undefined;
}

export function configFromEnv(): CronsoleServerConfig {
  const baseUrl = (env('API_URL') || 'http://localhost:3000/api').replace(/\/+$/, '');
  const rawToken = (env('TOKEN') || '').trim();
  let token = UNEXPANDED_PLACEHOLDER.test(rawToken) ? '' : rawToken;
  if (!token) {
    token = resolveFallbackToken() || '';
  }
  if (!token) {
    throw new Error(
      (rawToken
        ? `CRONSOLE_TOKEN was passed through unexpanded as the literal "${rawToken}", which means the ` +
          'variable is not set in the environment your MCP host was launched from. '
        : 'CRONSOLE_TOKEN is not set. ') +
      'The MCP server needs a user JWT to call the Cronsole API. Export it in the environment ' +
      'you launch the MCP host from — .mcp.json references it as ${CRONSOLE_TOKEN} and never ' +
      'holds the literal secret. See mcp-server/.env.example for how to mint one.'
    );
  }
  const rawTimeout = env('TIMEOUT_MS');
  const timeoutMs = rawTimeout ? Number(rawTimeout) : 15000;
  return { baseUrl, token, timeoutMs, allowDestructive: readAllowDestructive() };
}

/**
 * Opt in to the irreversible tools. Strict on purpose: only an explicit, exact
 * "true"/"1" (case/space-insensitive) opens the gate, so a typo, an empty
 * string, or the unexpanded `${CRONSOLE_MCP_ALLOW_DESTRUCTIVE}` literal all fail
 * CLOSED. The asymmetry is intentional — a false negative costs a missing tool
 * and an obvious error message, while a false positive hands an agent a deletion
 * verb the user never meant to grant.
 */
function readAllowDestructive(): boolean {
  const raw = (env('MCP_ALLOW_DESTRUCTIVE') || '').trim().toLowerCase();
  return raw === 'true' || raw === '1';
}

export class CronsoleClient {
  private readonly http: AxiosInstance;

  constructor(config: CronsoleClientConfig) {
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
   * Turn an Axios failure into a CronsoleApiError that carries the backend's own
   * honest error message and status (the API returns `{ error }` or `{ message,
   * warnings }`), so the MCP caller sees "Task not found" rather than a raw
   * "Request failed with status code 404".
   */
  private normalizeError(err: unknown): CronsoleApiError {
    if (isAxiosError(err)) {
      if (err.response) {
        const status = err.response.status;
        const data = this.decodeErrorBody(err.response.data);
        const message =
          data?.error ||
          data?.message ||
          `Cronsole API returned HTTP ${status}`;
        return new CronsoleApiError(message, status, data ?? err.response.data);
      }
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        return new CronsoleApiError(
          `Could not reach the Cronsole backend at ${this.http.defaults.baseURL} (${err.code}). ` +
          'Is the backend running, and is CRONSOLE_API_URL correct?'
        );
      }
      return new CronsoleApiError(err.message);
    }
    return new CronsoleApiError(err instanceof Error ? err.message : String(err));
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
