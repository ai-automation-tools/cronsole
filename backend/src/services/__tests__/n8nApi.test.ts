import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl, toExecution, toExecutionDetail, toWorkflow } from '../n8nApi.js';

/** The parsing half of the n8n surface. Shapes are from a live instance, 2026-10-04. */

const SCHEDULE_NODE = {
  id: 'weekly-trigger',
  name: 'Weekly Trigger',
  type: 'n8n-nodes-base.scheduleTrigger',
  typeVersion: 1.3,
  parameters: { rule: { interval: [{ field: 'weeks', triggerAtHour: 6 }] } }
};

const HTTP_NODE = {
  id: 'send',
  name: 'Send Email via AgentMail',
  type: 'n8n-nodes-base.httpRequest',
  parameters: { headerParameters: { parameters: [{ name: 'Authorization', value: 'Bearer am_live_secret' }] } },
  credentials: { httpHeaderAuth: { id: 'c1', name: 'AgentMail' } }
};

const LIVE_WORKFLOW = {
  id: '9zGpyQGdTftmUvq9',
  name: 'Weekly Stock Market Summary (AgentMail)',
  active: true,
  isArchived: false,
  nodes: [SCHEDULE_NODE, HTTP_NODE],
  settings: { executionOrder: 'v1' },
  versionId: 'v-1',
  activeVersionId: 'v-1',
  updatedAt: '2026-09-27T23:08:58.645Z',
  tags: [],
  shared: [{ project: { name: 'Someone <someone@example.com>' } }]
};

describe('normalizeBaseUrl reduces whatever was pasted to the instance root', () => {
  it.each([
    ['https://n8n.example.com/', 'https://n8n.example.com'],
    ['https://n8n.example.com/api/v1', 'https://n8n.example.com'],
    ['https://me.app.n8n.cloud/home/workflows', 'https://me.app.n8n.cloud'],
    ['https://example.com/n8n/workflow/abc123', 'https://example.com/n8n'],
    ['n8n.local:5678', 'https://n8n.local:5678']
  ])('%s', (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });
});

describe('toWorkflow drops what it does not need at the parse', () => {
  it('keeps parameters on schedule nodes only, so a hardcoded token never leaves', () => {
    const workflow = toWorkflow(LIVE_WORKFLOW)!;
    expect(workflow.nodes).toEqual([
      { name: 'Weekly Trigger', type: 'n8n-nodes-base.scheduleTrigger', parameters: SCHEDULE_NODE.parameters },
      { name: 'Send Email via AgentMail', type: 'n8n-nodes-base.httpRequest' }
    ]);
    expect(JSON.stringify(workflow)).not.toMatch(/am_live_secret|someone@example\.com|credentials/);
  });

  it('reads an absent settings.timezone as null — the instance zone, which the API does not report', () => {
    expect(toWorkflow(LIVE_WORKFLOW)!.timezone).toBeNull();
    expect(toWorkflow({ ...LIVE_WORKFLOW, settings: { timezone: 'Europe/Berlin' } })!.timezone).toBe('Europe/Berlin');
  });

  it('rejects a row with no id', () => {
    expect(toWorkflow({ name: 'x' })).toBeNull();
  });
});

describe('toWorkflow reads the published graph, not the draft', () => {
  it('uses activeVersion when the response carries it', () => {
    const published = { ...SCHEDULE_NODE, parameters: { rule: { interval: [{ field: 'days', triggerAtHour: 9 }] } } };
    const workflow = toWorkflow({
      ...LIVE_WORKFLOW,
      versionId: 'v-2',
      activeVersionId: 'v-1',
      activeVersion: { nodes: [published] }
    })!;
    expect(workflow.graph).toBe('published');
    expect(workflow.nodes[0]!.parameters).toEqual(published.parameters);
  });

  it('trusts the body when it is the published version', () => {
    expect(toWorkflow(LIVE_WORKFLOW)!.graph).toBe('body');
  });

  it('says so when the body is a newer draft and the published graph is missing', () => {
    expect(toWorkflow({ ...LIVE_WORKFLOW, versionId: 'v-2', activeVersionId: 'v-1' })!.graph).toBe('draft-only');
  });

  it('trusts the body on an instance that predates draft/publish', () => {
    const { versionId: _v, activeVersionId: _a, ...old } = LIVE_WORKFLOW;
    expect(toWorkflow(old)!.graph).toBe('body');
  });
});

describe('toExecution', () => {
  it('reads the live execution shape verbatim, without mapping the status', () => {
    expect(toExecution({
      id: '976',
      finished: true,
      mode: 'trigger',
      status: 'success',
      startedAt: '2026-10-04T10:00:51.109Z',
      stoppedAt: '2026-10-04T10:01:30.633Z',
      workflowId: '9zGpyQGdTftmUvq9'
    })).toEqual({
      id: '976',
      workflowId: '9zGpyQGdTftmUvq9',
      status: 'success',
      mode: 'trigger',
      startedAt: '2026-10-04T10:00:51.109Z',
      stoppedAt: '2026-10-04T10:01:30.633Z',
      finished: true
    });
  });

  it('accepts a numeric id and an older instance with no status', () => {
    expect(toExecution({ id: 5, finished: false })).toMatchObject({ id: '5', status: 'unknown', mode: 'unknown' });
  });
});

describe('toExecutionDetail', () => {
  it('orders steps by start time and keeps only node names', () => {
    const detail = toExecutionDetail({
      id: '977',
      status: 'error',
      mode: 'trigger',
      finished: false,
      data: {
        resultData: {
          runData: {
            'AI Agent': [{ startTime: 300, data: { main: [[{ json: { secret: 'x' } }]] } }],
            'Weekly Trigger': [{ startTime: 100 }],
            Configuration: [{ startTime: 200 }]
          },
          error: { message: 'Request failed with status code 401' },
          lastNodeExecuted: 'AI Agent'
        }
      }
    })!;
    expect(detail.steps).toEqual(['Weekly Trigger', 'Configuration', 'AI Agent']);
    expect(detail.errorMessage).toBe('Request failed with status code 401');
    expect(detail.lastNodeExecuted).toBe('AI Agent');
    expect(JSON.stringify(detail)).not.toContain('secret');
  });

  it('returns empty steps, not a failure, for an execution saved without data', () => {
    expect(toExecutionDetail({ id: '1', status: 'success' })).toMatchObject({ steps: [], errorMessage: null });
  });
});
