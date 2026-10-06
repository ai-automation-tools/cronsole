import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthState, PlatformType, TaskStatus } from '@prisma/client';

vi.mock('../../db.js', () => ({
  prisma: { platformCapability: { findFirst: vi.fn() } }
}));
vi.mock('../../services/n8nApi.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../services/n8nApi.js')>();
  return { ...real, listWorkflows: vi.fn(), getWorkflow: vi.fn(), listExecutions: vi.fn(), getExecution: vi.fn() };
});
vi.mock('../../services/n8nFolders.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../services/n8nFolders.js')>();
  return { ...real, readFolderPaths: vi.fn() };
});
vi.mock('../../services/n8nMcp.js', async importOriginal => {
  const real = await importOriginal<typeof import('../../services/n8nMcp.js')>();
  return { ...real, executeWorkflow: vi.fn() };
});

import { N8nConnector, triggerGroup, RUN_NEEDS_MCP } from '../N8nConnector.js';
import { executeWorkflow } from '../../services/n8nMcp.js';
import { prisma } from '../../db.js';
import { listWorkflows, getWorkflow, listExecutions, getExecution, type N8nWorkflow } from '../../services/n8nApi.js';
import { TaskService } from '../../services/TaskService.js';
import { readFolderPaths } from '../../services/n8nFolders.js';
import { redactConfig } from '../../services/n8nConnection.js';
import { scoreTask } from '../../services/taskHealth.js';

const listWorkflowsMock = vi.mocked(listWorkflows);
const getWorkflowMock = vi.mocked(getWorkflow);
const listExecutionsMock = vi.mocked(listExecutions);
const getExecutionMock = vi.mocked(getExecution);
const findFirst = vi.mocked(prisma.platformCapability.findFirst);
const executeWorkflowMock = vi.mocked(executeWorkflow);

const connector = new N8nConnector();

const config = (over: Record<string, unknown> = {}) => ({
  baseUrl: 'https://n8n.example.com',
  apiKey: 'n8n_api_abcd1234',
  timeZone: 'America/New_York',
  userId: 'user-1',
  ...over
});

/** The live weekly digest, as `toWorkflow` reduces it. */
const weekly = (over: Partial<N8nWorkflow> = {}): N8nWorkflow => ({
  id: '9zGpyQGdTftmUvq9',
  name: 'Weekly Stock Market Summary (AgentMail)',
  active: true,
  isArchived: false,
  timezone: null,
  graph: 'body',
  updatedAt: '2026-09-27T23:08:58.645Z',
  tags: [],
  triggerCount: 1,
  nodes: [
    { name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger' },
    {
      name: 'Weekly Trigger',
      type: 'n8n-nodes-base.scheduleTrigger',
      parameters: { rule: { interval: [{ field: 'weeks', triggerAtHour: 6 }] } }
    }
  ],
  ...over
});

const form = (): N8nWorkflow => ({
  ...weekly(),
  id: '0Cbgw8bdlSwfgnNI',
  name: 'Manual Trigger — Song (agent-runner)',
  nodes: [{ name: 'Song type request form', type: 'n8n-nodes-base.formTrigger' }]
});

const exec = (id: string, status: string, startedAt = '2026-10-04T10:00:51.109Z') => ({
  id,
  workflowId: '9zGpyQGdTftmUvq9',
  status,
  mode: 'trigger',
  startedAt,
  stoppedAt: '2026-10-04T10:01:30.633Z',
  finished: status === 'success'
});

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(null as never);
  listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly(), form()], truncated: false } });
  listExecutionsMock.mockResolvedValue({ ok: true, data: [exec('976', 'success'), exec('942', 'success')] });
});

describe('the boundary is declared', () => {
  it('refuses create and setStatus by name, leaves run declared, and the optional verbs absent', () => {
    expect([...connector.unsupportedVerbs].sort()).toEqual(['create', 'setStatus']);
    const c = connector as unknown as Record<string, unknown>;
    for (const verb of ['deleteTask', 'updateSchedule', 'updateActions', 'exportTask', 'importTask', 'listFolders']) {
      expect(c[verb]).toBeUndefined();
    }
  });

  it('has a declared, constant tracked set and a matching category', () => {
    expect(connector.trackedCategories()).toEqual(['n8n']);
    expect(TaskService.extractCategory('9zGpyQGdTftmUvq9', PlatformType.N8N)).toBe('n8n');
  });

  it('answers each refused verb with a sentence, and create is a 400', async () => {
    expect((await connector.setTaskStatus()).message).toMatch(/whole workflow/);
    expect(await connector.createTask()).toMatchObject({ success: false, refusedBeforeCalling: true });
  });
});

describe('runTask goes through the MCP door, and says what is missing without it', () => {
  it('without a token it refuses with the two switches named, and never calls out', async () => {
    const r = await connector.runTask('9zGpyQGdTftmUvq9', config());
    expect(r).toEqual({ success: false, ran: false, message: RUN_NEEDS_MCP });
    expect(RUN_NEEDS_MCP).toMatch(/MCP access/);
    expect(RUN_NEEDS_MCP).toMatch(/Available in MCP/);
    expect(executeWorkflowMock).not.toHaveBeenCalled();
  });

  it('with a token it starts the published workflow in production mode and reports the execution id', async () => {
    getWorkflowMock.mockResolvedValue({ ok: true, data: weekly() });
    executeWorkflowMock.mockResolvedValue({ ok: true, data: { executionId: '4242', status: 'started' } });
    const r = await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }));
    expect(r).toMatchObject({ success: true, ran: false, platformRunId: '4242', message: expect.stringMatching(/Schedule Trigger/) });
    // A manual trigger beside the schedule is not a choice in production mode, so n8n picks alone.
    expect(executeWorkflowMock).toHaveBeenCalledWith('https://n8n.example.com', 'mcp-tok', '9zGpyQGdTftmUvq9', { executionMode: 'production' });
  });

  it('a manual-only workflow runs its current version in manual mode, and says so', async () => {
    getWorkflowMock.mockResolvedValue({
      ok: true,
      data: weekly({ active: false, nodes: [{ name: 'Manual Trigger', type: 'n8n-nodes-base.manualTrigger' }, { name: 'Run', type: 'n8n-nodes-base.executeCommand' }] })
    });
    executeWorkflowMock.mockResolvedValue({ ok: true, data: { executionId: '77', status: 'started' } });
    const r = await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }));
    expect(executeWorkflowMock).toHaveBeenCalledWith('https://n8n.example.com', 'mcp-tok', '9zGpyQGdTftmUvq9', { executionMode: 'manual' });
    expect(r).toMatchObject({ success: true, platformRunId: '77', message: expect.stringMatching(/Manual Trigger.*current version/) });
  });

  it('a form-only workflow is left to n8n in production mode, not forced through manual', async () => {
    getWorkflowMock.mockResolvedValue({ ok: true, data: form() });
    executeWorkflowMock.mockResolvedValue({ ok: true, data: { executionId: null, status: 'error', error: 'Trigger requires input' } });
    const r = await connector.runTask('0Cbgw8bdlSwfgnNI', config({ mcpToken: 'mcp-tok' }));
    expect(executeWorkflowMock).toHaveBeenCalledWith(expect.any(String), 'mcp-tok', '0Cbgw8bdlSwfgnNI', { executionMode: 'production' });
    expect(r).toMatchObject({ success: false, message: 'n8n refused the run: Trigger requires input' });
  });

  it('names the schedule node when a webhook sits beside it', async () => {
    getWorkflowMock.mockResolvedValue({
      ok: true,
      data: weekly({ nodes: [...weekly().nodes, { name: 'Hook', type: 'n8n-nodes-base.webhook' }] })
    });
    executeWorkflowMock.mockResolvedValue({ ok: true, data: { executionId: '1', status: 'started' } });
    await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }));
    expect(executeWorkflowMock).toHaveBeenCalledWith('https://n8n.example.com', 'mcp-tok', '9zGpyQGdTftmUvq9', { executionMode: 'production', triggerNodeName: 'Weekly Trigger' });
  });

  it('a failed workflow read costs the trigger name, never the run', async () => {
    getWorkflowMock.mockResolvedValue({ ok: false, status: 500, message: 'n8n server error (500).' });
    executeWorkflowMock.mockResolvedValue({ ok: true, data: { executionId: '2', status: 'started' } });
    const r = await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }));
    expect(r.success).toBe(true);
    expect(executeWorkflowMock).toHaveBeenCalledWith(expect.any(String), 'mcp-tok', '9zGpyQGdTftmUvq9', { executionMode: 'production' });
  });

  it("n8n's own refusal is a failure to start carrying its sentence", async () => {
    getWorkflowMock.mockResolvedValue({ ok: true, data: weekly() });
    executeWorkflowMock.mockResolvedValue({
      ok: true,
      data: { executionId: null, status: 'error', error: 'Workflow is not available in MCP' }
    });
    const r = await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }));
    expect(r).toEqual({ success: false, ran: false, message: 'n8n refused the run: Workflow is not available in MCP' });
  });

  it('a transport failure is a failure, unless a run started since the request went out', async () => {
    getWorkflowMock.mockResolvedValue({ ok: true, data: weekly() });
    executeWorkflowMock.mockResolvedValue({ ok: false, status: null, message: 'Could not reach n8n.' });

    listExecutionsMock.mockResolvedValueOnce({ ok: true, data: [exec('old', 'success', '2020-01-01T00:00:00.000Z')] });
    expect(await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }))).toEqual({
      success: false,
      ran: false,
      message: 'Could not reach n8n.'
    });

    listExecutionsMock.mockResolvedValueOnce({ ok: true, data: [exec('fresh', 'running', new Date().toISOString())] });
    expect(await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }))).toMatchObject({
      success: true,
      ran: false,
      platformRunId: 'fresh'
    });
  });

  it('a 4xx from the MCP server is never re-read as a success', async () => {
    getWorkflowMock.mockResolvedValue({ ok: true, data: weekly() });
    executeWorkflowMock.mockResolvedValue({ ok: false, status: 401, message: 'n8n rejected the MCP access token (401).' });
    listExecutionsMock.mockResolvedValueOnce({ ok: true, data: [exec('fresh', 'running', new Date().toISOString())] });
    expect(await connector.runTask('9zGpyQGdTftmUvq9', config({ mcpToken: 'mcp-tok' }))).toMatchObject({ success: false });
  });

  it('the token is a credential: redacted to a boolean, never echoed', () => {
    const redacted = redactConfig({ baseUrl: 'https://n8n.example.com', apiKey: 'k', mcpToken: 'mcp-secret' });
    expect(redacted.hasMcpToken).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain('mcp-secret');
  });
});

describe('folders', () => {
  const dbUrl = 'postgresql://reader:s3cret@db.example.com:5432/n8n';

  it('without a folder database, groups by trigger by default — or not at all when asked', async () => {
    const grouped = await connector.syncTasks(config());
    expect(readFolderPaths).not.toHaveBeenCalled();
    expect(grouped.tasks.map(t => t.metadata.folderPath)).toEqual([['Scheduled'], ['Forms']]);

    const flat = await connector.syncTasks(config({ groupBy: 'none' }));
    expect(flat.tasks[0]!.metadata).not.toHaveProperty('folderPath');
  });

  it('names a group by its most specific trigger; manual only when it is the only one', () => {
    expect(triggerGroup(['manual', 'webhook'])).toBe('Webhooks');
    expect(triggerGroup(['manual'])).toBe('Manual');
    expect(triggerGroup(['manual', 'slack'])).toBe('Slack triggers');
  });

  it('puts the folder path in metadata and leaves the id and category alone', async () => {
    vi.mocked(readFolderPaths).mockResolvedValue({ ok: true, data: new Map([['9zGpyQGdTftmUvq9', ['Finance', 'Weekly']]]) });
    const outcome = await connector.syncTasks(config({ folderDbUrl: dbUrl }));
    const [task] = outcome.tasks;
    expect(task!.externalId).toBe('9zGpyQGdTftmUvq9');
    expect(task!.metadata).toMatchObject({ folderPath: ['Finance', 'Weekly'] });
    expect(TaskService.extractCategory(task!.externalId, PlatformType.N8N)).toBe('n8n');
  });

  it('a failed folder read warns and keeps every task — it is not a partial sync', async () => {
    vi.mocked(readFolderPaths).mockResolvedValue({ ok: false, message: 'Could not reach the n8n database.' });
    const outcome = await connector.syncTasks(config({ folderDbUrl: dbUrl }));
    expect(outcome.tasks).toHaveLength(2);
    expect(outcome.partial).toBe(false);
    expect(outcome.warnings!.join(' ')).toMatch(/without their n8n folders/);
  });

  it('never returns the database URL, only where it points', () => {
    const shown = redactConfig({ baseUrl: 'https://n8n.example.com', apiKey: 'k', folderDbUrl: dbUrl });
    expect(shown).toMatchObject({ hasFolderDb: true, folderDbHint: 'db.example.com:5432/n8n' });
    expect(JSON.stringify(shown)).not.toContain('s3cret');
  });
});

describe('on-demand workflows', () => {
  const manual = (): N8nWorkflow => ({
    ...weekly(),
    id: 'manualOnly0000001',
    name: 'Manual Trigger — Weekly Comic (agent-runner)',
    active: false,
    // n8n does not count a manual trigger (measured: 48 manual-only workflows, all 0).
    triggerCount: 0,
    nodes: [{ name: 'Run', type: 'n8n-nodes-base.manualTrigger' }]
  });
  const fragment = (): N8nWorkflow => ({
    ...weekly(),
    id: 'noTrigger00000001',
    name: 'Helper',
    triggerCount: 0,
    nodes: [{ name: 'Set', type: 'n8n-nodes-base.set' }]
  });

  beforeEach(() => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly(), form(), manual(), fragment()], truncated: false } });
  });

  it('tracks unscheduled workflows by default, with no cron and how they start', async () => {
    const outcome = await connector.syncTasks(config());
    const byId = new Map(outcome.tasks.map(t => [t.externalId, t]));
    expect(byId.size).toBe(3);
    expect(byId.get('0Cbgw8bdlSwfgnNI')).toMatchObject({
      schedule: null,
      status: 'ACTIVE',
      metadata: { onDemand: true, triggers: ['form'], scheduleReason: expect.stringMatching(/started by a form/) }
    });
    expect(byId.get('0Cbgw8bdlSwfgnNI')!.metadata).not.toHaveProperty('scheduleUnavailableReason');
    expect(outcome.notes![0]).toMatch(/1 with a schedule and 2 on demand.*1 with no trigger at all were skipped/);
    expect(listExecutionsMock).toHaveBeenCalledTimes(3);
  });

  it('keeps an unpublished manual-only workflow ACTIVE — n8n cannot publish it, and it runs anyway', async () => {
    const task = (await connector.syncTasks(config())).tasks.find(t => t.externalId === 'manualOnly0000001')!;
    expect(task.status).toBe('ACTIVE');
    expect(task.metadata).toMatchObject({ triggers: ['manual'], scheduleReason: expect.stringMatching(/by hand in the editor/) });
  });

  it('names the core triggers that do not end in "Trigger", and falls back on n8n\'s own count', async () => {
    const imap = { ...weekly(), id: 'imapOnly000000001', nodes: [{ name: 'Mail', type: 'n8n-nodes-base.emailReadImap' }] };
    // A community trigger whose type matches nothing here — n8n still counts it.
    const unknown = { ...weekly(), id: 'communityTrig0001', triggerCount: 1, nodes: [{ name: 'Hook', type: 'n8n-nodes-acme.onCall' }] };
    const helper = { ...unknown, id: 'helperNoTrigger01', triggerCount: 0 };
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [imap, unknown, helper], truncated: false } });

    const byId = new Map((await connector.syncTasks(config())).tasks.map(t => [t.externalId, t]));
    expect(byId.get('imapOnly000000001')!.metadata).toMatchObject({ triggers: ['email'], folderPath: ['Email'] });
    expect(byId.get('communityTrig0001')!.metadata).toMatchObject({ triggers: ['event'], folderPath: ['Other triggers'] });
    expect(byId.has('helperNoTrigger01')).toBe(false);
  });

  it('marks an unpublished form workflow DISABLED — its form is offline', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [{ ...form(), active: false }], truncated: false } });
    expect((await connector.syncTasks(config())).tasks[0]!.status).toBe('DISABLED');
  });

  it('names the setting when it is off', () => {
    expect(redactConfig({})).toMatchObject({ includeOnDemand: true, groupBy: 'trigger' });
    expect(redactConfig({ includeOnDemand: false })).toMatchObject({ includeOnDemand: false });
  });
});

describe('syncTasks', () => {
  it('with on-demand off, keeps only scheduled workflows, converts to UTC and says what it looked at', async () => {
    const outcome = await connector.syncTasks(config({ includeOnDemand: false }));
    expect(outcome.tasks).toHaveLength(1);
    const [task] = outcome.tasks;
    expect(task).toMatchObject({
      externalId: '9zGpyQGdTftmUvq9',
      status: 'ACTIVE',
      schedule: expect.stringMatching(/^0 1[01] \* \* 0$/), // 06:00 New York, EDT or EST
      nextRunTime: null
    });
    expect(task!.metadata).toMatchObject({
      reportsRunResult: true,
      executionCount: 2,
      consecutiveFailureCount: 0,
      lastStatus: 'success',
      platformTimeZone: 'America/New_York'
    });
    expect(outcome.notes).toEqual([expect.stringMatching(/read 2 workflows, 1 with a schedule\. Workflows with no schedule are not tracked/)]);
    expect(outcome.complete).toBe(true);
    expect(outcome.partial).toBe(false);
    // One execution read, for the scheduled workflow only.
    expect(listExecutionsMock).toHaveBeenCalledTimes(1);
  });

  it('without a declared zone, stores no schedule and says why once', async () => {
    const outcome = await connector.syncTasks(config({ timeZone: undefined }));
    expect(outcome.tasks[0]!.schedule).toBeNull();
    expect(outcome.warnings).toEqual([expect.stringMatching(/1 schedule run in the instance time zone/)]);
  });

  it("uses the workflow's own zone over the instance's", async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly({ timezone: 'UTC' })], truncated: false } });
    const outcome = await connector.syncTasks(config({ timeZone: undefined }));
    expect(outcome.tasks[0]!.schedule).toBe('0 6 * * 0');
  });

  it('names a workflow whose schedule cannot be a cron', async () => {
    const fortnightly = weekly({
      nodes: [{
        name: 'Every two weeks',
        type: 'n8n-nodes-base.scheduleTrigger',
        parameters: { rule: { interval: [{ field: 'weeks', weeksInterval: 2 }] } }
      }]
    });
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [fortnightly], truncated: false } });
    const outcome = await connector.syncTasks(config());
    expect(outcome.tasks[0]!.schedule).toBeNull();
    expect(outcome.warnings).toEqual([expect.stringMatching(/^Weekly Stock Market Summary .*every 2 weeks/)]);
  });

  it('reads an unpublished workflow as DISABLED', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly({ active: false })], truncated: false } });
    expect((await connector.syncTasks(config())).tasks[0]!.status).toBe('DISABLED');
  });

  it('skips archived workflows', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly({ isArchived: true })], truncated: false } });
    expect((await connector.syncTasks(config())).tasks).toEqual([]);
  });

  it('fetches the published graph for a draft, and refuses the schedule if it still cannot see it', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly({ graph: 'draft-only' })], truncated: false } });
    getWorkflowMock.mockResolvedValue({ ok: true, data: weekly({ graph: 'draft-only' }) });
    const outcome = await connector.syncTasks(config());
    expect(getWorkflowMock).toHaveBeenCalledWith('https://n8n.example.com', 'n8n_api_abcd1234', '9zGpyQGdTftmUvq9');
    expect(outcome.tasks[0]!.schedule).toBeNull();
    expect(outcome.warnings).toEqual([expect.stringMatching(/unpublished edits/)]);

    getWorkflowMock.mockResolvedValue({ ok: true, data: weekly({ graph: 'published' }) });
    expect((await connector.syncTasks(config())).tasks[0]!.schedule).not.toBeNull();
  });

  it('throws when the listing fails, so nothing is retired', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: false, status: 401, message: 'n8n rejected the API key (401).' });
    await expect(connector.syncTasks(config())).rejects.toThrow(/401/);
  });

  it('is partial — retiring nothing — when the list was truncated or a history read failed', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly()], truncated: true } });
    const truncated = await connector.syncTasks(config());
    expect(truncated).toMatchObject({ partial: true });
    expect(truncated.complete).toBeUndefined();

    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [weekly()], truncated: false } });
    listExecutionsMock.mockResolvedValue({ ok: false, status: 500, message: 'n8n server error (500).' });
    const noHistory = await connector.syncTasks(config());
    expect(noHistory.partial).toBe(true);
    expect(noHistory.tasks[0]!.metadata).toMatchObject({ reportsRunResult: false });
  });

  it('vouches for an empty instance, so unscheduling the last workflow retires its row', async () => {
    listWorkflowsMock.mockResolvedValue({ ok: true, data: { workflows: [form()], truncated: false } });
    expect(await connector.syncTasks(config({ includeOnDemand: false }))).toMatchObject({ tasks: [], complete: true });
  });

  it('counts the failure streak from the newest finished runs, skipping one in flight', async () => {
    listExecutionsMock.mockResolvedValue({
      ok: true,
      data: [exec('5', 'running'), exec('4', 'error'), exec('3', 'crashed'), exec('2', 'error'), exec('1', 'success')]
    });
    const meta = (await connector.syncTasks(config())).tasks[0]!.metadata;
    expect(meta).toMatchObject({ consecutiveFailureCount: 3, executionCount: 4, lastStatus: 'error' });
  });

  it('returns nothing without a URL and key', async () => {
    expect(await connector.syncTasks({})).toEqual({ tasks: [] });
    expect(listWorkflowsMock).not.toHaveBeenCalled();
  });
});

describe('run history', () => {
  it('lists runs in the platform vocabulary, with output closed on a run in flight', async () => {
    listExecutionsMock.mockResolvedValue({ ok: true, data: [exec('977', 'running'), exec('976', 'success')] });
    const result = await connector.listPlatformRuns('9zGpyQGdTftmUvq9', config());
    expect(result.runs!.map(r => [r.id, r.status, r.outputAvailable])).toEqual([
      ['977', 'running', false],
      ['976', 'success', true]
    ]);
  });

  it('returns steps, facts and the run page — and the error when it failed', async () => {
    getExecutionMock.mockResolvedValue({
      ok: true,
      data: {
        ...exec('976', 'error'),
        steps: ['Weekly Trigger', 'Configuration', 'AI Agent'],
        errorMessage: 'Request failed with status code 401',
        lastNodeExecuted: 'AI Agent'
      }
    });
    const result = await connector.getRunOutput('9zGpyQGdTftmUvq9', '976', config());
    expect(result.output).toEqual({
      text: 'Request failed with status code 401',
      steps: ['Weekly Trigger', 'Configuration', 'AI Agent'],
      facts: [
        { label: 'Started by', value: 'Schedule or other trigger' },
        { label: 'Duration', value: '40s' },
        { label: 'Stopped at', value: 'AI Agent' }
      ],
      url: 'https://n8n.example.com/workflow/9zGpyQGdTftmUvq9/executions/976'
    });
  });

  it('refuses an execution from a different workflow', async () => {
    getExecutionMock.mockResolvedValue({
      ok: true,
      data: { ...exec('976', 'success'), workflowId: 'other', steps: [], errorMessage: null, lastNodeExecuted: null }
    });
    expect((await connector.getRunOutput('9zGpyQGdTftmUvq9', '976', config())).success).toBe(false);
  });

  it('says a pruned execution aged out, rather than echoing a 404', async () => {
    getExecutionMock.mockResolvedValue({ ok: false, status: 404, message: 'n8n returned 404' });
    expect((await connector.getRunOutput('w', '1', config())).message).toMatch(/age out/);
  });
});

describe('getHealth reads evidence and never probes', () => {
  it('is UNKNOWN before any sync and HEALTHY after a successful one', async () => {
    expect((await connector.getHealth(config())).state).toBe(HealthState.UNKNOWN);
    findFirst.mockResolvedValue({ lastSuccessAt: new Date(), lastFailureAt: null, lastFailureReason: null } as never);
    expect((await connector.getHealth(config())).state).toBe(HealthState.HEALTHY);
    expect(listWorkflowsMock).not.toHaveBeenCalled();
  });
});

describe('scoreTask on n8n', () => {
  const NOW = new Date('2026-10-04T12:00:00Z');
  const task = (metadata: Record<string, unknown>) => ({
    id: 't1',
    name: 'Weekly digest',
    externalId: '9zGpyQGdTftmUvq9',
    platform: PlatformType.N8N,
    category: 'n8n',
    status: TaskStatus.ACTIVE,
    schedule: '0 10 * * 0',
    nextRunTime: null,
    updatedAt: NOW,
    metadata,
    executions: []
  });

  it('is unknown, with the reason, when the sync could not read executions', () => {
    const health = scoreTask(task({ reportsRunResult: false }), NOW);
    expect(health.tier).toBe('unknown');
    expect(health.signals.map(s => s.code)).toContain('no-run-evidence');
  });

  it('scores a clean recent run healthy', () => {
    const health = scoreTask(
      task({ reportsRunResult: true, executionCount: 2, consecutiveFailureCount: 0, lastStatus: 'success', lastRunTime: '2026-10-04T10:00:51Z' }),
      NOW
    );
    expect(health.tier).not.toBe('critical');
    expect(health.tier).not.toBe('unknown');
  });

  it('calls a failure streak critical', () => {
    const health = scoreTask(
      task({ reportsRunResult: true, executionCount: 3, consecutiveFailureCount: 3, lastStatus: 'error', lastRunTime: '2026-10-04T10:00:51Z' }),
      NOW
    );
    expect(health.tier).toBe('critical');
    expect(health.signals.map(s => s.code)).toEqual(expect.arrayContaining(['failure-streak', 'recent-failure']));
  });
});
