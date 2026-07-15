import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TaskHubClient, TaskHubApiError } from './client.js';

/**
 * Tool surface for the TaskHub MCP server (docs/ROADMAP.md › P3):
 *   list_tasks · run_task · list_templates · create_task · create_task_from_template ·
 *   convert_schedule
 *
 * Each tool is a thin call through TaskHubClient into the REST API. Business
 * rules (owner scoping, no-shell command structuring, agent signing, cron→trigger
 * conversion) all stay server-side — this layer only shapes input/output.
 */

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

export function registerTools(server: McpServer, client: TaskHubClient): void {
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
}
