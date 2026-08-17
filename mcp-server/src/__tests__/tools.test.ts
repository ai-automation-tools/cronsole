import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../tools.js';
import { CronsoleClient, CronsoleApiError } from '../client.js';

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

// ---- a CronsoleClient stub that records calls ------------------------------

type Method = 'get' | 'post' | 'patch' | 'delete' | 'getBuffer';

interface Call {
  method: Method;
  path: string;
  body?: unknown;
  /**
   * Query params on a GET. Recorded because several tools express their whole
   * filter surface here — dropping them would leave `list_run_history`'s
   * status/platform/date filters asserted by nothing.
   */
  params?: Record<string, unknown>;
}

function stubClient(routes: Record<string, unknown | (() => unknown)>) {
  const calls: Call[] = [];
  const resolve = (method: Method, path: string) => {
    // getBuffer is a GET as far as the route table is concerned — the buffer is
    // a decoding detail, not a different endpoint.
    const verb = method === 'getBuffer' ? 'GET' : method.toUpperCase();
    const key = `${verb} ${path}`;
    if (!(key in routes)) throw new CronsoleApiError(`no stub for ${key}`, 404);
    const v = routes[key];
    const out = typeof v === 'function' ? (v as () => unknown)() : v;
    if (out instanceof Error) throw out;
    return out;
  };
  const record = (
    method: Method,
    path: string,
    body?: unknown,
    params?: Record<string, unknown>
  ) => {
    calls.push({ method, path, body, params });
    return resolve(method, path);
  };
  const client = {
    async get(path: string, params?: Record<string, unknown>) {
      return record('get', path, undefined, params);
    },
    async post(path: string, body?: unknown) {
      return record('post', path, body);
    },
    async patch(path: string, body?: unknown) {
      return record('patch', path, body);
    },
    async delete(path: string) {
      return record('delete', path);
    },
    async getBuffer(path: string) {
      return record('getBuffer', path);
    }
  } as unknown as CronsoleClient;
  return { client, calls };
}

async function connect(client: CronsoleClient, allowDestructive = false) {
  const server = new McpServer({ name: 'cronsole-test', version: '0.0.0' });
  registerTools(server, client, { allowDestructive });
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
  externalId: '\\Cronsole\\Nightly Backup',
  nextRunTime: '2026-07-16T03:00:00.000Z',
  lastRunStatus: 'SUCCESS',
  lastRunAt: '2026-07-15T03:00:00.000Z',
  lastRunDurationMs: 1200,
  ...over
});

// ===========================================================================

describe('the tool surface', () => {
  it('registers exactly the documented non-destructive tools', async () => {
    // Pins the surface itself: adding or renaming a tool obligates the two
    // README tool tables and the skill (CLAUDE.md 11a). This is the tripwire.
    const { client } = stubClient({});
    const mcp = await connect(client);
    const names = (await mcp.listTools()).tools.map(t => t.name).sort();
    expect(names).toEqual([
      'connect_claude_routine',
      'convert_schedule',
      'create_claude_routine',
      'create_native_check_task',
      'create_native_program_task',
      'create_native_script_task',
      'create_native_task',
      'create_task',
      'create_task_from_template',
      'disconnect_claude_routine',
      'edit_claude_routine',
      'export_task',
      'get_diagnostics',
      'get_task_health',
      'get_task_history',
      'list_claude_routines',
      'list_folders',
      'list_platforms',
      'list_run_history',
      'list_tasks',
      'list_templates',
      'rename_task',
      'run_task',
      'set_task_status',
      'sync_tasks',
      'untrack_task',
      'update_native_job',
      'update_task_action',
      'update_task_schedule'
    ]);
  });

  it('offers BOTH create and connect for Claude routines, because both verbs are real', () => {
    // This test used to assert the opposite, and its reasoning was the mistake
    // rather than the code: "Anthropic exposes exactly one routines endpoint
    // (fire) and no create". True of the **documented** API, false of the
    // product — Claude Code itself creates routines through /v1/code/triggers
    // with the account session. The rule the old test was reaching for still
    // holds and is checked below: name a tool for the verb it performs.
    //
    // The two are genuinely different verbs and both are needed. `create` makes
    // a routine that did not exist; `connect` teaches Cronsole about one that
    // does, and remains the only path when the backend cannot read a Claude
    // Code session (a Dockerized stack, or nobody signed in).
    const source = readFileSync(new URL('../tools.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/'create_claude_routine'/);
    expect(source).toMatch(/'connect_claude_routine'/);
  });

  it('offers no way to DELETE a Claude routine, because none exists', () => {
    // The invariant that survived, and this one is verified against the API
    // rather than inferred from documentation: **neither** Claude endpoint
    // family exposes a DELETE. A routine can be disabled (set_task_status) and
    // forgotten (disconnect_claude_routine, untrack), never destroyed.
    //
    // So no tool may imply otherwise. An agent asked to "remove that routine"
    // must land on disable-or-disconnect and tell the user the routine itself
    // has to go at claude.ai — not silently leave a live routine running while
    // reporting success.
    const source = readFileSync(new URL('../tools.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/'delete_claude_routine'/);
    // And the create tool must say so at the moment it hands one over, since
    // that is the only point at which the caller can still choose otherwise.
    expect(source).toMatch(/no delete API|exposes no delete/i);
  });

  it('offers the reversible removal without the gate', async () => {
    // The point of gating delete_task is only honest if a safe way to remove a
    // task from the dashboard exists without the gate. Otherwise an agent asked
    // to tidy up has exactly one tool for the job and it is the irreversible
    // one — the failure mode that keeps set_task_status ungated too.
    const { client } = stubClient({});
    const guarded = await connect(client, false);
    const names = (await guarded.listTools()).tools.map(t => t.name);
    expect(names).toContain('untrack_task');
    expect(names).not.toContain('delete_task');
  });

  it('adds delete_task, and only delete_task, when destructive ops are allowed', async () => {
    const { client } = stubClient({});
    const guarded = (await connect(client, false)).listTools();
    const allowed = (await connect(client, true)).listTools();
    const before = (await guarded).tools.map(t => t.name);
    const after = (await allowed).tools.map(t => t.name);
    // The gate must open exactly one door — not quietly change the rest.
    expect(after.filter(n => !before.includes(n))).toEqual(['delete_task']);
    expect(before.filter(n => !after.includes(n))).toEqual([]);
  });

  it('describes every tool (a host shows these to the model)', async () => {
    const { client } = stubClient({});
    const mcp = await connect(client, true);
    for (const t of (await mcp.listTools()).tools) {
      expect(t.description, `${t.name} has no description`).toBeTruthy();
    }
  });
});

describe('the destructive-op gate', () => {
  // The gate's whole value is that an agent cannot reach it: it is set by a human
  // in the environment, out of band. These pin BOTH directions, because a gate
  // that never opens is a bug too — and a false positive here hands an agent a
  // deletion verb the user never granted.

  it('does not register delete_task by default', async () => {
    const { client } = stubClient({});
    const mcp = await connect(client);
    const names = (await mcp.listTools()).tools.map(t => t.name);
    expect(names).not.toContain('delete_task');
  });

  it('makes delete_task ABSENT rather than present-and-erroring', async () => {
    // The distinction matters: a tool the model can see is a tool it will plan
    // around. A capability that announces itself then refuses is worse than one
    // that was never offered — the model retries, reasons about permissions, and
    // burns turns on a door that does not exist.
    //
    // Calling it anyway is refused by the SDK as an unknown tool ("not found"),
    // NOT by a handler saying "not allowed" — which is the point: there is no
    // handler. The gate is the absence.
    const { client, calls } = stubClient({ 'DELETE /tasks/id1': { message: 'Task deleted' } });
    const mcp = await connect(client, false);
    const r = await call(mcp, 'delete_task', { taskId: 'id1' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/delete_task.*not found/i);
    // And nothing reached the API on the way to that refusal.
    expect(calls).toHaveLength(0);
  });

  it('registers delete_task when allowed', async () => {
    const { client } = stubClient({});
    const mcp = await connect(client, true);
    expect((await mcp.listTools()).tools.map(t => t.name)).toContain('delete_task');
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
      'POST /tasks/ghost/run': () => new CronsoleApiError('Task not found', 404)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'run_task', { taskId: 'ghost' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 404.*Task not found/);
  });

  // A native job runs inside the request, so "the run failed" arrives as a 200
  // with success:false. It must stay a RESULT (the call did what was asked) while
  // saying plainly that the run failed — an agent that reads only the first line
  // otherwise reports a failing check as a healthy one.
  it('surfaces a completed-but-failed run as a result, not an error', async () => {
    const { client } = stubClient({
      'POST /tasks/chk/run': {
        success: false,
        ran: true,
        message: 'GET https://api.example.com → 200 (expected 200–299) | body does not contain "ok"'
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'run_task', { taskId: 'chk' });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/ran and FAILED/);
    expect(text(r)).toMatch(/body does not contain/);
  });

  // The other half of the discrimination: a run that could not be STARTED is
  // still an error. If both collapsed into one shape the tool would be back to
  // making "your disk is full" indistinguishable from "monitoring is broken".
  it('still errors when the run could not be started at all', async () => {
    const { client } = stubClient({
      'POST /tasks/win/run': () => new CronsoleApiError('Agent is offline', 502)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'run_task', { taskId: 'win' });
    expect(r.isError).toBe(true);
    expect(text(r)).not.toMatch(/ran and FAILED/);
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

describe('list_folders', () => {
  const folders = {
    folders: [
      { path: '\\Cronsole', taskCount: 3, writable: true },
      { path: '\\Work\\Backups', taskCount: 1, writable: true },
      { path: '\\Microsoft\\Windows', taskCount: 12, writable: false },
      { path: '\\Empty', taskCount: 0, writable: true }
    ],
    defaultFolder: '\\Cronsole'
  };
  const mk = () => stubClient({ 'GET /tasks/folders': folders });

  it('lists folders with their task counts', async () => {
    const mcp = await connect(mk().client);
    const r = await call(mcp, 'list_folders');
    expect(r.structuredContent?.matched).toBe(4);
    expect(text(r)).toMatch(/\\Work\\Backups.*1 task/);
  });

  it('shows an unwritable folder AND says why, instead of hiding it', async () => {
    // The route deliberately returns writable:false rather than filtering, so
    // the caller can distinguish "exists but refused" from "does not exist".
    // Hiding it here would undo that and leave an agent guessing why its
    // perfectly real folder "doesn't exist".
    const mcp = await connect(mk().client);
    const out = text(await call(mcp, 'list_folders'));
    expect(out).toMatch(/\\Microsoft\\Windows/);
    expect(out).toMatch(/NOT writable/);
  });

  it('can narrow to writable folders on request', async () => {
    const mcp = await connect(mk().client);
    const r = await call(mcp, 'list_folders', { writableOnly: true });
    expect(r.structuredContent?.matched).toBe(3);
    expect(text(r)).not.toMatch(/\\Microsoft\\Windows/);
  });

  it('defaults to showing unwritable folders', async () => {
    const mcp = await connect(mk().client);
    expect((await call(mcp, 'list_folders')).structuredContent?.matched).toBe(4);
  });

  it('marks the default folder, since it needs no discovery', async () => {
    const mcp = await connect(mk().client);
    const r = await call(mcp, 'list_folders');
    expect(text(r)).toMatch(/\\Cronsole \[default\]/);
    expect(r.structuredContent?.defaultFolder).toBe('\\Cronsole');
  });

  it('states the default folder even when the filter excludes it', async () => {
    // An agent that filtered to \Work must still learn it can just omit
    // `folder` — otherwise it invents one.
    const mcp = await connect(mk().client);
    const out = text(await call(mcp, 'list_folders', { search: 'work' }));
    expect(out).toMatch(/Default folder: \\Cronsole/);
  });

  it('still names the default folder when it does not currently exist', async () => {
    // Observed live, not hypothesised: \Cronsole is created lazily and the agent
    // PRUNES it when its last task is deleted, so the default folder is
    // routinely absent from a real listing. An agent that read absence as
    // "unusable" would go invent a folder — which Cronsole then refuses,
    // because it only ever creates \Cronsole. The note must not depend on the
    // folder being present.
    const { client } = stubClient({
      'GET /tasks/folders': {
        folders: [{ path: '\\Cronsole-Stack', taskCount: 3, writable: true }],
        defaultFolder: '\\Cronsole'
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_folders');
    expect(text(r)).not.toMatch(/\\Cronsole \[default\]/);
    expect(text(r)).toMatch(/Default folder: \\Cronsole/);
    expect(text(r)).toMatch(/Cronsole creates this one itself/);
    expect(r.structuredContent?.defaultFolder).toBe('\\Cronsole');
  });

  it('filters by path, case-insensitively', async () => {
    const mcp = await connect(mk().client);
    expect((await call(mcp, 'list_folders', { search: 'microsoft' })).structuredContent?.matched).toBe(1);
  });

  it('keeps a zero-task folder (empty is not absent)', async () => {
    const mcp = await connect(mk().client);
    expect(text(await call(mcp, 'list_folders', { search: 'empty' }))).toMatch(/\\Empty.*0 task/);
  });

  it('is honest when the limit truncates', async () => {
    // A real machine had 161 folders (troubleshooting #9) — truncation is the
    // normal case here, not an edge case.
    const mcp = await connect(mk().client);
    const r = await call(mcp, 'list_folders', { limit: 2 });
    expect(r.structuredContent?.matched).toBe(4);
    expect(r.structuredContent?.returned).toBe(2);
    expect(text(r)).toMatch(/Showing 2 of 4/);
  });

  it('reports an offline agent honestly rather than as "no folders"', async () => {
    // The 502 exists precisely so this never renders as an empty list — that
    // would read as "this machine has no folders", a confident lie.
    const { client } = stubClient({
      'GET /tasks/folders': () => new CronsoleApiError('Agent folders timeout', 502)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_folders');
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 502/);
    expect(text(r)).not.toMatch(/0 folder/);
  });

  it('survives a folders payload with no rows', async () => {
    const { client } = stubClient({ 'GET /tasks/folders': { folders: [], defaultFolder: '\\Cronsole' } });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_folders');
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/No folders match/);
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

  it('sends createFolder only when the caller opts in', async () => {
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    await call(mcp, 'create_task', {
      name: 'x',
      command: 'c.exe',
      schedule: '0 9 * * *',
      folder: '\\NewTree',
      createFolder: true
    });
    expect(calls[0].body).toMatchObject({ folder: '\\NewTree', createFolder: true });
  });

  it('leaves createFolder off the wire entirely by default', async () => {
    // The default must be absence, not `false`: an ordinary create should not
    // even mention a flag whose only job is to widen what one call can create.
    const { client, calls } = stubClient({ 'POST /tasks': created });
    const mcp = await connect(client);
    await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '0 9 * * *' });
    expect(calls[0].body).not.toHaveProperty('createFolder');
  });

  it('says out loud which folders were created, and that removing them needs an admin', async () => {
    // Rendered into the TEXT, not just the structured payload: a model that
    // reads only the message must still learn a permanent folder now exists.
    const { client } = stubClient({
      'POST /tasks': { ...created, foldersCreated: ['\\NewTree'] }
    });
    const mcp = await connect(client);
    const res = await call(mcp, 'create_task', {
      name: 'x',
      command: 'c.exe',
      schedule: '0 9 * * *',
      folder: '\\NewTree',
      createFolder: true
    });
    const text = res.content.map((c: { text?: string }) => c.text ?? '').join('\n');
    expect(text).toContain('\\NewTree');
    expect(text).toMatch(/administrator rights/i);
  });

  it('creates on Cronsole-native when asked', async () => {
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

  it('refuses a platform Cronsole cannot create on, before reaching the API', async () => {
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
          lossy: 'replaced',
          warnings: ['This cron expression cannot be expressed as a Windows trigger, so the schedule will be REPLACED — not approximated — with a fixed hourly trigger: every hour from 00:00, about 24 runs a day (~8,760 a year).']
        }
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '0 4 1 1 *' });
    expect(text(r)).toMatch(/Schedule conversion warnings/);
    expect(text(r)).toMatch(/REPLACED/);
    expect(text(r)).toMatch(/may not match the cron you gave/);
    // The machine-readable discriminator leads the text with the actionable verb:
    // 'replaced' tells the model to delete and re-create, not shrug at a warning.
    expect(text(r)).toMatch(/schedule was REPLACED/);
    expect(text(r)).toMatch(/Delete it and use a schedule Windows can express/);
    expect(r.structuredContent?.conversion.lossy).toBe('replaced');
    expect(r.structuredContent?.conversion.warnings).toHaveLength(1);
  });

  it('names an approximated (drifting) conversion without the delete-and-recreate push', async () => {
    // The other 0.7 register: the trigger IS built from the cron, so the honest
    // guidance is "it drifts", not "throw it away". Same score, different verb —
    // the whole reason `lossy` exists.
    const { client } = stubClient({
      'POST /tasks': {
        ...created,
        conversion: {
          lossy: 'approximated',
          warnings: ['A 7-minute step does not divide 60 evenly, so run times drift apart after the first hour.']
        }
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '*/7 * * * *' });
    expect(text(r)).toMatch(/schedule was approximated/);
    expect(text(r)).not.toMatch(/REPLACED/);
    expect(text(r)).not.toMatch(/Delete it/);
    expect(r.structuredContent?.conversion.lossy).toBe('approximated');
  });

  it('surfaces a duplicate-name 409 honestly', async () => {
    const { client } = stubClient({
      'POST /tasks': () => new CronsoleApiError('A task named "x" already exists in \\Cronsole', 409)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_task', { name: 'x', command: 'c.exe', schedule: '0 9 * * *' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 409/);
    expect(text(r)).toMatch(/already exists/);
  });

  it('surfaces the \\Microsoft\\ refusal as the backend worded it', async () => {
    const { client } = stubClient({
      'POST /tasks': () => new CronsoleApiError('Folder \\Microsoft\\Windows is reserved by Windows.', 400)
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
    result: { externalId: '\\Cronsole\\x' },
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
        lossy: 'replaced',
        warnings: ['This cron expression cannot be expressed as a Windows trigger, so the schedule will be REPLACED with a fixed hourly trigger.'],
        trigger: { type: 'Time', startBoundary: '00:00', repetition: { interval: 'PT1H', duration: 'P1D' } }
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'convert_schedule', { schedule: '0 4 1 1 *' }));
    expect(out).toMatch(/confidence 0\.7/);
    expect(out).toMatch(/repeating every PT1H/);
    expect(out).toMatch(/for P1D/);
    expect(out).toMatch(/Warnings:/);
    // The score is 0.7 for two different risks; `lossy` is what tells them apart.
    // 'replaced' must read as danger, not a rounding note.
    expect(out).toMatch(/Lossy: REPLACED/);
    expect(out).toMatch(/discarded/);
  });

  it('names an approximated conversion distinctly from a replaced one', async () => {
    // Same 0.7 score, opposite meaning: the trigger IS derived from the cron and
    // merely drifts. The rendered line must not say REPLACED — that would tell
    // the model to throw away a schedule that is actually being honored.
    const { client } = stubClient({
      'POST /tasks/preview': preview({
        score: 0.7,
        lossy: 'approximated',
        warnings: ['A 7-minute step does not divide 60 evenly; run times drift apart after the first hour.'],
        trigger: { type: 'Time', startBoundary: '00:00', repetition: { interval: 'PT7M', duration: 'P1D' } }
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'convert_schedule', { schedule: '*/7 * * * *' }));
    expect(out).toMatch(/Lossy: approximated/);
    expect(out).toMatch(/drifts/);
    expect(out).not.toMatch(/REPLACED/);
  });

  it('renders the two run lists when the registered schedule differs from the cron', async () => {
    // The dates are the one rendering nobody can misread. "confidence 1.0" is
    // exactly what the Monday-only bug printed, and even "REPLACED" asks the
    // reader to know what it costs — two run lists that disagree do not.
    const { client } = stubClient({
      'POST /tasks/preview': preview({
        score: 0.7,
        lossy: 'replaced',
        warnings: ['REPLACED with a fixed hourly trigger.'],
        trigger: { type: 'Time', startBoundary: '00:00', repetition: { interval: 'PT1H' } },
        requestedRuns: ['2027-01-01T04:00:00.000Z'],
        effectiveRuns: [
          '2026-07-31T13:00:00.000Z',
          '2026-07-31T14:00:00.000Z',
          '2026-07-31T15:00:00.000Z'
        ],
        diverges: true
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'convert_schedule', { schedule: '0 4 1 1 *' }));
    expect(out).toMatch(/You asked for: 2027-01-01/);
    expect(out).toMatch(/It will ACTUALLY run: 2026-07-31T13/);
  });

  it('shows plain next runs when nothing diverges', async () => {
    const { client } = stubClient({
      'POST /tasks/preview': preview({
        trigger: { type: 'Daily', startBoundary: '09:00' },
        requestedRuns: ['2026-08-01T09:00:00.000Z', '2026-08-02T09:00:00.000Z'],
        effectiveRuns: ['2026-08-01T09:00:00.000Z', '2026-08-02T09:00:00.000Z'],
        diverges: false
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'convert_schedule', { schedule: '0 9 * * *' }));
    expect(out).toMatch(/Next runs \(UTC\): 2026-08-01/);
    expect(out).not.toMatch(/ACTUALLY/);
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

describe('set_task_status', () => {
  const row = (over: Record<string, unknown> = {}) => task({ ...over });

  it('patches the status route', async () => {
    const { client, calls } = stubClient({
      'PATCH /tasks/id1/status': row({ status: 'DISABLED', nextRunTime: null })
    });
    const mcp = await connect(client);
    await call(mcp, 'set_task_status', { taskId: 'id1', status: 'DISABLED' });
    expect(calls[0]).toMatchObject({
      method: 'patch',
      path: '/tasks/id1/status',
      body: { status: 'DISABLED' }
    });
  });

  it('url-encodes the task id', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/a%2Fb/status': row() });
    const mcp = await connect(client);
    await call(mcp, 'set_task_status', { taskId: 'a/b', status: 'ACTIVE' });
    expect(calls[0].path).toBe('/tasks/a%2Fb/status');
  });

  it('reports disabling in words, not just a status code', async () => {
    const { client } = stubClient({
      'PATCH /tasks/id1/status': row({ status: 'DISABLED', nextRunTime: null })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'set_task_status', { taskId: 'id1', status: 'DISABLED' }));
    expect(out).toMatch(/disabled/i);
    expect(out).toMatch(/Nightly Backup/);
  });

  it('reports the next run time when a task is enabled', async () => {
    const { client } = stubClient({
      'PATCH /tasks/id1/status': row({ status: 'ACTIVE', nextRunTime: '2026-07-16T03:00:00.000Z' })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'set_task_status', { taskId: 'id1', status: 'ACTIVE' }));
    expect(out).toMatch(/enabled/i);
    expect(out).toMatch(/2026-07-16T03:00:00.000Z/);
  });

  it.each([['DELETED'], ['UNKNOWN'], ['PAUSED'], ['active'], ['MISSING']])(
    'rejects %s before reaching the API — only ACTIVE/DISABLED are settable',
    async bad => {
      // The route accepts exactly two values; sending anything else would be a
      // 400 the tool should never have produced.
      const { client, calls } = stubClient({ 'PATCH /tasks/id1/status': row() });
      const mcp = await connect(client);
      const r = await call(mcp, 'set_task_status', { taskId: 'id1', status: bad });
      expect(r.isError).toBe(true);
      expect(calls).toHaveLength(0);
    }
  );

  it('tells an agent to disable rather than cron a task into silence', async () => {
    // The #14 trap in reverse: this tool exists so an agent has an honest way to
    // park a task. If the description stops saying so, the tool loses the reason
    // it shipped ungated.
    //
    // Each clause is asserted separately, NOT as an alternation: /a|b|c/ passes
    // while two thirds of the guidance is missing, which is exactly what it did
    // when this was mutation-tested. The instruction and the reason are both
    // load-bearing — an agent that reads "don't" without "why" tends to argue.
    const { client } = stubClient({});
    const mcp = await connect(client);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'set_task_status');
    expect(tool!.description, 'lost the instruction').toMatch(/do NOT try to park a task/i);
    expect(tool!.description, 'lost the rare-cron case').toMatch(/rare cron/i);
    expect(tool!.description, 'lost the consequence').toMatch(/REPLACED/);
    expect(tool!.description, 'lost the resulting frequency').toMatch(/hourly/i);
    expect(tool!.description, 'lost the reversibility promise').toMatch(/reversible/i);
  });

  it('surfaces an agent-offline 502 honestly', async () => {
    const { client } = stubClient({
      'PATCH /tasks/id1/status': () =>
        new CronsoleApiError('The platform failed to update the task status', 502)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'set_task_status', { taskId: 'id1', status: 'DISABLED' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/HTTP 502/);
    expect(text(r)).toMatch(/failed to update/);
  });
});

describe('update_task_schedule', () => {
  it('patches the schedule route with the cron', async () => {
    const { client, calls } = stubClient({
      'PATCH /tasks/id1/schedule': task({ schedule: '0 6 * * *' })
    });
    const mcp = await connect(client);
    await call(mcp, 'update_task_schedule', { taskId: 'id1', schedule: '0 6 * * *' });
    expect(calls[0]).toMatchObject({
      method: 'patch',
      path: '/tasks/id1/schedule',
      body: { schedule: '0 6 * * *' }
    });
  });

  it('reports the new schedule and next run', async () => {
    const { client } = stubClient({
      'PATCH /tasks/id1/schedule': task({
        schedule: '0 6 * * *',
        nextRunTime: '2026-07-16T06:00:00.000Z'
      })
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'update_task_schedule', { taskId: 'id1', schedule: '0 6 * * *' }));
    expect(out).toMatch(/0 6 \* \* \*/);
    expect(out).toMatch(/2026-07-16T06:00:00.000Z/);
  });

  it('warns about the hourly replacement in its description', async () => {
    // This tool can silently re-schedule a task to run 8,760x/year via the
    // fallback. If the description stops saying "read the trigger, not the
    // score", the trap is unguarded on this path (#14).
    const { client } = stubClient({});
    const mcp = await connect(client);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'update_task_schedule');
    expect(tool!.description).toMatch(/REPLACED/);
    expect(tool!.description).toMatch(/convert_schedule/);
  });

  it('surfaces the refusal for a non-cron trigger as the backend worded it', async () => {
    // A boot/logon/event-triggered Windows task has no cron form. The honest
    // answer is the backend's own 400, not a wrapper-invented one.
    const { client } = stubClient({
      'PATCH /tasks/id1/schedule': () =>
        new CronsoleApiError('Editing schedules is not supported for CLAUDE_CODE yet.', 400)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'update_task_schedule', { taskId: 'id1', schedule: '0 6 * * *' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/not supported for CLAUDE_CODE/);
  });

  it('requires a schedule', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/id1/schedule': task() });
    const mcp = await connect(client);
    const r = await call(mcp, 'update_task_schedule', { taskId: 'id1' });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('update_task_action', () => {
  const updated = task();

  it('patches the actions route with command and runLevel', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/id1/actions': updated });
    const mcp = await connect(client);
    await call(mcp, 'update_task_action', {
      taskId: 'id1',
      command: 'powershell.exe -File "C:\\jobs\\x.ps1"',
      runLevel: 'least'
    });
    expect(calls[0]).toMatchObject({
      method: 'patch',
      path: '/tasks/id1/actions',
      body: { command: 'powershell.exe -File "C:\\jobs\\x.ps1"', runLevel: 'least' }
    });
  });

  it('omits optional fields rather than sending undefined', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/id1/actions': updated });
    const mcp = await connect(client);
    await call(mcp, 'update_task_action', { taskId: 'id1', command: 'c.exe', runLevel: 'least' });
    expect(Object.keys(calls[0].body as object).sort()).toEqual(['command', 'runLevel']);
  });

  it('passes an explicitly empty workingDirectory through, to clear it', async () => {
    // '' is a real instruction ("clear the working directory"), distinct from
    // absent. Dropping it with a truthiness check would make clearing impossible.
    const { client, calls } = stubClient({ 'PATCH /tasks/id1/actions': updated });
    const mcp = await connect(client);
    await call(mcp, 'update_task_action', {
      taskId: 'id1',
      command: 'c.exe',
      runLevel: 'least',
      workingDirectory: ''
    });
    expect(calls[0].body).toMatchObject({ workingDirectory: '' });
  });

  it('requires runLevel, because the route replaces rather than merges', async () => {
    // The route's zod schema makes runLevel mandatory: the action is REPLACED,
    // so omitting it would silently reset a task's elevation. Better to demand it.
    const { client, calls } = stubClient({ 'PATCH /tasks/id1/actions': updated });
    const mcp = await connect(client);
    const r = await call(mcp, 'update_task_action', { taskId: 'id1', command: 'c.exe' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/runLevel/);
    expect(calls).toHaveLength(0);
  });

  it('rejects a runLevel the route does not accept', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/id1/actions': updated });
    const mcp = await connect(client);
    const r = await call(mcp, 'update_task_action', {
      taskId: 'id1',
      command: 'c.exe',
      runLevel: 'admin'
    });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('says the action is replaced, not merged', async () => {
    const { client } = stubClient({});
    const mcp = await connect(client);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'update_task_action');
    expect(tool!.description).toMatch(/REPLACES/);
  });

  it('reports that the schedule and identity were preserved', async () => {
    const { client } = stubClient({ 'PATCH /tasks/id1/actions': updated });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'update_task_action', {
      taskId: 'id1',
      command: 'c.exe',
      runLevel: 'highest'
    }));
    expect(out).toMatch(/preserved/i);
    expect(out).toMatch(/highest/);
  });
});

describe('get_task_history', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: 'e1',
    status: 'SUCCESS',
    triggeredAt: '2026-07-15T03:00:00.000Z',
    durationMs: 1200,
    log: null,
    platformRunId: null,
    ...over
  });

  it('reads the executions route', async () => {
    const { client, calls } = stubClient({ 'GET /tasks/id1/executions': [run()] });
    const mcp = await connect(client);
    await call(mcp, 'get_task_history', { taskId: 'id1' });
    expect(calls[0]).toMatchObject({ method: 'get', path: '/tasks/id1/executions' });
  });

  it('renders each run with its status and duration', async () => {
    const { client } = stubClient({
      'GET /tasks/id1/executions': [
        run({ status: 'SUCCESS', durationMs: 1200 }),
        run({ id: 'e2', status: 'FAILED', triggeredAt: '2026-07-14T03:00:00.000Z', durationMs: 90 })
      ]
    });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'get_task_history', { taskId: 'id1' }));
    expect(out).toMatch(/SUCCESS/);
    expect(out).toMatch(/FAILED/);
    expect(out).toMatch(/1200ms/);
    expect(out).toMatch(/2 recent run/);
  });

  it('includes the captured log for a failed run', async () => {
    const { client } = stubClient({
      'GET /tasks/id1/executions': [run({ status: 'FAILED', log: 'Access is denied.' })]
    });
    const mcp = await connect(client);
    expect(text(await call(mcp, 'get_task_history', { taskId: 'id1' }))).toMatch(/Access is denied/);
  });

  it('does not claim a task never ran when there is simply no history', async () => {
    // The honesty case. Cronsole records manual runs and native fires; a Windows
    // task firing on its OWN trigger is recorded by Windows. Reporting "no runs"
    // as "never ran" would be a confident lie about someone else's records.
    const { client } = stubClient({ 'GET /tasks/id1/executions': [] });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'get_task_history', { taskId: 'id1' }));
    expect(out).toMatch(/does NOT necessarily mean the task never ran/i);
    expect(out).toMatch(/recorded by Windows/i);
  });

  it('warns that SUCCESS is not proof against a hang', async () => {
    // #12's lesson, on the tool that most looks like proof: Cronsole's own
    // SUCCESS is exactly what the hung webhook template reported.
    const { client } = stubClient({});
    const mcp = await connect(client);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'get_task_history');
    expect(tool!.description).toMatch(/hang/i);
    expect(tool!.description).toMatch(/LastTaskResult/);
  });

  it('caps the limit at the 20 the route actually returns', async () => {
    // Offering limit: 100 would imply a history the API will never serve.
    const { client, calls } = stubClient({ 'GET /tasks/id1/executions': [run()] });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_task_history', { taskId: 'id1', limit: 50 });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a 404 for someone else\'s task', async () => {
    const { client } = stubClient({
      'GET /tasks/nope/executions': () => new CronsoleApiError('Task not found', 404)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_task_history', { taskId: 'nope' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Task not found/);
  });
});

describe('export_task', () => {
  // A Windows export arrives as UTF-16 LE + BOM bytes — the only encoding
  // Windows re-imports. Decoding it as UTF-8 yields mojibake, so these fixtures
  // are real buffers in that encoding, not strings.
  const xml = '<?xml version="1.0" encoding="UTF-16"?><Task><Actions/></Task>';
  const utf16WithBom = () => ({
    data: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]),
    contentType: 'application/xml; charset=utf-16le'
  });

  it('decodes a UTF-16 Windows export back to real XML', async () => {
    // The bug this prevents: reading UTF-16 LE bytes as UTF-8 yields the XML
    // interleaved with NUL bytes ("<\x00?\x00x\x00m\x00l..."), which the model
    // would then faithfully relay as the task definition. The final assertion
    // guards exactly that — the decoded text must contain no NUL.
    const { client } = stubClient({ 'GET /tasks/id1/export': utf16WithBom });
    const mcp = await connect(client);
    const r = await call(mcp, 'export_task', { taskId: 'id1' });
    expect(r.structuredContent?.xml).toBe(xml);
    expect(text(r)).toMatch(/<Task><Actions\/><\/Task>/);
    expect(text(r)).not.toMatch(/\x00/);
  });

  it('strips the BOM rather than leaving it in the XML', async () => {
    const { client } = stubClient({ 'GET /tasks/id1/export': utf16WithBom });
    const mcp = await connect(client);
    const r = await call(mcp, 'export_task', { taskId: 'id1' });
    expect(r.structuredContent?.xml.startsWith('<?xml')).toBe(true);
    expect(r.structuredContent?.xml).not.toMatch(/^﻿/);
  });

  it('tells the caller the file must be saved as UTF-16 to re-import', async () => {
    // The tool hands back a string; the encoding is lost the moment an agent
    // writes it. Saying so is the difference between a usable export and a file
    // Windows rejects with "unable to switch the encoding".
    const { client } = stubClient({ 'GET /tasks/id1/export': utf16WithBom });
    const mcp = await connect(client);
    expect(text(await call(mcp, 'export_task', { taskId: 'id1' }))).toMatch(/UTF-16 LE with a BOM/);
  });

  it('exports a Cronsole-native task as JSON', async () => {
    const bundle = {
      cronsoleTaskVersion: '1.0',
      exportedAt: '2026-07-15T00:00:00.000Z',
      task: { name: 'Ping', platform: 'TASKHUB_NATIVE', job: { url: 'https://x' } }
    };
    const { client } = stubClient({
      'GET /tasks/id2/export': {
        data: Buffer.from(JSON.stringify(bundle), 'utf8'),
        contentType: 'application/json; charset=utf-8'
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'export_task', { taskId: 'id2' });
    expect(r.structuredContent?.format).toBe('cronsole-json');
    expect(r.structuredContent?.definition).toEqual(bundle);
  });

  it('surfaces an agent-offline export failure honestly', async () => {
    const { client } = stubClient({
      'GET /tasks/id1/export': () =>
        new CronsoleApiError('The agent could not export this task', 502)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'export_task', { taskId: 'id1' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/agent could not export/);
    expect(text(r)).toMatch(/HTTP 502/);
  });
});

describe('create_native_task', () => {
  const created = { message: 'Native task created', task: task({ id: 'n1', platform: 'TASKHUB_NATIVE' }) };

  it('sends the jobType discriminator the route requires', async () => {
    // This test previously asserted a payload with NO `jobType` and was named
    // "nests the HTTP job the way the route expects" — a claim it could not
    // check, because the client is stubbed. The route rejected that shape with
    // "Unsupported jobType: undefined" from the day the tool shipped, and the
    // suite stayed green throughout (troubleshooting #44). The discriminator is
    // asserted first here so the next person sees it is load-bearing.
    const { client, calls } = stubClient({ 'POST /tasks/native': created });
    const mcp = await connect(client);
    await call(mcp, 'create_native_task', {
      name: 'Health ping',
      url: 'https://example.com/health',
      schedule: '*/15 * * * *'
    });
    expect(calls[0].path).toBe('/tasks/native');
    expect(calls[0].body).toEqual({
      name: 'Health ping',
      schedule: '*/15 * * * *',
      job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' }
    });
  });

  it('carries method, headers, and body into the job spec', async () => {
    // This is the whole reason the tool is separate from create_task, whose
    // native path takes only a URL.
    const { client, calls } = stubClient({ 'POST /tasks/native': created });
    const mcp = await connect(client);
    await call(mcp, 'create_native_task', {
      name: 'Webhook',
      url: 'https://example.com/hook',
      schedule: '0 9 * * *',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}'
    });
    expect((calls[0].body as any).job).toEqual({
      jobType: 'HTTP',
      url: 'https://example.com/hook',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}'
    });
  });

  it('omits absent optional job fields rather than sending undefined', async () => {
    const { client, calls } = stubClient({ 'POST /tasks/native': created });
    const mcp = await connect(client);
    await call(mcp, 'create_native_task', { name: 'n', url: 'https://x', schedule: '0 9 * * *' });
    expect(Object.keys((calls[0].body as any).job).sort()).toEqual(['jobType', 'method', 'url']);
  });

  it('rejects a method the executor does not support', async () => {
    const { client, calls } = stubClient({ 'POST /tasks/native': created });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_native_task', {
      name: 'n',
      url: 'https://x',
      schedule: '0 9 * * *',
      method: 'TRACE'
    });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('reports the created task and its next run', async () => {
    const { client } = stubClient({ 'POST /tasks/native': created });
    const mcp = await connect(client);
    const out = text(await call(mcp, 'create_native_task', {
      name: 'n',
      url: 'https://x',
      schedule: '0 9 * * *'
    }));
    expect(out).toMatch(/Native task created/);
    expect(out).toMatch(/id: n1/);
    expect(out).toMatch(/Next run/);
  });

  it('surfaces an invalid-job 400 from the backend', async () => {
    const { client } = stubClient({
      'POST /tasks/native': () => new CronsoleApiError('job.url must be an absolute URL', 400)
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'create_native_task', {
      name: 'n',
      url: 'notaurl',
      schedule: '0 9 * * *'
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/absolute URL/);
  });
});

describe('update_native_job', () => {
  const task = {
    id: 'n1', name: 'Ping', platform: 'TASKHUB_NATIVE',
    externalId: 'native_abc', status: 'ACTIVE', schedule: '0 3 * * *'
  };

  it('sends a complete HTTP job, and never a field from the other type', async () => {
    // The whole risk of a replace-not-patch verb reached through a flat tool
    // signature: `command` and `url` are both optional parameters, so a caller
    // can pass both. Only the fields belonging to the chosen jobType may be
    // stored — a stray `command` on an HTTP job is a field the executor never
    // reads and a reader cannot explain.
    const { client, calls } = stubClient({ 'PATCH /tasks/n1/job': task });
    const mcp = await connect(client);
    await call(mcp, 'update_native_job', {
      taskId: 'n1', jobType: 'HTTP', url: 'https://e.com/ping', method: 'POST',
      headers: { 'X-Key': 'v' }, body: '{}', command: 'node x.js', workingDirectory: '/tmp'
    });

    expect(calls[0]).toMatchObject({ method: 'patch', path: '/tasks/n1/job' });
    expect(calls[0].body).toEqual({
      job: { jobType: 'HTTP', url: 'https://e.com/ping', method: 'POST', headers: { 'X-Key': 'v' }, body: '{}' }
    });
  });

  it('sends a complete EXEC job, and never a field from the other type', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/n1/job': { ...task, name: 'Digest' } });
    const mcp = await connect(client);
    await call(mcp, 'update_native_job', {
      taskId: 'n1', jobType: 'EXEC', command: 'node digest.js', workingDirectory: 'D:\jobs',
      url: 'https://e.com', headers: { 'X-Key': 'v' }
    });

    expect(calls[0].body).toEqual({
      job: { jobType: 'EXEC', command: 'node digest.js', workingDirectory: 'D:\jobs' }
    });
  });

  it('defaults the method rather than omitting it, so the stored job is complete', async () => {
    // Omitting `method` must not mean "keep the old one" — this replaces the
    // job, and a spec that silently inherits half of its predecessor is exactly
    // the merge this route refuses to do.
    const { client, calls } = stubClient({ 'PATCH /tasks/n1/job': task });
    const mcp = await connect(client);
    await call(mcp, 'update_native_job', { taskId: 'n1', jobType: 'HTTP', url: 'https://e.com' });

    expect((calls[0].body as { job: Record<string, unknown> }).job).toEqual({
      jobType: 'HTTP', url: 'https://e.com', method: 'GET'
    });
  });

  it('url-encodes the task id', async () => {
    const { client, calls } = stubClient({ 'PATCH /tasks/a%2Fb/job': task });
    const mcp = await connect(client);
    await call(mcp, 'update_native_job', { taskId: 'a/b', jobType: 'HTTP', url: 'https://e.com' });
    expect(calls[0].path).toBe('/tasks/a%2Fb/job');
  });

  it('says the schedule and history survived, and points Windows elsewhere', async () => {
    const { client } = stubClient({ 'PATCH /tasks/n1/job': task });
    const mcp = await connect(client);
    const r = await call(mcp, 'update_native_job', { taskId: 'n1', jobType: 'HTTP', url: 'https://e.com' });
    expect(text(r)).toMatch(/schedule, name and run history were preserved/i);

    const tool = (await mcp.listTools()).tools.find(t => t.name === 'update_native_job');
    // Replace-not-patch and the Windows alternative both have to be in the
    // description — they are the two ways a caller gets this wrong.
    expect(tool!.description).toMatch(/REPLACES/);
    expect(tool!.description).toMatch(/update_task_action/);
  });
});

describe('untrack_task', () => {
  it('POSTs to the untrack route', async () => {
    const { client, calls } = stubClient({
      'POST /tasks/id1/untrack': { message: 'Removed from Cronsole', externalId: '\\IAM\\Rotate' }
    });
    const mcp = await connect(client);
    await call(mcp, 'untrack_task', { taskId: 'id1' });
    expect(calls[0]).toMatchObject({ method: 'post', path: '/tasks/id1/untrack' });
  });

  it('url-encodes the task id', async () => {
    const { client, calls } = stubClient({ 'POST /tasks/a%2Fb/untrack': { message: 'ok' } });
    const mcp = await connect(client);
    await call(mcp, 'untrack_task', { taskId: 'a/b' });
    expect(calls[0].path).toBe('/tasks/a%2Fb/untrack');
  });

  it('reports that the platform entry survived, in text and in structure', async () => {
    // A caller reading only the structured payload must not be able to mistake
    // this for a delete — that confusion is the whole risk of the feature.
    const { client } = stubClient({
      'POST /tasks/id1/untrack': {
        message: 'Removed from Cronsole',
        externalId: '\\IAM\\Rotate',
        detail: '"Rotate" is no longer tracked by Cronsole. It still exists on its platform.'
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'untrack_task', { taskId: 'id1' });

    expect(text(r)).toMatch(/still exists on its platform/i);
    expect(r.structuredContent).toMatchObject({
      taskId: 'id1',
      untracked: true,
      platformEntryKept: true,
      externalId: '\\IAM\\Rotate'
    });
  });

  it('still says the task survived when the API omits the detail line', async () => {
    const { client } = stubClient({ 'POST /tasks/id1/untrack': { message: 'ok' } });
    const mcp = await connect(client);
    expect(text(await call(mcp, 'untrack_task', { taskId: 'id1' })))
      .toMatch(/still exists on its platform/i);
  });

  it('is described as the non-destructive alternative to deleting', async () => {
    const { client } = stubClient({});
    const mcp = await connect(client);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'untrack_task');
    expect(tool!.description).toMatch(/WITHOUT deleting/i);
    expect(tool!.description).toMatch(/keeps running/i);
    // And it must name the one platform it refuses, or an agent will try it on
    // a native task and read the 400 as a bug.
    expect(tool!.description).toMatch(/TASKHUB_NATIVE/);
  });

  it('surfaces the native-task refusal instead of retrying as a delete', async () => {
    const { client } = stubClient({
      'POST /tasks/n1/untrack': new CronsoleApiError(
        'Cronsole-native tasks exist only inside Cronsole, so there is nothing to keep.',
        400
      )
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'untrack_task', { taskId: 'n1' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/exist only inside Cronsole/i);
  });
});

describe('delete_task', () => {
  it('names untrack_task as the tidy-up alternative', async () => {
    // The dangerous tool must point at the safe one where it is read.
    const { client } = stubClient({});
    const mcp = await connect(client, true);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'delete_task');
    expect(tool!.description).toMatch(/untrack_task/);
  });

  it('calls the NATIVE-ONLY delete route, never the UI one', async () => {
    // The whole safety property is which route this wraps. `DELETE /tasks/:id`
    // reaches a real Task Scheduler entry through the elevated agent;
    // `/tasks/:id/native` refuses anything but TASKHUB_NATIVE. Wrapping the
    // wrong one silently restores the blast radius this change removed, and
    // nothing else in the suite would notice.
    const { client, calls } = stubClient({
      'DELETE /tasks/id1/native': { message: 'Task deleted', archiveId: 'arc_1' }
    });
    const mcp = await connect(client, true);
    await call(mcp, 'delete_task', { taskId: 'id1' });
    expect(calls[0]).toMatchObject({ method: 'delete', path: '/tasks/id1/native' });
    expect(calls[0].path).not.toBe('/tasks/id1');
  });

  it('url-encodes the task id without mangling the route suffix', async () => {
    const { client, calls } = stubClient({
      'DELETE /tasks/a%2Fb/native': { message: 'Task deleted' }
    });
    const mcp = await connect(client, true);
    await call(mcp, 'delete_task', { taskId: 'a/b' });
    expect(calls[0].path).toBe('/tasks/a%2Fb/native');
  });

  it('reports the archive id, so the caller knows recovery is possible', async () => {
    const { client } = stubClient({
      'DELETE /tasks/id1/native': {
        message: 'Task deleted',
        archiveId: 'arc_42',
        executionsArchived: 7
      }
    });
    const mcp = await connect(client, true);
    const t = text(await call(mcp, 'delete_task', { taskId: 'id1' }));
    expect(t).toMatch(/arc_42/);
    expect(t).toMatch(/7 run record/);
    expect(t).toMatch(/task-archives/);
  });

  it('states the native-only boundary as a boundary, not a missing feature', async () => {
    // A model that reads "not supported yet" retries or looks for a flag. The
    // description has to foreclose that, or the refusal below gets fought.
    const { client } = stubClient({});
    const mcp = await connect(client, true);
    const tool = (await mcp.listTools()).tools.find(t => t.name === 'delete_task');
    expect(tool!.description).toMatch(/TASKHUB_NATIVE/);
    expect(tool!.description).toMatch(/boundary, not a missing feature/i);
    expect(tool!.description).toMatch(/untrack_task/);
    expect(tool!.description).toMatch(/set_task_status/);
  });

  it('surfaces the backend refusal for a Windows task in the backend words', async () => {
    // The check lives in the route. This asserts the wrapper does not soften,
    // reinterpret or swallow it — the caller needs to learn the real boundary.
    const { client } = stubClient({
      'DELETE /tasks/id1/native': () =>
        new CronsoleApiError(
          'This route deletes Cronsole-native tasks only, and this task is on ' +
            'WINDOWS_TASK_SCHEDULER.',
          400
        )
    });
    const mcp = await connect(client, true);
    const r = await call(mcp, 'delete_task', { taskId: 'id1' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/Cronsole-native tasks only/);
    expect(text(r)).toMatch(/WINDOWS_TASK_SCHEDULER/);
  });

  it('surfaces a refused-because-unarchivable delete as an error', async () => {
    // The delete did NOT happen. Reporting this as anything but an error would
    // tell the caller the task is gone when it is still scheduled and running.
    const { client } = stubClient({
      'DELETE /tasks/id1/native': () =>
        new CronsoleApiError(
          'Could not archive the task before deleting it, so the delete was refused. ' +
            'The task is unchanged.',
          500
        )
    });
    const mcp = await connect(client, true);
    const r = await call(mcp, 'delete_task', { taskId: 'id1' });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/delete was refused/);
    expect(text(r)).toMatch(/unchanged/);
  });
});

describe('error handling across the surface', () => {
  it('returns isError rather than throwing, for every tool', async () => {
    // A thrown handler surfaces as a protocol error; the model sees a stack
    // trace instead of a reason it can act on. Every tool must degrade to a
    // readable message.
    const boom = () => new CronsoleApiError('Backend exploded', 500);
    const { client } = stubClient({
      'GET /tasks': boom,
      'GET /templates': boom,
      'GET /tasks/folders': boom,
      'GET /tasks/x/executions': boom,
      'GET /tasks/x/export': boom,
      'POST /tasks': boom,
      'POST /tasks/native': boom,
      'POST /tasks/x/run': boom,
      'POST /tasks/x/untrack': boom,
      'POST /tasks/preview': boom,
      'POST /templates/t/apply': boom,
      'PATCH /tasks/x': boom,
      'PATCH /tasks/x/job': boom,
      'PATCH /tasks/x/status': boom,
      'PATCH /tasks/x/schedule': boom,
      'PATCH /tasks/x/actions': boom,
      'DELETE /tasks/x/native': boom,
      'GET /tools/platforms': boom,
      'GET /tools/platforms/claude/routines': boom,
      'POST /tools/platforms/claude/routines': boom,
      'DELETE /tools/platforms/claude/routines/x': boom,
      'PATCH /tools/platforms/claude/routines/x': boom,
      'POST /tasks/sync': boom,
      'GET /tools/diagnostics': boom,
      'GET /tools/task-health': boom,
      'GET /tools/history': boom
    });
    const mcp = await connect(client, true);
    const cases: [string, Record<string, unknown>][] = [
      ['list_tasks', {}],
      ['list_templates', {}],
      ['list_folders', {}],
      ['create_task', { name: 'n', command: 'c', schedule: '0 9 * * *' }],
      ['create_native_task', { name: 'n', url: 'https://x', schedule: '0 9 * * *' }],
      ['create_native_program_task', { name: 'n', command: 'node -v', schedule: '0 9 * * *' }],
      ['create_native_script_task', { name: 'n', interpreter: 'node', body: 'console.log(1)', schedule: '0 9 * * *' }],
      ['create_native_check_task', { name: 'n', schedule: '0 9 * * *', kind: 'tcp', host: 'h', port: 1 }],
      ['run_task', { taskId: 'x' }],
      ['convert_schedule', { schedule: '0 9 * * *' }],
      ['create_claude_routine', { name: 'n', prompt: 'p', schedule: '0 9 * * *' }],
      ['create_task_from_template', { templateId: 't' }],
      ['get_task_history', { taskId: 'x' }],
      ['export_task', { taskId: 'x' }],
      ['set_task_status', { taskId: 'x', status: 'DISABLED' }],
      ['update_task_schedule', { taskId: 'x', schedule: '0 9 * * *' }],
      ['update_task_action', { taskId: 'x', command: 'c', runLevel: 'least' }],
      ['untrack_task', { taskId: 'x' }],
      ['delete_task', { taskId: 'x' }],
      ['list_platforms', {}],
      ['list_claude_routines', {}],
      ['connect_claude_routine', { routineId: 'x', token: 't' }],
      ['disconnect_claude_routine', { routineId: 'x' }],
      ['edit_claude_routine', { routineId: 'x', newId: 'trig_2' }],
      ['sync_tasks', {}],
      ['get_diagnostics', {}],
      ['get_task_health', {}],
      ['list_run_history', {}],
      ['rename_task', { taskId: 'x', name: 'New name' }],
      ['update_native_job', { taskId: 'x', jobType: 'HTTP', url: 'https://e.com' }]
    ];
    // Every registered tool must appear above — a new tool that skips this guard
    // would be free to throw a stack trace at the model.
    const registered = (await mcp.listTools()).tools.map(t => t.name).sort();
    expect(cases.map(([n]) => n).sort()).toEqual(registered);

    for (const [name, args] of cases) {
      const r = await call(mcp, name, args);
      expect(r.isError, `${name} did not flag isError`).toBe(true);
      expect(text(r), `${name} lost the backend message`).toMatch(/Backend exploded/);
      expect(text(r), `${name} lost the status`).toMatch(/HTTP 500/);
    }
  });

  it('renders a connection failure (no status) without an empty "HTTP undefined"', async () => {
    const { client } = stubClient({
      'GET /tasks': () => new CronsoleApiError('Could not reach the Cronsole backend at http://x (ECONNREFUSED)')
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_tasks');
    expect(r.isError).toBe(true);
    expect(text(r)).toBe('Could not reach the Cronsole backend at http://x (ECONNREFUSED)');
    expect(text(r)).not.toMatch(/undefined/);
  });
});

// ---------------------------------------------------------------------------
// The /api/tools surface — added 2026-08-12
// ---------------------------------------------------------------------------

describe('list_platforms', () => {
  const matrix = {
    platforms: [
      {
        platform: 'CLAUDE_CODE',
        label: 'Claude Code Routines',
        summary: 'Fire a routine from Cronsole.',
        maturity: 'experimental',
        configured: true,
        isActive: true,
        healthState: 'DEGRADED',
        healthReason: '1 routine configured, none fired yet.',
        lastSync: null,
        taskCount: 1,
        lastVerifiedAt: null,
        capabilities: [
          { verb: 'sync', label: 'Sync', description: '', support: 'verified', lastSuccessAt: '2026-08-12T00:00:00Z', lastFailureAt: null, lastFailureReason: null },
          { verb: 'run', label: 'Run now', description: '', support: 'declared', lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null },
          { verb: 'create', label: 'Create', description: '', support: 'unsupported', lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null }
        ]
      }
    ]
  };

  it('separates verified from declared from unsupported', async () => {
    // The middle state is the whole design: "reachable but never observed" is
    // not the same claim as "it works here", and collapsing them is the
    // spec-table lie the matrix exists to prevent.
    const { client } = stubClient({ 'GET /tools/platforms': matrix });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_platforms', {});
    expect(text(r)).toMatch(/verified:\s+sync/);
    expect(text(r)).toMatch(/declared:\s+run/);
    expect(text(r)).toMatch(/unsupported:\s+create/);
  });

  it('filters to one platform', async () => {
    const { client } = stubClient({ 'GET /tools/platforms': matrix });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_platforms', { platform: 'WINDOWS_TASK_SCHEDULER' });
    expect(text(r)).toMatch(/No capability row for WINDOWS_TASK_SCHEDULER/);
  });
});

describe('Claude routines', () => {
  it('connects a routine and imports it in one call', async () => {
    const { client, calls } = stubClient({
      'POST /tools/platforms/claude/routines': {
        routine: { id: 'trig_1', name: 'Nightly', hasToken: true, taskCount: 0 },
        replaced: false,
        warnings: []
      },
      'POST /tasks/sync': { message: 'Sync complete', results: [] }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'connect_claude_routine', {
      routineId: 'trig_1',
      token: 'sk-ant-oat01-x',
      name: 'Nightly'
    });

    expect(r.isError).toBeFalsy();
    expect(calls[0].body).toEqual({ id: 'trig_1', token: 'sk-ant-oat01-x', name: 'Nightly' });
    // Scoped to Claude — a bare sync would pull in Windows folders nobody asked for.
    expect(calls[1]).toMatchObject({ path: '/tasks/sync', body: { categories: ['Claude'] } });
    expect(text(r)).toMatch(/still runs on its own schedule at claude\.ai/);
  });

  it('can store the credential without importing', async () => {
    const { client, calls } = stubClient({
      'POST /tools/platforms/claude/routines': {
        routine: { id: 'trig_1', hasToken: true, taskCount: 0 },
        replaced: false,
        warnings: []
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'connect_claude_routine', {
      routineId: 'trig_1',
      token: 't',
      importNow: false
    });
    expect(calls.some(c => c.path === '/tasks/sync')).toBe(false);
    expect(text(r)).toMatch(/Not imported/);
  });

  it('says a re-connect replaced the token rather than reporting a fresh add', async () => {
    // Re-adding IS the rotation path — generating a token at claude.ai revokes
    // its predecessor — so the distinction matters to the caller.
    const { client } = stubClient({
      'POST /tools/platforms/claude/routines': {
        routine: { id: 'trig_1', hasToken: true, taskCount: 2 },
        replaced: true,
        warnings: []
      },
      'POST /tasks/sync': { results: [] }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'connect_claude_routine', { routineId: 'trig_1', token: 't' });
    expect(text(r)).toMatch(/Re-connected \(token replaced\)/);
  });

  it('surfaces a shape warning instead of a clean success', async () => {
    const { client } = stubClient({
      'POST /tools/platforms/claude/routines': {
        routine: { id: 'weird', hasToken: true, taskCount: 0 },
        replaced: false,
        warnings: ['"weird" does not look like a routine id']
      },
      'POST /tasks/sync': { results: [] }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'connect_claude_routine', { routineId: 'weird', token: 't' });
    expect(text(r)).toMatch(/WARNING: "weird" does not look like a routine id/);
  });

  it('never echoes the token back', async () => {
    // The token is write-only everywhere else in the product, and a tool result
    // is a transcript entry — echoing it here would undo that in the one place
    // it is most durably recorded.
    const { client } = stubClient({
      'POST /tools/platforms/claude/routines': {
        routine: { id: 'trig_1', hasToken: true, taskCount: 0 },
        replaced: false,
        warnings: []
      },
      'POST /tasks/sync': { results: [] }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'connect_claude_routine', {
      routineId: 'trig_1',
      token: 'sk-ant-oat01-SECRET'
    });
    expect(text(r)).not.toMatch(/SECRET/);
    expect(JSON.stringify(r.structuredContent ?? {})).not.toMatch(/SECRET/);
  });

  it('fixes an id without asking for the token again', async () => {
    // The point of the edit route: disconnect-then-connect discards the stored
    // token, and claude.ai shows one once — so a typo would cost a credential.
    // The stub key is percent-encoded because the id being corrected is very
    // often a bad paste — the real case was the routine's NAME, spaces and all.
    // An unencoded path would break on exactly the ids this route exists to fix.
    const { client, calls } = stubClient({
      'PATCH /tools/platforms/claude/routines/Refresh%20sidebar%20links': {
        routine: { id: 'trig_01PD', name: 'Refresh sidebar links', hasToken: true },
        idChanged: true,
        previousId: 'Refresh sidebar links',
        tasksRepointed: 1,
        warnings: []
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'edit_claude_routine', {
      routineId: 'Refresh sidebar links',
      newId: 'trig_01PD'
    });
    expect(r.isError).toBeFalsy();
    expect(calls[0].path).toBe('/tools/platforms/claude/routines/Refresh%20sidebar%20links');
    // No token in the request — that is the invariant, not an omission.
    expect(calls[0].body).toEqual({ id: 'trig_01PD' });
    expect(text(r)).toMatch(/stored token was kept/);
    expect(text(r)).toMatch(/1 task\(s\) moved with it/);
  });

  it('refuses an edit that changes nothing, rather than reporting success', async () => {
    // A no-op PATCH is nearly always a caller bug (usually a field-name typo),
    // and a 200 hides it until someone wonders why nothing happened.
    const { client, calls } = stubClient({});
    const mcp = await connect(client);
    const r = await call(mcp, 'edit_claude_routine', { routineId: 'trig_1' });
    expect(r.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('reports the tasks it removed, and that the routine itself survives', async () => {
    // Both halves matter and they point opposite ways: the tracked rows GO
    // (a Claude task is tracked because the routine is declared, so this is the
    // only thing that removes one), and the routine at claude.ai STAYS.
    const { client } = stubClient({
      'DELETE /tools/platforms/claude/routines/trig_1': {
        removed: 'trig_1',
        tasksRemoved: 3,
        connectionRemoved: true
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'disconnect_claude_routine', { routineId: 'trig_1' });
    expect(text(r)).toMatch(/still runs at claude\.ai/);
    expect(text(r)).toMatch(/3 tracked task\(s\) were removed/);
  });

  it('tells an agent that untrack is not the way to remove a Claude task', async () => {
    // The refusal lives in the backend, so the only thing this surface can do
    // is route around it — and it can only do that if the description says so.
    const { client } = stubClient({});
    const mcp = await connect(client);
    const untrack = (await mcp.listTools()).tools.find(t => t.name === 'untrack_task');
    expect(untrack!.description).toMatch(/CLAUDE_CODE/);
    expect(untrack!.description).toMatch(/disconnect_claude_routine/);
  });

  it('explains an empty list rather than returning a bare zero', async () => {
    const { client } = stubClient({ 'GET /tools/platforms/claude/routines': { routines: [] } });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_claude_routines', {});
    expect(text(r)).toMatch(/claude\.ai\/code\/routines/);
  });
});

describe('sync_tasks', () => {
  it('refreshes when no categories are given', async () => {
    // The two modes are genuinely different and easy to confuse: a refresh adds
    // nothing new, while sending `categories` also forgets prior untracks.
    const { client, calls } = stubClient({ 'POST /tasks/sync': { results: [] } });
    const mcp = await connect(client);
    const r = await call(mcp, 'sync_tasks', {});
    expect(calls[0].body).toEqual({ scope: 'tracked' });
    expect(text(r)).toMatch(/nothing new imported/);
  });

  it('imports when categories are given', async () => {
    const { client, calls } = stubClient({
      'POST /tasks/sync': {
        results: [
          { platform: 'CLAUDE_CODE', count: 1, missing: 0, untracked: { count: 0, folders: [], systemCount: 0, excludedCount: 0 } }
        ]
      }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'sync_tasks', { categories: ['Claude'] });
    expect(calls[0].body).toEqual({ categories: ['Claude'] });
    expect(text(r)).toMatch(/Imported categories: Claude/);
  });
});

describe('get_diagnostics', () => {
  // The two states an agent must be able to tell apart, plus the one that is
  // neither: a real failure, a check that could not be measured, and a pass.
  const report = {
    generatedAt: '2026-08-17T16:57:22Z',
    measuredOn: {
      kind: 'container',
      hostname: 'box',
      os: 'linux',
      summary: 'Cronsole-native tasks run inside the backend container, not on your machine.'
    },
    counts: { pass: 1, warn: 0, fail: 1, unknown: 1 },
    worst: 'fail',
    checks: [
      {
        id: 'backend', title: 'Backend process', status: 'pass',
        summary: 'Running and answering requests.',
        facts: [{ label: 'Uptime', value: '9m' }]
      },
      {
        id: 'windows-agent', title: 'Windows agent', status: 'fail',
        summary: 'Agent not connected',
        facts: [
          { label: 'Socket', value: 'not connected' },
          { label: 'Last request timeout', value: '2026-08-17T09:03:00Z (8h ago) — task:list' }
        ],
        remedy: 'Check that the agent is running on your machine.'
      },
      {
        id: 'template-catalog', title: 'Template catalog', status: 'unknown',
        summary: 'No catalog sync has completed since this backend started.',
        facts: [{ label: 'Last sync attempt', value: 'none yet' }]
      }
    ]
  };

  it('prints the evidence for anything that is not passing', async () => {
    // The whole reason the tool exists: "Windows offline" is a verdict, and the
    // liveness facts under it are what separate "the agent never connected"
    // from "one request timed out this morning". A wrapper that printed only
    // summaries would be the status chip again, over stdio.
    const { client } = stubClient({ 'GET /tools/diagnostics': report });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_diagnostics', {});

    expect(text(r)).toMatch(/Socket: not connected/);
    expect(text(r)).toMatch(/task:list/);
    expect(text(r)).toMatch(/Check that the agent is running/);
  });

  it('omits the evidence for a passing check, so the failing rows are readable', async () => {
    const { client } = stubClient({ 'GET /tools/diagnostics': report });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_diagnostics', {});

    expect(text(r)).toMatch(/Backend process — pass/);
    expect(text(r)).not.toMatch(/Uptime: 9m/);
  });

  it('never reports an unmeasured check as ok', async () => {
    // `unknown` outranks `pass` for the reason troubleshooting #48 gives: an
    // absence of evidence rendered as health tells the reader to stop looking.
    const { client } = stubClient({ 'GET /tools/diagnostics': report });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_diagnostics', {});

    expect(text(r)).toMatch(/Template catalog — unknown/);
    expect(text(r)).toMatch(/1 not measured/);
    expect(text(r)).not.toMatch(/Template catalog — pass/);
  });

  it('says when the facts describe a container rather than the user\'s machine', async () => {
    // A disk or clock fact measured inside the container is about the container.
    // An agent that missed this would tell the user to free space on the wrong
    // filesystem — the `runtimeContext` trap, one layer out.
    const { client } = stubClient({ 'GET /tools/diagnostics': report });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_diagnostics', {});

    expect(text(r)).toMatch(/inside the backend container/);
    expect(text(r)).toMatch(/NOT the user's machine/);
  });

  it('forwards the whole report as structured content', async () => {
    // Verbatim, because the caller is usually working out what is wrong and a
    // summarized copy drops exactly the per-check facts that decide the answer.
    const { client } = stubClient({ 'GET /tools/diagnostics': report });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_diagnostics', {});

    expect(r.structuredContent).toMatchObject({ worst: 'fail', counts: { fail: 1, unknown: 1 } });
  });

  it('takes no arguments, so `worst` always describes the whole system', async () => {
    // A `checks` filter would let a caller narrow the report and then read
    // `worst` as a verdict on everything — the mixed-population error of #49 in
    // the one tool whose job is to be trusted about scope.
    const { client } = stubClient({ 'GET /tools/diagnostics': report });
    const mcp = await connect(client);
    const tools = await mcp.listTools();
    const schema = tools.tools.find(t => t.name === 'get_diagnostics')!.inputSchema;

    expect(Object.keys(schema.properties ?? {})).toEqual([]);
  });
});

describe('get_task_health', () => {
  // Shaped like the real response: the ROUTE applies `tier` / `includeSystem` /
  // `limit` and summarizes that same population, so `scope` says what `counts`
  // is about and the system task is already absent. The wrapper must not filter
  // again — filtering here while printing the server's counts is what made this
  // tool report "Across 358 task(s): 25 critical" above thirteen rows
  // (troubleshooting #49).
  const scan = {
    evaluatedAt: '2026-08-12T22:00:00Z',
    scope: { includeSystem: false, tier: null, systemExcluded: 1 },
    counts: { tasks: 2, critical: 1, attention: 0, unknown: 1, ok: 0 },
    matched: 2,
    returned: 2,
    tasks: [
      {
        taskId: 'a', name: 'Mine', platform: 'WINDOWS_TASK_SCHEDULER', category: 'X',
        isSystem: false, tier: 'critical', score: 35,
        signals: [{ code: 'last-run-failed', severity: 'critical', summary: 'The last run failed.', evidence: 'Windows recorded exit code 1', weight: 50 }]
      },
      {
        taskId: 'c', name: 'Unmeasured', platform: 'WINDOWS_TASK_SCHEDULER', category: 'X',
        isSystem: false, tier: 'unknown', score: 0, signals: []
      }
    ]
  };

  it('sends the system lens to the route instead of applying it here', async () => {
    // The lens and the count must be applied in the same place, or the summary
    // describes one population and the list another.
    const { client, calls } = stubClient({ 'GET /tools/task-health': scan });
    const mcp = await connect(client);
    await call(mcp, 'get_task_health', {});
    expect(calls[0].params).toMatchObject({ includeSystem: 'false' });
  });

  it('forwards tier and limit as query params too', async () => {
    const { client, calls } = stubClient({ 'GET /tools/task-health': scan });
    const mcp = await connect(client);
    await call(mcp, 'get_task_health', { tier: 'critical', includeSystem: true, limit: 5 });
    expect(calls[0].params).toMatchObject({ tier: 'critical', includeSystem: 'true', limit: 5 });
  });

  it('renders exactly what the route returned, without re-filtering', async () => {
    // A second filter here could only ever disagree with the counts above it.
    const { client } = stubClient({ 'GET /tools/task-health': scan });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_task_health', {});
    expect(text(r)).toMatch(/Mine/);
    expect(text(r)).toMatch(/Unmeasured/);
  });

  it('names the population its counts describe, and what was left out', async () => {
    // "Across N task(s)" over a personal-only scan is the #49 sentence again:
    // a true number under a label that claims a wider population than it counted.
    const { client } = stubClient({ 'GET /tools/task-health': scan });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_task_health', {});
    expect(text(r)).toMatch(/Across 2 of your task\(s\)/);
    expect(text(r)).toMatch(/1 system task\(s\) excluded/);
  });

  it('carries each signal with the evidence behind it', async () => {
    // A claim never travels without its source — the reason the scorer returns
    // signals rather than a bare number.
    const { client } = stubClient({ 'GET /tools/task-health': scan });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_task_health', {});
    expect(text(r)).toMatch(/The last run failed\./);
    expect(text(r)).toMatch(/Windows recorded exit code 1/);
  });

  it('reports the unknown tier so it is not read as ok', async () => {
    const { client } = stubClient({ 'GET /tools/task-health': scan });
    const mcp = await connect(client);
    const r = await call(mcp, 'get_task_health', {});
    expect(text(r)).toMatch(/1 unknown \(no evidence\)/);
  });
});

describe('list_run_history', () => {
  const history = {
    range: { from: '2026-07-13T00:00:00Z', to: '2026-08-12T00:00:00Z' },
    matched: { runs: 2, succeeded: 1, failed: 1, pending: 0 },
    truncated: false,
    rows: [
      { triggeredAt: '2026-08-12T22:00:00Z', taskId: 't1', taskName: 'Native job', platform: 'TASKHUB_NATIVE', category: 'C', status: 'SUCCESS', runKind: 'native-execution', durationMs: 120 },
      { triggeredAt: '2026-08-11T22:00:00Z', taskId: 't2', taskName: 'Win job', platform: 'WINDOWS_TASK_SCHEDULER', category: 'C', status: 'SUCCESS', runKind: 'manual-trigger', durationMs: 15 }
    ]
  };

  it('passes its filters through as query params', async () => {
    const { client, calls } = stubClient({ 'GET /tools/history': history });
    const mcp = await connect(client);
    await call(mcp, 'list_run_history', {
      status: ['FAILURE'],
      platform: 'WINDOWS_TASK_SCHEDULER',
      limit: 10
    });
    expect(calls[0].params).toMatchObject({
      status: 'FAILURE',
      platform: 'WINDOWS_TASK_SCHEDULER',
      limit: 10
    });
  });

  it('shows runKind, so a Windows SUCCESS is not read as a real outcome', async () => {
    // manual-trigger means "the agent accepted the start", not that the task
    // succeeded. Without runKind these two rows look identical.
    const { client } = stubClient({ 'GET /tools/history': history });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_run_history', {});
    expect(text(r)).toMatch(/native-execution/);
    expect(text(r)).toMatch(/manual-trigger/);
  });

  it('warns that an empty result does not mean nothing ran', async () => {
    const { client } = stubClient({
      'GET /tools/history': { ...history, matched: { runs: 0, succeeded: 0, failed: 0, pending: 0 }, rows: [] }
    });
    const mcp = await connect(client);
    const r = await call(mcp, 'list_run_history', {});
    expect(text(r)).toMatch(/Windows task running on schedule records nothing here/);
  });
});
