import { describe, it, expect } from 'vitest';
import {
  readConfig,
  redactConfig,
  redactPreset,
  findPreset,
  presetInputSchema,
  DEFAULT_GEMINI_AGENT
} from '../geminiTriggers.js';

/**
 * **The preset store, and the one thing it must never do.**
 *
 * This is where Cronsole started holding a credential it hands to another
 * platform, so the tests that matter are the ones about what comes back out. The
 * rule is not "headers are filtered from responses" — it is that
 * `redactPreset` is the only shape that leaves, and it has no field that could
 * carry one.
 */
describe('reading the stored preset list', () => {
  it('keeps a well-formed preset with its credential', () => {
    const config = readConfig({
      apiKey: 'AIza-x',
      toolPresets: [{ name: 'resend', url: 'https://mcp.resend.com/mcp', headers: { Authorization: 'Bearer re_x' } }]
    });
    expect(config.toolPresets).toEqual([
      { name: 'resend', url: 'https://mcp.resend.com/mcp', headers: { Authorization: 'Bearer re_x' } }
    ]);
  });

  it('is absent rather than empty on a connection that has none', () => {
    // **Not `toolPresets: []`.** A connection that never used a preset must
    // serialize byte-identically to what it did before this feature existed —
    // the same reason `reachPayload` omits an empty key rather than sending one.
    expect(readConfig({ apiKey: 'AIza-x' }).toolPresets).toBeUndefined();
  });

  it('drops an entry with no name or no URL instead of failing the whole read', () => {
    // Tolerant for the reason every other field here is: this parses a blob
    // written by another build, and one malformed entry must not take the
    // connection — and with it the API key and the agent — down with it.
    const config = readConfig({
      toolPresets: [
        { name: 'good', url: 'https://e.com/mcp' },
        { name: '', url: 'https://e.com/other' },
        { name: 'nourl' },
        'not an object'
      ]
    });
    expect(config.toolPresets?.map(p => p.name)).toEqual(['good']);
  });

  it('still returns the agent default when the preset list is garbage', () => {
    expect(readConfig({ toolPresets: 'nonsense' }).agent).toBe(DEFAULT_GEMINI_AGENT);
  });
});

describe('what leaves the server', () => {
  it('reports that a credential exists and never what it is', () => {
    const redacted = redactPreset({
      name: 'resend',
      url: 'https://mcp.resend.com/mcp',
      headers: { Authorization: 'Bearer re_secret_value' }
    });

    expect(redacted).toEqual({ name: 'resend', url: 'https://mcp.resend.com/mcp', hasHeaders: true });
    // At any depth, in any field. The assertion is over the serialized shape
    // rather than over named keys, because the failure this guards against is a
    // future field carrying the value somewhere nobody thought to look.
    expect(JSON.stringify(redacted)).not.toContain('re_secret_value');
    expect(JSON.stringify(redacted)).not.toContain('Bearer');
  });

  it('distinguishes a preset with no credential from one with a hidden one', () => {
    // An MCP server needing no auth is legitimate, and rendering it identically
    // to one whose token is merely unshowable would make "is this configured?"
    // unanswerable on screen.
    expect(redactPreset({ name: 'open', url: 'https://e.com/mcp' }).hasHeaders).toBe(false);
  });

  it('redacts every preset on the way through the config', () => {
    const out = redactConfig({
      apiKey: 'AIzaSyTOPSECRET',
      toolPresets: [
        { name: 'a', url: 'https://a.com/mcp', headers: { Authorization: 'Bearer aaa' } },
        { name: 'b', url: 'https://b.com/mcp' }
      ]
    });
    expect(out.presets).toEqual([
      { name: 'a', url: 'https://a.com/mcp', hasHeaders: true },
      { name: 'b', url: 'https://b.com/mcp', hasHeaders: false }
    ]);
    expect(JSON.stringify(out)).not.toContain('Bearer aaa');
    // The key is a hint, never the value — the rule that was already here.
    expect(JSON.stringify(out)).not.toContain('AIzaSyTOPSECRET');
  });
});

describe('finding a preset by name', () => {
  const config = {
    toolPresets: [{ name: 'Resend', url: 'https://mcp.resend.com/mcp' }]
  };

  it('matches regardless of case', () => {
    // The name is typed twice — once when saved, once when referenced by a
    // create — so a capital would otherwise fail a create with "no such preset"
    // over a name plainly visible on the screen beside it.
    expect(findPreset(config, 'resend')?.url).toBe('https://mcp.resend.com/mcp');
    expect(findPreset(config, 'RESEND')?.url).toBe('https://mcp.resend.com/mcp');
    expect(findPreset(config, '  Resend  ')?.url).toBe('https://mcp.resend.com/mcp');
  });

  it('returns nothing for a name that is not stored', () => {
    expect(findPreset(config, 'nope')).toBeUndefined();
  });
});

describe('the write schema', () => {
  it('refuses a name that cannot be typed back reliably', () => {
    // Same shape as a TaskSecret name and for the same reason: this is a
    // reference matched later, so spaces and punctuation turn a typo into
    // something that looks like a broken lookup.
    expect(presetInputSchema.safeParse({ name: 'my server', url: 'https://e.com/mcp' }).success).toBe(false);
    expect(presetInputSchema.safeParse({ name: 'my-server_2', url: 'https://e.com/mcp' }).success).toBe(true);
  });

  it('refuses a URL that is not one', () => {
    expect(presetInputSchema.safeParse({ name: 'x', url: 'mcp.resend.com' }).success).toBe(false);
  });

  it('accepts an absent headers map, which means keep what is stored', () => {
    const parsed = presetInputSchema.safeParse({ name: 'x', url: 'https://e.com/mcp' });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.headers).toBeUndefined();
  });

  it('accepts an explicitly empty headers map, which means clear it', () => {
    // Absent and `{}` must stay distinguishable: one is "I am editing the URL",
    // the other is "this server no longer needs a credential". Collapsing them
    // would make removing a token impossible without deleting the preset.
    const parsed = presetInputSchema.safeParse({ name: 'x', url: 'https://e.com/mcp', headers: {} });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.headers).toEqual({});
  });
});
