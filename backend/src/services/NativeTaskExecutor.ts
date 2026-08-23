import axios from 'axios';
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { mkdtemp, writeFile, rm, stat, statfs } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasSecretRef,
  illegalSecretRef,
  missingSecretRefs,
  redactSecrets,
  resolveJobSecrets
} from './jobSecrets.js';

/**
 * What a Cronsole-native task *does*. Four job types, discriminated on `jobType`.
 *
 * `HTTP` calls an endpoint. `EXEC` runs a program — added 2026-08-12, because
 * native could previously only ping a URL, which made the one source Cronsole
 * fully owns useless for the most ordinary scheduled task there is. `SCRIPT` and
 * `CHECK` landed 2026-08-15 (ADR 0002).
 *
 * The two newer types exist for reasons the older two could not cover:
 *
 * - **`SCRIPT`** carries the script *body*. `EXEC` can only name a file that
 *   already exists on the backend host — which on a Dockerized stack is a
 *   filesystem the user cannot see — so the most important half of the task was
 *   the half Cronsole could not show, back up, or ship as a template.
 * - **`CHECK`** is the only type whose *failure means something*. An `EXEC`
 *   failure is a bug in your script; a `CHECK` failure is a fact about your
 *   system, which is what the failure notifications, health tiers and the
 *   *Failures* view were all built to carry.
 */
export type NativeJob = HttpJob | ExecJob | ScriptJob | CheckJob;

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

/**
 * Run a script Cronsole is holding the text of.
 *
 * **`interpreter` is a fixed enum, not a path.** That is the whole guarantee of
 * this type. `EXEC` lets you name any program because you are naming a program;
 * here the free-form part is the *body*, so if the interpreter were free-form too
 * this would just be `EXEC` with an extra step — and it would lose the one thing
 * that makes running a shell here legitimate.
 *
 * Because it *is* a shell (a `bash` body is shell script by definition), the
 * no-shell rule is not being bent: that rule bans an **implicit** shell, where a
 * command string is silently wrapped in `cmd /c` and a value can become a second
 * process. Here the user names the interpreter and writes the body, so there is
 * nothing implicit and nothing re-parsed. Cronsole owns the argv (see
 * `SCRIPT_INTERPRETERS`); the caller never supplies it.
 */
export interface ScriptJob {
  jobType: 'SCRIPT';
  interpreter: ScriptInterpreter;
  /** The script text itself. Stored in the database — this is the point. */
  body: string;
  workingDirectory?: string;
  /** Extra environment. Added to a minimal base, never to Cronsole's — `childEnv`. */
  env?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Measure something and compare it to an expectation.
 *
 * **One job type, several probes, and that is deliberate.** Every probe is the
 * same kind of thing to navigate to — "the checks I'm running" — and each one
 * promoted to its own `jobType` would spend a permanent source-rail row on a
 * distinction nobody browses by. `STRUCTURAL_SUBTYPES` lists native's subtypes
 * whether or not any task uses one, so type count is navigation cost.
 */
export interface CheckJob {
  jobType: 'CHECK';
  probe: CheckProbe;
}

export type CheckProbe = HttpProbe | TcpProbe | FileFreshProbe | DiskFreeProbe;

/**
 * An HTTP request with an *assertion*, which is what separates it from `HTTP`.
 *
 * The split is intent, not capability. An `HTTP` job **does** something — fires a
 * webhook, pokes a deploy hook — and "the endpoint accepted it" really is the
 * honest success criterion for that. A `CHECK` **verifies** something, so a 200
 * serving an error page has to be able to fail.
 */
export interface HttpProbe {
  kind: 'http';
  url: string;
  method?: string;
  headers?: Record<string, string>;
  /** Acceptable status range. Defaults to 200–299. */
  expectStatus?: { min: number; max: number };
  /** Case-sensitive substring the body must contain. */
  expectBodyContains?: string;
  /** A dotted path into a JSON body, and what it must equal (compared as text). */
  expectJsonPath?: { path: string; equals: string };
}

/** Can something accept a TCP connection? The cheapest "is it up" there is. */
export interface TcpProbe {
  kind: 'tcp';
  host: string;
  port: number;
}

/**
 * A dead-man switch: has this file been written recently enough?
 *
 * Fails when a *backup* stops running, which is the failure that is otherwise
 * silent — nothing errors, the file simply stops changing.
 */
export interface FileFreshProbe {
  kind: 'fileFresh';
  path: string;
  maxAgeMinutes: number;
}

export interface DiskFreeProbe {
  kind: 'diskFree';
  path: string;
  minFreeBytes: number;
}

export interface NativeRunResult {
  success: boolean;
  log: string;
  durationMs: number;
  /**
   * Whether the job actually executed, making `success` a verdict about the
   * user's system rather than a failure to start. Only `validateJob` rejecting
   * the spec returns `false` — past that point something ran, even if it ran
   * badly (a missing interpreter reports `ENOENT` as a failed run, which is the
   * honest answer: the spec was runnable, this machine could not run it).
   *
   * The route reads it to decide 200-with-a-verdict vs 502; see the table on
   * `PlatformConnector.runTask` and troubleshooting #59.
   */
  ran: boolean;
}

/**
 * What one executor returns. `ran` is stamped by `executeJob` rather than by each
 * executor, so a fifth job type cannot ship having forgotten it — the only way to
 * reach an executor at all is through the branch that sets it.
 */
type ExecutedRunResult = Omit<NativeRunResult, 'ran'>;

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

/** A probe measures something; it should not sit on a socket for minutes doing it. */
export const CHECK_TIMEOUT_MS = 15_000;

/**
 * The interpreters a `SCRIPT` job may name, and the **exact argv Cronsole runs
 * them with**. The caller supplies the body and nothing else.
 *
 * Two entries here are load-bearing rather than stylistic:
 *
 * - **`-NoProfile`** on both PowerShells. Without it the user's profile script
 *   runs first, so what the task does depends on a file nobody thinks of as part
 *   of the task — and it differs between the machine they tested on and the one
 *   the backend runs on.
 * - **The extension.** PowerShell refuses to `-File` anything that is not `.ps1`,
 *   and `python` will happily run a `.txt` but reports errors against a filename
 *   that tells the user nothing. It is part of the contract, not decoration.
 *
 * `node` is here because it is the one interpreter guaranteed to exist wherever
 * this code is running — the backend *is* Node — which makes it the honest
 * default on a Dockerized stack where PowerShell is not installed.
 */
export const SCRIPT_INTERPRETERS = {
  powershell: {
    label: 'PowerShell (Windows)',
    executable: 'powershell',
    extension: '.ps1',
    args: (file: string) => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file]
  },
  pwsh: {
    label: 'PowerShell 7 (pwsh)',
    executable: 'pwsh',
    extension: '.ps1',
    args: (file: string) => ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file]
  },
  bash: { label: 'Bash', executable: 'bash', extension: '.sh', args: (file: string) => [file] },
  sh: { label: 'sh', executable: 'sh', extension: '.sh', args: (file: string) => [file] },
  python: { label: 'Python', executable: 'python', extension: '.py', args: (file: string) => [file] },
  node: { label: 'Node.js', executable: 'node', extension: '.js', args: (file: string) => [file] }
} as const;

export type ScriptInterpreter = keyof typeof SCRIPT_INTERPRETERS;

export const SCRIPT_INTERPRETER_KEYS = Object.keys(SCRIPT_INTERPRETERS) as ScriptInterpreter[];

/** A script body is content, not a command line; the cap is generous but real. */
export const MAX_SCRIPT_BODY_BYTES = 256 * 1024;

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
 * A URL field is legal when it is a URL **or** when a secret will make it one.
 *
 * A whole webhook URL is frequently the credential — that is the `NOTIFY` case
 * ADR 0002 deferred — so `${secret.WEBHOOK}` has to be storable in a `url`. The
 * shape check is not lost, only moved: `executeJob` re-runs `validateJob` on the
 * **resolved** job, where the reference is gone and this predicate collapses back
 * to the strict test. A secret whose value is not a URL is therefore an honest
 * run-time refusal rather than a request fired at nothing.
 */
function isUrlOrSecretRef(value: string): boolean {
  return /^https?:\/\//i.test(value) || hasSecretRef(value);
}

/**
 * Validates a job spec from client input / task metadata.
 * Returns an error message, or null if valid.
 */
export function validateJob(job: unknown): string | null {
  if (!job || typeof job !== 'object') return 'Missing job spec';
  const j = job as Record<string, unknown>;

  // Where a `${secret.NAME}` may appear is a property of the **spec**, so it is
  // checked here and refused by name (ADR 0003). The other secret failure — a
  // reference to a secret that is not set — is a property of the task *right
  // now*, so it belongs to `executeJob` and not to this function. Two different
  // facts, two different layers; collapsing them would make an imported task or
  // a restored archive impossible to express.
  const illegalRef = illegalSecretRef(j);
  if (illegalRef) return illegalRef;

  if (j.jobType === 'HTTP') {
    if (typeof j.url !== 'string' || !isUrlOrSecretRef(j.url)) {
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
    const execEnvError = validateEnv(j.env);
    if (execEnvError) return execEnvError;
    if (j.timeoutMs !== undefined) {
      const t = Number(j.timeoutMs);
      if (!Number.isFinite(t) || t <= 0 || t > MAX_EXEC_TIMEOUT_MS) {
        return `Job timeoutMs must be between 1 and ${MAX_EXEC_TIMEOUT_MS}`;
      }
    }
    return null;
  }

  if (j.jobType === 'SCRIPT') {
    // The allowlist check is the whole security property of this type, so it is
    // first and it names the legal values — a caller who mistyped `bash ` should
    // not have to guess what the set is.
    if (typeof j.interpreter !== 'string' || !(j.interpreter in SCRIPT_INTERPRETERS)) {
      return `Job interpreter must be one of ${SCRIPT_INTERPRETER_KEYS.join(', ')}`;
    }
    if (typeof j.body !== 'string' || !j.body.trim()) {
      return 'Job body is required';
    }
    if (Buffer.byteLength(j.body, 'utf8') > MAX_SCRIPT_BODY_BYTES) {
      return `Job body must be under ${Math.round(MAX_SCRIPT_BODY_BYTES / 1024)} KB`;
    }
    if (j.workingDirectory !== undefined && typeof j.workingDirectory !== 'string') {
      return 'Job workingDirectory must be a string';
    }
    const envError = validateEnv(j.env);
    if (envError) return envError;
    if (j.timeoutMs !== undefined) {
      const t = Number(j.timeoutMs);
      if (!Number.isFinite(t) || t <= 0 || t > MAX_EXEC_TIMEOUT_MS) {
        return `Job timeoutMs must be between 1 and ${MAX_EXEC_TIMEOUT_MS}`;
      }
    }
    return null;
  }

  if (j.jobType === 'CHECK') {
    return validateProbe(j.probe);
  }

  return `Unsupported jobType: ${j.jobType}`;
}

/** Shared by EXEC and SCRIPT, which carry the same `env` contract. */
function validateEnv(env: unknown): string | null {
  if (env === undefined) return null;
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    return 'Job env must be an object of string values';
  }
  if (Object.values(env as Record<string, unknown>).some(v => typeof v !== 'string')) {
    return 'Job env values must be strings';
  }
  return null;
}

/**
 * Validate one probe.
 *
 * Split out because a `CHECK` job is a thin wrapper around this — and because
 * every probe needs the same treatment the top-level discriminator gets: an
 * unrecognized `kind` is rejected **by name** rather than defaulted into a probe
 * the caller did not ask for.
 */
function validateProbe(probe: unknown): string | null {
  if (!probe || typeof probe !== 'object') return 'Missing check probe';
  const p = probe as Record<string, unknown>;

  if (p.kind === 'http') {
    if (typeof p.url !== 'string' || !isUrlOrSecretRef(p.url)) {
      return 'Check url must start with http:// or https://';
    }
    if (p.method !== undefined && !ALLOWED_METHODS.includes(String(p.method).toUpperCase())) {
      return `Check method must be one of ${ALLOWED_METHODS.join(', ')}`;
    }
    if (p.expectStatus !== undefined) {
      const range = p.expectStatus as Record<string, unknown>;
      const min = Number(range?.min);
      const max = Number(range?.max);
      if (!Number.isFinite(min) || !Number.isFinite(max) || min < 100 || max > 599 || min > max) {
        return 'Check expectStatus must be a {min, max} range between 100 and 599';
      }
    }
    if (p.expectBodyContains !== undefined && typeof p.expectBodyContains !== 'string') {
      return 'Check expectBodyContains must be a string';
    }
    if (p.expectJsonPath !== undefined) {
      const j = p.expectJsonPath as Record<string, unknown>;
      if (typeof j?.path !== 'string' || !j.path.trim() || typeof j?.equals !== 'string') {
        return 'Check expectJsonPath must be a {path, equals} pair of strings';
      }
    }
    return null;
  }

  if (p.kind === 'tcp') {
    if (typeof p.host !== 'string' || !p.host.trim()) return 'Check host is required';
    const port = Number(p.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return 'Check port must be between 1 and 65535';
    }
    return null;
  }

  if (p.kind === 'fileFresh') {
    if (typeof p.path !== 'string' || !p.path.trim()) return 'Check path is required';
    const age = Number(p.maxAgeMinutes);
    if (!Number.isFinite(age) || age <= 0) return 'Check maxAgeMinutes must be greater than 0';
    return null;
  }

  if (p.kind === 'diskFree') {
    if (typeof p.path !== 'string' || !p.path.trim()) return 'Check path is required';
    const bytes = Number(p.minFreeBytes);
    if (!Number.isFinite(bytes) || bytes <= 0) return 'Check minFreeBytes must be greater than 0';
    return null;
  }

  return `Unsupported check kind: ${(p as { kind?: unknown }).kind}`;
}

/**
 * Executes a Cronsole-native job (docs/resources/Native_Tasks.md).
 *
 * **The one place a `${secret.NAME}` becomes a value, and the one place a value
 * is taken back out of the log** (ADR 0003). Both live here, in the branch every
 * job type already funnels through, for the reason `ran` does: a fifth job type
 * cannot ship having resolved a credential into a command line and then logged
 * the command line, because it never touches either step itself.
 *
 * `secrets` is passed in rather than read from the database, so this function
 * stays free of Prisma and testable without one. Its two callers —
 * `NativeScheduler` and `CronsoleNativeConnector.runTask` — both already have
 * the task in hand.
 */
export async function executeJob(
  job: NativeJob,
  secrets: Record<string, string> = {}
): Promise<NativeRunResult> {
  const invalid = validateJob(job);
  if (invalid) {
    // Nothing executed. A malformed spec is a failure to *start*, so it must not
    // be reported as a verdict about the user's system — the caller turns that
    // distinction into 502 vs 200.
    return { success: false, log: invalid, durationMs: 0, ran: false };
  }

  // A reference to a secret that is not set is a failure to *start*, and it is
  // named rather than substituted with a blank: an empty Authorization header
  // comes back as a 401 that reads exactly like an expired token, which sends
  // the reader to the wrong system entirely.
  const missing = missingSecretRefs(job, Object.keys(secrets));
  if (missing.length) {
    return {
      success: false,
      durationMs: 0,
      ran: false,
      log:
        `This job refers to ${missing.length === 1 ? 'a secret that is not set' : 'secrets that are not set'} on ` +
        `this task: ${missing.join(', ')}. Set ${missing.length === 1 ? 'it' : 'them'} in the task's ` +
        'Secrets section (Edit → Secrets), then run it again.'
    };
  }

  const resolved = resolveJobSecrets(job, secrets);

  // Re-validated **after** substitution, which is where the shape checks a
  // reference was allowed to skip actually get made — a secret whose value is
  // not a URL is caught here rather than being fired at nothing. The message is
  // redacted for the same reason the log is: a refusal that quotes the offending
  // value would publish it.
  const resolvedInvalid = validateJob(resolved);
  if (resolvedInvalid) {
    return {
      success: false,
      durationMs: 0,
      ran: false,
      log: `${redactSecrets(resolvedInvalid, secrets)} (after resolving this task's secrets)`
    };
  }

  // Everything past validation executes, so `ran` is set once here rather than
  // in each of the four executors, where a new job type could forget it.
  const result = await runByJobType(resolved);
  return { ...result, log: redactSecrets(result.log, secrets), ran: true };
}

function runByJobType(job: NativeJob): Promise<Omit<NativeRunResult, 'ran'>> {
  switch (job.jobType) {
    case 'EXEC': return executeExec(job);
    case 'SCRIPT': return executeScript(job);
    case 'CHECK': return executeCheck(job);
    default: return executeHttp(job);
  }
}

async function executeHttp(job: HttpJob): Promise<ExecutedRunResult> {
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
function executeExec(job: ExecJob): Promise<ExecutedRunResult> {
  const args = job.args ?? [];
  return runProcess({
    executable: job.executable,
    args,
    workingDirectory: job.workingDirectory,
    env: job.env,
    timeoutMs: job.timeoutMs,
    label: [job.executable, ...args].join(' ')
  });
}

/** Everything `runProcess` needs. `label` is what the log calls this. */
interface ProcessSpec {
  executable: string;
  args: string[];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  label: string;
}

/**
 * Spawn, capture, and report — **one definition**, shared by `EXEC` and
 * `SCRIPT`.
 *
 * They differ only in where the argv comes from: `EXEC` is handed one, `SCRIPT`
 * builds one from a fixed interpreter table. Everything after that — the env
 * allowlist, `shell: false`, the timeout-vs-signal distinction, output capture
 * and truncation — is identical, and a second copy of it is how one job type
 * quietly stops honouring `childEnv`.
 */
function runProcess(spec: ProcessSpec): Promise<ExecutedRunResult> {
  const startedAt = Date.now();
  const args = spec.args;
  const timeoutMs = Math.min(spec.timeoutMs ?? DEFAULT_EXEC_TIMEOUT_MS, MAX_EXEC_TIMEOUT_MS);
  const label = spec.label;

  return new Promise<ExecutedRunResult>(resolve => {
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

    const done = (result: ExecutedRunResult) => {
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
      child = spawn(spec.executable, args, {
        cwd: spec.workingDirectory || undefined,
        env: childEnv(spec.env),
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

/**
 * Write the body to a temp file, run the interpreter against it, delete the file.
 *
 * **The cleanup is in a `finally`, and that matters most on the path least
 * likely to be exercised.** A script that times out is killed by signal, so a
 * `rm` placed after the run — or inside the success branch — leaks the file
 * exactly when the job is misbehaving, which is when it will be running most
 * often. The whole temp *directory* goes, not just the file, so an interpreter
 * that wrote something beside it does not leave that behind either.
 *
 * Mode `0o600`: the body may hold a token the user pasted in, and `os.tmpdir()`
 * is world-readable on POSIX.
 */
async function executeScript(job: ScriptJob): Promise<ExecutedRunResult> {
  const startedAt = Date.now();
  const spec = SCRIPT_INTERPRETERS[job.interpreter];
  let dir: string | null = null;

  try {
    dir = await mkdtemp(join(tmpdir(), 'cronsole-script-'));
    const file = join(dir, `script${spec.extension}`);
    await writeFile(file, job.body, { encoding: 'utf8', mode: 0o600 });

    const result = await runProcess({
      executable: spec.executable,
      args: spec.args(file),
      workingDirectory: job.workingDirectory,
      env: job.env,
      timeoutMs: job.timeoutMs,
      // The temp path is meaningless to the reader and different every run, so
      // the log names the interpreter instead. The body is on the task; this
      // line only has to say which of the six ran it.
      label: `${job.interpreter} script`
    });

    // A missing interpreter is the single most likely failure of this type — the
    // container has `node` and nothing else — and `spawn ... ENOENT` sends people
    // looking at their script rather than at the host. Same reasoning as the
    // ENOENT message in `runProcess`, one level up where the name is known.
    if (!result.success && /could not start/.test(result.log)) {
      return {
        ...result,
        log: `${result.log} — is "${spec.executable}" installed where the Cronsole backend runs?`
      };
    }
    return result;
  } catch (error: any) {
    return {
      success: false,
      log: `${job.interpreter} script could not be prepared: ${error?.message ?? 'unknown error'}`,
      durationMs: Date.now() - startedAt
    };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Run one probe and report **what was measured**, not just whether it passed.
 *
 * Every log line here names the observed value and the expectation beside it
 * (`free 4.2 GB (minimum 10 GB)`), because the reason to run a check is to learn
 * the number — a bare "failed" makes the run history useless for the one job
 * type whose history is the point.
 */
async function executeCheck(job: CheckJob): Promise<ExecutedRunResult> {
  const startedAt = Date.now();
  const done = (success: boolean, log: string): ExecutedRunResult => ({
    success,
    log,
    durationMs: Date.now() - startedAt
  });

  try {
    switch (job.probe.kind) {
      case 'http': return done(...(await probeHttp(job.probe)));
      case 'tcp': return done(...(await probeTcp(job.probe)));
      case 'fileFresh': return done(...(await probeFileFresh(job.probe)));
      case 'diskFree': return done(...(await probeDiskFree(job.probe)));
    }
  } catch (error: any) {
    // A probe that cannot run has *not* observed a healthy system, so this is a
    // failure rather than a skip — but the message says the check broke, not
    // that the thing being checked is down.
    return done(false, `Check could not run: ${error?.message ?? 'unknown error'}`);
  }
}

/** `[success, log]` — the shape every probe returns. */
type ProbeResult = [boolean, string];

async function probeHttp(probe: HttpProbe): Promise<ProbeResult> {
  const method = (probe.method ?? 'GET').toUpperCase();
  const range = probe.expectStatus ?? { min: 200, max: 299 };

  const response = await axios.request({
    url: probe.url,
    method,
    headers: probe.headers,
    timeout: CHECK_TIMEOUT_MS,
    validateStatus: () => true,
    // Keep the body as text: the assertions are a substring match and a JSON
    // path, and axios' automatic JSON parse would make the first one silently
    // impossible on any endpoint serving `application/json`.
    transformResponse: [(data: unknown) => data]
  });

  const head = `${method} ${probe.url} → ${response.status} (expected ${range.min}–${range.max})`;
  if (response.status < range.min || response.status > range.max) {
    return [false, head];
  }

  const body = typeof response.data === 'string' ? response.data : String(response.data ?? '');

  /**
   * What each optional assertion *observed*, collected as they pass.
   *
   * The success line used to end `| all assertions passed`, which named none of
   * them — so a check with an `expectBodyContains` logged **byte-identically**
   * to one with no body assertion at all. That breaks this type's own rule in
   * the half that runs most often: the failing path states the specific
   * assertion, the passing path did not, and an assertion silently lost between
   * the tool and the stored job was indistinguishable from one that ran and
   * passed. Naming them makes the loss visible — the clause simply stops
   * appearing.
   */
  const observed: string[] = [];

  if (probe.expectBodyContains) {
    if (!body.includes(probe.expectBodyContains)) {
      return [false, `${head} | body does not contain "${probe.expectBodyContains}"`];
    }
    observed.push(`body contains "${probe.expectBodyContains}"`);
  }

  if (probe.expectJsonPath) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return [false, `${head} | response is not JSON, so ${probe.expectJsonPath.path} cannot be read`];
    }
    const actual = readJsonPath(parsed, probe.expectJsonPath.path);
    if (actual === undefined) {
      return [false, `${head} | ${probe.expectJsonPath.path} is not present in the response`];
    }
    if (String(actual) !== probe.expectJsonPath.equals) {
      return [
        false,
        `${head} | ${probe.expectJsonPath.path} is "${String(actual)}", expected "${probe.expectJsonPath.equals}"`
      ];
    }
    // The *value*, not "matched" — same reading the failure gives, so the two
    // logs differ by the outcome rather than by their vocabulary.
    observed.push(`${probe.expectJsonPath.path} is "${String(actual)}"`);
  }

  // With no optional assertions the head is already the whole measurement, and
  // a bare head is the honest report of that. It cannot be confused with a
  // failing status-only check: those differ in the status number itself.
  // With no optional assertions the head is already the whole measurement, and
  // a bare head is the honest report of that. It cannot be confused with a
  // failing status-only check: those differ in the status number itself.
  return [true, [head, ...observed].join(' | ')];
}

/**
 * Walk a dotted path. Returns `undefined` for a missing key — which the caller
 * reports as *absent* rather than as a mismatch, because "the field is gone" and
 * "the field changed" are different facts about an API.
 */
function readJsonPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
    if (current === undefined) return undefined;
  }
  return current;
}

function probeTcp(probe: TcpProbe): Promise<ProbeResult> {
  const startedAt = Date.now();
  return new Promise<ProbeResult>(resolve => {
    let settled = false;
    const finish = (result: ProbeResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = connect({ host: probe.host, port: probe.port });
    socket.setTimeout(CHECK_TIMEOUT_MS);
    socket.on('connect', () =>
      finish([true, `tcp ${probe.host}:${probe.port} reachable in ${Date.now() - startedAt}ms`])
    );
    socket.on('timeout', () =>
      finish([false, `tcp ${probe.host}:${probe.port} did not answer within ${CHECK_TIMEOUT_MS / 1000}s`])
    );
    socket.on('error', (error: any) =>
      finish([false, `tcp ${probe.host}:${probe.port} unreachable: ${error?.code ?? error?.message ?? 'error'}`])
    );
  });
}

async function probeFileFresh(probe: FileFreshProbe): Promise<ProbeResult> {
  let info;
  try {
    info = await stat(probe.path);
  } catch (error: any) {
    // Absent is a *failure* here, and deliberately so: this probe exists to
    // notice that a backup stopped being written, and a backup that was never
    // written is the same problem in its worst form.
    return [
      false,
      error?.code === 'ENOENT'
        ? `${probe.path} does not exist (checked on the machine the backend runs on)`
        : `${probe.path} could not be read: ${error?.message ?? 'unknown error'}`
    ];
  }

  const ageMinutes = (Date.now() - info.mtimeMs) / 60_000;
  const measured = `${probe.path} last modified ${formatMinutes(ageMinutes)} ago (limit ${formatMinutes(probe.maxAgeMinutes)})`;
  return [ageMinutes <= probe.maxAgeMinutes, measured];
}

async function probeDiskFree(probe: DiskFreeProbe): Promise<ProbeResult> {
  const info = await statfs(probe.path);
  const free = info.bsize * info.bavail;
  const measured = `${probe.path} has ${formatBytes(free)} free (minimum ${formatBytes(probe.minFreeBytes)})`;
  return [free >= probe.minFreeBytes, measured];
}

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  if (minutes < 60 * 24) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / (60 * 24)).toFixed(1)}d`;
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
