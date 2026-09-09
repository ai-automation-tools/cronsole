import { describe, it, expect } from 'vitest';
import {
  hasSecretRef,
  illegalSecretRef,
  missingSecretRefs,
  redactSecrets,
  resolveJobSecrets,
  secretRefsIn,
  validateSecret,
  MIN_SECRET_VALUE_LENGTH,
  TaskSecretError
} from '../jobSecrets.js';
import type { NativeJob } from '../NativeTaskExecutor.js';

/**
 * The pure half of ADR 0003. Every assertion here is about one of the three
 * things that make the design safe rather than merely working: **where** a
 * reference is legal, **what** substitution produces, and **whether the value
 * comes back out of the log**.
 */

describe('secretRefsIn', () => {
  it('reads every legal field of each job type', () => {
    expect(secretRefsIn({
      jobType: 'HTTP',
      url: 'https://hooks/${secret.PATH}',
      headers: { Authorization: 'Bearer ${secret.TOKEN}' },
      body: '{"key":"${secret.KEY}"}'
    })).toEqual(['PATH', 'TOKEN', 'KEY']);

    expect(secretRefsIn({
      jobType: 'EXEC',
      executable: 'node',
      args: ['--token', '${secret.T}'],
      env: { API: '${secret.API}' }
    })).toEqual(['T', 'API']);

    expect(secretRefsIn({
      jobType: 'SCRIPT',
      interpreter: 'node',
      body: 'console.log("${secret.A}")',
      env: { B: '${secret.B}' }
    })).toEqual(['A', 'B']);

    expect(secretRefsIn({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x/${secret.U}', headers: { H: '${secret.H}' } }
    })).toEqual(['U', 'H']);
  });

  it('deduplicates, keeping first-seen order', () => {
    expect(secretRefsIn({
      jobType: 'HTTP',
      url: 'https://x/${secret.A}',
      headers: { One: '${secret.B}', Two: '${secret.A}' }
    })).toEqual(['A', 'B']);
  });

  it('reports nothing for a job with no references', () => {
    expect(secretRefsIn({ jobType: 'HTTP', url: 'https://x' })).toEqual([]);
    expect(secretRefsIn(undefined)).toEqual([]);
    expect(secretRefsIn({ jobType: 'CHECK', probe: { kind: 'tcp', host: 'h', port: 1 } })).toEqual([]);
  });

  it('ignores a reference sitting in a field that cannot hold one', () => {
    // Not "finds it and reports it as required" — a ref there is refused
    // outright by `illegalSecretRef`, so treating it as a requirement would put
    // the two functions into disagreement about the same job.
    expect(secretRefsIn({ jobType: 'EXEC', executable: '${secret.EXE}' })).toEqual([]);
  });

  it('does not read a non-http probe at all', () => {
    expect(secretRefsIn({
      jobType: 'CHECK',
      probe: { kind: 'fileFresh', path: '/x/${secret.P}', maxAgeMinutes: 5 }
    })).toEqual([]);
  });
});

describe('illegalSecretRef', () => {
  it('refuses a secret naming the program to run, and says why', () => {
    const msg = illegalSecretRef({ jobType: 'EXEC', executable: '${secret.EXE}' });
    expect(msg).toMatch(/executable/);
    expect(msg).toMatch(/run log/);
  });

  it('refuses a secret as the interpreter — the allowlist is the whole guarantee', () => {
    expect(illegalSecretRef({ jobType: 'SCRIPT', interpreter: '${secret.I}', body: 'x' }))
      .toMatch(/allowlist/);
  });

  it('refuses a reference in a header or env NAME, only the value may be one', () => {
    expect(illegalSecretRef({ jobType: 'HTTP', url: 'https://x', headers: { '${secret.N}': 'v' } }))
      .toMatch(/header \*name\*/);
    expect(illegalSecretRef({ jobType: 'EXEC', executable: 'node', env: { '${secret.N}': 'v' } }))
      .toMatch(/env variable \*name\*/);
  });

  it('refuses a reference in a check assertion, which is compared against captured output', () => {
    expect(illegalSecretRef({
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x', expectBodyContains: '${secret.S}' }
    })).toMatch(/assertion/);
  });

  it('refuses a reference in a probe that reports what it measured', () => {
    expect(illegalSecretRef({
      jobType: 'CHECK',
      probe: { kind: 'fileFresh', path: '/x/${secret.P}', maxAgeMinutes: 5 }
    })).toMatch(/published by the check itself/);
  });

  it('names the legal fields in the refusal rather than only the illegal one', () => {
    expect(illegalSecretRef({ jobType: 'HTTP', url: 'https://x', method: '${secret.M}' }))
      .toMatch(/headers\.\*/);
  });

  it('passes a job whose references are all legal', () => {
    expect(illegalSecretRef({
      jobType: 'HTTP',
      url: 'https://x/${secret.A}',
      headers: { Authorization: '${secret.B}' },
      body: '${secret.C}'
    })).toBeNull();
    expect(illegalSecretRef({ jobType: 'HTTP', url: 'https://x' })).toBeNull();
  });
});

describe('missingSecretRefs', () => {
  it('names only what is referenced and not available', () => {
    const job = { jobType: 'HTTP', url: 'https://x/${secret.A}', headers: { H: '${secret.B}' } };
    expect(missingSecretRefs(job, ['A'])).toEqual(['B']);
    expect(missingSecretRefs(job, ['A', 'B'])).toEqual([]);
    // A stored secret nothing references is not a problem and is not reported.
    expect(missingSecretRefs(job, ['A', 'B', 'UNUSED'])).toEqual([]);
  });
});

describe('resolveJobSecrets', () => {
  it('substitutes into every legal field without touching the original', () => {
    const job: NativeJob = {
      jobType: 'HTTP',
      url: 'https://hooks/${secret.PATH}',
      method: 'POST',
      headers: { Authorization: 'Bearer ${secret.TOKEN}', 'Content-Type': 'application/json' },
      body: '{"k":"${secret.TOKEN}"}'
    };
    const resolved = resolveJobSecrets(job, { PATH: 'abc123', TOKEN: 'tok_live_9' });

    expect(resolved).toMatchObject({
      url: 'https://hooks/abc123',
      headers: { Authorization: 'Bearer tok_live_9', 'Content-Type': 'application/json' },
      body: '{"k":"tok_live_9"}'
    });
    // The caller is holding the object it read out of `metadata`; mutating it is
    // how a resolved credential gets written back to the row.
    expect(job.url).toBe('https://hooks/${secret.PATH}');
  });

  it('substitutes into EXEC args and env, and leaves the executable alone', () => {
    const job: NativeJob = {
      jobType: 'EXEC',
      executable: 'node',
      args: ['--token', '${secret.T}'],
      env: { API: '${secret.T}' }
    };
    const resolved = resolveJobSecrets(job, { T: 'sekrit-value' }) as typeof job;
    expect(resolved.args).toEqual(['--token', 'sekrit-value']);
    expect(resolved.env).toEqual({ API: 'sekrit-value' });
    expect(resolved.executable).toBe('node');
  });

  it('substitutes into a SCRIPT body', () => {
    const job: NativeJob = { jobType: 'SCRIPT', interpreter: 'node', body: 'x("${secret.K}")' };
    expect((resolveJobSecrets(job, { K: 'value1' }) as typeof job).body).toBe('x("value1")');
  });

  it('substitutes into an http probe and leaves other probes untouched', () => {
    const http: NativeJob = {
      jobType: 'CHECK',
      probe: { kind: 'http', url: 'https://x/${secret.U}', headers: { H: '${secret.V}' } }
    };
    expect(resolveJobSecrets(http, { U: 'uuuu', V: 'vvvv' })).toMatchObject({
      probe: { url: 'https://x/uuuu', headers: { H: 'vvvv' } }
    });

    const tcp: NativeJob = { jobType: 'CHECK', probe: { kind: 'tcp', host: 'h', port: 1 } };
    expect(resolveJobSecrets(tcp, { U: 'uuuu' })).toEqual(tcp);
  });

  it('leaves an unresolvable reference standing rather than blanking it', () => {
    // A blank turns `Bearer ${secret.X}` into `Bearer `, and the 401 that comes
    // back reads exactly like an expired token instead of a missing one.
    const job: NativeJob = { jobType: 'HTTP', url: 'https://x', headers: { A: 'Bearer ${secret.X}' } };
    expect((resolveJobSecrets(job, { OTHER: 'value' }) as typeof job).headers)
      .toEqual({ A: 'Bearer ${secret.X}' });
  });
});

describe('redactSecrets', () => {
  it('replaces the value with the reference that carried it', () => {
    expect(redactSecrets('POST https://hooks/abc123 → 204', { PATH: 'abc123' }))
      .toBe('POST https://hooks/${secret.PATH} → 204');
  });

  it('replaces every occurrence, not just the first', () => {
    expect(redactSecrets('tok_live_9 then tok_live_9', { T: 'tok_live_9' }))
      .toBe('${secret.T} then ${secret.T}');
  });

  it('masks the longer value first, so a secret containing another is masked as itself', () => {
    const out = redactSecrets('value-prefix-and-more', {
      SHORT: 'value-prefix',
      LONG: 'value-prefix-and-more'
    });
    expect(out).toBe('${secret.LONG}');
  });

  it('skips values below the redactable minimum rather than shredding the log', () => {
    // Nothing can store one — `validateSecret` refuses it — but a value that got
    // in some other way must not turn every "a" in the output into a marker.
    expect(redactSecrets('a banana', { A: 'a' })).toBe('a banana');
  });

  it('leaves output alone when there are no secrets', () => {
    expect(redactSecrets('node -v → exit 0', {})).toBe('node -v → exit 0');
  });
});

describe('hasSecretRef', () => {
  it('is true only for a well-formed reference', () => {
    expect(hasSecretRef('${secret.A}')).toBe(true);
    expect(hasSecretRef('prefix ${secret.A_1} suffix')).toBe(true);
    expect(hasSecretRef('${secret.}')).toBe(false);
    expect(hasSecretRef('${secret.1A}')).toBe(false);
    expect(hasSecretRef('${other.A}')).toBe(false);
    expect(hasSecretRef(undefined)).toBe(false);
  });
});

describe('validateSecret', () => {
  it('accepts an env-shaped name and a real value', () => {
    expect(() => validateSecret('API_TOKEN', 'tok_live_9')).not.toThrow();
    expect(() => validateSecret('_x1', 'abcd')).not.toThrow();
  });

  it('refuses a name that is not env-shaped', () => {
    expect(() => validateSecret('my token', 'abcdefgh')).toThrow(TaskSecretError);
    expect(() => validateSecret('1TOKEN', 'abcdefgh')).toThrow(/not a usable secret name/);
  });

  it('refuses a value too short to redact, and states that as the reason', () => {
    expect(() => validateSecret('T', 'abc')).toThrow(
      new RegExp(`at least ${MIN_SECRET_VALUE_LENGTH} characters`)
    );
    expect(() => validateSecret('T', 'abc')).toThrow(/redacts/);
  });

  it('refuses a value that is a file rather than a credential', () => {
    expect(() => validateSecret('T', 'x'.repeat(5000))).toThrow(/credential, not a file/);
  });
});
