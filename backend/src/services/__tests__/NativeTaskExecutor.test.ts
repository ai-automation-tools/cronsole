import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import {
  validateJob,
  executeJob,
  childEnv,
  MAX_EXEC_TIMEOUT_MS,
  type ExecJob,
  type NativeJob
} from '../NativeTaskExecutor.js';

vi.mock('axios', () => ({
  default: { request: vi.fn() }
}));

/**
 * Spawns real child processes — see the same note in `NativeJobTypes.test.ts`.
 * These are the two files whose wall clock belongs to the OS scheduler, and
 * both have timed out under full-suite contention while passing in isolation.
 * 30s still catches a genuine hang.
 */
vi.setConfig({ testTimeout: 30_000 });

describe('validateJob', () => {
  it('accepts a valid HTTP job', () => {
    expect(validateJob({ jobType: 'HTTP', url: 'https://example.com' })).toBeNull();
    expect(validateJob({ jobType: 'HTTP', url: 'http://localhost:3000/x', method: 'post' })).toBeNull();
  });

  it('rejects missing or malformed specs', () => {
    expect(validateJob(undefined)).toMatch(/Missing/);
    expect(validateJob({})).toMatch(/jobType/);
    expect(validateJob({ jobType: 'SHELL', url: 'https://x.com' })).toMatch(/Unsupported/);
    expect(validateJob({ jobType: 'HTTP', url: 'ftp://x.com' })).toMatch(/url/);
    expect(validateJob({ jobType: 'HTTP', url: 'https://x.com', method: 'TRACE' })).toMatch(/method/);
  });
});

describe('executeJob', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
  });

  it('reports success on 2xx responses', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'ok' });

    const job: NativeJob = { jobType: 'HTTP', url: 'https://example.com/ping' };
    const result = await executeJob(job);

    expect(result.success).toBe(true);
    expect(result.log).toContain('GET https://example.com/ping → 200');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.com/ping',
      method: 'GET',
      timeout: 15000
    }));
  });

  it('reports failure on non-2xx responses', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 503, data: 'unavailable' });

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.log).toContain('503');
  });

  it('reports failure on network errors', async () => {
    vi.mocked(axios.request).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.log).toContain('ECONNREFUSED');
  });

  it('fails fast on invalid job specs without calling axios', async () => {
    const result = await executeJob({ jobType: 'HTTP', url: 'notaurl' } as NativeJob);

    expect(result.success).toBe(false);
    expect(axios.request).not.toHaveBeenCalled();
  });

  // `ran` is what lets the route answer 200-with-a-verdict instead of 502, so a
  // spec that never executed must not claim to be a verdict about anything. Both
  // directions are asserted: a rejected spec is `false`, a real failed request is
  // `true` — collapsing either way reintroduces troubleshooting #59.
  it('reports ran:false for a spec that never executed', async () => {
    const result = await executeJob({ jobType: 'HTTP', url: 'notaurl' } as NativeJob);

    expect(result.ran).toBe(false);
  });

  it('reports ran:true for a request that executed and failed', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 500, data: 'boom' });

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.success).toBe(false);
    expect(result.ran).toBe(true);
  });

  it('reports ran:true for a network error, which is a real attempt', async () => {
    vi.mocked(axios.request).mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.ran).toBe(true);
  });

  it('truncates long response bodies in the log', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'x'.repeat(2000) });

    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' });

    expect(result.log.length).toBeLessThan(600);
  });
});

// ---------------------------------------------------------------------------
// EXEC jobs. These run a real child process — `process.execPath` is the node
// binary running this suite, so it is guaranteed present and cross-platform,
// which a hard-coded `echo`/`cmd.exe` would not be.
// ---------------------------------------------------------------------------

const node = (script: string, over: Partial<ExecJob> = {}): NativeJob => ({
  jobType: 'EXEC',
  executable: process.execPath,
  args: ['-e', script],
  ...over
});

describe('validateJob — EXEC', () => {
  it('accepts a minimal and a full spec', () => {
    expect(validateJob({ jobType: 'EXEC', executable: 'node' })).toBeNull();
    expect(validateJob({
      jobType: 'EXEC',
      executable: 'node',
      args: ['-v'],
      workingDirectory: '/tmp',
      env: { FOO: 'bar' },
      timeoutMs: 1000
    })).toBeNull();
  });

  it('rejects the ways a spec can be malformed', () => {
    expect(validateJob({ jobType: 'EXEC' })).toMatch(/executable/);
    expect(validateJob({ jobType: 'EXEC', executable: '   ' })).toMatch(/executable/);
    expect(validateJob({ jobType: 'EXEC', executable: 'node', args: 'not-an-array' })).toMatch(/args/);
    expect(validateJob({ jobType: 'EXEC', executable: 'node', args: [1, 2] })).toMatch(/args/);
    expect(validateJob({ jobType: 'EXEC', executable: 'node', env: ['a'] })).toMatch(/env/);
    expect(validateJob({ jobType: 'EXEC', executable: 'node', env: { A: 5 } })).toMatch(/env/);
    expect(validateJob({ jobType: 'EXEC', executable: 'node', timeoutMs: 0 })).toMatch(/timeoutMs/);
    expect(validateJob({ jobType: 'EXEC', executable: 'node', timeoutMs: MAX_EXEC_TIMEOUT_MS + 1 }))
      .toMatch(/timeoutMs/);
  });
});

describe('childEnv — the backend\'s secrets never reach a task', () => {
  it('passes no variable that is not on the allowlist', () => {
    // The exact shape of the risk: this process holds the AES key that encrypts
    // every stored platform credential. Inheriting the environment would hand it
    // to any scheduled script, defeating encryption-at-rest through the same UI
    // that created the task.
    process.env.CRONSOLE_TEST_SECRET = 'super-secret-value';
    try {
      const env = childEnv();
      expect(env.CRONSOLE_TEST_SECRET).toBeUndefined();
      expect(Object.values(env)).not.toContain('super-secret-value');
    } finally {
      delete process.env.CRONSOLE_TEST_SECRET;
    }
  });

  it('keeps PATH, or nothing could be executed at all', () => {
    expect(childEnv().PATH ?? childEnv().Path).toBeTruthy();
  });

  it('lets a job add its own variables deliberately', () => {
    expect(childEnv({ MY_VAR: 'x' }).MY_VAR).toBe('x');
  });
});

describe('executeJob — EXEC', () => {
  it('reports exit 0 as success and captures output', async () => {
    const result = await executeJob(node('console.log("hello from the job")'));
    expect(result.success).toBe(true);
    expect(result.log).toContain('exit 0');
    expect(result.log).toContain('hello from the job');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('reports a non-zero exit as failure, and keeps stderr', async () => {
    const result = await executeJob(node('console.error("it broke"); process.exit(3)'));
    expect(result.success).toBe(false);
    expect(result.log).toContain('exit 3');
    expect(result.log).toContain('it broke');
  });

  it('does not leak the parent environment into the child', async () => {
    // The end-to-end version of the childEnv test — proving it through a real
    // spawn, because the unit test above pins the helper and not its use.
    process.env.CRONSOLE_TEST_SECRET = 'leaked';
    try {
      const result = await executeJob(
        node('console.log(process.env.CRONSOLE_TEST_SECRET ?? "ABSENT")')
      );
      expect(result.log).toContain('ABSENT');
      expect(result.log).not.toContain('leaked');
    } finally {
      delete process.env.CRONSOLE_TEST_SECRET;
    }
  });

  it('passes the job\'s own env through', async () => {
    const result = await executeJob(
      node('console.log(process.env.GREETING)', { env: { GREETING: 'from-the-spec' } })
    );
    expect(result.log).toContain('from-the-spec');
  });

  it('says the executable was not found rather than echoing a raw errno', async () => {
    const result = await executeJob({
      jobType: 'EXEC',
      executable: 'definitely-not-a-real-program-xyz'
    });
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/not found|could not start/i);
  });

  it('kills a job that overruns its timeout, and says so', async () => {
    const result = await executeJob(
      node('setTimeout(() => {}, 30000)', { timeoutMs: 300 })
    );
    expect(result.success).toBe(false);
    expect(result.log).toMatch(/timed out/i);
  }, 15000);

  it('never runs through a shell', async () => {
    // The P0 guarantee. If a shell were involved, `&&` would chain a second
    // command; with `shell: false` it is just an argument the program prints.
    const result = await executeJob(
      node('console.log(process.argv[2])', { args: ['-e', 'console.log(process.argv[2])', 'a && echo pwned'] })
    );
    expect(result.log).toContain('a && echo pwned');
    expect(result.log).not.toMatch(/\bpwned\s*$/m);
  });

  it('refuses an invalid spec before spawning anything', async () => {
    const result = await executeJob({ jobType: 'EXEC', executable: '' } as NativeJob);
    expect(result.success).toBe(false);
    expect(result.durationMs).toBe(0);
  });
});

/**
 * ADR 0003 at the executor. The three properties that make the reference model
 * safe all live in `executeJob`, so they are asserted where they live: an
 * unresolved reference **never runs**, a resolved value **reaches the request**,
 * and the value **does not come back in the log**.
 */
describe('executeJob — stored secrets', () => {
  beforeEach(() => {
    vi.mocked(axios.request).mockReset();
  });

  it('substitutes a secret into the request without it appearing in the log', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 204, data: '' });

    const result = await executeJob(
      {
        jobType: 'HTTP',
        method: 'POST',
        url: 'https://hooks.example.com/${secret.HOOK_PATH}',
        headers: { Authorization: 'Bearer ${secret.TOKEN}' }
      },
      { HOOK_PATH: 'w3bh00k', TOKEN: 'tok_live_secret' }
    );

    expect(axios.request).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://hooks.example.com/w3bh00k',
      headers: { Authorization: 'Bearer tok_live_secret' }
    }));
    expect(result.success).toBe(true);
    // The URL is echoed into the log line by design, so this is the case that
    // makes redaction load-bearing rather than decorative.
    expect(result.log).not.toContain('w3bh00k');
    expect(result.log).toContain('${secret.HOOK_PATH}');
  });

  it('redacts a secret a program printed back out', async () => {
    const result = await executeJob(
      node('', { args: ['-e', 'console.log(process.env.LEAK)'], env: { LEAK: '${secret.T}' } }),
      { T: 'tok_live_secret' }
    );
    expect(result.log).not.toContain('tok_live_secret');
    expect(result.log).toContain('${secret.T}');
  });

  it('refuses to start when a referenced secret is not set, and names it', async () => {
    const result = await executeJob(
      { jobType: 'HTTP', url: 'https://x.com', headers: { A: 'Bearer ${secret.MISSING_ONE}' } },
      {}
    );
    // `ran: false` — nothing executed, so this is a failure to START and the
    // route answers 502 rather than reporting a verdict (troubleshooting #59).
    expect(result.ran).toBe(false);
    expect(result.success).toBe(false);
    expect(result.log).toContain('MISSING_ONE');
    expect(axios.request).not.toHaveBeenCalled();
  });

  it('accepts a url that is entirely a reference, and checks its shape after resolving', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'ok' });
    // A whole webhook URL is frequently the credential — that has to be storable.
    expect(validateJob({ jobType: 'HTTP', url: '${secret.WEBHOOK}' })).toBeNull();

    const good = await executeJob({ jobType: 'HTTP', url: '${secret.WEBHOOK}' }, {
      WEBHOOK: 'https://hooks.example.com/abc'
    });
    expect(good.ran).toBe(true);

    const bad = await executeJob({ jobType: 'HTTP', url: '${secret.WEBHOOK}' }, {
      WEBHOOK: 'not-a-url-at-all'
    });
    expect(bad.ran).toBe(false);
    expect(bad.log).toMatch(/after resolving/);
    // The refusal must not quote the value it refused.
    expect(bad.log).not.toContain('not-a-url-at-all');
  });

  it('refuses a reference in a field that cannot hold one, before anything runs', async () => {
    const result = await executeJob(
      { jobType: 'EXEC', executable: '${secret.EXE}' } as NativeJob,
      { EXE: 'node' }
    );
    expect(result.ran).toBe(false);
    expect(result.log).toMatch(/executable/);
  });

  it('is unchanged for a job with no references', async () => {
    vi.mocked(axios.request).mockResolvedValue({ status: 200, data: 'ok' });
    const result = await executeJob({ jobType: 'HTTP', url: 'https://example.com' }, { UNUSED: 'value1' });
    expect(result.success).toBe(true);
    expect(result.log).toContain('https://example.com');
  });
});
