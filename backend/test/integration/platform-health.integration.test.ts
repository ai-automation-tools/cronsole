import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

/**
 * `GET /api/tasks/health` is the surface the dashboard's platform dots and its
 * "synced N ago" chip are drawn from, and it used to lie twice: it reported
 * `HEALTHY` whenever a socket object existed, and stamped `lastSync: new Date()`
 * — a timestamp created by the act of asking (troubleshooting #40).
 *
 * The connector half of that is unit-tested. What only real Postgres can show is
 * the **persistence** half, which is where the remaining ways to fabricate a
 * timestamp live:
 *
 *  - the route must not write a sync time it did not perform,
 *  - it must still report a genuine one recorded earlier by `POST /sync`,
 *  - and it must clear a stale `healthReason` rather than let Prisma's
 *    `undefined`-means-leave-alone keep the last unhealthy explanation filed
 *    under a healthy state (the shape of #22).
 *
 * With no agent connected, Windows is honestly OFFLINE — which is exactly the
 * state that makes "does it invent a lastSync anyway?" answerable.
 */
async function createConnection(
  userId: string,
  platform: PlatformType,
  overrides: { lastSync?: Date | null; healthReason?: string | null } = {}
) {
  return prisma.platformConnection.create({
    data: {
      userId,
      platform,
      config: {},
      isActive: true,
      healthState: 'HEALTHY',
      lastSync: overrides.lastSync ?? null,
      healthReason: overrides.healthReason ?? null
    }
  });
}

describe('GET /api/tasks/health — status is evidence, not a clock reading', () => {
  let auth: string;
  let userId: string;

  beforeEach(async () => {
    const created = await createUser(`health_${Date.now()}@example.com`);
    auth = created.auth;
    userId = created.user.id;
  });

  it('reports OFFLINE with no lastSync when no agent has ever connected', async () => {
    await createConnection(userId, PlatformType.WINDOWS_TASK_SCHEDULER);

    const res = await request(app).get('/api/tasks/health').set('Authorization', auth);

    expect(res.status).toBe(200);
    const windows = res.body.find((p: any) => p.platform === 'WINDOWS_TASK_SCHEDULER');
    expect(windows.state).toBe('OFFLINE');
    // The whole defect in one assertion: nothing synced, so nothing is reported.
    expect(windows.lastSync).toBeUndefined();
  });

  it('does not write a sync time it did not perform', async () => {
    const conn = await createConnection(userId, PlatformType.WINDOWS_TASK_SCHEDULER);

    await request(app).get('/api/tasks/health').set('Authorization', auth);

    const after = await prisma.platformConnection.findUniqueOrThrow({ where: { id: conn.id } });
    // A health probe observes; it does not sync. Only POST /api/tasks/sync may
    // stamp this column.
    expect(after.lastSync).toBeNull();
  });

  it('reports a genuine earlier sync recorded by POST /sync', async () => {
    const synced = new Date('2026-08-11T09:30:00.000Z');
    await createConnection(userId, PlatformType.WINDOWS_TASK_SCHEDULER, { lastSync: synced });

    const res = await request(app).get('/api/tasks/health').set('Authorization', auth);

    const windows = res.body.find((p: any) => p.platform === 'WINDOWS_TASK_SCHEDULER');
    // Offline now, but a real sync did happen earlier and the dashboard should
    // say how old the truth is rather than drop the fact entirely.
    expect(windows.state).toBe('OFFLINE');
    expect(new Date(windows.lastSync)).toEqual(synced);
  });

  it('clears a stale healthReason instead of leaving it under a healthy state', async () => {
    // Native is in-process, so it reports HEALTHY with no reason — the case
    // where `undefined` would silently preserve whatever was there before.
    const conn = await createConnection(userId, PlatformType.TASKHUB_NATIVE, {
      healthReason: 'Agent connected but not responding (task:list timed out)'
    });

    const res = await request(app).get('/api/tasks/health').set('Authorization', auth);

    const native = res.body.find((p: any) => p.platform === 'TASKHUB_NATIVE');
    expect(native.state).toBe('HEALTHY');
    expect(native.reason).toBeUndefined();

    const after = await prisma.platformConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after.healthReason).toBeNull();
  });

  it('never reports a lastSync for the native platform — it has nothing to sync from', async () => {
    // This database IS its source of truth. It is also the reason fixing only
    // the Windows connector would have achieved nothing: the dashboard chip
    // takes the newest lastSync across every platform, so one connector
    // fabricating a time keeps the whole dashboard reading "just now".
    await createConnection(userId, PlatformType.TASKHUB_NATIVE);

    const res = await request(app).get('/api/tasks/health').set('Authorization', auth);

    const native = res.body.find((p: any) => p.platform === 'TASKHUB_NATIVE');
    expect(native.state).toBe('HEALTHY');
    expect(native.lastSync).toBeUndefined();
  });
});
