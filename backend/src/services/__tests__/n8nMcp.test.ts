import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({
  default: { post: vi.fn(), delete: vi.fn() }
}));

import axios from 'axios';
import { readJsonRpc, readExecution, verifyMcpToken, executeWorkflow, N8N_MCP_PATH } from '../n8nMcp.js';

const post = vi.mocked(axios.post);
const del = vi.mocked(axios.delete);

/**
 * The one door that starts an n8n workflow. Shapes follow the MCP streamable
 * HTTP transport: JSON or a one-message SSE stream, the server's choice.
 */

type Reply = { status: number; data: string; headers?: Record<string, string> };
const json = (body: unknown, extra: Partial<Reply> = {}): Reply => ({
  status: 200,
  data: JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(extra.headers ?? {}) },
  ...extra
});
const sse = (body: unknown): Reply => ({
  status: 200,
  data: `event: message\ndata: ${JSON.stringify(body)}\n\n`,
  headers: { 'content-type': 'text/event-stream' }
});
const accepted: Reply = { status: 202, data: '', headers: {} };

/** Queue replies in request order. The handshake is two posts, then the call. */
const replies = (...list: Reply[]) => {
  for (const r of list) post.mockResolvedValueOnce({ ...r, headers: r.headers ?? {} } as never);
};

const initOk = (sessionId?: string) =>
  json({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'n8n' } } }, {
    headers: { 'content-type': 'application/json', ...(sessionId ? { 'mcp-session-id': sessionId } : {}) }
  });

beforeEach(() => {
  vi.clearAllMocks();
  del.mockResolvedValue({ status: 200 } as never);
});

describe('readJsonRpc finds the response however the server framed it', () => {
  it('reads a plain JSON body', () => {
    expect(readJsonRpc(JSON.stringify({ jsonrpc: '2.0', id: 3, result: { ok: 1 } }), 'application/json', 3)).toEqual({
      jsonrpc: '2.0',
      id: 3,
      result: { ok: 1 }
    });
  });

  it('reads an SSE stream and skips events for other ids', () => {
    const body =
      'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\n' +
      'event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"tools":[]}}\n\n';
    expect(readJsonRpc(body, 'text/event-stream; charset=utf-8', 7)).toMatchObject({ id: 7, result: { tools: [] } });
  });

  it('returns null for a body that is not a response at all', () => {
    expect(readJsonRpc('<html>login</html>', 'text/html', 1)).toBeNull();
    expect(readJsonRpc(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }), 'application/json', 1)).toBeNull();
  });
});

describe('readExecution reads the tool result in both spellings', () => {
  it('prefers structuredContent', () => {
    expect(
      readExecution({ structuredContent: { executionId: '1234', status: 'started' }, content: [{ type: 'text', text: 'ignored' }] })
    ).toEqual({ ok: true, data: { executionId: '1234', status: 'started' } });
  });

  it('falls back to the first JSON text block', () => {
    expect(readExecution({ content: [{ type: 'text', text: '{"executionId":"99","status":"started"}' }] })).toEqual({
      ok: true,
      data: { executionId: '99', status: 'started' }
    });
  });

  it("carries n8n's own refusal as a started-nothing answer", () => {
    expect(
      readExecution({ structuredContent: { executionId: null, status: 'error', error: 'Workflow has no published version' } })
    ).toEqual({ ok: true, data: { executionId: null, status: 'error', error: 'Workflow has no published version' } });
  });

  it('turns isError into a failure carrying the text', () => {
    const r = readExecution({ isError: true, content: [{ type: 'text', text: 'Workflow not available in MCP' }] });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('Workflow not available in MCP') });
  });

  it('a result with no recognisable payload is an error, not a start', () => {
    expect(readExecution({ content: [{ type: 'text', text: 'all good' }] })).toMatchObject({
      ok: true,
      data: { status: 'error', executionId: null, error: 'all good' }
    });
  });
});

describe('verifyMcpToken', () => {
  it('succeeds only when execute_workflow is served, and closes the session', async () => {
    replies(initOk('sess-1'), accepted, sse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search_workflows' }, { name: 'execute_workflow' }] } }));
    expect(await verifyMcpToken('https://n8n.example.com/', 'tok')).toEqual({ ok: true, data: true });

    const [url, body, opts] = post.mock.calls[0]!;
    expect(url).toBe(`https://n8n.example.com${N8N_MCP_PATH}`);
    expect(body).toMatchObject({ method: 'initialize' });
    expect((opts as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer tok');
    // The session id handed back on initialize rides on every later request.
    expect((post.mock.calls[2]![2] as { headers: Record<string, string> }).headers['Mcp-Session-Id']).toBe('sess-1');
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('refuses a server that does not offer the tool, naming what it does offer', async () => {
    replies(initOk(), accepted, json({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search_workflows' }] } }));
    const r = await verifyMcpToken('https://n8n.example.com', 'tok');
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('search_workflows') });
  });

  it('a 401 names the token and where it comes from', async () => {
    replies({ status: 401, data: 'Unauthorized' });
    const r = await verifyMcpToken('https://n8n.example.com', 'bad');
    expect(r).toMatchObject({ ok: false, status: 401, message: expect.stringMatching(/MCP access/) });
  });

  it('a 404 names the version and the switch', async () => {
    replies({ status: 404, data: 'Cannot POST /mcp-server/http' });
    const r = await verifyMcpToken('https://n8n.example.com', 'tok');
    expect(r).toMatchObject({ ok: false, status: 404, message: expect.stringMatching(/1\.121|Enable MCP Access/) });
  });

  it('an unreachable instance is status null', async () => {
    post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const r = await verifyMcpToken('https://n8n.example.com', 'tok');
    expect(r).toMatchObject({ ok: false, status: null, message: expect.stringContaining('ECONNREFUSED') });
  });
});

describe('executeWorkflow', () => {
  it('calls execute_workflow in production mode and returns the execution id', async () => {
    replies(initOk(), accepted, json({ jsonrpc: '2.0', id: 2, result: { structuredContent: { executionId: '4242', status: 'started' } } }));
    expect(await executeWorkflow('https://n8n.example.com', 'tok', 'wf-1', { executionMode: 'production' })).toEqual({
      ok: true,
      data: { executionId: '4242', status: 'started' }
    });
    expect(post.mock.calls[2]![1]).toMatchObject({
      method: 'tools/call',
      params: { name: 'execute_workflow', arguments: { workflowId: 'wf-1', executionMode: 'production' } }
    });
    expect((post.mock.calls[2]![1] as { params: { arguments: Record<string, unknown> } }).params.arguments).not.toHaveProperty('triggerNodeName');
  });

  it('names the trigger when asked to', async () => {
    replies(initOk(), accepted, json({ jsonrpc: '2.0', id: 2, result: { structuredContent: { executionId: '1', status: 'started' } } }));
    await executeWorkflow('https://n8n.example.com', 'tok', 'wf-1', { executionMode: 'production', triggerNodeName: 'Weekly Trigger' });
    expect(post.mock.calls[2]![1]).toMatchObject({ params: { arguments: { triggerNodeName: 'Weekly Trigger' } } });
  });

  it('sends manual mode when asked to', async () => {
    replies(initOk(), accepted, json({ jsonrpc: '2.0', id: 2, result: { structuredContent: { executionId: '7', status: 'started' } } }));
    await executeWorkflow('https://n8n.example.com', 'tok', 'wf-1', { executionMode: 'manual' });
    expect(post.mock.calls[2]![1]).toMatchObject({ params: { arguments: { workflowId: 'wf-1', executionMode: 'manual' } } });
  });

  it('a JSON-RPC error is a refusal with the server sentence', async () => {
    replies(initOk(), accepted, json({ jsonrpc: '2.0', id: 2, error: { code: -32602, message: 'Unknown tool' } }));
    const r = await executeWorkflow('https://n8n.example.com', 'tok', 'wf-1', { executionMode: 'production' });
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining('Unknown tool') });
  });

  it('a failed handshake never reaches the call', async () => {
    replies({ status: 403, data: 'MCP access disabled' });
    const r = await executeWorkflow('https://n8n.example.com', 'tok', 'wf-1', { executionMode: 'production' });
    expect(r).toMatchObject({ ok: false, status: 403 });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
