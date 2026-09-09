import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const existsSync = vi.fn();
const readFileSync = vi.fn();
vi.mock('node:fs', () => ({
  existsSync: (...a: unknown[]) => existsSync(...a),
  readFileSync: (...a: unknown[]) => readFileSync(...a)
}));
vi.mock('node:os', () => ({ homedir: () => '/home/mike' }));

// `executionHost` is computed once at import, so the container case is a
// separate module registry rather than a mutable flag.
vi.mock('../runtimeContext.js', () => ({ executionHost: { kind: 'host' } }));

import { getClaudeCredential, resetClaudeCredentialCache, credentialsPath } from '../claudeOAuth.js';

const FUTURE = Date.now() + 60 * 60 * 1000;
const creds = (oauth: unknown) => JSON.stringify({ claudeAiOauth: oauth });

beforeEach(() => {
  vi.clearAllMocks();
  resetClaudeCredentialCache();
  delete process.env.CLAUDE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CONFIG_DIR;
  existsSync.mockReturnValue(true);
  readFileSync.mockReturnValue(creds({ accessToken: 'sk-ant-oat01-live', expiresAt: FUTURE }));
});

afterEach(() => {
  delete process.env.CLAUDE_OAUTH_TOKEN;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe('reading the account credential', () => {
  it('reads the Claude Code session off disk', () => {
    const { credential, problem } = getClaudeCredential();
    expect(problem).toBeUndefined();
    expect(credential?.token).toBe('sk-ant-oat01-live');
    expect(credential?.source).toBe('file');
  });

  it('honours CLAUDE_CONFIG_DIR, so a relocated config does not silently disable the connector', () => {
    process.env.CLAUDE_CONFIG_DIR = '/custom/dir';
    expect(credentialsPath()).toBe('/custom/dir/.credentials.json'.replace(/\//g, require('node:path').sep));
  });

  it('lets an explicit env token win, and asks the filesystem nothing', () => {
    process.env.CLAUDE_OAUTH_TOKEN = 'sk-ant-oat01-explicit';
    const { credential } = getClaudeCredential();
    expect(credential?.token).toBe('sk-ant-oat01-explicit');
    expect(credential?.source).toBe('env');
    expect(existsSync).not.toHaveBeenCalled();
  });

  it('distinguishes the four ways there can be no credential', () => {
    // Each maps to a different sentence, and conflating them is how someone
    // regenerates a token when the real problem is that they are in Docker.
    existsSync.mockReturnValue(false);
    resetClaudeCredentialCache();
    expect(getClaudeCredential().problem).toBe('no-file');

    existsSync.mockReturnValue(true);
    readFileSync.mockReturnValue('{ not json');
    resetClaudeCredentialCache();
    expect(getClaudeCredential().problem).toBe('unreadable');

    readFileSync.mockReturnValue(creds({ expiresAt: FUTURE }));
    resetClaudeCredentialCache();
    expect(getClaudeCredential().problem).toBe('absent');

    readFileSync.mockReturnValue(creds({ accessToken: 'sk-ant-oat01-old', expiresAt: Date.now() - 1000 }));
    resetClaudeCredentialCache();
    expect(getClaudeCredential().problem).toBe('expired');
  });

  it('never leaks the token or the file contents into a reason string', () => {
    // A JSON parse error can quote the bytes it choked on, and this file is a
    // secret store — so the parse error is deliberately not included.
    readFileSync.mockReturnValue('{ "claudeAiOauth": { "accessToken": "sk-ant-oat01-SECRET" ');
    resetClaudeCredentialCache();
    const { reason } = getClaudeCredential();
    expect(reason).toBeDefined();
    expect(reason).not.toContain('SECRET');
  });

  it('treats a token about to expire as already expired', () => {
    // A credential valid for another two seconds will not survive the request
    // it is about to be used for.
    readFileSync.mockReturnValue(creds({ accessToken: 'sk-ant-oat01-x', expiresAt: Date.now() + 2000 }));
    resetClaudeCredentialCache();
    expect(getClaudeCredential().problem).toBe('expired');
  });

  it('never offers to refresh, because that would rotate the CLI\'s own token', () => {
    // The load-bearing refusal. Two processes refreshing the same credential
    // race, and the loser holds a revoked refresh token — Cronsole would log the
    // user out of the Claude Code CLI from a background poll, with the symptom
    // appearing hours later somewhere else entirely.
    readFileSync.mockReturnValue(
      creds({ accessToken: 'sk-ant-oat01-x', refreshToken: 'sk-ant-ort01-y', expiresAt: Date.now() - 1 })
    );
    resetClaudeCredentialCache();
    const { credential, reason } = getClaudeCredential();
    expect(credential).toBeNull();
    expect(reason).toMatch(/login/i);
    // Read-only in every sense: nothing is written back.
    expect(reason).toMatch(/does not refresh/i);
  });

  it('memoizes, because verbReachability asks once per verb per poll', () => {
    getClaudeCredential();
    getClaudeCredential();
    getClaudeCredential();
    expect(readFileSync).toHaveBeenCalledTimes(1);

    resetClaudeCredentialCache();
    getClaudeCredential();
    expect(readFileSync).toHaveBeenCalledTimes(2);
  });
});

describe('inside a container', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('../runtimeContext.js', () => ({ executionHost: { kind: 'container' } }));
  });

  it('says the backend cannot see the machine, rather than naming a path that is not theirs', async () => {
    // Reporting "no credential at /root/.claude" would send someone hunting for
    // a file they are looking straight at in Explorer — the same confusion
    // runtimeContext exists to prevent for native EXEC jobs.
    const mod = await import('../claudeOAuth.js');
    mod.resetClaudeCredentialCache();
    const { credential, problem, reason } = mod.getClaudeCredential();
    expect(credential).toBeNull();
    expect(problem).toBe('container');
    expect(reason).toMatch(/container/i);
    expect(reason).toMatch(/CLAUDE_OAUTH_TOKEN/);
  });

  it('still accepts an explicit env token, because that reason does not apply to a value handed in', async () => {
    process.env.CLAUDE_OAUTH_TOKEN = 'sk-ant-oat01-explicit';
    const mod = await import('../claudeOAuth.js');
    mod.resetClaudeCredentialCache();
    expect(mod.getClaudeCredential().credential?.source).toBe('env');
    delete process.env.CLAUDE_OAUTH_TOKEN;
  });
});
