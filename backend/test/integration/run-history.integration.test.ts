import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus, ExecutionStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

const DAY = 86400000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

async function createTask(userId: string, name: string, platform = PlatformType.WINDOWS_TASK_SCHEDULER) {
  return prisma.task.create({
    data: {
      userId,
      platform,
      externalId: `\\Work\\${name}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: 'Work',
      schedule: '0 9 * * *',
      status: TaskStatus.ACTIVE,
      metadata: {}
    }
  });
}

async function log(taskId: string, status: ExecutionStatus, when: Date, extra: { log?: string; durationMs?: number } = {}) {
  return prisma.executionLog.create({
    data: { taskId, status, triggeredAt: when, durationMs: extra.durationMs ?? 100, log: extra.log ?? 'ok' }
  });
}

describe('cross-task run history', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('history-owner@example.com');
  });

  it('401s when unauthenticated', async () => {
    const res = await request(app).get('/api/tools/history');
    expect(res.status).toBe(401);
  });

  // ExecutionLog has no userId — ownership exists only through the task
  // relation, so a missing join filter leaks every user's run history.
  it("never returns another user's runs", async () => {
    const other = await createUser('history-other@example.com');
    const mine = await createTask(owner.user.id, 'Mine');
    const theirs = await createTask(other.user.id, 'Theirs');
    await log(mine.id, ExecutionStatus.SUCCESS, daysAgo(1));
    await log(theirs.id, ExecutionStatus.FAILURE, daysAgo(1));

    const res = await request(app).get('/api/tools/history').set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.body.rows).toHaveLength(1);
    expect(res.body.rows[0].taskName).toBe('Mine');
    // The count is computed separately from the rows — it must be scoped too.
    expect(res.body.matched.runs).toBe(1);
  });

  it('defaults to the last 30 days and filters by an explicit range', async () => {
    const task = await createTask(owner.user.id, 'Ranged');
    await log(task.id, ExecutionStatus.SUCCESS, daysAgo(2));
    await log(task.id, ExecutionStatus.SUCCESS, daysAgo(60));

    const def = await request(app).get('/api/tools/history').set('Authorization', owner.auth);
    expect(def.body.matched.runs).toBe(1);

    const wide = await request(app)
      .get('/api/tools/history')
      .query({ from: daysAgo(90).toISOString() })
      .set('Authorization', owner.auth);
    expect(wide.body.matched.runs).toBe(2);
  });

  it('filters by status, accepting a comma-separated list', async () => {
    const task = await createTask(owner.user.id, 'Mixed');
    await log(task.id, ExecutionStatus.SUCCESS, daysAgo(1));
    await log(task.id, ExecutionStatus.FAILURE, daysAgo(2));
    await log(task.id, ExecutionStatus.TIMEOUT, daysAgo(3));

    const res = await request(app)
      .get('/api/tools/history')
      .query({ status: 'FAILURE,TIMEOUT' })
      .set('Authorization', owner.auth);

    expect(res.body.matched.runs).toBe(2);
    expect(res.body.rows.map((r: { status: string }) => r.status).sort()).toEqual(['FAILURE', 'TIMEOUT']);
  });

  // The count answers "what would the export contain", so it must describe the
  // whole filtered set — not the page. Getting this wrong understates the
  // number exactly on the large export where it matters.
  it('counts the whole match even when the returned rows are capped', async () => {
    const task = await createTask(owner.user.id, 'Many');
    for (let i = 1; i <= 5; i++) await log(task.id, ExecutionStatus.SUCCESS, daysAgo(i));

    const res = await request(app)
      .get('/api/tools/history')
      .query({ limit: 2 })
      .set('Authorization', owner.auth);

    expect(res.body.rows).toHaveLength(2);
    expect(res.body.returned.runs).toBe(2);
    expect(res.body.matched.runs).toBe(5);
    expect(res.body.truncated).toBe(true);
  });

  it('400s a range that ends before it starts', async () => {
    const res = await request(app)
      .get('/api/tools/history')
      .query({ from: new Date().toISOString(), to: daysAgo(5).toISOString() })
      .set('Authorization', owner.auth);
    expect(res.status).toBe(400);
  });

  describe('CSV', () => {
    it('serves a downloadable UTF-8 CSV with the counts in a header', async () => {
      const task = await createTask(owner.user.id, 'Exported');
      await log(task.id, ExecutionStatus.FAILURE, daysAgo(1), { log: 'boom' });

      const res = await request(app)
        .get('/api/tools/history')
        .query({ format: 'csv' })
        .set('Authorization', owner.auth)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/cronsole-run-history.*\.csv/);
      expect(JSON.parse(res.headers['x-cronsole-history-counts']).runs).toBe(1);

      const body = res.body as Buffer;
      // UTF-8 BOM, so Excel does not decode non-ASCII names as ANSI.
      expect([...body.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      const text = body.subarray(3).toString('utf8');
      expect(text.split('\r\n')[0]).toContain('triggeredAt,taskName');
      expect(text).toContain('Exported');
      expect(text).toContain('manual-trigger');
    });

    // Cronsole stores command lines, so an export is attacker-influenceable text
    // that is already about running things. Without neutralization this file is
    // a payload that fires when someone opens it in Excel.
    it('neutralizes a task name that a spreadsheet would execute', async () => {
      const task = await prisma.task.create({
        data: {
          userId: owner.user.id,
          platform: PlatformType.TASKHUB_NATIVE,
          externalId: `native_${Math.random().toString(36).slice(2, 8)}`,
          name: "=cmd|'/c calc'!A1",
          category: 'Work',
          status: TaskStatus.ACTIVE,
          metadata: {}
        }
      });
      await log(task.id, ExecutionStatus.SUCCESS, daysAgo(1));

      const res = await request(app)
        .get('/api/tools/history')
        .query({ format: 'csv' })
        .set('Authorization', owner.auth)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });

      const text = (res.body as Buffer).toString('utf8');
      expect(text).toContain("'=cmd|'/c calc'!A1");
      // And never the live form at the start of a field.
      expect(text).not.toMatch(/(^|,)=cmd/m);
    });
  });
});

describe('task health', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('health-owner@example.com');
  });

  it('401s when unauthenticated', async () => {
    expect((await request(app).get('/api/tools/task-health')).status).toBe(401);
  });

  it("scores only the caller's tasks", async () => {
    const other = await createUser('health-other@example.com');
    await createTask(owner.user.id, 'Mine');
    await createTask(other.user.id, 'Theirs');

    const res = await request(app).get('/api/tools/task-health').set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].name).toBe('Mine');
  });

  // The whole feature's premise: an unmeasured task is not a healthy one.
  it('scores a Windows task with no run evidence as unknown, not ok', async () => {
    await createTask(owner.user.id, 'Unmeasured');

    const res = await request(app).get('/api/tools/task-health').set('Authorization', owner.auth);
    const health = res.body.tasks[0];

    expect(health.tier).toBe('unknown');
    expect(health.score).toBeNull();
    expect(res.body.counts).toMatchObject({ tasks: 1, unknown: 1, ok: 0 });
  });

  it('reports a failing native task as critical, with its evidence attached', async () => {
    const task = await createTask(owner.user.id, 'Broken', PlatformType.TASKHUB_NATIVE);
    await log(task.id, ExecutionStatus.FAILURE, daysAgo(1), { log: 'connection refused' });

    const res = await request(app).get('/api/tools/task-health').set('Authorization', owner.auth);
    const health = res.body.tasks[0];

    expect(health.tier).toBe('critical');
    expect(health.signals.map((s: { code: string }) => s.code)).toContain('recent-failure');
    // Every signal ships with the source it was derived from — a claim without
    // its evidence is the thing this feature exists not to be.
    for (const signal of health.signals) expect(signal.evidence).toBeTruthy();
  });

  it('ranks the worst task first', async () => {
    const broken = await createTask(owner.user.id, 'Broken', PlatformType.TASKHUB_NATIVE);
    const fine = await createTask(owner.user.id, 'Fine', PlatformType.TASKHUB_NATIVE);
    await log(broken.id, ExecutionStatus.FAILURE, daysAgo(1));
    await log(fine.id, ExecutionStatus.SUCCESS, daysAgo(1));

    const res = await request(app).get('/api/tools/task-health').set('Authorization', owner.auth);
    expect(res.body.tasks[0].name).toBe('Broken');
  });

  /**
   * Troubleshooting #49. These filters live on the route rather than in a caller
   * precisely because the route also computes `counts` — so the invariant under
   * test is not "the filter works" but **"the summary and the list describe the
   * same population"**.
   */
  describe('filters (and the counts that must agree with them)', () => {
    const systemTask = (userId: string, name: string) =>
      prisma.task.create({
        data: {
          userId,
          platform: PlatformType.WINDOWS_TASK_SCHEDULER,
          externalId: `\\Microsoft\\Windows\\${name}`,
          name,
          category: 'Microsoft',
          schedule: '0 9 * * *',
          status: TaskStatus.ACTIVE,
          metadata: {}
        }
      });

    it('defaults to every task, because the dashboard tier map passes no params', async () => {
      await createTask(owner.user.id, 'Mine');
      await systemTask(owner.user.id, 'TheirsSystem');

      const res = await request(app).get('/api/tools/task-health').set('Authorization', owner.auth);

      expect(res.body.counts.tasks).toBe(2);
      expect(res.body.tasks).toHaveLength(2);
      expect(res.body.scope).toMatchObject({ includeSystem: true, systemExcluded: 0 });
    });

    // The regression test for #49 itself.
    it('counts the same population it lists when the system lens is applied', async () => {
      await createTask(owner.user.id, 'Mine');
      await systemTask(owner.user.id, 'TheirsSystem');

      const res = await request(app)
        .get('/api/tools/task-health?includeSystem=false')
        .set('Authorization', owner.auth);

      expect(res.body.counts.tasks).toBe(1);
      expect(res.body.matched).toBe(1);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.tasks[0].name).toBe('Mine');
      // Hidden, but never silently: 257 of these on a real machine.
      expect(res.body.scope).toMatchObject({ includeSystem: false, systemExcluded: 1 });
    });

    it('counts tiers BEFORE the tier filter, or the breakdown says nothing', async () => {
      // Counted after `tier`, this would report `critical: 1` and zeros for
      // everything else — a breakdown that only ever describes what you asked
      // for is not a breakdown.
      const broken = await createTask(owner.user.id, 'Broken', PlatformType.TASKHUB_NATIVE);
      await log(broken.id, ExecutionStatus.FAILURE, daysAgo(1));
      await createTask(owner.user.id, 'Unmeasured');

      const res = await request(app)
        .get('/api/tools/task-health?tier=critical')
        .set('Authorization', owner.auth);

      expect(res.body.matched).toBe(1);
      expect(res.body.tasks[0].name).toBe('Broken');
      expect(res.body.counts).toMatchObject({ tasks: 2, critical: 1, unknown: 1 });
      expect(res.body.scope.tier).toBe('critical');
    });

    it('limit caps the rows returned without rewriting what matched', async () => {
      const a = await createTask(owner.user.id, 'BrokenA', PlatformType.TASKHUB_NATIVE);
      const b = await createTask(owner.user.id, 'BrokenB', PlatformType.TASKHUB_NATIVE);
      await log(a.id, ExecutionStatus.FAILURE, daysAgo(1));
      await log(b.id, ExecutionStatus.FAILURE, daysAgo(1));

      const res = await request(app)
        .get('/api/tools/task-health?limit=1')
        .set('Authorization', owner.auth);

      expect(res.body.returned).toBe(1);
      expect(res.body.tasks).toHaveLength(1);
      expect(res.body.matched).toBe(2);
      expect(res.body.counts.tasks).toBe(2);
    });

    // A typo'd lens must not silently widen the population.
    it('400s on a malformed includeSystem rather than guessing', async () => {
      const res = await request(app)
        .get('/api/tools/task-health?includeSystem=fasle')
        .set('Authorization', owner.auth);

      expect(res.status).toBe(400);
    });
  });
});
