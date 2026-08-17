import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { mkdtemp, writeFile, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateJob,
  executeJob,
  SCRIPT_INTERPRETERS,
  MAX_SCRIPT_BODY_BYTES,
  type NativeJob
} from '../NativeTaskExecutor.js';
import { buildNativeJob } from '../nativeJob.js';

vi.mock('axios', () => ({ default: { request: vi.fn() } }));

/**
 * **This file spawns real child processes, so its wall clock is the machine's
 * scheduler rather than anything this code controls.**
 *
 * Under a full parallel run — every suite at once on a 2-core CI runner — a
 * `spawn` has exceeded the 5s default and reddened the suite roughly 1 run in 3
 * since 2026-08-15. It has now done so on **two different tests** (`reports a
 * non-zero exit as a failure`, then `blames the host…` in CI on 2026-08-17,
 * where the first passed in 24ms), which is what establishes it as contention
 * rather than one slow assertion.
 *
 * File-level rather than a per-test argument, deliberately: the flake has
 * already moved between tests, so a constant each test must remember is one the
 * next spawning test forgets. 30s still catches a genuine hang — a script that
 * never exits — it just stops reporting a busy runner as a defect. **A suite
 * that reddens at random teaches people to re-run instead of read**, which
 * costs far more than the seconds this gives back.
 */
vi.setConfig({ testTimeout: 30_000 });

/**
 * `SCRIPT` and `CHECK` — the two job types added 2026-08-15 (ADR 0002).
 *
 * The `SCRIPT` cases run **real** interpreters (`node`, which is by definition
 * present wherever this suite runs) rather than mocking `spawn`, because the
 * whole type is about a file reaching a real interpreter with the right
 * extension and the right argv — a mocked spawn would assert the arguments this
 * file already constructs and prove nothing about whether the interpreter
 * accepts them.
 */

describe('validateJob — SCRIPT', () => {
  it('accepts every allowlisted interpreter', () => {
    for (const interpreter of Object.keys(SCRIPT_INTERPRETERS)) {
      expect(validateJob({ jobType: 'SCRIPT', interpreter, body: 'echo hi' })).toBeNull();
    }
  });

  it('refuses an interpreter outside the allowlist, and names the legal set', () => {
    // The allowlist IS the security property of this type: without it, SCRIPT is
    // EXEC with an extra step and the shell it runs is no longer one the user named.
    const error = validateJob({ jobType: 'SCRIPT', interpreter: 'perl', body: 'x' });
    expect(error).toMatch(/interpreter/);
    expect(error).toMatch(/powershell/);
  });

  it('refuses an interpreter smuggled in as a path', () => {
    expect(validateJob({ jobType: 'SCRIPT', interpreter: '/bin/bash', body: 'x' })).toMatch(/interpreter/);
    expect(validateJob({ jobType: 'SCRIPT', interpreter: 'bash ', body: 'x' })).toMatch(/interpreter/);
  });

  it('requires a non-empty body and caps its size', () => {
    expect(validateJob({ jobType: 'SCRIPT', interpreter: 'bash', body: '   ' })).toMatch(/body/);
    expect(
      validateJob({ jobType: 'SCRIPT', interpreter: 'bash', body: 'x'.repeat(MAX_SCRIPT_BODY_BYTES + 1) })
    ).toMatch(/KB/);
  });

  it('applies the same env contract as EXEC', () => {
    expect(validateJob({ jobType: 'SCRIPT', interpreter: 'bash', body: 'x', env: { A: 1 } })).toMatch(/env/);
  });
});

describe('buildNativeJob — SCRIPT', () => {
  it('stores the body and drops fields the client invented', () => {
    const job = buildNativeJob({
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'console.log(1)',
      executable: 'evil.exe',
      url: 'https://example.com'
    });
    expect(job).toEqual({
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'console.log(1)',
      workingDirectory: undefined,
      env: undefined,
      timeoutMs: undefined
    });
  });

  it('passes an unknown interpreter through for validateJob to reject by name', () => {
    // Never coerced to a default: a PowerShell body quietly run under `sh` is a
    // create that reports success and a job that fails at 3am.
    const job = buildNativeJob({ jobType: 'SCRIPT', interpreter: 'ruby', body: 'x' });
    expect((job as { interpreter: string }).interpreter).toBe('ruby');
    expect(validateJob(job)).toMatch(/interpreter/);
  });
});

describe('executeJob — SCRIPT', () => {
  it('runs the body and reports the real exit code', async () => {
    const job: NativeJob = {
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'console.log("from the body"); process.exit(0);'
    };
    const result = await executeJob(job);
    expect(result.success).toBe(true);
    expect(result.log).toMatch(/from the body/);
    expect(result.log).toMatch(/node script/);
  });

  it('reports a non-zero exit as a failure', async () => {
    const result = await executeJob({
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'process.exit(3);'
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/exit 3/);
  });

  it('does not inherit Cronsole\'s environment', async () => {
    // The reason childEnv exists: this process holds the AES key encrypting every
    // stored platform credential, so a scheduled script must not be able to read it.
    process.env.CRONSOLE_TEST_SECRET = 'do-not-leak';
    try {
      const result = await executeJob({
        jobType: 'SCRIPT',
        interpreter: 'node',
        body: 'console.log("SECRET=" + (process.env.CRONSOLE_TEST_SECRET ?? "absent"));'
      });
      expect(result.log).toMatch(/SECRET=absent/);
    } finally {
      delete process.env.CRONSOLE_TEST_SECRET;
    }
  });

  it('passes explicitly-set env through', async () => {
    const result = await executeJob({
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'console.log("V=" + process.env.MY_VAR);',
      env: { MY_VAR: 'chosen' }
    });
    expect(result.log).toMatch(/V=chosen/);
  });

  it('deletes the temp directory even when the script times out', async () => {
    // The cleanup path least likely to be exercised, and the one that leaks
    // exactly when a job is misbehaving — so it is pinned rather than assumed.
    const before = await countScriptTempDirs();
    const result = await executeJob({
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'setTimeout(() => {}, 60000);',
      timeoutMs: 300
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/timed out/);
    expect(await countScriptTempDirs()).toBe(before);
  });

  it('deletes the temp directory after a successful run', async () => {
    const before = await countScriptTempDirs();
    await executeJob({ jobType: 'SCRIPT', interpreter: 'node', body: 'console.log(1);' });
    expect(await countScriptTempDirs()).toBe(before);
  });

  it('blames the host, not the script, when the interpreter is missing', async () => {
    // "spawn pwsh ENOENT" sends someone to read their own script. The container
    // has node and usually nothing else, so this sentence is the common case.
    const result = await executeJob({
      jobType: 'SCRIPT',
      interpreter: 'pwsh',
      body: 'Write-Output "hi"'
    });
    if (!result.success && /could not start/.test(result.log)) {
      expect(result.log).toMatch(/installed where the Cronsole backend runs/);
    }
  });
});

async function countScriptTempDirs(): Promise<number> {
  const entries = await readdir(tmpdir());
  return entries.filter(e => e.startsWith('cronsole-script-')).length;
}

describe('validateJob — CHECK', () => {
  it('accepts each probe kind', () => {
    expect(validateJob({ jobType: 'CHECK', probe: { kind: 'http', url: 'https://x.com' } })).toBeNull();
    expect(validateJob({ jobType: 'CHECK', probe: { kind: 'tcp', host: 'x.com', port: 443 } })).toBeNull();
    expect(
      validateJob({ jobType: 'CHECK', probe: { kind: 'fileFresh', path: '/tmp/x', maxAgeMinutes: 60 } })
    ).toBeNull();
    expect(
      validateJob({ jobType: 'CHECK', probe: { kind: 'diskFree', path: '/', minFreeBytes: 1024 } })
    ).toBeNull();
  });

  it('rejects an unknown probe kind by name rather than defaulting', () => {
    expect(validateJob({ jobType: 'CHECK', probe: { kind: 'ping', host: 'x' } })).toMatch(/Unsupported check kind: ping/);
    expect(validateJob({ jobType: 'CHECK' })).toMatch(/Missing check probe/);
  });

  it('validates each probe\'s own fields', () => {
    expect(validateJob({ jobType: 'CHECK', probe: { kind: 'http', url: 'ftp://x' } })).toMatch(/url/);
    expect(validateJob({ jobType: 'CHECK', probe: { kind: 'tcp', host: 'x', port: 0 } })).toMatch(/port/);
    expect(validateJob({ jobType: 'CHECK', probe: { kind: 'tcp', host: 'x', port: 70000 } })).toMatch(/port/);
    expect(
      validateJob({ jobType: 'CHECK', probe: { kind: 'fileFresh', path: '/x', maxAgeMinutes: 0 } })
    ).toMatch(/maxAgeMinutes/);
    expect(
      validateJob({ jobType: 'CHECK', probe: { kind: 'http', url: 'https://x.com', expectStatus: { min: 500, max: 200 } } })
    ).toMatch(/expectStatus/);
  });
});

describe('executeJob — CHECK http', () => {
  beforeEach(() => vi.mocked(axios.request).mockReset());

  it('passes inside the default 2xx range and says what it measured', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'ok' });
    const result = await executeJob({ jobType: 'CHECK', probe: { kind: 'http', url: 'https://x.com' } });
    expect(result.success).toBe(true);
    expect(result.log).toMatch(/→ 200 \(expected 200–299\)/);
  });

  it('fails a 200 whose body is wrong — the reason CHECK exists apart from HTTP', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'Service Unavailable' });
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com', expectBodyContains: 'healthy' }
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/body does not contain "healthy"/);
  });

  it('honours a custom status range', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 301, data: '' });
    const pass = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com', expectStatus: { min: 300, max: 399 } }
    });
    expect(pass.success).toBe(true);
    const fail = await executeJob({ jobType: 'CHECK', probe: { kind: 'http', url: 'https://x.com' } });
    expect(fail.success).toBe(false);
  });

  it('reads a JSON path, and distinguishes absent from changed', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: '{"status":{"db":"up"}}' });

    const ok = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com', expectJsonPath: { path: 'status.db', equals: 'up' } }
    });
    expect(ok.success).toBe(true);

    const changed = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com', expectJsonPath: { path: 'status.db', equals: 'down' } }
    });
    expect(changed.log).toMatch(/is "up", expected "down"/);

    const absent = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com', expectJsonPath: { path: 'status.cache', equals: 'up' } }
    });
    expect(absent.log).toMatch(/not present/);
  });

  it('names each assertion it passed, so a dropped one is visible', async () => {
    // The whole point: a check that asserts something must not log identically
    // to one that asserts nothing. Before this, both ended `| all assertions
    // passed`, so an assertion lost between the MCP tool and the stored job
    // read exactly like one that ran and held.
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: '{"status":{"db":"up"}}' });

    const asserted = await executeJob({
      jobType: 'CHECK',
      probe: {
        kind: 'http',
        url: 'https://x.com',
        expectBodyContains: 'up',
        expectJsonPath: { path: 'status.db', equals: 'up' }
      }
    });
    expect(asserted.success).toBe(true);
    expect(asserted.log).toMatch(/body contains "up"/);
    // The observed value, not a bare "matched" — same vocabulary the failure uses.
    expect(asserted.log).toMatch(/status\.db is "up"/);

    const bare = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com' }
    });
    expect(bare.success).toBe(true);
    expect(bare.log).not.toMatch(/body contains/);
    expect(bare.log).not.toMatch(/status\.db/);
    // Same status, same URL, different assertions ⇒ different logs. That
    // difference is the property; asserting the strings differ pins it directly.
    expect(bare.log).not.toBe(asserted.log);
  });

  it('reports a non-JSON body as unreadable rather than as a mismatch', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: '<html>' });
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x.com', expectJsonPath: { path: 'a', equals: 'b' } }
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/not JSON/);
  });
});

describe('executeJob — CHECK fileFresh', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cronsole-check-test-'));
  });
  afterEach(async () => {
    await (await import('node:fs/promises')).rm(dir, { recursive: true, force: true });
  });

  it('passes for a file written just now, and names the measurement', async () => {
    const file = join(dir, 'backup.txt');
    await writeFile(file, 'x');
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'fileFresh', path: file, maxAgeMinutes: 60 }
    });
    expect(result.success).toBe(true);
    expect(result.log).toMatch(/last modified 0m ago \(limit 1\.0h\)/);
  });

  it('fails for a stale file', async () => {
    const file = join(dir, 'backup.txt');
    await writeFile(file, 'x');
    const old = new Date(Date.now() - 3 * 60 * 60_000);
    await utimes(file, old, old);
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'fileFresh', path: file, maxAgeMinutes: 60 }
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/3\.0h ago/);
  });

  it('treats a missing file as a failure, not as nothing to check', async () => {
    // This probe exists to notice a backup that stopped being written. A backup
    // that was never written is the same problem in its worst form.
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'fileFresh', path: join(dir, 'never.txt'), maxAgeMinutes: 60 }
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/does not exist/);
    expect(result.log).toMatch(/machine the backend runs on/);
  });
});

describe('executeJob — CHECK diskFree', () => {
  it('measures real free space and reports both numbers', async () => {
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'diskFree', path: tmpdir(), minFreeBytes: 1024 }
    });
    expect(result.success).toBe(true);
    expect(result.log).toMatch(/free \(minimum 1\.0 KB\)/);
  });

  it('fails when the floor is unreachable', async () => {
    const result = await executeJob({
      jobType: 'CHECK',
      probe: { kind: 'diskFree', path: tmpdir(), minFreeBytes: Number.MAX_SAFE_INTEGER }
    });
    expect(result.success).toBe(false);
  });
});

describe('executeJob — CHECK tcp', () => {
  it('fails closed on an unreachable port', async () => {
    const result = await executeJob({
      jobType: 'CHECK',
      // Port 1 on loopback: reserved, and nothing in CI listens there.
      probe: { kind: 'tcp', host: '127.0.0.1', port: 1 }
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/tcp 127\.0\.0\.1:1/);
  });
});
