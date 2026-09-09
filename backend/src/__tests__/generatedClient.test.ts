import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * Guards the stale-generated-client failure mode (troubleshooting #22).
 *
 * The bug it exists for shipped silently for nine days: the compose stack shadows
 * `node_modules` with an anonymous volume, so a host `prisma generate` never
 * reaches the container. `prisma migrate` still updated the DB enum, so the
 * database gained `MISSING` while the container's client didn't — and Prisma
 * treats an `undefined` value in `data` as "leave this field alone", so the write
 * was dropped while `updateMany` still returned a count.
 *
 * Note what could NOT have caught this: the unit suites mock `@prisma/client`, so
 * `TaskStatus.MISSING` was whatever the mock defined. The check therefore has to
 * assert against the *really generated* client, which the first test does.
 */
describe('generated Prisma client', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('@prisma/client');
  });

  it('is current — every TaskStatus member the code writes exists', async () => {
    // No mock: this asserts against the real generated client, so it fails if
    // someone changes the schema and forgets to regenerate.
    const { missingTaskStatusMembers } = await import('../db.js');
    expect(missingTaskStatusMembers()).toEqual([]);
  });

  it('names the members absent from a stale client', async () => {
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {},
      // A client generated before the 2026-07-16 MISSING migration.
      TaskStatus: { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED', UNKNOWN: 'UNKNOWN', DELETED: 'DELETED' }
    }));
    vi.resetModules();

    const { missingTaskStatusMembers } = await import('../db.js');
    expect(missingTaskStatusMembers()).toEqual(['MISSING']);
  });

  it('warns loudly at boot, naming the value and the fix, without throwing', async () => {
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {},
      TaskStatus: { ACTIVE: 'ACTIVE', DISABLED: 'DISABLED', UNKNOWN: 'UNKNOWN', DELETED: 'DELETED' }
    }));
    vi.resetModules();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { warnOnStaleGeneratedClient } = await import('../db.js');
    // Non-fatal on purpose: a stale enum breaks the features that write it, not
    // the whole app. The honest refusal lives at the write site instead.
    expect(() => warnOnStaleGeneratedClient()).not.toThrow();

    const output = err.mock.calls.flat().join(' ');
    expect(output).toContain('MISSING');
    expect(output).toContain('prisma generate');
    expect(output).toMatch(/SILENTLY DROPPED/i);
    err.mockRestore();
  });

  it('stays silent when the client is current', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { warnOnStaleGeneratedClient } = await import('../db.js');

    warnOnStaleGeneratedClient();

    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
