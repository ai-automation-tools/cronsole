import { describe, it, expect } from 'vitest';
import {
  normalizeRoutineId,
  looksLikeRoutineId,
  looksLikeRoutineToken,
  readRoutines,
  redactRoutines,
  upsertRoutine,
  routineInputSchema
} from '../claudeRoutines.js';

/**
 * The Claude connection is the only config a user composes by hand, and the only
 * one holding a live third-party credential they typed in. Both facts are why
 * this module is tested rather than trusted.
 */

describe('normalizeRoutineId — the paste is a URL more often than an id', () => {
  it('takes the id out of the fire URL the modal actually shows', () => {
    // claude.ai displays the whole URL next to the token, so pasting it is the
    // expected input, not an edge case. Stored as-is it would 404 at first run
    // with nothing pointing back at the paste.
    expect(normalizeRoutineId('https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire'))
      .toBe('trig_01ABC');
  });

  it('survives a trailing slash, query string or fragment', () => {
    for (const input of [
      'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire/',
      'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire?x=1',
      'https://api.anthropic.com/v1/claude_code/routines/trig_01ABC/fire#note'
    ]) {
      expect(normalizeRoutineId(input)).toBe('trig_01ABC');
    }
  });

  it('passes a bare id through, trimmed', () => {
    expect(normalizeRoutineId('  trig_01ABC  ')).toBe('trig_01ABC');
  });

  it('refuses a path-shaped paste with no routine id in it', () => {
    // Better a 400 naming what to copy than storing a URL that fails much later.
    expect(normalizeRoutineId('https://claude.ai/code/routines')).toBeNull();
    expect(normalizeRoutineId('')).toBeNull();
    expect(normalizeRoutineId('   ')).toBeNull();
  });

  it('accepts an unprefixed bare value rather than enforcing a format', () => {
    // /fire is experimental behind a dated beta header; refusing an id shape
    // Anthropic later changes would be worse than a 404 that explains itself.
    // The route warns instead — see looksLikeRoutineId.
    expect(normalizeRoutineId('something_else')).toBe('something_else');
    expect(looksLikeRoutineId('something_else')).toBe(false);
    expect(looksLikeRoutineId('trig_01ABC')).toBe(true);
  });

  it('flags a token that is not the shape claude.ai issues', () => {
    expect(looksLikeRoutineToken('sk-ant-oat01-abc')).toBe(true);
    expect(looksLikeRoutineToken('sk-ant-api03-abc')).toBe(false);
  });
});

describe('redactRoutines — the token is write-only', () => {
  const stored = [{ id: 'trig_1', token: 'sk-ant-oat01-secret', name: 'Nightly' }];

  it('drops the token key entirely, not merely its value', () => {
    // Not `{ ...r, token: undefined }`: that leaves the key present and keeps
    // the secret out of the response only because JSON.stringify drops
    // undefined. The same near-miss was in ClaudeConnector.syncTasks.
    const [redacted] = redactRoutines(stored);
    expect(redacted).not.toHaveProperty('token');
    expect(Object.keys(redacted)).not.toContain('token');
    expect(JSON.stringify(redacted)).not.toContain('secret');
  });

  it('says a token exists without saying what it is', () => {
    expect(redactRoutines(stored)[0].hasToken).toBe(true);
  });
});

describe('readRoutines — one bad entry must not take the list down', () => {
  it('reads well-formed entries', () => {
    const routines = readRoutines({ routines: [{ id: 'trig_1', token: 't', name: 'A' }] });
    expect(routines).toEqual([{ id: 'trig_1', token: 't', name: 'A' }]);
  });

  it('drops entries that could not be fired, keeping the rest', () => {
    // Hand-maintained config: a routine missing its token is unrunnable, but it
    // must not make the user's other routines unrunnable too.
    const routines = readRoutines({
      routines: [
        { id: 'trig_1', token: 't' },
        { id: 'trig_2' },
        { token: 'orphan' },
        null,
        'nonsense',
        { id: 'trig_3', token: 't3' }
      ]
    });
    expect(routines.map(r => r.id)).toEqual(['trig_1', 'trig_3']);
  });

  it('returns nothing for an absent or malformed config', () => {
    for (const config of [{}, null, undefined, { routines: 'nope' }, { routines: null }]) {
      expect(readRoutines(config)).toEqual([]);
    }
  });
});

describe('upsertRoutine — re-adding is how you rotate', () => {
  it('replaces the entry with the same id instead of duplicating it', () => {
    // Generating a token at claude.ai revokes its predecessor, so the stored one
    // is already dead when the user gets here. Requiring a delete first would
    // add a step to the only recovery path there is.
    const before = [{ id: 'trig_1', token: 'old', name: 'Nightly' }];
    const after = upsertRoutine(before, { id: 'trig_1', token: 'new' });
    expect(after).toHaveLength(1);
    expect(after[0].token).toBe('new');
  });

  it('leaves other routines untouched', () => {
    const before = [{ id: 'trig_1', token: 'a' }, { id: 'trig_2', token: 'b' }];
    const after = upsertRoutine(before, { id: 'trig_2', token: 'b2' });
    expect(after.find(r => r.id === 'trig_1')?.token).toBe('a');
    expect(after.find(r => r.id === 'trig_2')?.token).toBe('b2');
  });
});

describe('routineInputSchema', () => {
  it('requires both an id and a token', () => {
    expect(routineInputSchema.safeParse({ id: 'trig_1' }).success).toBe(false);
    expect(routineInputSchema.safeParse({ token: 'sk' }).success).toBe(false);
    expect(routineInputSchema.safeParse({ id: '', token: 'sk' }).success).toBe(false);
    expect(routineInputSchema.safeParse({ id: 'trig_1', token: '' }).success).toBe(false);
    expect(routineInputSchema.safeParse({ id: 'trig_1', token: 'sk' }).success).toBe(true);
  });

  it('treats the name as optional', () => {
    const parsed = routineInputSchema.parse({ id: 'trig_1', token: 'sk' });
    expect(parsed.name).toBeUndefined();
  });
});
