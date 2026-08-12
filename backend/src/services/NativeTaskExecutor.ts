import axios from 'axios';
import { spawn } from 'node:child_process';

/**
 * What a Cronsole-native task *does*. Two job types, discriminated on `jobType`.
 *
 * `HTTP` calls an endpoint. `EXEC` runs a program — added 2026-08-12, because
 * native could previously only ping a URL, which made the one source Cronsole
 * fully owns useless for the most ordinary scheduled task there is.
 */
export type NativeJob = HttpJob | ExecJob;

export interface HttpJob {
  jobType: 'HTTP';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Run a program. **Never a shell.**
 *
 * `executable` + `args[]` is the same `StructuredAction` shape the Windows
 * connector registers (see `utils/commandParser.ts`), and for the same P0 reason:
 * a value can at worst become a malformed argument to the *intended* program, and
 * can never launch a second process. A job that genuinely needs pipes or
 * redirection names its shell explicitly — `{executable: 'cmd.exe', args: ['/c',
 * '…']}` — which keeps the shell command as one argument rather than an implicit
 * wrapper around everything.
 */
export interface ExecJob {
  jobType: 'EXEC';
  executable: string;
  args?: string[];
  workingDirectory?: string;
  /**
   * Extra environment for the child. **Added to a minimal base, never to
   * Cronsole's own environment** — see `childEnv`.
   */
  env?: Record<string, string>;
  /** Hard kill after this long. Defaults to 5 min, capped at 60. */
  timeoutMs?: number;
}

export interface NativeRunResult {
  success: boolean;
  log: string;
  durationMs: number;
}

const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

/** An HTTP body is usually incidental to the status code. */
const LOG_SNIPPET_LENGTH = 500;
/**
 * A script's output *is* the result, not context for it — so exec keeps more.
 * `ExecutionLog.log` is `@db.Text`, so this costs nothing structural.
 */
const EXEC_LOG_LENGTH = 2000;
/** Ceiling on what is held in memory while a chatty script runs. */
const EXEC_CAPTURE_BYTES = 64 * 1024;

export const DEFAULT_EXEC_TIMEOUT_MS = 5 * 60_000;
export const MAX_EXEC_TIMEOUT_MS = 60 * 60_000;

/**
 * Environment variables a child process is allowed to inherit.
 *
 * **The default is to inherit nothing.** `process.env` in this backend holds
 * `DATABASE_URL`, `JWT_SECRET` and the AES key that encrypts every
 * `PlatformConnection.config` — so a scheduled script that ran `env` and posted
 * the result somewhere would exfiltrate the key protecting every platform
 * credential the user has stored. Passing the parent environment is the obvious
 * default and it is the wrong one; the whole point of encrypting config at rest
 * is defeated by handing the key to a task the same UI creates.
 *
 * So the child gets an allowlist of variables an OS needs to run a program at
 * all, plus whatever the job spec sets explicitly. A job that needs a secret
 * passes it in `env` deliberately, which is a decision someone made rather than
 * an inheritance nobody noticed.
 */
const ENV_ALLOWLIST = [
  // Windows
  'PATH', 'PATHEXT', 'SystemRoot', 'windir', 'SystemDrive', 'COMSPEC',
  'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA',
  'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'OS', 'PROCESSOR_ARCHITECTURE',
  // POSIX
  'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'USER', 'LOGNAME'
];

/** Build the child's environment: allowlisted OS basics + the job's own vars. */
export function childEnv(jobEnv?: Record<string, string>): NodeJS.ProcessEnv {
  const allow = new Set(ENV_ALLOWLIST.map(k => k.toLowerCase()));
  const env: NodeJS.ProcessEnv = {};
  // Case-insensitive match: Windows spells these inconsistently (`Path`, `PATH`,
  // `windir`, `WINDIR`) and dropping one silently makes the executable unfindable.
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && allow.has(key.toLowerCase())) env[key] = value;
  }
  return { ...env, ...(jobEnv ?? {}) };
}

/**
 * Validates a job spec from client input / task metadata.
 * Returns an error message, or null if valid.
 */
export function validateJob(job: unknown): string | null {
  if (!job || typeof job !== 'object') return 'Missing job spec';
  const j = job as Record<string, unknown>;

  if (j.jobType === 'HTTP') {
    if (typeof j.url !== 'string' || !/^https?:\/\//i.test(j.url)) {
      return 'Job url must start with http:// or https://';
    }
    if (j.method !== undefined && !ALLOWED_METHODS.includes(String(j.method).toUpperCase())) {
      return `Job method must be one of ${ALLOWED_METHODS.join(', ')}`;
    }
    return null;
  }

  if (j.jobType === 'EXEC') {
    if (typeof j.executable !== 'string' || !j.executable.trim()) {
      return 'Job executable is required';
    }
    if (j.args !== undefined) {
      if (!Array.isArray(j.args) || j.args.some(a => typeof a !== 'string')) {
        return 'Job args must be an array of strings';
      }
    }
    if (j.workingDirectory !== undefined && typeof j.workingDirectory !== 'string') {
      return 'Job workingDirectory must be a string';
    }
    if (j.env !== undefined) {
      const env = j.env as Record<string, unknown>;
      if (typeof env !== 'object' || env === null || Array.isArray(env)) {
        return 'Job env must be an object of string values';
      }
      if (Object.values(env).some(v => typeof v !== 'string')) {
        return 'Job env values must be strings';
      }
    }
    if (j.timeoutMs !== undefined) {
      const t = Number(j.timeoutMs);
      if (!Number.isFinite(t) || t <= 0 || t > MAX_EXEC_TIMEOUT_MS) {
        return `Job timeoutMs must be between 1 and ${MAX_EXEC_TIMEOUT_MS}`;
      }
    }
    return null;
  }

  return `Unsupported jobType: ${j.jobType}`;
}

/** Executes a Cronsole-native job (docs/resources/Native_Tasks.md). */
export async function executeJob(job: NativeJob): Promise<NativeRunResult> {
  const invalid = validateJob(job);
  if (invalid) {
    return { success: false, log: invalid, durationMs: 0 };
  }
  return job.jobType === 'EXEC' ? executeExec(job) : executeHttp(job);
}

async function executeHttp(job: HttpJob): Promise<NativeRunResult> {
  const method = (job.method ?? 'GET').toUpperCase();
  const startedAt = Date.now();
  try {
    const response = await axios.request({
      url: job.url,
      method,
      headers: job.headers,
      data: job.body || undefined,
      timeout: 15000,
      // Treat any HTTP response as a completed request; status is judged below.
      validateStatus: () => true
    });

    const snippet = typeof response.data === 'string'
      ? response.data.slice(0, LOG_SNIPPET_LENGTH)
      : JSON.stringify(response.data)?.slice(0, LOG_SNIPPET_LENGTH);
    const success = response.status >= 200 && response.status < 300;

    return {
      success,
      log: `${method} ${job.url} → ${response.status}${snippet ? ` | ${snippet}` : ''}`,
      durationMs: Date.now() - startedAt
    };
  } catch (error: any) {
    return {
      success: false,
      log: `${method} ${job.url} failed: ${error.message}`,
      durationMs: Date.now() - startedAt
    };
  }
}

/**
 * Run the program and report what actually happened.
 *
 * Unlike a Windows run — where `SUCCESS` only means the agent accepted a start —
 * this is a real verdict: the process ran here, in this process tree, and its
 * exit code is the outcome. That is Cronsole-native's genuine advantage, and the
 * reason the output is worth keeping.
 */
function executeExec(job: ExecJob): Promise<NativeRunResult> {
  const startedAt = Date.now();
  const args = job.args ?? [];
  const timeoutMs = Math.min(job.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS);
  const label = [job.executable, ...args].join(' ');

  return new Promise<NativeRunResult>(resolve => {
    let output = '';
    let truncated = false;
    let timedOut = false;
    let settled = false;

    const capture = (chunk: Buffer) => {
      if (output.length >= EXEC_CAPTURE_BYTES) {
        truncated = true;
        return;
      }
      output += chunk.toString('utf8');
      if (output.length > EXEC_CAPTURE_BYTES) {
        output = output.slice(0, EXEC_CAPTURE_BYTES);
        truncated = true;
      }
    };

    const done = (result: NativeRunResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const tail = () => {
      const text = output.trim().slice(0, EXEC_LOG_LENGTH);
      const more = truncated || output.trim().length > EXEC_LOG_LENGTH ? ' …(truncated)' : '';
      return text ? ` | ${text}${more}` : '';
    };

    let child;
    try {
      child = spawn(job.executable, args, {
        cwd: job.workingDirectory || undefined,
        env: childEnv(job.env),
        // The P0 guarantee, restated at the call site: no shell, ever. With
        // `shell: false` the args array is passed through as discrete argv
        // entries, so a value cannot be re-parsed into another command.
        shell: false,
        windowsHide: true,
        timeout: timeoutMs
      });
    } catch (error: any) {
      // spawn can throw synchronously on a malformed executable path.
      return done({
        success: false,
        log: `${label} could not start: ${error.message}`,
        durationMs: Date.now() - startedAt
      });
    }

    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    child.on('error', (error: any) => {
      // ENOENT is the common one and deserves a better sentence than the raw
      // message: "spawn foo ENOENT" does not tell a user their PATH is the issue.
      const reason = error?.code === 'ENOENT'
        ? `executable not found (checked PATH: ${process.env.PATH ? 'set' : 'empty'})`
        : error?.message ?? 'unknown error';
      done({
        success: false,
        log: `${label} could not start: ${reason}`,
        durationMs: Date.now() - startedAt
      });
    });

    child.on('close', (code, signal) => {
      // Node reports a timeout kill as a signal, not as a distinct event, so the
      // two are told apart here — "killed after 5m" and "died on SIGTERM" are
      // different facts and only one of them is Cronsole's doing.
      if (signal && timedOut) {
        return done({
          success: false,
          log: `${label} timed out after ${Math.round(timeoutMs / 1000)}s and was killed${tail()}`,
          durationMs: Date.now() - startedAt
        });
      }
      if (signal) {
        return done({
          success: false,
          log: `${label} terminated on ${signal}${tail()}`,
          durationMs: Date.now() - startedAt
        });
      }
      done({
        success: code === 0,
        log: `${label} → exit ${code}${tail()}`,
        durationMs: Date.now() - startedAt
      });
    });

    // `timeout` on spawn fires the kill; this only records *why* the signal came,
    // so the close handler above can say "timed out" instead of "terminated".
    const timer = setTimeout(() => { timedOut = true; }, timeoutMs);
    timer.unref?.();
    child.on('close', () => clearTimeout(timer));
  });
}
