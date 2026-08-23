import type { Task } from '../types';

/**
 * Everything the unified task editor needs to know *before* it renders a field:
 * what the current values are, and which parts of this task are editable at all.
 *
 * It lives outside the modal because the same three questions are asked twice —
 * once to prefill the form, once to decide whether a section renders as an
 * editor or as an honest refusal. Deriving them in two places is how a section
 * ends up editable in the UI and refused by the route.
 *
 * The gating rules here are **unchanged** from the three separate modals this
 * replaced; only their home moved. Each one exists for a reason that is not
 * cosmetic, so each is commented where it is decided rather than here.
 */

type Meta = Record<string, unknown>;

const asText = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined;

/** Quote a token containing whitespace so a rebuilt command line re-tokenizes to
 *  the same argv on save — `C:\Program Files\node.exe` would otherwise split in
 *  two. The backend's `toStructuredAction` strips the quotes again. */
const quoteIfSpaced = (s: string): string => (/\s/.test(s) ? `"${s}"` : s);

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type RunLevel = 'least' | 'highest';
export type JobType = 'HTTP' | 'EXEC' | 'SCRIPT' | 'CHECK';
export type ScriptInterpreter = 'powershell' | 'pwsh' | 'bash' | 'sh' | 'python' | 'node';
export type CheckKind = 'http' | 'tcp' | 'fileFresh' | 'diskFree';

/**
 * The interpreters offered, and what each is for.
 *
 * A **mirror** of the backend's `SCRIPT_INTERPRETERS` allowlist — the server is
 * the authority and rejects anything outside it, so this list can only ever be
 * the same or smaller. It exists because a `<select>` needs labels, not because
 * the browser gets a vote.
 */
export const SCRIPT_INTERPRETERS: { value: ScriptInterpreter; label: string }[] = [
  { value: 'powershell', label: 'PowerShell (Windows)' },
  { value: 'pwsh', label: 'PowerShell 7 (pwsh)' },
  { value: 'bash', label: 'Bash' },
  { value: 'sh', label: 'sh' },
  { value: 'python', label: 'Python' },
  { value: 'node', label: 'Node.js' }
];

/** Cronsole labels. Neither is owned by the platform; both are DB-only writes. */
export interface LabelValues {
  name: string;
  category: string;
}

/** A Windows task's single exec action plus the two settings the route accepts. */
export interface WindowsActionValues {
  command: string;
  workingDirectory: string;
  description: string;
  runLevel: RunLevel;
}

/** A Cronsole-native job spec, held as form fields rather than as the stored
 *  shape — the two job types share no fields, so both halves are carried and
 *  only the selected one is ever sent. */
export interface NativeJobValues {
  jobType: JobType;
  url: string;
  method: string;
  headers: string;
  body: string;
  command: string;
  workingDirectory: string;
  // SCRIPT
  interpreter: ScriptInterpreter;
  scriptBody: string;
  // CHECK. `checkUrl` is deliberately separate from `url`: switching HTTP ↔ Check
  // replaces the job, so carrying one field across the two would make a discarded
  // value silently reappear as the new job's.
  checkKind: CheckKind;
  checkUrl: string;
  checkMethod: string;
  expectStatusMin: string;
  expectStatusMax: string;
  expectBodyContains: string;
  expectJsonPath: string;
  expectJsonEquals: string;
  checkHost: string;
  checkPort: string;
  checkPath: string;
  maxAgeMinutes: string;
  minFreeMb: string;
}

/** Empty form state, so every caller starts from the same shape. */
export const emptyNativeJobValues = (): NativeJobValues => ({
  jobType: 'HTTP',
  url: '',
  method: 'GET',
  headers: '',
  body: '',
  command: '',
  workingDirectory: '',
  interpreter: 'powershell',
  scriptBody: '',
  checkKind: 'http',
  checkUrl: '',
  checkMethod: 'GET',
  expectStatusMin: '200',
  expectStatusMax: '299',
  expectBodyContains: '',
  expectJsonPath: '',
  expectJsonEquals: '',
  checkHost: '',
  checkPort: '',
  checkPath: '',
  maxAgeMinutes: '60',
  minFreeMb: '1024'
});

/** What switching *away* from a stored job type throws away, named before the click. */
export const discardedByTypeSwitch = (stored: JobType): string =>
  ({
    HTTP: 'URL, method, headers and body',
    EXEC: 'command and working directory',
    SCRIPT: 'script body and interpreter',
    CHECK: 'check and everything it compares against'
  }[stored]);

// ---------------------------------------------------------------------------
// Section availability
// ---------------------------------------------------------------------------

/** A section is either editable, or refused with a sentence saying why. The
 *  reason is required: a disabled control with no explanation is the thing this
 *  refactor set out to remove. */
export type Editable<T> =
  | { editable: true; initial: T }
  | { editable: false; reason: string };

// ---------------------------------------------------------------------------
// Labels — always editable, on every platform
// ---------------------------------------------------------------------------

export function labelValues(task: Task): LabelValues {
  return { name: task.name, category: task.category ?? '' };
}

/**
 * What the machine calls this task, when the machine has an opinion.
 *
 * Only Windows does: its `externalId` is the Task Scheduler path and the name is
 * the last segment — which is why a rename there produces a *different task*
 * rather than a new name, and why a Cronsole rename survives sync. Claude's id
 * is an opaque `trig_…` and a native row *is* the task, so neither has a second
 * name to disagree with.
 */
export function platformName(task: Task): string {
  return task.platform === 'WINDOWS_TASK_SCHEDULER'
    ? task.externalId.split('\\').pop() ?? ''
    : '';
}

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

/**
 * Editable for Cronsole-native tasks (the backend owns the scheduler) and for
 * Windows tasks whose trigger is cron-expressible (`task.schedule` is set).
 * Boot / logon / event / on-demand Windows triggers read back as no schedule and
 * stay read-only until there is a safe editor for them.
 *
 * `initial` is the **stored UTC** cron. The field converts it into the user's
 * zone for display and back exactly once on submit — a zone must never reach
 * storage.
 */
export function scheduleEdit(task: Task): Editable<string> {
  const supported =
    task.platform === 'TASKHUB_NATIVE' || task.platform === 'WINDOWS_TASK_SCHEDULER';

  if (!supported) {
    return {
      editable: false,
      reason: 'Schedule editing is only available for Cronsole-native tasks and cron-expressible Windows tasks.'
    };
  }
  if (!task.schedule) {
    return {
      editable: false,
      reason: task.platform === 'WINDOWS_TASK_SCHEDULER'
        ? "This task runs on a trigger Cronsole can't edit yet (boot, logon, event, or on-demand only)."
        : 'This task has no cron schedule stored, so there is nothing to edit.'
    };
  }
  return { editable: true, initial: task.schedule };
}

// ---------------------------------------------------------------------------
// What the task runs
// ---------------------------------------------------------------------------

export type RunsEdit =
  | { kind: 'windows'; editable: true; initial: WindowsActionValues }
  | { kind: 'native'; editable: true; initial: NativeJobValues }
  | { kind: 'none'; editable: false; reason: string };

/**
 * Prefill for the Windows action editor.
 *
 * Gated to a Windows task with exactly one reported exec action, because the
 * agent *replaces* the single exec action — a multi-action task would silently
 * lose the others, and a task the agent has not reported yet has nothing to
 * prefill from.
 */
function windowsActionEdit(task: Task): RunsEdit {
  const meta = (task.metadata ?? {}) as Meta;
  const runLevel: RunLevel = /highest/i.test(asText(meta.runLevel) ?? '') ? 'highest' : 'least';
  const description = asText(meta.description) ?? '';

  const acts = Array.isArray(meta.actions) ? meta.actions : [];
  const execActs = acts
    .map(a => (a ?? {}) as Meta)
    .filter(a => asText(a.path) ?? asText(a.executable));

  if (execActs.length !== 1) {
    return {
      kind: 'none',
      editable: false,
      reason: acts.length === 0
        ? "The agent hasn't reported this task's command yet — sync and try again."
        : "This task has multiple actions; editing multi-action tasks isn't supported yet."
    };
  }

  const act = execActs[0];
  const exe = asText(act.path) ?? asText(act.executable) ?? '';
  const args = asText(act.arguments);
  const exeToken = quoteIfSpaced(exe);
  return {
    kind: 'windows',
    editable: true,
    initial: {
      command: args ? `${exeToken} ${args}` : exeToken,
      workingDirectory: asText(act.workingDirectory) ?? '',
      description,
      runLevel
    }
  };
}

/**
 * Prefill for the Cronsole-native job editor.
 *
 * Always editable, unlike the Windows path — a native job spec is a column in a
 * row this process owns, so there is no agent to be offline, no multi-action
 * shape to refuse, and nothing that has to have been reported by a sync first. A
 * task whose stored job is unreadable still opens: the form defaults to HTTP
 * with empty fields, which is a repair rather than a dead end.
 */
function nativeJobEdit(task: Task): RunsEdit {
  const meta = (task.metadata ?? {}) as Meta;
  const job = (meta.job ?? {}) as Meta;
  const stored = asText(job.jobType);
  // An unrecognized stored type falls back to HTTP with empty fields — the same
  // "a broken row still opens" repair the original did. It is not silent: the
  // form shows HTTP selected while the task's source row still reads whatever
  // the server derived, and saving is an explicit act.
  const jobType: JobType =
    stored === 'EXEC' || stored === 'SCRIPT' || stored === 'CHECK' ? stored : 'HTTP';

  const exe = asText(job.executable) ?? '';
  const args = Array.isArray(job.args) ? (job.args as unknown[]).map(a => String(a)) : [];
  const command = exe
    ? [quoteIfSpaced(exe), ...args.map(quoteIfSpaced)].join(' ')
    : '';

  const probe = (job.probe ?? {}) as Meta;
  const probeKind = asText(probe.kind);
  const range = (probe.expectStatus ?? {}) as Meta;
  const jsonPath = (probe.expectJsonPath ?? {}) as Meta;
  const minFreeBytes = Number(probe.minFreeBytes);

  return {
    kind: 'native',
    editable: true,
    initial: {
      ...emptyNativeJobValues(),
      jobType,
      url: asText(job.url) ?? '',
      method: (asText(job.method) ?? 'GET').toUpperCase(),
      headers: job.headers && typeof job.headers === 'object'
        ? JSON.stringify(job.headers, null, 2)
        : '',
      // `body` is the HTTP request body on an HTTP job and the script text on a
      // SCRIPT one — the same key, two unrelated meanings. Each is read only for
      // its own type, or switching HTTP → Scripts would drop the request body
      // into the editor as the script, one line after the form promised to
      // discard it.
      body: jobType === 'HTTP' ? asText(job.body) ?? '' : '',
      command,
      workingDirectory: asText(job.workingDirectory) ?? '',

      interpreter: (asText(job.interpreter) ?? 'powershell') as ScriptInterpreter,
      scriptBody: jobType === 'SCRIPT' ? asText(job.body) ?? '' : '',

      checkKind:
        probeKind === 'tcp' || probeKind === 'fileFresh' || probeKind === 'diskFree'
          ? probeKind
          : 'http',
      checkUrl: asText(probe.url) ?? '',
      checkMethod: (asText(probe.method) ?? 'GET').toUpperCase(),
      expectStatusMin: asText(range.min) ?? '200',
      expectStatusMax: asText(range.max) ?? '299',
      expectBodyContains: asText(probe.expectBodyContains) ?? '',
      expectJsonPath: asText(jsonPath.path) ?? '',
      expectJsonEquals: asText(jsonPath.equals) ?? '',
      checkHost: asText(probe.host) ?? '',
      checkPort: asText(probe.port) ?? '',
      checkPath: asText(probe.path) ?? '',
      maxAgeMinutes: asText(probe.maxAgeMinutes) ?? '60',
      // Megabytes in the form, bytes on the wire. Nobody types 10737418240, and
      // a field whose unit is only in its label is a field people get wrong by
      // three orders of magnitude.
      minFreeMb: Number.isFinite(minFreeBytes) && minFreeBytes > 0
        ? String(Math.round(minFreeBytes / (1024 * 1024)))
        : '1024'
    }
  };
}

export function runsEdit(task: Task): RunsEdit {
  if (task.platform === 'TASKHUB_NATIVE') return nativeJobEdit(task);
  if (task.platform === 'WINDOWS_TASK_SCHEDULER') return windowsActionEdit(task);
  return {
    kind: 'none',
    editable: false,
    reason: task.platform === 'CLAUDE_CODE'
      ? 'What a Claude routine runs is defined at claude.ai — Cronsole can schedule and fire it, not rewrite its prompt.'
      : 'Editing what this task runs is only available for Windows Task Scheduler and Cronsole-native tasks.'
  };
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

/**
 * Parse the headers textarea. Returns null — not `{}` — when it cannot be read,
 * so an unreadable value blocks the save rather than silently sending none. A
 * job that runs and 401s at 3am is worse than a form that will not submit.
 */
export function parseHeaders(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed) return {};
  // JSON first, since that is what the API stores and what an export round-trips.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
      }
      return null;
    } catch {
      return null;
    }
  }
  // Otherwise `Name: value` per line, which is how anyone who has used curl
  // expects to type a header — pasting one out of an API's docs should not need
  // reformatting into JSON first.
  const out: Record<string, string> = {};
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at <= 0) return null;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

/** The exact body `PATCH /tasks/:id/job` receives. Built here so the dirty check
 *  and the request compare the same thing — a section that reports itself
 *  unchanged must be unchanged *on the wire*, not merely in the fields. */
export function nativeJobPayload(v: NativeJobValues): Record<string, unknown> | null {
  if (v.jobType === 'HTTP') {
    const parsed = parseHeaders(v.headers);
    if (!parsed) return null;
    return {
      jobType: 'HTTP',
      url: v.url.trim(),
      method: v.method,
      ...(Object.keys(parsed).length ? { headers: parsed } : {}),
      ...(v.body.trim() ? { body: v.body } : {})
    };
  }

  if (v.jobType === 'SCRIPT') {
    return {
      jobType: 'SCRIPT',
      interpreter: v.interpreter,
      // Not trimmed. Leading whitespace is significant in Python, and a trailing
      // newline is what makes a shell script's last line run — trimming a script
      // body the way a form field is trimmed silently changes what it does.
      body: v.scriptBody,
      ...(v.workingDirectory.trim() ? { workingDirectory: v.workingDirectory.trim() } : {})
    };
  }

  if (v.jobType === 'CHECK') {
    return { jobType: 'CHECK', probe: checkProbePayload(v) };
  }

  return {
    jobType: 'EXEC',
    // Sent as a command line on purpose: the backend tokenizes it with the same
    // `toStructuredAction` the create and Windows paths use, so there is one
    // definition of "how a command line becomes argv" and the browser never
    // holds a copy that can drift from it.
    command: v.command.trim(),
    ...(v.workingDirectory.trim() ? { workingDirectory: v.workingDirectory.trim() } : {})
  };
}

/**
 * The probe half of a CHECK payload.
 *
 * Only the selected kind's fields are sent — the form carries all four so a user
 * can switch back without retyping, but a probe that shipped `host` alongside
 * `url` would store something the executor never reads, which is the merge
 * problem `PATCH /job` replaces rather than patches to avoid.
 */
function checkProbePayload(v: NativeJobValues): Record<string, unknown> {
  if (v.checkKind === 'tcp') {
    return { kind: 'tcp', host: v.checkHost.trim(), port: Number(v.checkPort) };
  }
  if (v.checkKind === 'fileFresh') {
    return {
      kind: 'fileFresh',
      path: v.checkPath.trim(),
      maxAgeMinutes: Number(v.maxAgeMinutes)
    };
  }
  if (v.checkKind === 'diskFree') {
    return {
      kind: 'diskFree',
      path: v.checkPath.trim(),
      minFreeBytes: Math.round(Number(v.minFreeMb) * 1024 * 1024)
    };
  }
  return {
    kind: 'http',
    url: v.checkUrl.trim(),
    method: v.checkMethod,
    expectStatus: { min: Number(v.expectStatusMin), max: Number(v.expectStatusMax) },
    ...(v.expectBodyContains.trim() ? { expectBodyContains: v.expectBodyContains.trim() } : {}),
    ...(v.expectJsonPath.trim()
      ? { expectJsonPath: { path: v.expectJsonPath.trim(), equals: v.expectJsonEquals } }
      : {})
  };
}

/**
 * Is the form complete enough to send? Returns the reason it is not.
 *
 * Shared by the create and edit forms so a job cannot be submittable in one and
 * refused in the other — the same one-derivation rule the prefill and the gate
 * already follow.
 */
export function nativeJobIncomplete(v: NativeJobValues): string | null {
  if (v.jobType === 'HTTP') {
    return /^https?:\/\//i.test(v.url.trim()) ? null : 'Enter a URL starting with http:// or https://';
  }
  if (v.jobType === 'EXEC') {
    return v.command.trim() ? null : 'Enter the command to run';
  }
  if (v.jobType === 'SCRIPT') {
    return v.scriptBody.trim() ? null : 'Write the script to run';
  }
  if (v.checkKind === 'http') {
    if (!/^https?:\/\//i.test(v.checkUrl.trim())) return 'Enter a URL starting with http:// or https://';
    const min = Number(v.expectStatusMin);
    const max = Number(v.expectStatusMax);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      return 'The expected status range must run from low to high';
    }
    if (v.expectJsonPath.trim() && !v.expectJsonEquals.trim()) {
      return 'Give the JSON path a value to compare against';
    }
    return null;
  }
  if (v.checkKind === 'tcp') {
    if (!v.checkHost.trim()) return 'Enter a host';
    const port = Number(v.checkPort);
    return Number.isInteger(port) && port > 0 && port < 65536 ? null : 'Enter a port between 1 and 65535';
  }
  if (!v.checkPath.trim()) return 'Enter a path';
  if (v.checkKind === 'fileFresh') {
    return Number(v.maxAgeMinutes) > 0 ? null : 'Enter an age limit in minutes';
  }
  return Number(v.minFreeMb) > 0 ? null : 'Enter a minimum free space in MB';
}

export function windowsActionPayload(v: WindowsActionValues): Record<string, unknown> {
  return {
    command: v.command.trim(),
    workingDirectory: v.workingDirectory.trim(),
    description: v.description.trim(),
    runLevel: v.runLevel
  };
}

// ---------------------------------------------------------------------------
// Secret references
// ---------------------------------------------------------------------------

/** `${secret.NAME}` — a **mirror** of the backend's `SECRET_REF` (ADR 0003). */
const SECRET_REF = /\$\{secret\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * Which secrets the job **currently being typed** refers to.
 *
 * This is not a second definition of the server's judgement, and the distinction
 * matters. For a task that exists, `GET /tasks/:id/secrets` answers this and the
 * UI reads it from there — the server owns it. This function exists for the one
 * case the server cannot answer: a task that does not exist yet, where the job
 * has never been sent anywhere. It reads the **payload** rather than the form
 * fields for exactly that reason — the same bytes `POST /tasks/native` will
 * receive, so the browser cannot see a reference the server will not, or miss
 * one it will. The server re-derives it either way and reports `missingSecrets`
 * on the create response; this only decides what the form can say beforehand.
 */
export function secretRefsIn(values: NativeJobValues): string[] {
  const payload = nativeJobPayload(values);
  if (!payload) return [];
  const found: string[] = [];
  const take = (v: unknown) => {
    if (typeof v !== 'string') return;
    for (const m of v.matchAll(SECRET_REF)) found.push(m[1]!);
  };
  const takeValues = (v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.values(v).forEach(take);
  };

  if (payload.jobType === 'HTTP') {
    take(payload.url);
    takeValues(payload.headers);
    take(payload.body);
  } else if (payload.jobType === 'EXEC') {
    // The command line is tokenized server-side, so a ref anywhere in it lands
    // in an arg — which is where it is legal. The executable is not, and the
    // server refuses that by name.
    take(payload.command);
    takeValues(payload.env);
  } else if (payload.jobType === 'SCRIPT') {
    take(payload.body);
    takeValues(payload.env);
  } else if (payload.jobType === 'CHECK') {
    const probe = payload.probe as Record<string, unknown> | undefined;
    if (probe?.kind === 'http') {
      take(probe.url);
      takeValues(probe.headers);
    }
  }
  return [...new Set(found)];
}
