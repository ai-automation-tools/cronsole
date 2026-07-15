import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { TaskHubClient, TaskHubApiError } from '../client.js';

/**
 * These drive the REAL registered tools through a REAL MCP client over an
 * in-memory transport, stubbing only the HTTP client. That boundary is the
 * point: everything the wrapper owns (schemas, filtering, rendering, error
 * shaping) is exercised for real, while everything the backend owns is out of
 * scope — it has its own suites, and duplicating them here would only pin our
 * guess about the API.
 *
 * Consequence worth knowing: a tool that fails to register, or a schema that
 * rejects valid input, fails these tests. A handler called directly would not
 * have caught either.
 */

// ---- a TaskHubClient stub that records calls ------------------------------

interface Call {
  method: 'get' | 'post';
  path: string;
  body?: unknown;
}

function stubClient(routes: Record<string, unknown | (() => unknown)>) {
  const calls: Call[] = [];
  const resolve = (method: 'get' | 'post', path: string) => {
    const key = `${method.toUpperCase()} ${path}`;
    if (!(key in routes)) throw new TaskHubApiError(`no stub for ${key}`, 404);
    const v = routes[key];
    const out = typeof v === 'function' ? (v as () => unknown)() : v;
    if (out instanceof Error) throw out;
    return out;
  };
  const client = {
    async get(path: string) {
      calls.push({ method: 'get', path });
      return resolve('get', path);
    },
    async post(path: string, body?: unknown) {
      calls.push({ method: 'post', path, body });
      return resolve('post', path);
    }
  } as unknown as TaskHubClient;
  return { client, calls };
}

async function connect(client: TaskHubClient) {
  const server = new McpServer({ name: 'taskhub-test', version: '0.0.0' });
  registerTools(server, client);
  const mcp = new Client({ name: 'test-client', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

const call = async (mcp: Client, name: string, args: Record<string, unknown> = {}) =>
  (await mcp.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
    structuredContent?: Record<string, any>;
  };

const text = (r: { content: { text: string }[] }) => r.content.map(c => c.text).join('\n');

// ---- fixtures -------------------------------------------------------------

const task = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'id1',
  name: 'Nightly Backup',
  platform: 'WINDOWS_TASK_SCHEDULER',
  category: 'Backup',
  schedule: '0 3 * * *',
  status: 'ACTIVE',
  externalId: '\\TaskHub\\Nightly Backup',
  nextRunTime: '2026-07-16T03:00:00.000Z',
  lastRunStatus: 'SUCCESS',
  lastRunAt: '2026-07-15T03:00:00.000Z',
  lastRunDurationMs: 1200,
  ...over
});

// ===========================================================================

describe('the tool surface', () => {
  it('registers exactly the six documented tools', async () => {
    // Pins the surface itself: adding or renaming a tool obligates the two
    // README tool tables and the skill (CLAUDE.md 11a). This is the tripwire.
    const { client } = stubClient({});
    const mcp = await connect(client);
    const names = (await mcp.listTools()).tools.map(t => t.name).sort();
    expect(names).toEqual([
      'convert_schedule',
      'create_task',
      'create_task_from_template',
      'list_tasks',
      'list_templates',
      'run_task'
    ]);
  });

  it('describes every tool (a host shows these to the model)', async () => {
    const { client } = stubClient({});
    const mcp = await connect(client);
    for (const t of (await mcp.listTools()).tools) {
      expect(t.description, `${t.name} has no description`).toBeTruthy();
    }
  });
});

describe('list_tasks', () => {
  let mcp: Client;
  const rows = [
    task({ id: 'a', name: 'Nightly Backup', category: 'Backup', status: 'ACTIVE' }),
    task({
      id: 'b',
      name: 'Weekly Report',
      category: 'Reports',
      status: 'DISABLED',
      platform: 'TASKHUB_NATIVE',
      schedule: '0 9 * * 1'
    }),
    task({ id: 'c', name: 'Git Fetch', category: 'Dev', status: 'ACTIVE', schedule: '0 6 * * *' })
  ];

  beforeEach(async () => {
    mcp = await connect(stubClient({ 'GET /tasks': rows }).client);
  });

  it('returns every task with no filters', async () => {
    const r = await call(mcp, 'list_tasks');
    expect(r.structuredContent?.matched).toBe(3);
    expect(r.structuredContent?.tasks).toHaveLength(3);
  });

  it('filters by platform', async () => {
    const r = await call(mcp, 'list_tasks', { platform: 'TASKHUB_NATIVE' });
    expect(r.structuredContent?.tasks.map((t: any) => t.id)).toEqual(['b']);
  });

  it('filters by status', async () => {
    const r = await call(mcp, 'list_tasks', { status: 'DISABLED' });
    expect(r.structuredContent?.tasks.map((t: any) => t.id)).toEqual(['b']);
  });

  it('matches category case-insensitively but exactly', async () => {
    expect((await call(mcp, 'list_tasks', { category: 'backup' })).structuredContent?.matched).toBe(1);
    // "Back" is a prefix, not the category — an exact match must not fire.
    expect((await call(mcp, 'list_tasks', { category: 'Back' })).structuredContent?.matched).toBe(0);
  });

  it('searches across name, category, and schedule', async () => {
    expect((await call(mcp, 'list_tasks', { search: 'git' })).structuredContent?.matched).toBe(1);
    expect((await call(mcp, 'list_tasks', { search: 'Reports' })).structuredContent?.matched).toBe(1);
    expect((await call(mcp, 'list_tasks', { search: '0 6 * * *' })).structuredContent?.matched).toBe(1);
  });

  it('combines filters conjunctively', async () => {
    const r = await call(mcp, 'list_tasks', { status: 'ACTIVE', search: 'backup' });
    expect(r.structuredContent?.tasks.map((t: any) => t.id)).toEqual(['a']);
  });

  it('is honest when the limit truncates the result', async () => {
    // The honesty rule in miniature: never imply you showed everything.
    const r = await call(mcp, 'list_tasks', { limit: 2 });
    expect(r.structuredContent?.matched).toBe(3);
    expect(r.structuredContent?.returned).toBe(2);
    expect(text(r)).toMatch(/Showing 2 of 3/);
  });

  it('does not claim truncation when nothing was truncated', async () => {
    expect(text(await call(mcp, 'list_tasks'))).not.toMatch(/Showing/);
  });

  it('says so plainly when nothing matches', async () => {
    const r = await call(mcp, 'list_tasks', { search: 'nothing-matches-this' });
    expect(r.structuredContent?.matched).toBe(0);
    expect(text(r)).toMatch(/No tasks match/);
  });

  it('surfaces the id, since every other task tool needs it', async () => {
    expect(text(await call(mcp, 'list_tasks', { search: 'Git' }))).toMatch(/id: c/);
  });

  it('rejects an unknown platform rather than silently returning nothing', async () => {
    // Schema validation is real over the protocol — an enum typo must fail
    // loudly. The SDK reports it as an isError result (not a rejection), which
    // is the better shape: the model reads the reason instead of a protocol
    // error, and can correct itself.
    const r = await call(mcp, 'list_tasks', { platform: 'NOPE' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/validation/i);
  });
});

describe('run_task', () => {
  it('posts to the run route and returns the backend message', async () => {
    const { client, calls } = stubClient({ 'POST /tasks/abc/run': { message: 'Started successfully', success: true } });
    const mcp = await connect(client);
    const r = await call(mcp, 'run_task', { taskId: 'abc' });
    expect(calls[0].path).toBe('/tasks/abc/run');
    expect(text(r)).toBe('Started successfully');
  });

  it('url-encodes the task id', async () => {
    const { client, calls } = stubClient({ 'POST /tasks/a%2Fb/run': { message: 'ok' } });
    const mcp = await connect(client);
    await call(mcp, 'run_task', { taskId: 'a/b' });
    expect(calls[0].path).toBe('/tasks/a%2Fb/run');
  });

  it('reports a not-found id honestly instead of throwing', async () => {
    const { client } = stubClient({
      'POST /tasks/ghost/run': () => new TaskHubApiError('Task not found', 404)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'run_task', { taskId: 'ghost' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 404.*Task not found/);
  });
});

describe('list_templates', () => {
  const templates = [
    {
      id: 'tpl_ps',
      name: 'PowerShell Script',
      description: 'Run a .ps1 on a schedule.',
      category: 'OTHER',
      tags: ['windows', 'powershell'],
      isStarter: true,
      scriptType: 'powershell',
      scheduleExpression: '0 9 * * *',
      targetPlatforms: ['WINDOWS_TASK_SCHEDULER'],
      parameters: [
        { key: 'scriptPath', label: 'Script file path', required: true, type: 'path', help: 'Absolute path.' },
        { key: 'args', label: 'Arguments', required: false, type: 'text', default: '' }
      ]
    },
    {
      id: 'dev-git-fetch-prune',
      name: 'Git Fetch & Prune',
      description: 'Fetch all remotes.',
      category: 'DEV_WORKFLOW',
      tags: ['dev', 'git'],
      isStarter: false,
      scriptType: null,
      scheduleExpression: '0 6 * * *',
      targetPlatforms: ['WINDOWS_TASK_SCHEDULER', 'MACOS_LAUNCHD'],
      parameters: null
    }
  ];

  it('maps a template parameter key to the name callers must pass', async () => {
    // The catalog stores `key`; create_task_from_template takes `parameters`
    // keyed by name. If this mapping drifts, an agent fills in the wrong keys
    // and the apply 400s for a reason that points nowhere useful.
    const mcp = await connect(stubClient({ 'GET /templates': templates }).client);
    const r = await call(mcp, 'list_templates', { search: 'powershell' });
    const params = r.structuredContent?.templates[0].parameters;
    expect(params[0]).toMatchObject({ name: 'scriptPath', required: true, type: 'path' });
    expect(params[1]).toMatchObject({ name: 'args', required: false });
  });

  it('marks required params in the text so an agent can see them', async () => {
    const mcp = await connect(stubClient({ 'GET /templates': templates }).client);
    expect(text(await call(mcp, 'list_templates', { search: 'powershell' }))).toMatch(/scriptPath\*/);
  });

  it('tolerates a template with no parameters', async () => {
    const mcp = await connect(stubClient({ 'GET /templates': templates }).client);
    const r = await call(mcp, 'list_templates', { search: 'git' });
    expect(r.structuredContent?.templates[0].parameters).toEqual([]);
  });

  it('searches across name, description, category, and tags', async () => {
    const mcp = await connect(stubClient({ 'GET /templates': templates }).client);
    expect((await call(mcp, 'list_templates', { search: 'dev' })).structuredContent?.matched).toBe(1);
    expect((await call(mcp, 'list_templates', { search: 'remotes' })).structuredContent?.matched).toBe(1);
  });

  it('is honest when the limit truncates', async () => {
    const mcp = await connect(stubClient({ 'GET /templates': templates }).client);
    expect(text(await call(mcp, 'list_templates', { limit: 1 }))).toMatch(/Showing 1 of 2/);
  });
});

describe('create_task', () => {
  const created = {
    message: 'Task created successfully',
    task: task({ id: 'new1', name: 'MyTask' }),
    conversion: { warnings: [] as string[] }
  };

  it('sends name, command, schedule, and the default platform', async () => {
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    await call(mcp, 'create_task', {
      name: 'MyTask',
      command: 'powershell.exe -NoProfile -File "C:\\jobs\\x.ps1"',
      schedule: '0 9 * * *'
    });
    expect(calls[0].path).toBe('/tasks');
    expect(calls[0].body).toEqual({
      name: 'MyTask',
      command: 'powershell.exe -NoProfile -File "C:\\jobs\\x.ps1"',
      schedule: '0 9 * * *',
      platform: 'WINDOWS_TASK_SCHEDULER'
    });
  });

  it('omits optional fields rather than sending undefined', async () => {
    // A literal `folder: undefined` in the body is not the same as absent — the
    // route branches on `typeof folder === 'string'`, so keep the wire clean.
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '0 9 * * *' });
    expect(Object.keys(calls[0].body as object).sort()).toEqual([
      'command',
      'name',
      'platform',
      'schedule'
    ]);
  });

  it('passes folder and category through when given', async () => {
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    await call(mcp, 'create_task', {
      name: 'x',
      command: 'c.exe',
      schedule: '0 9 * * *',
      folder: '\\Work\\Backups',
      category: 'Ops'
    });
    expect(calls[0].body).toMatchObject({ folder: '\\Work\\Backups', category: 'Ops' });
  });

  it('creates on TaskHub-native when asked', async () => {
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    await call(mcp, 'create_task', {
      name: 'ping',
      command: 'https://example.com/health',
      schedule: '*/15 * * * *',
      platform: 'TASKHUB_NATIVE'
    });
    expect(calls[0].body).toMatchObject({ platform: 'TASKHUB_NATIVE' });
  });

  it('refuses a platform TaskHub cannot create on, before reaching the API', async () => {
    // CHATGPT has no connector that can create — the enum must stop it here
    // rather than let the backend 400 on something the tool should never send.
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', {
      name: 'x',
      command: 'c',
      schedule: '0 9 * * *',
      platform: 'CHATGPT'
    });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['name', { command: 'c', schedule: '0 9 * * *' }],
    ['command', { name: 'n', schedule: '0 9 * * *' }],
    ['schedule', { name: 'n', command: 'c' }]
  ])('requires %s, and says which field is missing', async (field, args) => {
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', args);
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(new RegExp(field));
    // Never half-create: a rejected call must not have reached the API.
    expect(calls).toHaveLength(0);
  });

  it('reports the created task with its id', async () => {
    const { client } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', { name: 'MyTask', command: 'c.exe', schedule: '0 9 * * *' });
    expect(text(r)).toMatch(/Task created successfully/);
    expect(text(r)).toMatch(/id: new1/);
    expect(r.structuredContent?.task.id).toBe('new1');
  });

  it('surfaces a lossy conversion instead of reporting a clean success', async () => {
    // The #14 trap: the backend ACCEPTS a fallback trigger rather than refusing
    // it, so a task can be created on a schedule that is not the one asked for.
    // Reporting only "Task created successfully" would be a confident lie.
    const { client } = stubClient({
      'POST /tasks': {
        ...created,
        conversion: {
          warnings: ['Complex cron expression will be converted to a fallback interval trigger; execution times might not align 100%.']
        }
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '0 4 1 1 *' });
    expect(text(r)).toMatch(/Schedule conversion warnings/);
    expect(text(r)).toMatch(/fallback interval trigger/);
    expect(text(r)).toMatch(/may not match the cron you gave/);
    expect(r.structuredContent?.conversion.warnings).toHaveLength(1);
  });

  it('surfaces a duplicate-name 409 honestly', async () => {
    const { client } = stubClient({
      'POST /tasks': () => new TaskHubApiError('A task named "x" already exists in \\TaskHub', 409)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '0 9 * * *' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 409/);
    expect(text(r)).toMatch(/already exists/);
  });

  it('surfaces the \\Microsoft\\ refusal as the backend worded it', async () => {
    const { client } = stubClient({
      'POST /tasks': () => new TaskHubApiError('Folder \\Microsoft\\Windows is reserved by Windows.', 400)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', {
      name: 'x',
      command: 'c.exe',
      schedule: '0 9 * * *',
      folder: '\\Microsoft\\Windows'
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/reserved by Windows/);
  });
});

describe('create_task_from_template', () => {
  const applied = {
    message: 'Template applied successfully',
    result: { externalId: '\\TaskHub\\x' },
    conversion: { confidence: 1, warnings: [] as string[] }
  };

  it('applies to the template route with raw parameters', async () => {
    // Parameters must go RAW to the server: substitution is server-side so a
    // value containing a quote can't split into extra arguments (a P0 fix).
    const { client, calls } = stubClient({ 'POST /templates/tpl_ps/apply': applied });
    const mcp = await connect(client);
    await call(mcp, 'create_task_from_template', {
      templateId: 'tpl_ps',
      parameters: { scriptPath: 'C:\\a b\\x.ps1' }
    });
    expect(calls[0].path).toBe('/templates/tpl_ps/apply');
    expect(calls[0].body).toMatchObject({ parameters: { scriptPath: 'C:\\a b\\x.ps1' } });
  });

  it('url-encodes the template id', async () => {
    const { client, calls } = stubClient({ 'POST /templates/a%2Fb/apply': applied });
    const mcp = await connect(client);
    await call(mcp, 'create_task_from_template', { templateId: 'a/b' });
    expect(calls[0].path).toBe('/templates/a%2Fb/apply');
  });

  it('sends only the platform when nothing else is given', async () => {
    const { client, calls } = stubClient({ 'POST /templates/t/apply': applied });
    const mcp = await connect(client);
    await call(mcp, 'create_task_from_template', { templateId: 't' });
    expect(calls[0].body).toEqual({ platform: 'WINDOWS_TASK_SCHEDULER' });
  });

  it('surfaces lossy conversion warnings', async () => {
    const { client } = stubClient({
      'POST /templates/t/apply': { ...applied, conversion: { confidence: 0.7, warnings: ['lossy thing'] } }
    });
    const mcp = await connect(client);
    expect(text(await call(mcp, 'create_task_from_template', { templateId: 't' }))).toMatch(/lossy thing/);
  });
});

describe('convert_schedule', () => {
  const preview = (over: Record<string, unknown>) => ({
    score: 1,
    warnings: [] as string[],
    trigger: null,
    ...over
  });

  it('spells out the weekdays a weekly trigger fires on', async () => {
    // The bug this exists for: parseInt('1-5') is 1, so "0 9 * * 1-5" built a
    // MONDAY-ONLY trigger and still scored 1.0 with no warnings. A bare
    // confidence reads identically whether the conversion was right or silently
    // wrong — printing the days is what makes it visible in a text-only host.
    const { client } = stubClient({
      'POST /tasks/preview': preview({
        trigger: {
          type: 'Weekly',
          startBoundary: '09:00',
          daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        }
      })
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'convert_schedule', { schedule: '0 9 * * 1-5' });
    const out = text(r);
    expect(out).toMatch(/confidence 1/);
    for (const d of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      expect(out, `${d} missing from the rendered trigger`).toMatch(new RegExp(d));
    }
  });

  it('renders the hourly fallback so a replaced schedule is visible', async () => {
    // #14: an unrecognized cron is REPLACED with a hard-coded hourly trigger,
    // reported as 0.7 + "might not align 100%". If the tool printed only the
    // score, "once a year" silently becoming "hourly" would be invisible.
    const { client } = stubClient({
      'POST /tasks/preview': preview({
        score: 0.7,
        warnings: ['Complex cron expression will be converted to a fallback interval trigger; execution times might not align 100%.'],
        trigger: { type: 'Time', startBoundary: '00:00', repetition: { interval: 'PT1H', duration: 'P1D' } }
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'convert_schedule', { schedule: '0 4 1 1 *' }));
    expect(out).toMatch(/confidence 0\.7/);
    expect(out).toMatch(/repeating every PT1H/);
    expect(out).toMatch(/for P1D/);
    expect(out).toMatch(/Warnings:/);
  });

  it('renders a daily trigger', async () => {
    const { client } = stubClient({
      'POST /tasks/preview': preview({ trigger: { type: 'Daily', startBoundary: '09:00', daysInterval: 1 } })
    });
    const mcp = await connect(client);
    expect(text(await call(mcp, 'convert_schedule', { schedule: '0 9 * * *' }))).toMatch(/Daily at 09:00/);
  });

  it('mentions a multi-day interval', async () => {
    const { client } = stubClient({
      'POST /tasks/preview': preview({ trigger: { type: 'Daily', startBoundary: '09:00', daysInterval: 3 } })
    });
    const mcp = await connect(client);
    expect(text(await call(mcp, 'convert_schedule', { schedule: '0 9 */3 * *' }))).toMatch(/every 3 days/);
  });

  it('reports an invalid expression as not convertible, with the reason', async () => {
    const { client } = stubClient({
      'POST /tasks/preview': preview({
        score: 0,
        warnings: ['Schedule must be a 5-field cron expression (min hour dom month dow).'],
        trigger: null
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'convert_schedule', { schedule: 'not a cron' }));
    expect(out).toMatch(/Not convertible/);
    expect(out).toMatch(/score 0/);
    expect(out).toMatch(/5-field cron/);
  });

  it('sends the platform and schedule to the preview route', async () => {
    const { client, calls } = stubClient({ 'POST /tasks/preview': preview({}) });
    const mcp = await connect(client);
    await call(mcp, 'convert_schedule', { schedule: '0 9 * * *', platform: 'TASKHUB_NATIVE' });
    expect(calls[0].body).toEqual({ platform: 'TASKHUB_NATIVE', schedule: '0 9 * * *' });
  });
});

describe('error handling across the surface', () => {
  it('returns isError rather than throwing, for every tool', async () => {
    // A thrown handler surfaces as a protocol error; the model sees a stack
    // trace instead of a reason it can act on. Every tool must degrade to a
    // readable message.
    const boom = () => new TaskHubApiError('Backend exploded', 500);
    const { client } = stubClient({
      'GET /tasks': boom,
      'GET /templates': boom,
      'POST /tasks': boom,
      'POST /tasks/x/run': boom,
      'POST /tasks/preview': boom,
      'POST /templates/t/apply': boom
    });
    const mcp = await connect(client);
    const cases: [string, Record<string, unknown>][] = [
      ['list_tasks', {}],
      ['list_templates', {}],
      ['create_task', { name: 'n', command: 'c', schedule: '0 9 * * *' }],
      ['run_task', { taskId: 'x' }],
      ['convert_schedule', { schedule: '0 9 * * *' }],
      ['create_task_from_template', { templateId: 't' }]
    ];
    for (const [name, args] of cases) {
      const r = await call(mcp, name, args);
      expect(r.isError, `${name} did not flag isError`).toBe(true);
      expect(text(r), `${name} lost the backend message`).toMatch(/Backend exploded/);
      expect(text(r), `${name} lost the status`).toMatch(/HTTP 500/);
    }
  });

  it('renders a connection failure (no status) without an empty "HTTP undefined"', async () => {
    const { client } = stubClient({
      'GET /tasks': () => new TaskHubApiError('Could not reach the TaskHub backend at http://x (ECONNREFUSED)')
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_tasks');
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Could not reach the TaskHub backend at http://x (ECONNREFUSED)');
    expect(text(r)).not.toMatch(/undefined/);
  });
});
