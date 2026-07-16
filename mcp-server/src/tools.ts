import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TaskHubClient, TaskHubApiError } from './client.js';

/**
 * Tool surface for the TaskHub MCP server (docs/ROADMAP.md › P3):
 *
 *   read      list_tasks · list_templates · list_folders · get_task_history ·
 *             export_task · convert_schedule
 *   create    create_task · create_native_task · create_task_from_template
 *   act       run_task
 *   modify    set_task_status · update_task_schedule · update_task_action
 *   destroy   delete_task            (only when allowDestructive — see below)
 *
 * Each tool is a thin call through TaskHubClient into the REST API. Business
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
   * fills it in itself. See TaskHubClientConfig.allowDestructive.
   */
  allowDestructive: boolean;
}

// The platforms TaskHub can actually create on today (the honesty pass gated the
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
    err instanceof TaskHubApiError
      ? err.status
        ? `TaskHub API error (HTTP ${err.status}): ${err.message}`
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
  client: TaskHubClient,
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
        'List the scheduled tasks TaskHub tracks for the current user (Windows Task Scheduler + TaskHub-native), ' +
        'with each task\'s schedule, status, next run time, and last run result. Optional filters narrow the list.',
      inputSchema: {
        platform: z
          .enum(ALL_PLATFORMS)
          .optional()
          .describe('Only tasks on this platform.'),
        status: z
          .enum(['ACTIVE', 'DISABLED', 'UNKNOWN', 'DELETED'])
          .optional()
          .describe('Only tasks with this status.'),
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
        'Trigger a task to run immediately by its TaskHub id (get ids from list_tasks). ' +
        'For a Windows task this sends a signed run command to the local agent; for a native task the backend runs it. ' +
        'Returns the run result.',
      inputSchema: {
        taskId: z.string().describe('The TaskHub task id (from list_tasks).')
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
        'List the TaskHub template catalog (starters + use-case patterns) with each template\'s id, category, tags, ' +
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
        'folder other than the default: TaskHub creates ONLY its own "\\TaskHub" folder, so every other folder ' +
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
        const note = `\nDefault folder: ${result.defaultFolder} (used when you omit \`folder\`; TaskHub creates this one itself).`;
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
            '5-field cron in UTC: "min hour dom month dow". TaskHub stores all schedules as UTC cron and ' +
            'displays them in local time — do not pass local time.'
          ),
        platform: z
          .enum(CREATABLE_PLATFORMS)
          .default('WINDOWS_TASK_SCHEDULER')
          .describe('Where to create the task. Only Windows and TaskHub-native are creatable today.'),
        category: z
          .string()
          .optional()
          .describe('TaskHub category for grouping. For Windows this defaults to the folder name.'),
        folder: z
          .string()
          .optional()
          .describe(
            'Windows only: the Task Scheduler folder to create the task in, e.g. "\\\\TaskHub" (default) or ' +
            '"\\\\Work\\\\Backups". The folder MUST ALREADY EXIST — TaskHub creates only its own "\\\\TaskHub" ' +
            'folder, because removing a folder needs elevation and it will not leave behind one the user has to ' +
            'delete by hand. Folders under "\\\\Microsoft\\\\" are refused outright: Windows keeps its own ' +
            'scheduled tasks there and a name collision would silently overwrite one.'
          )
      }
    },
    async ({ name, command, schedule, platform, category, folder }) => {
      try {
        const body: Record<string, unknown> = { name, command, schedule, platform };
        if (category) body.category = category;
        if (folder) body.folder = folder;

        const result = await client.post<{
          message?: string;
          task?: TaskRow;
          conversion?: { warnings?: string[] };
        }>('/tasks', body);

        // Surface lossy conversion at the same volume as success. The backend
        // accepts a fallback trigger rather than refusing it, so a task can be
        // created on a schedule that is not the one asked for — saying so here
        // is the difference between an honest result and a confident lie.
        const warnings = result.conversion?.warnings?.length
          ? `\nSchedule conversion warnings: ${result.conversion.warnings.join('; ')}` +
            '\nThe registered trigger may not match the cron you gave. Verify with convert_schedule.'
          : '';
        const task = result.task;
        const created = task
          ? `\n${task.name} [${task.platform}] — ${task.schedule ?? 'no schedule'} — ${task.status} (id: ${task.id})`
          : '';
        const msg = typeof result.message === 'string' ? result.message : 'Task created';
        return ok(`${msg}${created}${warnings}`, {
          platform,
          task: task ? compactTask(task) : null,
          conversion: result.conversion ?? { warnings: [] }
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
          .describe('Where to create the task. Only Windows and TaskHub-native are creatable today.'),
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
            'Windows only: the Task Scheduler folder to create the task in, e.g. "\\\\TaskHub" (default) or ' +
            '"\\\\Work\\\\Backups". This also becomes the task\'s category in TaskHub. The folder MUST ALREADY ' +
            'EXIST — TaskHub creates only its own "\\\\TaskHub" folder, because removing a folder needs elevation ' +
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
        const conv = result.conversion as { warnings?: string[] } | undefined;
        const warnings = conv?.warnings?.length
          ? `\nSchedule conversion warnings: ${conv.warnings.join('; ')}`
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
        'Returns a confidence score (0–1), any lossy-conversion warnings, and the resulting Windows trigger. ' +
        'A score of 0 means the expression is invalid or not convertible.',
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
        }>('/tasks/preview', { platform, schedule });
        const warnings = result.warnings?.length ? `\nWarnings: ${result.warnings.join('; ')}` : '';
        const trigger = result.trigger ? `\nTrigger: ${describeTrigger(result.trigger)}` : '';
        const text =
          result.score > 0
            ? `Convertible for ${platform} (confidence ${result.score}).${trigger}${warnings}`
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
      title: 'Create a TaskHub-native HTTP task',
      description:
        'Create a TaskHub-native task that makes an HTTP request on a schedule — run by the TaskHub backend ' +
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
        category: z.string().optional().describe('TaskHub category for grouping. Defaults to "TaskHub".')
      }
    },
    async ({ name, url, schedule, method, headers, body, category }) => {
      try {
        // The route takes the job as a nested spec and validates it with the same
        // validateJob the executor uses — so the shape is the backend's, not ours.
        const job: Record<string, unknown> = { url, method };
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
        'IMPORTANT: history only covers runs TaskHub knows about — manual runs it triggered and TaskHub-native ' +
        'scheduler fires. A Windows task that ran on its own trigger is recorded by Windows, not here, so an ' +
        'empty history does NOT mean the task never ran. Note too that a SUCCESS here means the run was ' +
        'dispatched and reported success — a task that hangs forever can still report SUCCESS, so for a ' +
        'suspected hang check Windows\' own LastTaskResult rather than trusting this.',
      inputSchema: {
        taskId: z.string().describe('The TaskHub task id (from list_tasks).'),
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
          // its own trigger — those runs are recorded by Windows, not TaskHub.
          return ok(
            'No run history recorded for this task.\n' +
            'This means TaskHub has not recorded a run — it does NOT necessarily mean the task never ran: ' +
            'a Windows task firing on its own trigger is recorded by Windows, not by TaskHub. ' +
            'TaskHub records manual runs it triggered and TaskHub-native scheduler fires.',
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
        'a TaskHub-native task exports as TaskHub JSON. Useful for inspecting exactly what is registered, ' +
        'backing a task up before changing it, or moving it to another machine. ' +
        'IMPORTANT if you save the XML to a file: Windows requires it as UTF-16 LE with a BOM. Writing it as ' +
        'UTF-8 (the default almost everywhere) produces a file Windows refuses with "unable to switch the ' +
        'encoding" — the text below is correct, but the encoding you save it in is on you.',
      inputSchema: {
        taskId: z.string().describe('The TaskHub task id (from list_tasks).')
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

        // TaskHub-native: JSON straight from the DB row.
        const json = JSON.parse(data.toString('utf8'));
        return ok(
          `TaskHub-native task definition for ${taskId}:\n\n${JSON.stringify(json, null, 2)}`,
          { taskId, format: 'taskhub-json', definition: json }
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
        'For a Windows task this sends a signed command to the local agent; the change is written to TaskHub ' +
        'only after the platform confirms it.',
      inputSchema: {
        taskId: z.string().describe('The TaskHub task id (from list_tasks).'),
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
        'TaskHub records the change only after the platform confirms it. ' +
        'IMPORTANT: check the new schedule with convert_schedule FIRST and read the returned trigger, not just ' +
        'the confidence score. A cron Windows cannot express natively is REPLACED with an hourly trigger rather ' +
        'than refused, and it only ever runs MORE often than you asked. ' +
        'Only tasks whose trigger is expressible as cron can be re-scheduled: a Windows task that runs at boot, ' +
        'logon, or on an event has no cron form and is refused honestly.',
      inputSchema: {
        taskId: z.string().describe('The TaskHub task id (from list_tasks).'),
        schedule: z
          .string()
          .describe(
            '5-field cron in UTC: "min hour dom month dow". TaskHub stores all schedules as UTC and displays ' +
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
        'the task\'s action while preserving its trigger and the account it runs as, and TaskHub records the ' +
        'change only after the platform confirms it. ' +
        'The command is structured server-side into a no-shell {executable, args[]} action, exactly as on create ' +
        '— so a shell is NOT implied: to use pipes, redirection, or `&&` you must invoke one explicitly, ' +
        'e.g. cmd.exe /c "…". ' +
        'NOTE: this REPLACES the action rather than patching it — `command` and `runLevel` are both required, ' +
        'so pass the full command you want even if you are only changing the working directory, and read the ' +
        'task\'s current values first (list_tasks / export_task) rather than guessing.',
      inputSchema: {
        taskId: z.string().describe('The TaskHub task id (from list_tasks).'),
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
          'via the local agent (which runs elevated), and the TaskHub record is only removed after the platform ' +
          'confirms the deletion. This CANNOT be undone — there is no trash and no restore. ' +
          'Prefer set_task_status with DISABLED unless the task is genuinely meant to be gone: disabling stops ' +
          'the task running and is fully reversible. ' +
          'If you did not create the task in this session, export_task first so the definition can be rebuilt, ' +
          'and confirm with the user before calling this.',
        inputSchema: {
          taskId: z.string().describe('The TaskHub task id (from list_tasks).')
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
