import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { upsert: vi.fn() },
    template: { upsert: vi.fn(), findMany: vi.fn() }
  }
}));

// Same mock shape as catalogSync.test.ts: db.ts's `new PrismaClient()` returns
// our spy, and the enum objects normalize.ts reads resolve to their key strings.
vi.mock('@prisma/client', () => {
  const enumProxy = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? k : undefined) });
  return {
    PrismaClient: class {
      constructor() {
        return mockPrisma as unknown as object;
      }
    },
    PlatformType: enumProxy,
    ScriptType: enumProxy,
    OsTarget: enumProxy,
    TemplateCategory: enumProxy,
    Prisma: {}
  };
});

import { importTemplates, extractTemplateCandidates } from './importCatalog.js';

const validTemplate = () => ({
  schemaVersion: '1.0',
  id: 'tpl_import_a',
  name: 'Imported A',
  trigger: { kind: 'schedule', cron: '0 9 * * *' },
  runtime: 'powershell',
  os: 'windows',
  category: 'monitoring',
  commandTemplate: 'powershell.exe -NoProfile -Command {{command}}',
  parameters: [{ key: 'command', label: 'Command', type: 'text', required: true }],
  compatibleTargets: ['windows']
});

describe('extractTemplateCandidates', () => {
  it('accepts a bundle envelope, a bare array, and a single object', () => {
    const t = validTemplate();
    expect(extractTemplateCandidates({ templates: [t, t] })).toHaveLength(2);
    expect(extractTemplateCandidates([t])).toHaveLength(1);
    expect(extractTemplateCandidates(t)).toHaveLength(1);
  });

  it('returns nothing for a non-object payload', () => {
    expect(extractTemplateCandidates(null)).toEqual([]);
    expect(extractTemplateCandidates('nope')).toEqual([]);
    expect(extractTemplateCandidates(42)).toEqual([]);
  });
});

describe('importTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.template.findMany.mockResolvedValue([]); // no existing rows by default
  });

  it('creates a new template (no existing row) and ensures the catalog owner', async () => {
    const res = await importTemplates(validTemplate());

    expect(res.created).toEqual(['tpl_import_a']);
    expect(res.updated).toEqual([]);
    expect(res.errors).toEqual([]);
    expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(1);
    const call = mockPrisma.template.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'tpl_import_a' });
    expect(call.create).toMatchObject({ id: 'tpl_import_a', user: { connect: { id: 'cli_user_placeholder' } } });
  });

  it('classifies an existing template as updated', async () => {
    mockPrisma.template.findMany.mockResolvedValue([{ id: 'tpl_import_a' }]);
    const res = await importTemplates([validTemplate()]);
    expect(res.updated).toEqual(['tpl_import_a']);
    expect(res.created).toEqual([]);
  });

  it('reports a schema-invalid entry without upserting it', async () => {
    const res = await importTemplates({ id: 'tpl_bad', name: 'no trigger' });
    expect(res.created).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].id).toBe('tpl_bad');
    expect(res.errors[0].error).toMatch(/Schema validation failed/);
    expect(mockPrisma.template.upsert).not.toHaveBeenCalled();
  });

  it('rejects a template whose command references an undeclared placeholder', async () => {
    const bad = { ...validTemplate(), parameters: [] }; // {{command}} now undeclared
    const res = await importTemplates(bad);
    expect(res.created).toEqual([]);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].error).toMatch(/unfilled placeholder/i);
  });

  it('imports the good entries and reports the bad ones in a mixed batch', async () => {
    const good = validTemplate();
    const bad = { id: 'tpl_bad', name: 'broken' };
    const res = await importTemplates([good, bad]);
    expect(res.created).toEqual(['tpl_import_a']);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].id).toBe('tpl_bad');
    expect(res.total).toBe(2);
  });

  it('errors clearly on an empty payload', async () => {
    const res = await importTemplates({ templates: [] });
    expect(res.total).toBe(0);
    expect(res.errors[0].error).toMatch(/No templates found/);
  });
});
