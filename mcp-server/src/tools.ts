import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TaskHubClient, TaskHubApiError } from './client.js';

/**
 * Tool surface for the TaskHub MCP server (docs/ROADMAP.md › P3):
 *   list_tasks · run_task · list_templates · create_task_from_template · convert_schedule
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
        parameters: z
          .record(z.string(), z.string())
          .optional()
          .describe('Values for the template\'s {{placeholders}}, keyed by parameter name. Required params must be provided.')
      }
    },
    async ({ templateId, platform, name, schedule, parameters }) => {
      try {
        const body: Record<string, unknown> = { platform };
        if (name) body.name = name;
        if (schedule) body.schedule = schedule;
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
        const result = await client.post<{ score: number; warnings: string[]; trigger: unknown }>(
          '/tasks/preview',
          { platform, schedule }
        );
        const warnings = result.warnings?.length ? `\nWarnings: ${result.warnings.join('; ')}` : '';
        const text =
          result.score > 0
            ? `Convertible for ${platform} (confidence ${result.score}).${warnings}`
            : `Not convertible for ${platform} (score 0).${warnings}`;
        return ok(text, { platform, schedule, ...result });
      } catch (err) {
        return toolError(err);
      }
    }
  );
}
