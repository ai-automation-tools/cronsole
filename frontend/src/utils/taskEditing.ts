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
export type JobType = 'HTTP' | 'EXEC';

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
}

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
  const isExec = asText(job.jobType) === 'EXEC';

  const exe = asText(job.executable) ?? '';
  const args = Array.isArray(job.args) ? (job.args as unknown[]).map(a => String(a)) : [];
  const command = exe
    ? [quoteIfSpaced(exe), ...args.map(quoteIfSpaced)].join(' ')
    : '';

  return {
    kind: 'native',
    editable: true,
    initial: {
      jobType: isExec ? 'EXEC' : 'HTTP',
      url: asText(job.url) ?? '',
      method: (asText(job.method) ?? 'GET').toUpperCase(),
      headers: job.headers && typeof job.headers === 'object'
        ? JSON.stringify(job.headers, null, 2)
        : '',
      body: asText(job.body) ?? '',
      command,
      workingDirectory: asText(job.workingDirectory) ?? ''
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

export function windowsActionPayload(v: WindowsActionValues): Record<string, unknown> {
  return {
    command: v.command.trim(),
    workingDirectory: v.workingDirectory.trim(),
    description: v.description.trim(),
    runLevel: v.runLevel
  };
}
