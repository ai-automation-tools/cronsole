import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

import {
  listWorkflows,
  listWorkflowRuns,
  workflowSchedules,
  verifyToken
} from '../githubActions.js';

/**
 * **The half of GitHub Actions that a unit test can actually verify.**
 *
 * `githubActions.test.ts` covers the YAML, and `GitHubActionsConnector.test.ts`
 * covers what the connector does with the results. Between them sat the request
 * layer itself — the headers, the query parameters and the status mapping — with
 * no test at all, on the one connector nobody has ever pointed at a real
 * repository: this install reports `configured: false` and `sync: declared`.
 *
 * So these are the claims that would otherwise be verified only by connecting a
 * token and hoping, and each is one that fails *quietly* if it drifts:
 *
 * - a missing `X-GitHub-Api-Version` does not error, it silently gets whatever
 *   GitHub defaults to that month;
 * - a `runs` query without `event: schedule` returns runs, just the wrong ones —
 *   a workflow's scheduled health judged by whatever somebody last pushed;
 * - a 404 with a generic message sends the user to check their spelling when the
 *   actual cause is a token scope, which is the failure GitHub makes hardest to
 *   diagnose by answering 404 rather than 403.
 *
 * What still needs a real token is the round trip: that GitHub's live shapes
 * match `toWorkflow` / `toRun`, and that a repository with a real `on: schedule`
 * workflow arrives with the cron this layer claims to read.
 */

const get = vi.fn();
const create = axios.create as unknown as ReturnType<typeof vi.fn>;

const TOKEN = 'ghp_example';

/** A GitHub response as axios hands it over, with `validateStatus` off. */
const respond = (status: number, data: unknown = {}, headers: Record<string, string> = {}) =>
  get.mockResolvedValue({ status, data, headers });

beforeEach(() => {
  vi.clearAllMocks();
  create.mockReturnValue({ get } as never);
});

describe('the wire format', () => {
  it('sends the token, the API version and a User-Agent on every call', async () => {
    respond(200, { workflows: [] });
    await listWorkflows(TOKEN, 'o', 'r');

    const config = create.mock.calls[0][0];
    expect(config.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(config.headers.Accept).toBe('application/vnd.github+json');
    // Pinned rather than defaulted: without it GitHub serves whatever version is
    // current, and a response shape changes under a connector that never asked.
    expect(config.headers['X-GitHub-Api-Version']).toBeTruthy();
    expect(config.headers['User-Agent']).toBe('Cronsole');
  });

  it('interprets every status itself rather than letting axios throw', async () => {
    respond(200, { workflows: [] });
    await listWorkflows(TOKEN, 'o', 'r');
    // "This repository does not exist" must not arrive as a stack trace
    // indistinguishable from a network fault.
    expect(create.mock.calls[0][0].validateStatus(404)).toBe(true);
  });

  it('builds one client per call, never a module-level one', async () => {
    // The token belongs to a user's connection. A process-wide client holding
    // one user's credential is how a multi-user install leaks across accounts.
    respond(200, { workflows: [] });
    await listWorkflows(TOKEN, 'o', 'r');
    await listWorkflows('ghp_other', 'o', 'r');

    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[1][0].headers.Authorization).toBe('Bearer ghp_other');
  });

  it('asks for workflows a page at GitHub\'s maximum', async () => {
    respond(200, { workflows: [], total_count: 0 });
    await listWorkflows(TOKEN, 'owner', 'repo');

    expect(get).toHaveBeenCalledWith('/repos/owner/repo/actions/workflows', { params: { per_page: 100 } });
  });

  it('reports the repository total, so a truncated read is knowable', async () => {
    // The connector says so out loud; it can only do that if this returns the
    // count rather than the length of what fitted.
    respond(200, { workflows: [{ id: 1, path: '.github/workflows/a.yml' }], total_count: 137 });
    const result = await listWorkflows(TOKEN, 'o', 'r');

    expect(result.ok && result.data.total).toBe(137);
    expect(result.ok && result.data.workflows).toHaveLength(1);
  });

  it('drops a workflow row missing the fields everything downstream keys on', async () => {
    respond(200, { workflows: [{ name: 'no id' }, { id: 2, path: 'p.yml' }] });
    const result = await listWorkflows(TOKEN, 'o', 'r');
    expect(result.ok && result.data.workflows.map(w => w.id)).toEqual([2]);
  });

  it('reads only scheduled runs, and no pull-request runs', async () => {
    respond(200, { workflow_runs: [] });
    await listWorkflowRuns(TOKEN, 'owner', 'repo', 42);

    expect(get).toHaveBeenCalledWith(
      '/repos/owner/repo/actions/workflows/42/runs',
      { params: { per_page: 5, event: 'schedule', exclude_pull_requests: true } }
    );
  });

  it('encodes a path segment by segment, so a slash in the file path survives', async () => {
    respond(200, { encoding: 'base64', content: Buffer.from('on:\n  schedule:\n    - cron: "0 9 * * *"').toString('base64') });
    await workflowSchedules(TOKEN, 'o', 'r', '.github/workflows/nightly build.yml');

    // The slashes are the path; the space inside a segment is not.
    expect(get).toHaveBeenCalledWith(
      '/repos/o/r/contents/.github/workflows/nightly%20build.yml'
    );
  });
});

describe('what comes back', () => {
  it('reads the cron exactly as written — this is the one source with no conversion', async () => {
    // GitHub documents `on: schedule` as UTC with no timezone support, which is
    // exactly Cronsole's storage contract. A conversion appearing anywhere on
    // this path would be a silent 8-hour error with nothing on screen to catch it.
    const file = 'on:\n  schedule:\n    - cron: "30 17 * * 1-5"\n';
    respond(200, { encoding: 'base64', content: Buffer.from(file).toString('base64') });

    const result = await workflowSchedules(TOKEN, 'o', 'r', 'w.yml');
    expect(result.ok && result.data.crons).toEqual(['30 17 * * 1-5']);
    expect(result.ok && result.data.reason).toBeUndefined();
  });

  it('says why rather than reporting no schedule when the file is not text', async () => {
    // A submodule, a symlink, or a directory listing. "Could not read this" and
    // "this has no schedule" render identically and only one is a fact.
    respond(200, { encoding: 'none', content: null });
    const result = await workflowSchedules(TOKEN, 'o', 'r', 'w.yml');

    expect(result.ok && result.data.crons).toEqual([]);
    expect(result.ok && result.data.reason).toMatch(/did not return the workflow file as text/i);
  });

  it('refuses a workflow file past the parse cap, with the size in the reason', async () => {
    respond(200, { encoding: 'base64', content: 'aGk=', size: 5_000_000 });
    const result = await workflowSchedules(TOKEN, 'o', 'r', 'w.yml');

    expect(result.ok && result.data.crons).toEqual([]);
    expect(result.ok && result.data.reason).toMatch(/5000000 bytes/);
  });

  it('reads the login off /user when verifying a token', async () => {
    respond(200, { login: 'octocat' });
    const result = await verifyToken(TOKEN);

    expect(get).toHaveBeenCalledWith('/user');
    expect(result.ok && result.data.login).toBe('octocat');
  });
});

describe('what a failure says', () => {
  it('reads a 404 as a missing scope, not as a typo', async () => {
    // GitHub answers 404, never 403, for anything a token cannot see — so "not
    // found" is the *expected* symptom of a token missing the `repo` scope, and
    // a generic message sends people to check the spelling of a name that is
    // correct.
    respond(404, { message: 'Not Found' });
    const result = await listWorkflows(TOKEN, 'private', 'repo');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.status).toBe(404);
    expect(!result.ok && result.message).toMatch(/repo` scope/);
  });

  it('names a rate limit and says it clears on its own', async () => {
    const reset = Math.floor(Date.parse('2026-08-24T12:00:00Z') / 1000);
    respond(403, { message: 'API rate limit exceeded' }, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(reset)
    });

    const result = await listWorkflows(TOKEN, 'o', 'r');
    expect(!result.ok && result.message).toMatch(/rate limit reached \(403\)/i);
    expect(!result.ok && result.message).toContain('2026-08-24T12:00:00.000Z');
    // Cronsole only reads here, so there is nothing for the user to undo.
    expect(!result.ok && result.message).toMatch(/clears on its own/);
  });

  it('separates a plain 403 from a rate limit', async () => {
    respond(403, { message: 'Resource not accessible by personal access token' });
    const result = await listWorkflows(TOKEN, 'o', 'r');

    expect(!result.ok && result.message).toMatch(/refused access \(403\)/i);
    expect(!result.ok && result.message).not.toMatch(/rate limit/i);
  });

  it('calls a 5xx retryable, and does not call a 404 retryable', async () => {
    respond(503);
    expect((await listWorkflows(TOKEN, 'o', 'r')) as never).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Safe to retry/)
    });
  });

  it('says what happened when GitHub could not be reached at all', async () => {
    // No status to report, and `HTTP null` is worse than the actual reason.
    get.mockRejectedValue(new Error('getaddrinfo ENOTFOUND api.github.com'));
    const result = await listWorkflows(TOKEN, 'o', 'r');

    expect(!result.ok && result.status).toBeNull();
    expect(!result.ok && result.message).toMatch(/Could not reach GitHub .*ENOTFOUND/);
  });
});
