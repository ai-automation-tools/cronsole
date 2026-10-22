import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus, ExecutionStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

const DAY = 86400000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

async function createTask(
  userId: string,
  name: string,
  overrides: {
    platform?: PlatformType;
    externalId?: string;
    status?: TaskStatus;
    schedule?: string | null;
    metadata?: object;
  } = {}
) {
  return prisma.task.create({
    data: {
      userId,
      platform: overrides.platform ?? PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: overrides.externalId ?? `\\Work\\${name}_${Math.random().toString(36).slice(2, 8)}`,
      name,
      category: 'Work',
      schedule: overrides.schedule === undefined ? '0 9 * * *' : overrides.schedule,
      status: overrides.status ?? TaskStatus.ACTIVE,
      metadata: overrides.metadata ?? {}
    }
  });
}

const log = (taskId: string, status: ExecutionStatus, when: Date, durationMs = 100) =>
  prisma.executionLog.create({ data: { taskId, status, triggeredAt: when, durationMs, log: 'ok' } });

describe('execution analytics', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('analytics-owner@example.com');
  });

  it('401s when unauthenticated', async () => {
    const res = await request(app).get('/api/tools/analytics');
    expect(res.status).toBe(401);
  });

  // ExecutionLog has no userId — ownership exists only through the task
  // relation, and this route reads it four different ways.
  it("never counts another user's runs or lists their tasks", async () => {
    const other = await createUser('analytics-other@example.com');
    const mine = await createTask(owner.user.id, 'Mine');
    const theirs = await createTask(other.user.id, 'Theirs', {
      metadata: { lastRunTime: daysAgo(400).toISOString() }
    });
    await log(mine.id, ExecutionStatus.SUCCESS, daysAgo(1));
    await log(theirs.id, ExecutionStatus.FAILURE, daysAgo(1));

    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.body.totals.runs).toBe(1);
    expect(res.body.totals.failed).toBe(0);
    expect([...res.body.idle.tasks, ...res.body.idle.unassessed].map((t: { name: string }) => t.name))
      .not.toContain('Theirs');
  });

  it('buckets the trend by day and zero-fills the span', async () => {
    const task = await createTask(owner.user.id, 'Trended');
    await log(task.id, ExecutionStatus.SUCCESS, daysAgo(1));
    await log(task.id, ExecutionStatus.FAILURE, daysAgo(1));

    const res = await request(app)
      .get('/api/tools/analytics')
      .query({ days: 7, tz: 'UTC' })
      .set('Authorization', owner.auth);

    // 7 days back plus today — the empty days are present, not skipped.
    expect(res.body.trend.days.length).toBeGreaterThanOrEqual(8);
    expect(res.body.trend.partial).toBe(false);
    const busiest = res.body.trend.days.find((d: { runs: number }) => d.runs > 0);
    expect(busiest).toMatchObject({ runs: 2, succeeded: 1, failed: 1 });
    expect(res.body.totals).toMatchObject({ runs: 2, succeeded: 1, failed: 1 });
  });

  it('refuses an unknown time zone rather than silently using UTC', async () => {
    const res = await request(app)
      .get('/api/tools/analytics')
      .query({ tz: 'Mars/Olympus_Mons' })
      .set('Authorization', owner.auth);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/time zone/i);
  });

  it('reports the requested zone back, so the buckets are reproducible', async () => {
    const res = await request(app)
      .get('/api/tools/analytics')
      .query({ tz: 'America/Los_Angeles' })
      .set('Authorization', owner.auth);

    expect(res.body.window.timeZone).toBe('America/Los_Angeles');
  });

  it('measures duration only on native tasks, and counts what it dropped', async () => {
    // A Windows durationMs times the agent accepting a start, not the job.
    const windows = await createTask(owner.user.id, 'Windows job');
    const native = await createTask(owner.user.id, 'Native job', {
      platform: PlatformType.TASKHUB_NATIVE,
      externalId: `native:${Math.random().toString(36).slice(2, 8)}`
    });

    for (let i = 0; i < 5; i++) await log(windows.id, ExecutionStatus.SUCCESS, daysAgo(i + 1), 50);
    for (let i = 0; i < 5; i++) await log(native.id, ExecutionStatus.SUCCESS, daysAgo(i + 1), 4000);
    for (let i = 0; i < 5; i++) await log(native.id, ExecutionStatus.SUCCESS, daysAgo(i + 6), 1000);

    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    expect(res.body.duration.excludedManualTriggerRuns).toBe(5);
    expect(res.body.duration.tasks).toHaveLength(1);
    expect(res.body.duration.tasks[0]).toMatchObject({
      name: 'Native job',
      recentMedianMs: 4000,
      baselineMedianMs: 1000,
      changeRatio: 4
    });
  });

  it("judges a Windows task's idleness from Windows' own last-run time", async () => {
    const stale = await createTask(owner.user.id, 'Long idle', {
      metadata: { lastRunTime: daysAgo(45).toISOString() }
    });
    await createTask(owner.user.id, 'Recently run', {
      metadata: { lastRunTime: daysAgo(1).toISOString() }
    });

    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    expect(res.body.idle.tasks.map((t: { taskId: string }) => t.taskId)).toEqual([stale.id]);
    expect(res.body.idle.tasks[0].evidence).toMatch(/Windows reported a last run/);
  });

  it('looks past the trend window for the last run, so "200 days ago" is answerable', async () => {
    // The idle query is deliberately unbounded. Restricting it to the 30-day
    // window would hide the date and report the task as never-run instead.
    const task = await createTask(owner.user.id, 'Old native', {
      platform: PlatformType.TASKHUB_NATIVE,
      externalId: `native:${Math.random().toString(36).slice(2, 8)}`
    });
    await log(task.id, ExecutionStatus.SUCCESS, daysAgo(200));

    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    const idle = res.body.idle.tasks.find((t: { taskId: string }) => t.taskId === task.id);
    expect(idle).toBeDefined();
    expect(idle.daysSinceLastRun).toBe(200);
    expect(res.body.idle.unassessed.map((u: { taskId: string }) => u.taskId)).not.toContain(task.id);
  });

  it('reports a task with no run evidence as unmeasured, never as idle', async () => {
    const task = await createTask(owner.user.id, 'Old agent', { metadata: {} });

    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    expect(res.body.idle.tasks.map((t: { taskId: string }) => t.taskId)).not.toContain(task.id);
    expect(res.body.idle.unassessed.find((u: { taskId: string }) => u.taskId === task.id)).toMatchObject({
      reason: 'no-run-evidence'
    });
  });

  it('does not judge disabled or on-demand tasks for not running', async () => {
    const parked = await createTask(owner.user.id, 'Parked', {
      status: TaskStatus.DISABLED,
      metadata: { lastRunTime: daysAgo(400).toISOString() }
    });
    const onDemand = await createTask(owner.user.id, 'On demand', {
      schedule: null,
      metadata: { lastRunTime: daysAgo(400).toISOString() }
    });

    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    const reasons = new Map(
      res.body.idle.unassessed.map((u: { taskId: string; reason: string }) => [u.taskId, u.reason])
    );
    expect(reasons.get(parked.id)).toBe('disabled');
    expect(reasons.get(onDemand.id)).toBe('no-schedule');
    expect(res.body.idle.tasks).toHaveLength(0);
  });

  it('honors an explicit idle threshold', async () => {
    await createTask(owner.user.id, 'Ten days', {
      metadata: { lastRunTime: daysAgo(10).toISOString() }
    });

    const strict = await request(app)
      .get('/api/tools/analytics')
      .query({ idleDays: 7 })
      .set('Authorization', owner.auth);
    expect(strict.body.idle.thresholdDays).toBe(7);
    expect(strict.body.idle.tasks).toHaveLength(1);

    const loose = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);
    expect(loose.body.idle.tasks).toHaveLength(0);
  });

  it('states what the numbers count, in the payload rather than only in the UI', async () => {
    const res = await request(app).get('/api/tools/analytics').set('Authorization', owner.auth);

    expect(res.body.source.runs).toMatch(/Cronsole performed/);
    expect(res.body.source.idle).toMatch(/Windows tasks are judged/);
  });
});
