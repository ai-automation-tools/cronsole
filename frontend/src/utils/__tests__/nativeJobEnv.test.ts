import { describe, it, expect } from 'vitest';
import {
  parseEnv,
  formatEnv,
  nativeJobPayload,
  nativeJobUnreadable,
  nativeJobIncomplete,
  discardedByTypeSwitch,
  secretRefsIn,
  emptyNativeJobValues,
  type NativeJobValues
} from '../taskEditing';

const exec = (over: Partial<NativeJobValues> = {}): NativeJobValues => ({
  ...emptyNativeJobValues(),
  jobType: 'EXEC',
  command: 'node digest.js',
  ...over
});

const script = (over: Partial<NativeJobValues> = {}): NativeJobValues => ({
  ...emptyNativeJobValues(),
  jobType: 'SCRIPT',
  scriptBody: 'echo hi',
  ...over
});

describe('parseEnv', () => {
  it('reads NAME=value per line, and JSON', () => {
    expect(parseEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' });
    expect(parseEnv('{"A":"1"}')).toEqual({ A: '1' });
    expect(parseEnv('   ')).toEqual({});
  });

  it('keeps everything after the first = as the value', () => {
    // `PATH=a=b` is one variable. Splitting on every `=` would silently drop half
    // of any value that contains one — a base64 token, a connection string.
    expect(parseEnv('PATH=a=b')).toEqual({ PATH: 'a=b' });
  });

  it('drops blank and # lines so a pasted .env block works', () => {
    expect(parseEnv('# comment\n\nA=1')).toEqual({ A: '1' });
  });

  it('refuses a name a child process could not be given', () => {
    expect(parseEnv('1BAD=x')).toBeNull();
    expect(parseEnv('has space=x')).toBeNull();
    expect(parseEnv('novalue')).toBeNull();
    expect(parseEnv('=novalue')).toBeNull();
    expect(parseEnv('{"1BAD":"x"}')).toBeNull();
    expect(parseEnv('[1,2]')).toBeNull();
  });

  it('makes a ${secret.…} in a NAME unrepresentable, and legal in a value', () => {
    // The server refuses a ref in an env name by name (illegalSecretRef); the
    // parser's name rule means the form cannot even send one.
    expect(parseEnv('${secret.A}=x')).toBeNull();
    expect(parseEnv('TOKEN=${secret.API_TOKEN}')).toEqual({ TOKEN: '${secret.API_TOKEN}' });
  });

  it('round-trips through formatEnv', () => {
    expect(parseEnv(formatEnv({ A: '1', B: 'two' }))).toEqual({ A: '1', B: 'two' });
    expect(formatEnv(undefined)).toBe('');
    expect(formatEnv([1, 2])).toBe('');
  });
});

describe('nativeJobPayload — env', () => {
  it('sends env on EXEC and SCRIPT', () => {
    expect(nativeJobPayload(exec({ env: 'A=1' }))).toMatchObject({ jobType: 'EXEC', env: { A: '1' } });
    expect(nativeJobPayload(script({ env: 'A=1' }))).toMatchObject({ jobType: 'SCRIPT', env: { A: '1' } });
  });

  it('omits env entirely when empty, so an untouched job is not dirty', () => {
    expect(nativeJobPayload(exec())).not.toHaveProperty('env');
    expect(nativeJobPayload(script())).not.toHaveProperty('env');
  });

  it('carries env across an EXEC ↔ SCRIPT switch — the one field both types share', () => {
    const values = exec({ env: 'A=1' });
    expect(nativeJobPayload({ ...values, jobType: 'SCRIPT', scriptBody: 'x' })).toMatchObject({
      env: { A: '1' }
    });
  });

  it('refuses to build an unreadable env rather than sending none', () => {
    expect(nativeJobPayload(exec({ env: 'nope' }))).toBeNull();
    expect(nativeJobPayload(script({ env: 'nope' }))).toBeNull();
  });

  it('still keeps the SCRIPT interpreter it always sent', () => {
    expect(nativeJobPayload(script({ interpreter: 'bash' }))).toMatchObject({ interpreter: 'bash' });
  });
});

describe('nativeJobUnreadable', () => {
  it('names the field that cannot be read, not whichever one was hard-coded', () => {
    expect(nativeJobUnreadable(script({ env: 'nope' }))).toMatch(/NAME=value/);
    expect(nativeJobUnreadable({ ...emptyNativeJobValues(), headers: 'nope' })).toMatch(/Headers/);
  });

  it('does not read env on a type that has none', () => {
    // A SCRIPT job's unreadable env must not be reported against an HTTP job,
    // and an HTTP job has no env field to fail on.
    expect(nativeJobUnreadable({ ...emptyNativeJobValues(), url: 'https://x.dev', env: 'nope' })).toBeNull();
  });
});

describe('nativeJobIncomplete', () => {
  it('blocks an unreadable field before an incomplete one', () => {
    expect(nativeJobIncomplete(exec({ env: 'nope' }))).toMatch(/NAME=value/);
  });

  it('judges a script by its body and a check by its probe, not by a command', () => {
    // The edit modal used to gate every non-HTTP job on `command`, which no
    // script or check has.
    expect(nativeJobIncomplete(script())).toBeNull();
    expect(nativeJobIncomplete(script({ scriptBody: '' }))).toMatch(/script/i);
    expect(
      nativeJobIncomplete({ ...emptyNativeJobValues(), jobType: 'CHECK', checkUrl: 'https://x.dev' })
    ).toBeNull();
  });

  it('accepts a URL that is itself a secret, as the API does', () => {
    expect(
      nativeJobIncomplete({ ...emptyNativeJobValues(), url: '${secret.WEBHOOK_URL}' })
    ).toBeNull();
    expect(nativeJobIncomplete({ ...emptyNativeJobValues(), url: 'ftp://x.dev' })).toMatch(/http/);
  });
});

describe('discardedByTypeSwitch', () => {
  it('names the environment only when the switch actually drops it', () => {
    expect(discardedByTypeSwitch('EXEC', 'SCRIPT')).not.toMatch(/environment/);
    expect(discardedByTypeSwitch('EXEC', 'HTTP')).toMatch(/environment/);
    expect(discardedByTypeSwitch('SCRIPT', 'CHECK')).toMatch(/environment/);
    expect(discardedByTypeSwitch('HTTP', 'EXEC')).not.toMatch(/environment/);
  });
});

describe('secretRefsIn — the reason this field needed an editor', () => {
  it('sees a secret referenced from env, on both types', () => {
    // The gap the env editor closed: a secret could be stored on a task and then
    // referenced only from a field the app could not edit. The New Task form asks
    // for a value for every name this returns, so the reference has to be
    // reachable from the form for the secret to be settable at create time.
    expect(secretRefsIn(exec({ env: 'TOKEN=${secret.API_TOKEN}' }))).toEqual(['API_TOKEN']);
    expect(secretRefsIn(script({ env: 'TOKEN=${secret.API_TOKEN}' }))).toEqual(['API_TOKEN']);
  });

  it('reports nothing from an env it cannot read, rather than guessing', () => {
    expect(secretRefsIn(exec({ env: 'nope' }))).toEqual([]);
  });
});
