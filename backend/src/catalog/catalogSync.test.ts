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

function fakeSource(list: unknown[]): TemplateCatalogSource {
  return {
    name: 'fake',
    listRaw: async () => list as never,
    list: async () => list as never
  };
}

describe('syncCatalogToDb', () => {
  beforeEach(() => vi.clearAllMocks());

  it('ensures the catalog owner and upserts every template by id', async () => {
    const templates = [
      { id: 'tpl_a', name: 'A', scriptType: 'POWERSHELL' },
      { id: 'tpl_b', name: 'B', scriptType: 'BASH' }
    ];
    const res = await syncCatalogToDb(fakeSource(templates));

    expect(res).toEqual({ count: 2, source: 'fake' });
    expect(mockPrisma.user.upsert).toHaveBeenCalledTimes(1);
    expect(mockPrisma.template.upsert).toHaveBeenCalledTimes(2);

    const first = mockPrisma.template.upsert.mock.calls[0][0];
    expect(first.where).toEqual({ id: 'tpl_a' });
    // The update branch carries the template data minus the id — this is exactly
    // how a registry change propagates to an existing row (no reseed needed).
    expect(first.update).toEqual({ name: 'A', scriptType: 'POWERSHELL' });
    expect(first.create).toMatchObject({
      id: 'tpl_a',
      name: 'A',
      user: { connect: { id: CATALOG_OWNER_ID } }
    });
  });

  it('handles an empty catalog and reports the source name', async () => {
    const res = await syncCatalogToDb(fakeSource([]));
    expect(res).toEqual({ count: 0, source: 'fake' });
    expect(mockPrisma.template.upsert).not.toHaveBeenCalled();
  });
});
