import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: { upsert: vi.fn() },
    template: { upsert: vi.fn() }
  }
}));

// Mock the client so `db.ts`'s `new PrismaClient()` returns our spy, and the enum
// objects normalize.ts reads at load resolve to their own key strings.
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

import { syncCatalogToDb, CATALOG_OWNER_ID } from './catalogSync.js';
import type { TemplateCatalogSource } from './source.js';

// The real sources return two shapes: `listRaw()` = validated v1 templates
// (carry the `core` flag), `list()` = normalized Prisma rows (no `core`). The
// fake mirrors that so the core-only filter can be exercised.
function fakeSource(raw: unknown[], norm: unknown[]): TemplateCatalogSource {
  return {
    name: 'fake',
    listRaw: async () => raw as never,
    list: async () => norm as never
  };
}

describe('syncCatalogToDb', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensures the catalog owner and upserts every CORE template by id', async () => {
    const raw = [
      { id: 'tpl_a', core: true },
      { id: 'tpl_b', core: true }
    ];
    const norm = [
      { id: 'tpl_a', name: 'A', scriptType: 'POWERSHELL' },
      { id: 'tpl_b', name: 'B', scriptType: 'BASH' }
    ];
    const res = await syncCatalogToDb(fakeSource(raw, norm));

    expect(res).toEqual({ count: 2, source: 'fake' });
    expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.template.upsert).toHaveBeenCalledTimes(2);

    const first = mockPrisma.template.upsert.mock.calls[0][0];
    expect(first.where).toEqual({ id: 'tpl_a' });
    // The update branch carries the normalized template data minus the id — this
    // is exactly how a registry change propagates to an existing row (no reseed).
    expect(first.update).toEqual({ name: 'A', scriptType: 'POWERSHELL' });
    expect(first.create).toMatchObject({
      id: 'tpl_a',
      name: 'A',
      user: { connect: { id: CATALOG_OWNER_ID } }
    });
  });

  it('auto-syncs only core templates — extended ones are skipped', async () => {
    const raw = [
      { id: 'tpl_core', core: true },
      { id: 'tpl_ext', core: false },
      { id: 'tpl_unset' } // absent core ⇒ extended
    ];
    const norm = [
      { id: 'tpl_core', name: 'Core', scriptType: 'POWERSHELL' },
      { id: 'tpl_ext', name: 'Ext', scriptType: 'BASH' },
      { id: 'tpl_unset', name: 'Unset', scriptType: 'NODE' }
    ];
    const res = await syncCatalogToDb(fakeSource(raw, norm));

    expect(res).toEqual({ count: 1, source: 'fake' });
    expect(mockPrisma.template.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.template.upsert.mock.calls[0][0].where).toEqual({ id: 'tpl_core' });
  });

  it('handles an empty catalog and reports the source name', async () => {
    const res = await syncCatalogToDb(fakeSource([], []));
    expect(res).toEqual({ count: 0, source: 'fake' });
    expect(mockPrisma.template.upsert).not.toHaveBeenCalled();
  });
});
