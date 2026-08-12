import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CronsoleClient, CronsoleApiError } from './client.js';

/**
 * Tool surface for the Cronsole MCP server (docs/ROADMAP.md › P3):
 *
 *   read      list_tasks · list_templates · list_folders · get_task_history ·
 *             export_task · convert_schedule
 *   create    create_task · create_native_task · create_native_script_task ·
 *             create_task_from_template
 *   act       run_task
 *   modify    set_task_status · update_task_schedule · update_task_action ·
 *             untrack_task
 *   destroy   delete_task            (only when allowDestructive — see below)
 *
 * Each tool is a thin call through CronsoleClient into the REST API. Business
 * rules (owner scoping, no-shell command structuring, agent signing, cron→trigger
 * conversion) all stay server-side — this layer only shapes input/output.
 *
 * Gating (decided 2026-07-15, docs/ROADMAP.md › MCP surface expansion): the
 * irreversible verb is gated, the reversible ones are not. `set_task_status` in
 * particular ships ungated ON PURPOSE — it is the honest way to park a task, and
 * gating it would push an agent toward encoding "don't run" in the cron, which
 * is troubleshooting #14 exactly. A gate that makes the safe path harder than the
 * unsafe one is worse than no gate.
 */

export interface ToolOptions {
  /**
   * Register the irreversible tools (delete_task). Sourced from an env var, not
   * a tool parameter: a `confirm: true` argument is not a gate, because the model
   * fills it in itself. See CronsoleClientConfig.allowDestructive.
   */
  allowDestructive: boolean;
}

// The platforms Cronsole can actually create on today (the honesty pass gated the
// UI to these too). Others are catalog-only until their agent/connector exists.
const CREATABLE_PLATFORMS = ['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE'] as const;

const ALL_PLATFORMS = [
  'WINDOWS_TASK_SCHEDULER',
  'MACOS_LAUNCHD',
  'CLAUDE_CODE',
  'CHATGPT',
  'JULES',
  'OPEN_CLAW',
  'HERMES',
  'TASKHUB_NATIVE'
] as const;

// ---- API response shapes (only the fields the tools surface) ----

interface TaskRow {
  id: string;
  name: string;
  platform: string;
  category: string | null;
  schedule: string | null;
  status: string;
  externalId: string;
  nextRunTime: string | null;
  lastRunStatus: string | null;
  lastRunAt: string | null;
  lastRunDurationMs: number | null;
}

// Parameter shape as stored on Template.parameters (Registry v1): `key` is the
// {{placeholder}} name, `default` the prefill, `help` the hint.
interface TemplateParameter {
  key: string;
  label?: string;
  type?: string;
  required?: boolean;
  default?: string | null;
  options?: string[];
  help?: string;
}

// Mirrors backend WindowsTrigger (backend/src/utils/scheduler-conversion.ts).
interface WindowsTrigger {
  type: 'Daily' | 'Weekly' | 'Monthly' | 'Time';
  startBoundary: string;
  daysInterval?: number;
  daysOfWeek?: string[];
  repetition?: { interval: string; duration?: string };
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  isStarter: boolean;
  scriptType: string | null;
  scheduleExpression: string | null;
  targetPlatforms: string[];
  parameters: TemplateParameter[] | null;
}

// GET /api/tasks/folders. `writable: false` folders are returned rather than
// filtered out, on purpose — see list_folders.
interface FolderRow {
  path: string;
  taskCount: number;
  writable: boolean;
}

// GET /api/tasks/:id/executions — mirrors Prisma's ExecutionLog. The route
// returns the 20 most recent, newest first; that cap is the API's, not ours.
/** One cell of the capability matrix — a claim about *this install*, with its evidence. */
interface CapabilityCell {
  verb: string;
  label: string;
  description: string;
  support: 'verified' | 'declared' | 'unsupported';
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

interface PlatformMatrixRow {
  platform: string;
  label: string;
  summary: string;
  maturity: 'functional' | 'experimental';
  configured: boolean;
  isActive: boolean;
  healthState: string | null;
  healthReason: string | null;
  lastSync: string | null;
  taskCount: number;
  capabilities: CapabilityCell[];
  lastVerifiedAt: string | null;
}

/** A declared Claude routine. Never carries the token — the API does not return it. */
interface ClaudeRoutineRow {
  id: string;
  name?: string;
  hasToken: boolean;
  taskCount: number;
}

interface SyncResultRow {
  platform: string;
  count: number;
  missing: number;
  untracked?: { count: number; folders: string[]; systemCount: number; excludedCount: number };
  exclusionsCleared?: number;
}

interface HealthSignal {
  code: string;
  severity: string;
  summary: string;
  /** Always names the field it came from — a claim never travels without its source. */
  evidence: string;
  weight: number;
}

interface TaskHealthResponse {
  evaluatedAt: string;
  counts: { tasks: number; critical: number; attention: number; unknown: number; ok: number };
  tasks: Array<{
    taskId: string;
    name: string;
    platform: string;
    category: string;
    isSystem: boolean;
    tier: string;
    score: number;
    signals: HealthSignal[];
  }>;
}

interface RunHistoryResponse {
  range: { from: string; to: string };
  matched: { runs: number; succeeded: number; failed: number; pending: number };
  truncated: boolean;
  rows: Array<{
    triggeredAt: string;
    taskId: string;
    taskName: string;
    platform: string;
    category: string;
    status: string;
    /** Derived at read time — what `status` actually means for this platform. */
    runKind: string;
    durationMs: number | null;
  }>;
}

interface ExecutionRow {
  id: string;
  status: string;
  triggeredAt: string;
  durationMs: number | null;
  log: string | null;
  platformRunId: string | null;
}

// ---- helpers ----

/** A tool handler failed — render the message honestly and flag it as an error. */
function toolError(err: unknown) {
  const message =
    err instanceof CronsoleApiError
      ? err.status
        ? `Cronsole API error (HTTP ${err.status}): ${err.message}`
        : err.message
      : err instanceof Error
        ? err.message
        : String(err);
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true
  };
}

/**
 * One-line rendering of the trigger the conversion produced. A bare "confidence
 * 1" reads identically whether the conversion was right or silently wrong: the
 * multi-day weekly bug turned "1-5" into a Monday-only trigger and still scored
 * 1.0 with no warnings. Spelling the days out is what makes that visible to a
 * host that shows only text. Durations stay ISO-8601 — that's what Task
 * Scheduler itself displays, so it stays checkable against the real trigger.
 */
function describeTrigger(t: WindowsTrigger): string {
  const parts: string[] = [t.type];
  if (t.startBoundary) parts.push(`at ${t.startBoundary}`);
  if (t.daysOfWeek?.length) parts.push(`on ${t.daysOfWeek.join(', ')}`);
  if (t.daysInterval && t.daysInterval > 1) parts.push(`every ${t.daysInterval} days`);
  if (t.repetition?.interval) {
    const dur = t.repetition.duration ? ` for ${t.repetition.duration}` : '';
    parts.push(`repeating every ${t.repetition.interval}${dur}`);
  }
  return parts.join(' ');
}

/** A successful tool result carrying both a readable summary and structured data. */
function ok(text: string, structuredContent: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text }],
    structuredContent
  };
}

const compactTask = (t: TaskRow) => ({
  id: t.id,
  name: t.name,
  platform: t.platform,
  category: t.category,
  schedule: t.schedule,
  status: t.status,
  nextRunTime: t.nextRunTime,
  lastRunStatus: t.lastRunStatus,
  lastRunAt: t.lastRunAt
});

const compactTemplate = (t: TemplateRow) => ({
  id: t.id,
  name: t.name,
  description: t.description,
  category: t.category,
  tags: t.tags,
  isStarter: t.isStarter,
  targetPlatforms: t.targetPlatforms,
  defaultSchedule: t.scheduleExpression,
  parameters: (t.parameters ?? []).map(p => ({
    name: p.key,
    label: p.label,
    required: p.required ?? false,
    type: p.type,
    options: p.options,
    default: p.default,
    help: p.help
  }))
});

export function registerTools(
  server: McpServer,
  client: CronsoleClient,
  options: ToolOptions = { allowDestructive: false }
): void {
  // -------------------------------------------------------------------------
  // list_tasks
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_tasks',
    {
      title: 'List scheduled tasks',
      description:
        'List the scheduled tasks Cronsole tracks for the current user (Windows Task Scheduler + Cronsole-native), ' +
        'with each task\'s schedule, status, next run time, and last run result. Optional filters narrow the list.',
      inputSchema: {
        platform: z
          .enum(ALL_PLATFORMS)
          .optional()
          .describe('Only tasks on this platform.'),
        status: z
          .enum(['ACTIVE', 'DISABLED', 'UNKNOWN', 'DELETED', 'MISSING'])
          .optional()
          .describe(
            'Only tasks with this status. MISSING = tracked by Cronsole but absent from the platform on the last ' +
            'sync (a native delete, or an offline agent / unreadable folder — indistinguishable from here); it ' +
            'self-heals to ACTIVE/DISABLED when the task reappears. Use it to answer "what did I lose?".'
          ),
        category: z
          .string()
          .optional()
          .describe('Only tasks in this category (case-insensitive exact match).'),
        search: z
          .string()
          .optional()
          .describe('Free-text filter matched against task name, category, and schedule.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Max tasks to return (default 50). Narrow with filters rather than raising this.')
      }
    },
    async ({ platform, status, category, search, limit }) => {
      try {
        let tasks = await client.get<TaskRow[]>('/tasks');
        if (platform) tasks = tasks.filter(t => t.platform === platform);
        if (status) tasks = tasks.filter(t => t.status === status);
        if (category) {
          const c = category.toLowerCase();
          tasks = tasks.filter(t => (t.category ?? '').toLowerCase() === c);
        }
        if (search) {
          const q = search.toLowerCase();
          tasks = tasks.filter(t =>
            [t.name, t.category, t.schedule].some(v => (v ?? '').toLowerCase().includes(q))
          );
        }
        const matched = tasks.length;
        const rows = tasks.slice(0, limit).map(compactTask);
        const header =
          matched > rows.length
            ? `Showing ${rows.length} of ${matched} matching task(s) (limit ${limit} — filter to narrow):`
            : `${matched} task(s).`;
        const summary = rows.length
          ? rows
              .map(r => `• ${r.name} [${r.platform}] — ${r.schedule ?? 'no schedule'} — ${r.status}` +
                (r.nextRunTime ? ` — next ${r.nextRunTime}` : '') +
                ` (id: ${r.id})`)
              .join('\n')
          : 'No tasks match.';
        return ok(`${header}\n${summary}`, { matched, returned: rows.length, tasks: rows });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // run_task
  // -------------------------------------------------------------------------
  server.registerTool(
    'run_task',
    {
      title: 'Run a task now',
      description:
        'Trigger a task to run immediately by its Cronsole id (get ids from list_tasks). ' +
        'For a Windows task this sends a signed run command to the local agent; for a native task the backend runs it. ' +
        'Returns the run result.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).')
      }
    },
    async ({ taskId }) => {
      try {
        const result = await client.post<Record<string, unknown>>(
          `/tasks/${encodeURIComponent(taskId)}/run`
        );
        const msg = typeof result.message === 'string' ? result.message : 'Task run command sent';
        return ok(msg, { taskId, result });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // list_templates
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_templates',
    {
      title: 'List task templates',
      description:
        'List the Cronsole template catalog (starters + use-case patterns) with each template\'s id, category, tags, ' +
        'target platforms, default schedule, and declared parameters — use this to find a template id and its required ' +
        'parameters before calling create_task_from_template.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Free-text filter matched against template name, description, category, and tags.'),
        category: z
          .string()
          .optional()
          .describe('Only templates in this category (case-insensitive exact match).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Max templates to return (default 50).')
      }
    },
    async ({ search, category, limit }) => {
      try {
        let templates = await client.get<TemplateRow[]>('/templates');
        if (category) {
          const c = category.toLowerCase();
          templates = templates.filter(t => (t.category ?? '').toLowerCase() === c);
        }
        if (search) {
          const q = search.toLowerCase();
          templates = templates.filter(t =>
            [t.name, t.description, t.category, ...(t.tags ?? [])].some(v =>
              (v ?? '').toLowerCase().includes(q)
            )
          );
        }
        const matched = templates.length;
        const rows = templates.slice(0, limit).map(compactTemplate);
        const header =
          matched > rows.length
            ? `Showing ${rows.length} of ${matched} matching template(s) (limit ${limit}):`
            : `${matched} template(s).`;
        const summary = rows.length
          ? rows
              .map(r => {
                const params = r.parameters.length
                  ? ` — params: ${r.parameters.map(p => p.name + (p.required ? '*' : '')).join(', ')}`
                  : '';
                return `• ${r.name} [${r.category ?? 'OTHER'}] (id: ${r.id})${params}`;
              })
              .join('\n')
          : 'No templates match.';
        return ok(`${header}\n${summary}`, { matched, returned: rows.length, templates: rows });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // list_folders
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_folders',
    {
      title: 'List Windows Task Scheduler folders',
      description:
        'List the real Windows Task Scheduler folders on the machine, with how many tasks each holds and whether ' +
        'a task can be created in it. Call this before create_task / create_task_from_template when you want a ' +
        'folder other than the default: Cronsole creates ONLY its own "\\Cronsole" folder, so every other folder ' +
        'must already exist — this is how you find out which do. Windows-only (no other platform has task folders). ' +
        'Folders you cannot create in are listed with writable=false rather than hidden, so you can see that a ' +
        'folder exists AND why it is refused.',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Free-text filter matched against the folder path (case-insensitive substring).'),
        writableOnly: z
          .boolean()
          .default(false)
          .describe(
            'Only folders a task can actually be created in. Default false — an unwritable folder is worth ' +
            'seeing, because "it exists but is refused" is a different answer from "it does not exist".'
          ),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .default(50)
          .describe('Max folders to return (default 50). A real machine can have well over a hundred — filter rather than raise this.')
      }
    },
    async ({ search, writableOnly, limit }) => {
      try {
        const result = await client.get<{ folders: FolderRow[]; defaultFolder: string }>(
          '/tasks/folders'
        );
        let folders = result.folders ?? [];
        if (writableOnly) folders = folders.filter(f => f.writable);
        if (search) {
          const q = search.toLowerCase();
          folders = folders.filter(f => (f.path ?? '').toLowerCase().includes(q));
        }
        const matched = folders.length;
        const rows = folders.slice(0, limit);
        const header =
          matched > rows.length
            ? `Showing ${rows.length} of ${matched} folder(s) (limit ${limit} — filter to narrow):`
            : `${matched} folder(s).`;
        const summary = rows.length
          ? rows
              .map(f => {
                const tag = f.path === result.defaultFolder ? ' [default]' : '';
                // Say why, not just no: a bare omission reads as "does not exist".
                const writable = f.writable ? '' : ' — NOT writable (cannot create here)';
                return `• ${f.path}${tag} — ${f.taskCount} task(s)${writable}`;
              })
              .join('\n')
          : 'No folders match.';
        const note = `\nDefault folder: ${result.defaultFolder} (used when you omit \`folder\`; Cronsole creates this one itself).`;
        return ok(`${header}\n${summary}${note}`, {
          matched,
          returned: rows.length,
          defaultFolder: result.defaultFolder,
          folders: rows
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // create_task
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_task',
    {
      title: 'Create a task from a command',
      description:
        'Create a real scheduled task directly from a command — no template needed. Use this when you already ' +
        'know the command to run; use create_task_from_template only when you want a catalog recipe. ' +
        'The server converts the 5-field UTC cron to the platform\'s native trigger and registers the task ' +
        '(a Windows task is created via the signed local agent, and the command is structured no-shell). ' +
        `Only ${CREATABLE_PLATFORMS.join(' and ')} can be created today. ` +
        'IMPORTANT: check the schedule with convert_schedule first and READ THE RETURNED TRIGGER, not just the ' +
        'confidence score — a cron this converter cannot express natively is REPLACED with an hourly trigger ' +
        '(it only ever runs more often than you asked), and that arrives as a mild-sounding warning.',
      inputSchema: {
        name: z
          .string()
          .describe(
            'Task name. Must be unique among tracked Windows tasks in the same folder — a collision returns 409 ' +
            'rather than letting Windows silently overwrite the existing task.'
          ),
        command: z
          .string()
          .describe(
            'The command to run, e.g. `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\\\path\\\\job.ps1"` ' +
            'or `C:\\\\Tools\\\\backup.exe --full`. For Windows this is tokenized into a structured no-shell ' +
            '{executable, args[]} action, so a shell is NOT implied: to use shell features (pipes, redirection, ' +
            '`&&`) you must opt in explicitly by invoking one, e.g. `cmd.exe /c "..."`. ' +
            'For TASKHUB_NATIVE the command must be a URL (it becomes an HTTP GET job).'
          ),
        schedule: z
          .string()
          .describe(
            '5-field cron in UTC: "min hour dom month dow". Cronsole stores all schedules as UTC cron and ' +
            'displays them in local time — do not pass local time.'
          ),
        platform: z
          .enum(CREATABLE_PLATFORMS)
          .default('WINDOWS_TASK_SCHEDULER')
          .describe('Where to create the task. Only Windows and Cronsole-native are creatable today.'),
        category: z
          .string()
          .optional()
          .describe('Cronsole category for grouping. For Windows this defaults to the folder name.'),
        folder: z
          .string()
          .optional()
          .describe(
            'Windows only: the Task Scheduler folder to create the task in, e.g. "\\\\Cronsole" (default) or ' +
            '"\\\\Work\\\\Backups". The folder MUST ALREADY EXIST — Cronsole creates only its own "\\\\Cronsole" ' +
            'folder, because removing a folder needs elevation and it will not leave behind one the user has to ' +
            'delete by hand. Folders under "\\\\Microsoft\\\\" are refused outright: Windows keeps its own ' +
            'scheduled tasks there and a name collision would silently overwrite one. ' +
            'Set createFolder if you want a missing folder created instead of refused.'
          ),
        createFolder: z
          .boolean()
          .optional()
          .describe(
            'Windows only. Create `folder` when it does not exist, instead of refusing. Default false. ' +
            'THINK BEFORE SETTING THIS: the local agent runs elevated, so a folder it creates carries an ' +
            'administrator ACE — the user will need administrator rights to delete it again, and Cronsole ' +
            'never removes it for them (it only ever prunes its own "\\\\Cronsole"). Prefer list_folders and ' +
            'an existing folder. Use this when the user has asked for a specific new folder by name, not to ' +
            'recover from a typo — a misspelled path becomes a permanent folder. It does not widen WHERE a ' +
            'task may go: "\\\\Microsoft\\\\" is still refused. Any folder created is named in the response.'
          )
      }
    },
    async ({ name, command, schedule, platform, category, folder, createFolder }) => {
      try {
        const body: Record<string, unknown> = { name, command, schedule, platform };
        if (category) body.category = category;
        if (folder) body.folder = folder;
        // Only sent when true. The route defaults it to false, and putting an
        // explicit `false` on the wire for every ordinary create would make the
        // opt-in look like a routine field rather than a deliberate one.
        if (createFolder) body.createFolder = true;

        const result = await client.post<{
          message?: string;
          task?: TaskRow;
          conversion?: { warnings?: string[]; lossy?: 'approximated' | 'replaced' };
          foldersCreated?: string[];
        }>('/tasks', body);

        // Surface lossy conversion at the same volume as success. The backend
        // accepts a fallback trigger rather than refusing it, so a task can be
        // created on a schedule that is not the one asked for — saying so here
        // is the difference between an honest result and a confident lie. Lead
        // with the register: 'replaced' means the schedule was thrown away, not
        // rounded, and the caller should almost certainly delete and re-create.
        const lossyLead =
          result.conversion?.lossy === 'replaced'
            ? '\nThe schedule was REPLACED — the cron you gave was discarded for an hourly trigger, so this task runs far more often than you asked. Delete it and use a schedule Windows can express, or create it disabled.'
            : result.conversion?.lossy === 'approximated'
              ? '\nThe schedule was approximated — the trigger is built from your cron but drifts after the first cycle.'
              : '';
        const warnings = result.conversion?.warnings?.length
          ? lossyLead +
            `\nSchedule conversion warnings: ${result.conversion.warnings.join('; ')}` +
            '\nThe registered trigger may not match the cron you gave. Verify with convert_schedule.'
          : '';
        const task = result.task;
        const created = task
          ? `\n${task.name} [${task.platform}] — ${task.schedule ?? 'no schedule'} — ${task.status} (id: ${task.id})`
          : '';
        // Rendered at the same volume as a warning, not tucked into the
        // structured payload: creating a folder is the exception to a standing
        // invariant, and the caller cannot undo it without elevation. A model
        // that only reads the text must still learn it happened.
        const folders = result.foldersCreated?.length
          ? `\nCreated Task Scheduler folder(s): ${result.foldersCreated.join(', ')}. ` +
            'Removing these again needs administrator rights — Cronsole will not delete them.'
          : '';
        const msg = typeof result.message === 'string' ? result.message : 'Task created';
        return ok(`${msg}${created}${warnings}${folders}`, {
          platform,
          task: task ? compactTask(task) : null,
          conversion: result.conversion ?? { warnings: [] },
          foldersCreated: result.foldersCreated ?? []
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // create_task_from_template
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_task_from_template',
    {
      title: 'Create a task from a template',
      description:
        'Create a real scheduled task from a catalog template (get the template id and its parameters from list_templates). ' +
        'The server fills the template\'s {{placeholders}} from `parameters`, converts the cron schedule to the platform\'s ' +
        'native trigger, and registers the task (a Windows task is created via the signed local agent). ' +
        `Only ${CREATABLE_PLATFORMS.join(' and ')} can actually be created today.`,
      inputSchema: {
        templateId: z.string().describe('The template id (from list_templates).'),
        platform: z
          .enum(CREATABLE_PLATFORMS)
          .default('WINDOWS_TASK_SCHEDULER')
          .describe('Where to create the task. Only Windows and Cronsole-native are creatable today.'),
        name: z
          .string()
          .optional()
          .describe('Task name. Defaults to the template name. Must be unique among tracked Windows tasks.'),
        schedule: z
          .string()
          .optional()
          .describe("5-field UTC cron (min hour dom month dow). Defaults to the template's schedule."),
        folder: z
          .string()
          .optional()
          .describe(
            'Windows only: the Task Scheduler folder to create the task in, e.g. "\\\\Cronsole" (default) or ' +
            '"\\\\Work\\\\Backups". This also becomes the task\'s category in Cronsole. The folder MUST ALREADY ' +
            'EXIST — Cronsole creates only its own "\\\\Cronsole" folder, because removing a folder needs elevation ' +
            'and it will not leave behind one the user has to delete by hand. Folders under "\\\\Microsoft\\\\" are ' +
            'refused outright: Windows keeps its own scheduled tasks there and a name collision would silently ' +
            'overwrite one.'
          ),
        parameters: z
          .record(z.string(), z.string())
          .optional()
          .describe('Values for the template\'s {{placeholders}}, keyed by parameter name. Required params must be provided.')
      }
    },
    async ({ templateId, platform, name, schedule, folder, parameters }) => {
      try {
        const body: Record<string, unknown> = { platform };
        if (name) body.name = name;
        if (schedule) body.schedule = schedule;
        if (folder) body.folder = folder;
        if (parameters) body.parameters = parameters;

        const result = await client.post<Record<string, unknown>>(
          `/templates/${encodeURIComponent(templateId)}/apply`,
          body
        );
        const conv = result.conversion as { warnings?: string[]; lossy?: 'approximated' | 'replaced' } | undefined;
        const lossyLead =
          conv?.lossy === 'replaced'
            ? '\nThe schedule was REPLACED — the cron was discarded for an hourly trigger, so this runs far more often than the template asked. '
            : '';
        const warnings = conv?.warnings?.length
          ? lossyLead + `\nSchedule conversion warnings: ${conv.warnings.join('; ')}`
          : '';
        const msg = typeof result.message === 'string' ? result.message : 'Template applied';
        return ok(`${msg}${warnings}`, { templateId, platform, result });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // convert_schedule
  // -------------------------------------------------------------------------
  server.registerTool(
    'convert_schedule',
    {
      title: 'Convert / validate a cron schedule',
      description:
        'Check how a 5-field UTC cron expression converts to a target platform\'s native trigger before creating a task. ' +
        'Returns a confidence score (0–1), any lossy-conversion warnings, the resulting Windows trigger, and a machine-readable ' +
        '`lossy` field. A score of 0 means the expression is invalid or not convertible. ' +
        'IMPORTANT: 0.7 is returned for TWO different risks the score alone cannot distinguish — read `lossy`: ' +
        '"approximated" means the trigger IS built from your cron but drifts (an uneven */N step), while "replaced" means your ' +
        'cron was DISCARDED for a fixed hourly trigger (it then runs about 24×/day no matter what you asked). Trust `lossy` and ' +
        'the trigger, not the number.',
      inputSchema: {
        schedule: z
          .string()
          .describe('A 5-field cron expression in UTC: "min hour day-of-month month day-of-week".'),
        platform: z
          .enum(ALL_PLATFORMS)
          .default('WINDOWS_TASK_SCHEDULER')
          .describe('Target platform. Only Windows performs a real trigger conversion; others consume cron directly.')
      }
    },
    async ({ schedule, platform }) => {
      try {
        const result = await client.post<{
          score: number;
          warnings: string[];
          trigger: WindowsTrigger | null;
          lossy?: 'approximated' | 'replaced';
          requestedRuns?: string[];
          effectiveRuns?: string[] | null;
          diverges?: boolean;
        }>('/tasks/preview', { platform, schedule });
        const warnings = result.warnings?.length ? `\nWarnings: ${result.warnings.join('; ')}` : '';
        const trigger = result.trigger ? `\nTrigger: ${describeTrigger(result.trigger)}` : '';
        // Name the register the 0.7 score hides. 'replaced' is the dangerous one:
        // the schedule you asked for was thrown away, not merely rounded.
        const lossy =
          result.lossy === 'replaced'
            ? '\nLossy: REPLACED — your cron was discarded for the trigger above (it runs far MORE often than asked).'
            : result.lossy === 'approximated'
              ? '\nLossy: approximated — the trigger is built from your cron but drifts after the first cycle.'
              : '';
        // Dates, because they are the only rendering nobody can misread. A bare
        // confidence of 1.0 is exactly what the Monday-only bug printed, and
        // "REPLACED" still requires the reader to know what that costs; two run
        // lists that disagree do not.
        const runs = result.diverges && result.effectiveRuns?.length
          ? `\nYou asked for: ${(result.requestedRuns ?? []).slice(0, 3).join(', ') || 'never'}` +
            `\nIt will ACTUALLY run: ${result.effectiveRuns.slice(0, 3).join(', ')}, …`
          : result.requestedRuns?.length
            ? `\nNext runs (UTC): ${result.requestedRuns.slice(0, 3).join(', ')}`
            : '';
        const text =
          result.score > 0
            ? `Convertible for ${platform} (confidence ${result.score}).${trigger}${lossy}${runs}${warnings}`
            : `Not convertible for ${platform} (score 0).${warnings}`;
        return ok(text, { platform, schedule, ...result });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // create_native_task
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_native_task',
    {
      title: 'Create a Cronsole-native HTTP task',
      description:
        'Create a Cronsole-native task that makes an HTTP request on a schedule — run by the Cronsole backend ' +
        'itself, with no agent and no machine to be logged into. Use this instead of create_task when the job ' +
        'IS an HTTP call and you need more than a plain GET: this takes a full job spec (method, headers, body), ' +
        'where create_task with platform=TASKHUB_NATIVE only accepts a URL. ' +
        'Good for pinging a health endpoint, triggering a webhook, or poking a deploy hook.',
      inputSchema: {
        name: z.string().describe('Task name.'),
        url: z.string().describe('The URL to request. Must be absolute, e.g. "https://example.com/health".'),
        schedule: z
          .string()
          .describe(
            '5-field cron in UTC: "min hour dom month dow". Native tasks are run by the backend\'s own cron ' +
            'scheduler, so the expression is used AS GIVEN — no Windows trigger conversion, and none of the ' +
            'hourly-fallback risk that applies to Windows tasks.'
          ),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'])
          .default('GET')
          .describe('HTTP method. Defaults to GET.'),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe('Request headers, e.g. {"Authorization": "Bearer …", "Content-Type": "application/json"}.'),
        body: z
          .string()
          .optional()
          .describe('Request body as a string. For JSON, pass the serialized JSON and set a Content-Type header.'),
        category: z.string().optional().describe('Cronsole category for grouping. Defaults to "Cronsole".')
      }
    },
    async ({ name, url, schedule, method, headers, body, category }) => {
      try {
        // The route takes the job as a nested spec and validates it with the same
        // validateJob the executor uses — so the shape is the backend's, not ours.
        //
        // `jobType` is REQUIRED and was missing here from the day this tool
        // shipped, so every call 400'd with "Unsupported jobType: undefined".
        // Nothing caught it: the suite stubs the HTTP client, which pins what
        // this wrapper *sends* and can never prove the API *accepts* it. That is
        // the gap docs/testing/README.md already names — drive a wrapped route by
        // hand after touching it (troubleshooting #44).
        const job: Record<string, unknown> = { jobType: 'HTTP', url, method };
        if (headers) job.headers = headers;
        if (body) job.body = body;

        const payload: Record<string, unknown> = { name, schedule, job };
        if (category) payload.category = category;

        const result = await client.post<{ message?: string; task?: TaskRow }>('/tasks/native', payload);
        const task = result.task;
        const created = task
          ? `\n${task.name} [${task.platform}] — ${task.schedule ?? 'no schedule'} — ${task.status} (id: ${task.id})` +
            (task.nextRunTime ? `\nNext run: ${task.nextRunTime}` : '')
          : '';
        const msg = typeof result.message === 'string' ? result.message : 'Native task created';
        return ok(`${msg}${created}`, { task: task ? compactTask(task) : null });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // create_native_script_task
  // -------------------------------------------------------------------------
  server.registerTool(
    'create_native_script_task',
    {
      title: 'Create a Cronsole-native task that runs a program',
      description:
        'Create a Cronsole-native task that RUNS A PROGRAM on a schedule, executed by the Cronsole backend ' +
        'itself rather than by an OS scheduler. Use this when the job is a script or executable and you want ' +
        'real run results — exit code, duration and captured output land in the task history, unlike a Windows ' +
        'task where a SUCCESS only means the agent accepted the start. ' +
        'IMPORTANT: this runs wherever the Cronsole BACKEND runs, which is the user\'s machine for a normal ' +
        'local install but is INSIDE THE CONTAINER if the backend is Dockerized — where their paths and tools ' +
        'do not exist. Check the executionHost on the Cronsole-native row of GET /api/tools/platforms if the ' +
        'user\'s environment is unknown, and prefer create_task with platform=WINDOWS_TASK_SCHEDULER for a job ' +
        'that must run as the user on their desktop or survive Cronsole being down. ' +
        'The command is tokenized server-side and run with NO SHELL, so pipes, redirection and && are ordinary ' +
        'characters — name cmd.exe /c or /bin/sh -c explicitly if the job genuinely needs them.',
      inputSchema: {
        name: z.string().describe('Task name.'),
        command: z
          .string()
          .describe(
            'The command line to run, e.g. powershell -NoProfile -File "D:\scripts\backup.ps1". ' +
            'Quote any argument containing spaces; it is split into an executable plus discrete arguments ' +
            'server-side, never passed to a shell.'
          ),
        schedule: z
          .string()
          .describe(
            '5-field cron in UTC: "min hour dom month dow". Used AS GIVEN by the backend scheduler — no ' +
            'Windows trigger conversion and none of its lossiness.'
          ),
        workingDirectory: z
          .string()
          .optional()
          .describe('Directory to run in. Must exist on the machine the backend runs on.'),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Kill the job after this long. Defaults to 5 minutes; 60 minutes is the maximum.'),
        category: z.string().optional().describe('Cronsole category for grouping. Defaults to "Cronsole".')
      }
    },
    async ({ name, command, schedule, workingDirectory, timeoutMs, category }) => {
      try {
        const job: Record<string, unknown> = { jobType: 'EXEC', command };
        if (workingDirectory) job.workingDirectory = workingDirectory;
        if (timeoutMs !== undefined) job.timeoutMs = timeoutMs;

        const payload: Record<string, unknown> = { name, schedule, job };
        if (category) payload.category = category;

        const result = await client.post<{ message?: string; task?: TaskRow }>('/tasks/native', payload);
        const task = result.task;
        const created = task
          ? `
${task.name} [${task.platform}] — ${task.schedule ?? 'no schedule'} — ${task.status} (id: ${task.id})` +
            (task.nextRunTime ? `
Next run: ${task.nextRunTime}` : '')
          : '';
        const msg = typeof result.message === 'string' ? result.message : 'Native task created';
        return ok(`${msg}${created}`, { task: task ? compactTask(task) : null });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_task_history
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_task_history',
    {
      title: 'Get a task\'s recent run history',
      description:
        'Show the recent execution history for a task — when it ran, whether it succeeded, how long it took, ' +
        'and any captured output. This is how you answer "did last night\'s job actually work?". ' +
        'Returns at most the 20 most recent runs (a server-side cap), newest first. ' +
        'IMPORTANT: history only covers runs Cronsole knows about — manual runs it triggered and Cronsole-native ' +
        'scheduler fires. A Windows task that ran on its own trigger is recorded by Windows, not here, so an ' +
        'empty history does NOT mean the task never ran. Note too that a SUCCESS here means the run was ' +
        'dispatched and reported success — a task that hangs forever can still report SUCCESS, so for a ' +
        'suspected hang check Windows\' own LastTaskResult rather than trusting this.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(20)
          .default(20)
          .describe('Max runs to return (default 20, which is also the server-side maximum).')
      }
    },
    async ({ taskId, limit }) => {
      try {
        const runs = await client.get<ExecutionRow[]>(
          `/tasks/${encodeURIComponent(taskId)}/executions`
        );
        const rows = (runs ?? []).slice(0, limit);
        if (rows.length === 0) {
          // Say what the emptiness does and does not mean. "No runs" read as
          // "never ran" would be a confident lie for a Windows task firing on
          // its own trigger — those runs are recorded by Windows, not Cronsole.
          return ok(
            'No run history recorded for this task.\n' +
            'This means Cronsole has not recorded a run — it does NOT necessarily mean the task never ran: ' +
            'a Windows task firing on its own trigger is recorded by Windows, not by Cronsole. ' +
            'Cronsole records manual runs it triggered and Cronsole-native scheduler fires.',
            { taskId, returned: 0, runs: [] }
          );
        }
        const summary = rows
          .map(r => {
            const dur = r.durationMs !== null && r.durationMs !== undefined ? ` — ${r.durationMs}ms` : '';
            const log = r.log ? `\n    ${r.log.replace(/\s+/g, ' ').slice(0, 300)}` : '';
            return `• ${r.triggeredAt} — ${r.status}${dur}${log}`;
          })
          .join('\n');
        return ok(`${rows.length} recent run(s), newest first:\n${summary}`, {
          taskId,
          returned: rows.length,
          runs: rows
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // export_task
  // -------------------------------------------------------------------------
  server.registerTool(
    'export_task',
    {
      title: 'Export a task\'s definition',
      description:
        'Export a task\'s full definition. A Windows task exports as native Task Scheduler XML (the same thing ' +
        'Export-ScheduledTask and the Task Scheduler UI produce, so it re-imports into any Windows machine); ' +
        'a Cronsole-native task exports as Cronsole JSON. Useful for inspecting exactly what is registered, ' +
        'backing a task up before changing it, or moving it to another machine. ' +
        'IMPORTANT if you save the XML to a file: Windows requires it as UTF-16 LE with a BOM. Writing it as ' +
        'UTF-8 (the default almost everywhere) produces a file Windows refuses with "unable to switch the ' +
        'encoding" — the text below is correct, but the encoding you save it in is on you.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).')
      }
    },
    async ({ taskId }) => {
      try {
        // Must go through getBuffer: a Windows export is UTF-16 LE + BOM bytes,
        // and letting axios decode them as UTF-8 yields mojibake.
        const { data, contentType } = await client.getBuffer(
          `/tasks/${encodeURIComponent(taskId)}/export`
        );
        const isXml = contentType.includes('xml');

        if (isXml) {
          // Strip the BOM and decode from the encoding the route actually sends,
          // so the model reads real XML rather than every-other-byte garbage.
          const utf16 = contentType.toLowerCase().includes('utf-16');
          const hasBom = data.length >= 2 && data[0] === 0xff && data[1] === 0xfe;
          const body = hasBom ? data.subarray(2) : data;
          const xml = utf16 ? body.toString('utf16le') : body.toString('utf8');
          return ok(
            `Windows Task Scheduler XML for task ${taskId}:\n\n${xml}\n\n` +
            'Note: to re-import this into Windows, it must be saved as UTF-16 LE with a BOM — ' +
            'a UTF-8 file is rejected with "unable to switch the encoding".',
            { taskId, format: 'windows-xml', xml }
          );
        }

        // Cronsole-native: JSON straight from the DB row.
        const json = JSON.parse(data.toString('utf8'));
        return ok(
          `Cronsole-native task definition for ${taskId}:\n\n${JSON.stringify(json, null, 2)}`,
          { taskId, format: 'cronsole-json', definition: json }
        );
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // set_task_status
  // -------------------------------------------------------------------------
  server.registerTool(
    'set_task_status',
    {
      title: 'Enable or disable a task',
      description:
        'Enable or disable a scheduled task. This is THE right way to stop a task from running without deleting ' +
        'it — do NOT try to park a task by giving it a rare cron schedule (an expression Windows cannot express ' +
        'is silently REPLACED with an hourly trigger, so "once a year" becomes "every hour"). ' +
        'Disabling keeps the task and its definition intact and is fully reversible: enable it again to resume. ' +
        'For a Windows task this sends a signed command to the local agent; the change is written to Cronsole ' +
        'only after the platform confirms it.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).'),
        status: z
          .enum(['ACTIVE', 'DISABLED'])
          .describe('ACTIVE enables the task; DISABLED stops it running without deleting it.')
      }
    },
    async ({ taskId, status }) => {
      try {
        const task = await client.patch<TaskRow>(
          `/tasks/${encodeURIComponent(taskId)}/status`,
          { status }
        );
        const verb = status === 'ACTIVE' ? 'enabled' : 'disabled';
        const next = task.nextRunTime ? ` — next run ${task.nextRunTime}` : '';
        return ok(`Task ${verb}: ${task.name} [${task.platform}]${next}`, {
          taskId,
          status,
          task: compactTask(task)
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // update_task_schedule
  // -------------------------------------------------------------------------
  server.registerTool(
    'update_task_schedule',
    {
      title: 'Change a task\'s schedule',
      description:
        'Change when an existing task runs, without deleting and recreating it. For a Windows task the agent ' +
        'rebuilds only the trigger — the command, working directory, and permissions are preserved — and ' +
        'Cronsole records the change only after the platform confirms it. ' +
        'IMPORTANT: check the new schedule with convert_schedule FIRST and read the returned trigger, not just ' +
        'the confidence score. A cron Windows cannot express natively is REPLACED with an hourly trigger rather ' +
        'than refused, and it only ever runs MORE often than you asked. ' +
        'Only tasks whose trigger is expressible as cron can be re-scheduled: a Windows task that runs at boot, ' +
        'logon, or on an event has no cron form and is refused honestly.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).'),
        schedule: z
          .string()
          .describe(
            '5-field cron in UTC: "min hour dom month dow". Cronsole stores all schedules as UTC and displays ' +
            'them in local time — do not pass local time.'
          )
      }
    },
    async ({ taskId, schedule }) => {
      try {
        const task = await client.patch<TaskRow>(
          `/tasks/${encodeURIComponent(taskId)}/schedule`,
          { schedule }
        );
        const next = task.nextRunTime ? `\nNext run: ${task.nextRunTime}` : '';
        return ok(
          `Schedule updated: ${task.name} [${task.platform}] now runs on "${task.schedule ?? schedule}" (UTC cron).${next}`,
          { taskId, schedule, task: compactTask(task) }
        );
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // update_task_action
  // -------------------------------------------------------------------------
  server.registerTool(
    'update_task_action',
    {
      title: 'Change what a task runs',
      description:
        'Change an existing task\'s command, working directory, description, or run level. The agent replaces ' +
        'the task\'s action while preserving its trigger and the account it runs as, and Cronsole records the ' +
        'change only after the platform confirms it. ' +
        'The command is structured server-side into a no-shell {executable, args[]} action, exactly as on create ' +
        '— so a shell is NOT implied: to use pipes, redirection, or `&&` you must invoke one explicitly, ' +
        'e.g. cmd.exe /c "…". ' +
        'NOTE: this REPLACES the action rather than patching it — `command` and `runLevel` are both required, ' +
        'so pass the full command you want even if you are only changing the working directory, and read the ' +
        'task\'s current values first (list_tasks / export_task) rather than guessing.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).'),
        command: z
          .string()
          .describe(
            'The full command to run, e.g. `powershell.exe -NoProfile -File "C:\\\\jobs\\\\backup.ps1"`. ' +
            'Replaces the existing action entirely — it is not merged with it.'
          ),
        runLevel: z
          .enum(['least', 'highest'])
          .describe(
            "'least' runs with the user's normal rights; 'highest' runs elevated. Required — pass the task's " +
            'current level unless you intend to change it. Prefer least unless the job genuinely needs elevation.'
          ),
        workingDirectory: z
          .string()
          .optional()
          .describe('Directory to run the command in. Omit to clear it.'),
        description: z
          .string()
          .optional()
          .describe('Free-text description shown in Task Scheduler. Omit to clear it. Max 1024 characters.')
      }
    },
    async ({ taskId, command, runLevel, workingDirectory, description }) => {
      try {
        const body: Record<string, unknown> = { command, runLevel };
        if (workingDirectory !== undefined) body.workingDirectory = workingDirectory;
        if (description !== undefined) body.description = description;

        const task = await client.patch<TaskRow>(
          `/tasks/${encodeURIComponent(taskId)}/actions`,
          body
        );
        return ok(
          `Action updated: ${task.name} [${task.platform}] now runs \`${command}\`` +
          `${workingDirectory ? ` in ${workingDirectory}` : ''} at run level "${runLevel}".` +
          '\nThe task\'s schedule and the account it runs as were preserved.',
          { taskId, command, runLevel, task: compactTask(task) }
        );
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // untrack_task — the reversible removal. Deliberately UNGATED.
  // -------------------------------------------------------------------------
  //
  // Before this existed the only removal on the surface was `delete_task`, which
  // destroys the real scheduler entry and is gated. So an agent asked to "clean
  // up my dashboard" had exactly one tool for the job, and it was the
  // irreversible one — the same gate-makes-the-safe-path-harder failure that
  // keeps `set_task_status` ungated (see the header). Adding the safe verb is
  // what makes gating the dangerous one honest.
  //
  // Ungated because the scheduled task itself is untouched and the row can be
  // re-imported: nothing is destroyed that the platform doesn't still hold. The
  // Cronsole-only loss is the run history, which is stated in the description
  // rather than glossed over.
  server.registerTool(
    'untrack_task',
    {
      title: 'Remove a task from Cronsole, keeping it on the platform',
      description:
        'Stop tracking a task in Cronsole WITHOUT deleting it. The real scheduled task is left alone — it stays ' +
        'on the machine and keeps running on its own schedule; only Cronsole\'s record of it (and its Cronsole run ' +
        'history) is removed, and future syncs will not re-import it. ' +
        'This is the right tool for cleaning up a dashboard, undoing an over-broad import, or hiding tasks the ' +
        'user does not care about — use it instead of delete_task for anything that is not genuinely meant to ' +
        'stop existing. ' +
        'Reversible: importing that category again in the Cronsole UI starts tracking the task once more. ' +
        'Not available for TASKHUB_NATIVE tasks, which exist only inside Cronsole and therefore have nothing to ' +
        'be kept — disable or delete those instead.',
      inputSchema: {
        taskId: z.string().describe('The Cronsole task id (from list_tasks).')
      }
    },
    async ({ taskId }) => {
      try {
        const result = await client.post<{ message?: string; externalId?: string; detail?: string }>(
          `/tasks/${encodeURIComponent(taskId)}/untrack`,
          {}
        );
        const detail = typeof result.detail === 'string'
          ? result.detail
          : 'Removed from Cronsole. The scheduled task still exists on its platform.';
        return ok(detail, {
          taskId,
          untracked: true,
          externalId: result.externalId,
          // Named explicitly so a caller reading only the structured payload
          // cannot mistake this for a delete.
          platformEntryKept: true
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // list_platforms — what Cronsole can actually do here, and how it knows
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_platforms',
    {
      title: 'List platforms and what Cronsole can do with each',
      description:
        'The capability matrix: for every connected platform, which verbs Cronsole can perform and the evidence ' +
        'behind each claim. Call this BEFORE planning work you are not sure is possible — it is the difference ' +
        'between a tool that will refuse and one that has simply never been used here. ' +
        'Each capability is one of three states, and the middle one carries the meaning: ' +
        '`verified` = it has actually succeeded on this install, with the timestamp that earned it; ' +
        '`declared` = the route would accept it, but nothing has been observed to work yet; ' +
        '`unsupported` = the route would refuse, because the platform has no such API. ' +
        '`unsupported` is a boundary, not a to-do: no amount of retrying turns it into `verified`. ' +
        'Example: Claude Code reports `create` and `setStatus` as unsupported, because Anthropic exposes exactly ' +
        'one routines endpoint (fire) and no way to create or pause one.',
      inputSchema: {
        platform: z
          .enum(ALL_PLATFORMS)
          .optional()
          .describe('Only this platform. Omit for every platform that has a connector.')
      }
    },
    async ({ platform }) => {
      try {
        const result = await client.get<{ platforms: PlatformMatrixRow[] }>('/tools/platforms');
        let rows = result.platforms ?? [];
        if (platform) rows = rows.filter(p => p.platform === platform);
        if (!rows.length) {
          return ok(
            platform
              ? `No capability row for ${platform}. Only platforms with a connector appear here; link-only platforms do not.`
              : 'No platforms reported.',
            { platforms: [] }
          );
        }

        const summary = rows
          .map(p => {
            const verified = p.capabilities.filter(c => c.support === 'verified').map(c => c.verb);
            const declared = p.capabilities.filter(c => c.support === 'declared').map(c => c.verb);
            const unsupported = p.capabilities.filter(c => c.support === 'unsupported').map(c => c.verb);
            const health = p.configured
              ? `${p.healthState ?? 'unknown'}${p.healthReason ? ` — ${p.healthReason}` : ''}`
              : 'not connected';
            return [
              `• ${p.label} (${p.platform}) — ${p.maturity}, ${p.taskCount} task(s), health: ${health}`,
              `    verified:    ${verified.join(', ') || '—'}`,
              `    declared:    ${declared.join(', ') || '—'}`,
              `    unsupported: ${unsupported.join(', ') || '—'}`
            ].join('\n');
          })
          .join('\n');

        return ok(`${rows.length} platform(s).\n${summary}`, { platforms: rows });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // Claude Code routines
  // -------------------------------------------------------------------------
  //
  // There is no `create_claude_routine`, and there cannot be. Anthropic exposes
  // exactly one routines endpoint — POST /v1/claude_code/routines/{id}/fire —
  // whose token the reference scopes as "One routine only; no read access".
  // Routines are created at claude.ai or with /schedule in the Claude Code CLI.
  // What Cronsole can do is learn a routine's id and token so it can fire it,
  // which is `connect`, not `create`. Naming the tool for the verb it actually
  // performs is the same rule the Platforms matrix follows one layer down.
  server.registerTool(
    'list_claude_routines',
    {
      title: 'List the Claude Code routines Cronsole can fire',
      description:
        'The routines declared in the Claude connection, WITHOUT their tokens. Note this is not a read of your ' +
        'claude.ai account: Claude Code has no list API, so this returns what has been connected to Cronsole and ' +
        'nothing else. A routine you created at claude.ai will not appear until it is connected here, and one ' +
        'deleted there will still appear until its next run returns 404. ' +
        '`taskCount` is how many tracked Cronsole tasks point at each routine — what disconnecting would strand.',
      inputSchema: {}
    },
    async () => {
      try {
        const result = await client.get<{ routines: ClaudeRoutineRow[] }>(
          '/tools/platforms/claude/routines'
        );
        const routines = result.routines ?? [];
        if (!routines.length) {
          return ok(
            'No Claude routines are connected. Create one at claude.ai/code/routines (or with /schedule in the ' +
              'Claude Code CLI), then connect it with connect_claude_routine.',
            { routines: [] }
          );
        }
        const summary = routines
          .map(r => `• ${r.name || r.id} (${r.id}) — ${r.taskCount} tracked task(s)`)
          .join('\n');
        return ok(`${routines.length} connected routine(s).\n${summary}`, { routines });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'connect_claude_routine',
    {
      title: 'Connect an existing Claude Code routine so Cronsole can fire it',
      description:
        'Store a routine\'s id and API token so it appears on the dashboard with a working Run. ' +
        'This does NOT create a routine — Anthropic exposes no create endpoint. The routine must already exist ' +
        'at claude.ai/code/routines (or be made with /schedule in the Claude Code CLI), and must have an API ' +
        'trigger: open the routine, Edit, Add another trigger, API, then Generate token. ' +
        'SECURITY: the token is a live credential and is passed here as a plain parameter, so it will appear in ' +
        'this conversation and in the MCP host\'s logs. If a human is available, prefer the Cronsole UI ' +
        '(Dashboard, New Task, Claude — or the Platforms tab), where the token goes straight into encrypted ' +
        'storage without passing through a model context. Ask before requesting a token from a user. ' +
        'Generating a token at claude.ai revokes the previous one for that routine, so re-connecting an id ' +
        'here replaces the stored token rather than erroring — that is the rotation path. ' +
        'Cronsole cannot read or set a routine\'s schedule; the cadence stays at claude.ai and the task will ' +
        'show no cron.',
      inputSchema: {
        routineId: z
          .string()
          .min(1)
          .describe(
            'The trig_… routine id, or the whole fire URL from the API trigger dialog (the id is extracted). ' +
            'The routine\'s own page URL carries the same id.'
          ),
        token: z
          .string()
          .min(1)
          .describe(
            'The per-routine bearer token (sk-ant-oat01-…). Shown once by claude.ai and not retrievable later.'
          ),
        name: z
          .string()
          .optional()
          .describe('Display name on the dashboard. Defaults to the routine id, which is unreadable but never wrong.'),
        importNow: z
          .boolean()
          .default(true)
          .describe(
            'Also run the import so the routine becomes a task immediately (what the UI does). Set false to ' +
            'store the credential only — it will not appear on the dashboard until sync_tasks runs.'
          )
      }
    },
    async ({ routineId, token, name, importNow }) => {
      try {
        const result = await client.post<{
          routine: ClaudeRoutineRow;
          replaced: boolean;
          warnings?: string[];
        }>('/tools/platforms/claude/routines', {
          id: routineId,
          token,
          ...(name ? { name } : {})
        });

        let imported = false;
        if (importNow) {
          await client.post('/tasks/sync', { categories: ['Claude'] });
          imported = true;
        }

        const verb = result.replaced ? 'Re-connected (token replaced)' : 'Connected';
        const warnings = result.warnings ?? [];
        // Surfaced, not swallowed: it saved anyway, so silence would leave a
        // likely-wrong value to fail at the first run instead of here.
        const warnText = warnings.length ? `\nWARNING: ${warnings.join(' ')}` : '';
        const importText = imported
          ? '\nImported — it is on the dashboard now.'
          : '\nNot imported. Call sync_tasks with category "Claude" to make it appear.';
        return ok(
          `${verb} routine "${result.routine.name || result.routine.id}" (${result.routine.id}).` +
            `${importText}${warnText}\n` +
            'The routine still runs on its own schedule at claude.ai — Cronsole can trigger it, not reschedule it.',
          {
            routine: result.routine,
            replaced: result.replaced,
            imported,
            warnings
          }
        );
      } catch (err) {
        return toolError(err);
      }
    }
  );

  server.registerTool(
    'disconnect_claude_routine',
    {
      title: 'Forget a Claude routine (it keeps running at claude.ai)',
      description:
        'Remove a routine\'s stored id and token from Cronsole. This is NOT a delete: the routine keeps running ' +
        'at claude.ai on its own schedule, and Cronsole has no API to stop or delete it — use claude.ai for that. ' +
        'One cost worth stating before you call it: the stored token is discarded and cannot be recovered, ' +
        'because claude.ai shows a token once. Re-connecting later means generating a new token there (which ' +
        'also revokes any other copy of the old one). ' +
        'Tracked tasks pointing at the routine survive and stay on the dashboard, but their Run will fail until ' +
        'it is re-connected; the count is reported back so you can say what was stranded.',
      inputSchema: {
        routineId: z.string().min(1).describe('The trig_… id (from list_claude_routines).')
      }
    },
    async ({ routineId }) => {
      try {
        const result = await client.delete<{
          removed: string;
          orphanedTasks: number;
          connectionRemoved: boolean;
        }>(`/tools/platforms/claude/routines/${encodeURIComponent(routineId)}`);
        const stranded = result.orphanedTasks
          ? ` ${result.orphanedTasks} tracked task(s) now point at a routine Cronsole cannot fire.`
          : '';
        const conn = result.connectionRemoved
          ? ' That was the last routine, so the Claude connection was removed too.'
          : '';
        return ok(
          `Disconnected ${result.removed}. The routine itself is untouched and still runs at claude.ai.${stranded}${conn}`,
          result
        );
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // sync_tasks — the import path
  // -------------------------------------------------------------------------
  server.registerTool(
    'sync_tasks',
    {
      title: 'Import or refresh tasks from their platforms',
      description:
        'Pull tasks from every connected platform into Cronsole. Two distinct modes, and picking the wrong one ' +
        'is the usual mistake: ' +
        'omit `categories` for a REFRESH of what you already track (statuses, schedules, last-run info) — this ' +
        'adds nothing new; ' +
        'pass `categories` to IMPORT those categories, which is how untracked tasks first appear. ' +
        'Call list_untracked_categories… (or the Import screen) to see what is available — on a real machine ' +
        'there can be hundreds of Windows folders, most of them Windows\' own. ' +
        'An explicit `categories` import also forgets any prior untracks inside those categories, because naming ' +
        'a category is the same gesture that started tracking it; a plain refresh deliberately does not, so a ' +
        'routine refresh can never undo a deliberate removal.',
      inputSchema: {
        categories: z
          .array(z.string())
          .optional()
          .describe(
            'Categories to import (e.g. ["Claude"]). Omit to refresh only what is already tracked. ' +
            'For Windows these are the root scheduler folder names; Claude routines all file under "Claude".'
          )
      }
    },
    async ({ categories }) => {
      try {
        const body = categories?.length ? { categories } : { scope: 'tracked' as const };
        const result = await client.post<{ message?: string; results?: SyncResultRow[] }>(
          '/tasks/sync',
          body
        );
        const rows = result.results ?? [];
        const summary = rows.length
          ? rows
              .map(r => {
                const untracked = r.untracked?.count
                  ? ` — ${r.untracked.count} still untracked`
                  : '';
                const missing = r.missing ? `, ${r.missing} missing` : '';
                return `• ${r.platform}: ${r.count} tracked${missing}${untracked}`;
              })
              .join('\n')
          : 'No platforms reported.';
        const mode = categories?.length
          ? `Imported categories: ${categories.join(', ')}.`
          : 'Refreshed the tasks already tracked (nothing new imported).';
        return ok(`${mode}\n${summary}`, { mode: categories?.length ? 'import' : 'refresh', results: rows });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // get_task_health
  // -------------------------------------------------------------------------
  server.registerTool(
    'get_task_health',
    {
      title: 'Score every task and rank the worst first',
      description:
        'The health scan: a tier and a score per task, with signals that each name the field they came from. ' +
        'Use it to answer "what is broken?" across the whole dashboard rather than task by task. ' +
        'Two readings matter. `unknown` is NOT `ok` — it means no evidence has been reported (an agent that has ' +
        'never re-published omits lastTaskResult entirely), so treat it as "not checked", never as healthy. ' +
        'And `disabled` is not unhealthy: parking a task is the recommended safe action, so it is not flagged. ' +
        'Windows tasks are judged on Windows\' own lastTaskResult, not on Cronsole\'s run log — a Cronsole ' +
        'SUCCESS for a Windows task only means the agent accepted the start.',
      inputSchema: {
        tier: z
          .enum(['critical', 'attention', 'unknown', 'ok'])
          .optional()
          .describe('Only tasks in this tier. Omit for all, worst first.'),
        includeSystem: z
          .boolean()
          .default(false)
          .describe(
            'Include the tasks Windows itself owns (\\Microsoft\\…). Default false — on a real machine they ' +
            'dominate the worst-scoring list and bury your own tasks.'
          ),
        limit: z.number().int().min(1).max(200).default(20).describe('Max tasks to return (default 20).')
      }
    },
    async ({ tier, includeSystem, limit }) => {
      try {
        const result = await client.get<TaskHealthResponse>('/tools/task-health');
        let tasks = result.tasks ?? [];
        if (!includeSystem) tasks = tasks.filter(t => !t.isSystem);
        if (tier) tasks = tasks.filter(t => t.tier === tier);
        const matched = tasks.length;
        const rows = tasks.slice(0, limit);
        const c = result.counts;
        const header =
          `Scanned at ${result.evaluatedAt}. Across ${c.tasks} task(s): ` +
          `${c.critical} critical, ${c.attention} need attention, ${c.unknown} unknown (no evidence), ${c.ok} ok.`;
        const body = rows.length
          ? rows
              .map(t => {
                const why = (t.signals ?? [])
                  .map(s => `      - [${s.severity}] ${s.summary} (${s.evidence})`)
                  .join('\n');
                return `• ${t.name} — ${t.tier} (score ${t.score}) [${t.platform}] id=${t.taskId}\n${why}`;
              })
              .join('\n')
          : 'No tasks match.';
        const note = matched > rows.length ? `\nShowing ${rows.length} of ${matched} matching.` : '';
        return ok(`${header}\n${body}${note}`, {
          evaluatedAt: result.evaluatedAt,
          counts: c,
          matched,
          returned: rows.length,
          tasks: rows
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // list_run_history — across tasks, unlike get_task_history
  // -------------------------------------------------------------------------
  server.registerTool(
    'list_run_history',
    {
      title: 'Run history across every task',
      description:
        'Cross-task run history — "what failed this month?", which get_task_history cannot answer because it ' +
        'takes one task id. ' +
        'CRITICAL caveat: these are runs CRONSOLE PERFORMED, not every run that happened. A Windows task firing ' +
        'on its own schedule writes nothing here, so an empty result does NOT mean nothing ran. Every row carries ' +
        'a `runKind` so status is readable: `native-execution` is a real outcome (exit code, duration), while ' +
        '`manual-trigger` on a Windows task means only that the agent accepted the start. ' +
        'For "is this task actually healthy?", prefer get_task_health, which reads the platform\'s own verdict.',
      inputSchema: {
        status: z
          .array(z.enum(['SUCCESS', 'FAILURE', 'RUNNING', 'TIMEOUT']))
          .optional()
          .describe('Only these outcomes, e.g. ["FAILURE"].'),
        platform: z.enum(ALL_PLATFORMS).optional().describe('Only runs of tasks on this platform.'),
        taskId: z.string().optional().describe('Only runs of this task (same as get_task_history, with the cross-task shape).'),
        from: z.string().optional().describe('ISO date/time lower bound. Defaults to 30 days ago.'),
        to: z.string().optional().describe('ISO date/time upper bound. Defaults to now.'),
        limit: z.number().int().min(1).max(500).default(50).describe('Max rows (default 50).')
      }
    },
    async ({ status, platform, taskId, from, to, limit }) => {
      try {
        const params: Record<string, unknown> = { limit };
        if (status?.length) params.status = status.join(',');
        if (platform) params.platform = platform;
        if (taskId) params.taskId = taskId;
        if (from) params.from = from;
        if (to) params.to = to;

        const result = await client.get<RunHistoryResponse>('/tools/history', params);
        const m = result.matched;
        const rows = result.rows ?? [];
        const header =
          `${m.runs} run(s) between ${result.range.from} and ${result.range.to} — ` +
          `${m.succeeded} succeeded, ${m.failed} failed, ${m.pending} pending.` +
          (result.truncated ? ` Showing the first ${rows.length}.` : '');
        const body = rows.length
          ? rows
              .map(r => {
                const dur = r.durationMs != null ? ` ${r.durationMs}ms` : '';
                return `• ${r.triggeredAt} ${r.status}${dur} — ${r.taskName} [${r.platform}] (${r.runKind})`;
              })
              .join('\n')
          : 'No runs match. Remember a Windows task running on schedule records nothing here.';
        return ok(`${header}\n${body}`, {
          range: result.range,
          matched: m,
          returned: rows.length,
          truncated: result.truncated,
          rows
        });
      } catch (err) {
        return toolError(err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // delete_task — registered ONLY when explicitly allowed.
  // -------------------------------------------------------------------------
  //
  // Absent, not present-and-erroring, when the gate is closed: a tool the model
  // can see is a tool it will plan around, and a capability that announces itself
  // then refuses is worse than one that was never offered. `tools/list` is the
  // honest statement of what this server can do.
  if (options.allowDestructive) {
    server.registerTool(
      'delete_task',
      {
        title: 'Delete a task permanently',
        description:
          'PERMANENTLY delete a scheduled task. For a Windows task this removes the real Task Scheduler entry ' +
          'via the local agent (which runs elevated), and the Cronsole record is only removed after the platform ' +
          'confirms the deletion. This CANNOT be undone — there is no trash and no restore. ' +
          'Prefer set_task_status with DISABLED unless the task is genuinely meant to be gone: disabling stops ' +
          'the task running and is fully reversible. ' +
          'If the goal is to tidy the Cronsole dashboard rather than to destroy a scheduled task, use ' +
          'untrack_task instead — it removes the task from Cronsole and leaves it running on the machine. ' +
          'If you did not create the task in this session, export_task first so the definition can be rebuilt, ' +
          'and confirm with the user before calling this.',
        inputSchema: {
          taskId: z.string().describe('The Cronsole task id (from list_tasks).')
        }
      },
      async ({ taskId }) => {
        try {
          const result = await client.delete<{ message?: string }>(
            `/tasks/${encodeURIComponent(taskId)}`
          );
          const msg = typeof result.message === 'string' ? result.message : 'Task deleted';
          return ok(`${msg} (id: ${taskId}). This cannot be undone.`, { taskId, deleted: true });
        } catch (err) {
          return toolError(err);
        }
      }
    );
  }
}
