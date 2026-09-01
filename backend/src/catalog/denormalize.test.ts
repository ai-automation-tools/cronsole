import { describe, it, expect } from 'vitest';
import { bundledCatalog } from './bundled.js';
import { registryTemplateSchema } from './schema.js';
import { normalizeTemplate } from './normalize.js';
import { denormalizeTemplate } from './denormalize.js';

const byId = (id: string) => {
  const found = bundledCatalog.find((t) => t.id === id);
  if (!found) throw new Error(`fixture missing template ${id}`);
  return found;
};

describe('denormalizeTemplate', () => {
  it('round-trips every bundled template losslessly through the DB shape', () => {
    // The DB stores the normalized shape; export denormalizes it back to v1.
    // The guarantee that matters: normalize(denormalize(normalize(t))) is
    // identical to normalize(t) — i.e. a template exported and re-imported
    // reproduces the exact same DB row.
    for (const t of bundledCatalog) {
      const norm1 = normalizeTemplate(t);
      const back = denormalizeTemplate(norm1);

      const parsed = registryTemplateSchema.safeParse(back);
      expect(parsed.success, `${t.id} denormalized to invalid v1: ` +
        (parsed.success ? '' : parsed.error.message)).toBe(true);

      const norm2 = normalizeTemplate(parsed.success ? parsed.data : back);
      expect(norm2, `${t.id} did not round-trip`).toEqual(norm1);
    }
  });

  it('carries the core fields and cron across the round-trip', () => {
    const original = byId('tpl_starter_powershell_script');
    const back = denormalizeTemplate(normalizeTemplate(original));
    expect(back.schemaVersion).toBe('1.0');
    expect(back.id).toBe(original.id);
    expect(back.name).toBe(original.name);
    expect(back.trigger).toEqual(original.trigger);
    expect(back.commandTemplate).toBe(original.commandTemplate);
    expect(back.isStarter).toBe(true);
    expect(back.parameters).toEqual(original.parameters);
    expect(back.tags).toEqual(original.tags); // tags survive the DB round-trip
  });

  it('maps platforms back to at least the source compatible target', () => {
    const back = denormalizeTemplate(
      normalizeTemplate(byId('tpl_starter_powershell_script'))
    );
    expect(back.compatibleTargets).toContain('windows');
    expect(back.compatibleTargets.length).toBeGreaterThan(0);
  });

  it('throws when a row maps to no v1 compatible target', () => {
    expect(() =>
      denormalizeTemplate({
        id: 'tpl_orphan',
        name: 'Orphan',
        // JULES has no COMPAT_TARGET mapping, so nothing lowers.
        sourcePlatform: 'JULES' as never,
        targetPlatforms: ['JULES' as never],
        scheduleExpression: '0 * * * *',
        commandTemplate: 'echo hi',
        scriptType: 'BATCH' as never,
        os: 'WINDOWS' as never,
        category: 'OTHER' as never,
        isStarter: false
      })
    ).toThrow(/no platforms that map/);
  });

  /**
   * The one thing that must be true of `agentTools` at both ends: no credential
   * can travel in it.
   *
   * The parse reads `type`, `name` and `preset` and nothing else, so a template
   * authored with a `url` or a `headers` block loses them **at the boundary**
   * rather than downstream -- which is why no reader after this point (the DB
   * row, an export, an archive, an MCP tool response, a log line) is one
   * forgotten `delete` away from publishing somebody's bearer token. Stripped
   * rather than refused, because `RegistryCatalogSource` skips a template it
   * cannot parse, and a template that silently vanishes from a catalog is worse
   * than one that arrives with less reach than it asked for -- the connector
   * refuses an unresolvable server anyway, with the list.
   */
  it('drops url and headers from agentTools at the parse and at the export', () => {
    const authored = {
      ...byId('gemini-daily-email-digest'),
      agentTools: [
        {
          type: 'mcp_server',
          name: 'resend',
          preset: 'resend',
          url: 'https://mcp.example.com/sse',
          headers: { Authorization: 'Bearer super-secret' }
        }
      ]
    };

    const parsed = registryTemplateSchema.parse(authored);
    expect(parsed.agentTools).toEqual([
      { type: 'mcp_server', name: 'resend', preset: 'resend' }
    ]);

    // Same refusal on the way out, from a row hand-edited to hold the fields
    // the parse would have stripped -- enforced at both ends rather than one,
    // because export is the direction a leak would travel.
    const back = denormalizeTemplate({
      ...normalizeTemplate(parsed),
      agentTools: [
        { type: 'mcp_server', preset: 'resend', url: 'https://x', headers: { a: 'b' } }
      ]
    });
    expect(back.agentTools).toEqual([{ type: 'mcp_server', preset: 'resend' }]);
    expect(JSON.stringify(back)).not.toContain('super-secret');
    expect(JSON.stringify(back)).not.toContain('headers');
  });

  it('leaves agentTools absent for a template that grants nothing', () => {
    const back = denormalizeTemplate(
      normalizeTemplate(byId('tpl_starter_powershell_script'))
    );
    expect(back.agentTools).toBeUndefined();
  });
});
