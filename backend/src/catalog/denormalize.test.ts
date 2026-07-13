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
});
