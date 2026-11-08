import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * ADR 0004: independent runs, the overlap rule, retries and catch-up.
 *
 * The executor is mocked, so each test controls exactly when a run ends and how
 * it went. What is under test is the scheduler's bookkeeping, not the job.
 */

const db = vi.hoisted(() => ({
  task: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  executionLog: { create: vi.fn() }
}));
vi.mock('../../db.js', () => ({ prisma: db }));
vi.mock('../../ws/uiChannel.js', () => ({ notifyTasksChanged: vi.fn() }));
vi.mock('../FailureNotificationService.js', () => ({ queueRunNotification: vi.fn() }));
vi.mock('../taskSecrets.js', () => ({
  readTaskSecrets: vi.fn(async () => ({})),
  TaskSecretDecryptError: class extends Error {}
}));
vi.mock('../NativeTaskExecutor.js', () => ({ executeJob: vi.fn() }));

import { NativeScheduler, MISSED_RUN_GRACE_MS } from '../NativeScheduler.js';
import { executeJob } from '../NativeTaskExecutor.js';
import { queueRunNotification } from '../FailureNotificationService.js';

const now = new Date('2026-11-06T12:00:00Z');
const task = (id: string, job: Record<string, unknown>, nextRunTime = now) => ({
  id,
  name: id,
  userId: 'u1',
  schedule: '0 * * * *',
  status: 'ACTIVE',
  nextRunTime,
  metadata: { job }
});
const ok = { success: true, ran: true, log: 'ok', durationMs: 1 };
const failed = { success: false, ran: true, log: 'exit 1', durationMs: 1 };
const logs = () => db.executionLog.create.mock.calls.map(c => c[0].data.log as string);

let scheduler: NativeScheduler;
beforeEach(() => {
  vi.clearAllMocks();
  scheduler = new NativeScheduler();
  scheduler.sleep = async () => {};
  db.task.update.mockResolvedValue({});
  db.executionLog.create.mockImplementation(async () => ({ id: 'e', triggeredAt: now }));
});

describe('NativeScheduler (ADR 0004)', () => {
  it('starts every due task without waiting for the others', async () => {
    let finishSlow!: () => void;
    vi.mocked(executeJob).mockImplementation(async job =>
      (job as any).url === 'slow' ? new Promise(r => { finishSlow = () => r(ok as any); }) : (ok as any)
    );
    db.task.findMany.mockResolvedValue([
      task('slow', { jobType: 'HTTP', url: 'slow' }),
      task('fast', { jobType: 'HTTP', url: 'fast' })
    ]);

    await scheduler.tick(now);
    await vi.waitFor(() => expect(logs()).toEqual(['[scheduled] ok'])); // fast finished, slow still going
    expect(scheduler.isRunning('slow')).toBe(true);

    finishSlow();
    await scheduler.idle();
    expect(logs()).toHaveLength(2);
    expect(scheduler.isRunning('slow')).toBe(false);
  });

  it('records when a run started, not when its row was written', async () => {
    let startedAt = 0;
    vi.mocked(executeJob).mockImplementation(async () => {
      startedAt = Date.now();
      await new Promise(r => setTimeout(r, 50));
      return ok as any;
    });
    db.task.findMany.mockResolvedValue([task('t', { jobType: 'HTTP', url: 'x' })]);

    await scheduler.tick(now);
    await scheduler.idle();
    const at = (db.executionLog.create.mock.calls[0][0].data.triggeredAt as Date).getTime();
    expect(at).toBeLessThanOrEqual(startedAt);
    expect(startedAt - at).toBeLessThan(50);
  });

  it('skips a run that comes due while the last is still going, by default', async () => {
    let finish!: () => void;
    vi.mocked(executeJob).mockImplementation(() => new Promise(r => { finish = () => r(ok as any); }));
    db.task.findMany.mockResolvedValue([task('t', { jobType: 'HTTP', url: 'x' })]);

    await scheduler.tick(now);
    await scheduler.tick(now);
    finish();
    await scheduler.idle();
    expect(executeJob).toHaveBeenCalledTimes(1);
  });

  it('queues exactly one run behind a running one when the policy says queue', async () => {
    const t = task('t', { jobType: 'HTTP', url: 'x', policy: { overlap: 'queue' } });
    const finishers: Array<() => void> = [];
    vi.mocked(executeJob).mockImplementation(() => new Promise(r => finishers.push(() => r(ok as any))));
    db.task.findMany.mockResolvedValue([t]);
    db.task.findUnique.mockResolvedValue(t);

    await scheduler.tick(now);
    await scheduler.tick(now);
    await scheduler.tick(now); // a third due time while running: still only one queued
    finishers[0]();
    await vi.waitFor(() => expect(finishers).toHaveLength(2));
    finishers[1]();
    await scheduler.idle();
    expect(executeJob).toHaveBeenCalledTimes(2);
    expect(logs()).toEqual(['[scheduled] ok', '[queued] ok']);
  });

  it('retries a run that ran and failed, and notifies only on the last attempt', async () => {
    vi.mocked(executeJob)
      .mockResolvedValueOnce(failed as any)
      .mockResolvedValueOnce(failed as any)
      .mockResolvedValueOnce(ok as any);
    db.task.findMany.mockResolvedValue([task('t', { jobType: 'EXEC', executable: 'x', policy: { retries: 3 } })]);

    await scheduler.tick(now);
    await scheduler.idle();
    expect(logs()).toEqual([
      '[scheduled · attempt 1 of 4] exit 1',
      '[scheduled · attempt 2 of 4] exit 1',
      '[scheduled · attempt 3 of 4] ok'
    ]);
    expect(queueRunNotification).toHaveBeenCalledTimes(1);
    expect(vi.mocked(queueRunNotification).mock.calls[0][0].status).toBe('SUCCESS');
  });

  it('does not retry a run that could not start, or a check', async () => {
    vi.mocked(executeJob).mockResolvedValue({ success: false, ran: false, log: 'missing secret', durationMs: 0 } as any);
    db.task.findMany.mockResolvedValue([
      task('nostart', { jobType: 'EXEC', executable: 'x', policy: { retries: 2 } }),
      // A row stored before validateJob refused retries on a check.
      task('check', { jobType: 'CHECK', probe: { kind: 'tcp' }, policy: { retries: 2 } })
    ]);
    await scheduler.tick(now);
    await scheduler.idle();
    expect(executeJob).toHaveBeenCalledTimes(2);
  });

  it('skips a missed run unless the task asks to catch up, and catches up once', async () => {
    vi.mocked(executeJob).mockResolvedValue(ok as any);
    const late = new Date(now.getTime() - MISSED_RUN_GRACE_MS - 7 * 24 * 3_600_000); // a week down
    db.task.findMany.mockResolvedValue([
      task('plain', { jobType: 'HTTP', url: 'x' }, late),
      task('catchup', { jobType: 'HTTP', url: 'x', policy: { catchUp: true } }, late)
    ]);
    await scheduler.tick(now);
    await scheduler.idle();
    expect(logs()).toEqual(['[catch-up] ok']);
    // Advanced from now, so the next tick finds nothing more to catch up.
    expect(db.task.update.mock.calls.map(c => c[0].data.nextRunTime.getTime() > now.getTime())).toEqual([true, true]);
  });

  it('refuses a claim on a task that is already running, and frees it on release', async () => {
    expect(scheduler.claim('t')).toBe(true);
    expect(scheduler.claim('t')).toBe(false);
    await scheduler.release('t');
    expect(scheduler.claim('t')).toBe(true);
  });
});

describe('run after another task', () => {
  const a = task('a', { jobType: 'HTTP', url: 'a' });
  const dep = (id: string, when: string) => task(id, { jobType: 'HTTP', url: id, policy: { runAfter: { taskId: 'a', when } } }, null as any);

  it('starts the dependents whose condition the outcome meets, and only them', async () => {
    vi.mocked(executeJob).mockResolvedValue(failed as any);
    db.task.findMany
      .mockResolvedValueOnce([a]) // the tick's due list
      .mockResolvedValueOnce([dep('onSuccess', 'success'), dep('onFailure', 'failure'), dep('always', 'always')])
      .mockResolvedValue([]); // the dependents have no dependents of their own
    await scheduler.tick(now);
    await scheduler.idle();
    expect(logs()).toEqual(['[scheduled] exit 1', '[after "a"] exit 1', '[after "a"] exit 1']);
    expect(vi.mocked(executeJob).mock.calls.map(c => (c[0] as any).url)).toEqual(['a', 'onFailure', 'always']);
  });

  it('moves on the final verdict, not on a failed attempt a retry fixed', async () => {
    vi.mocked(executeJob).mockResolvedValueOnce(failed as any).mockResolvedValue(ok as any);
    db.task.findMany
      .mockResolvedValueOnce([task('a', { jobType: 'HTTP', url: 'a', policy: { retries: 1 } })])
      .mockResolvedValueOnce([dep('onFailure', 'failure'), dep('onSuccess', 'success')])
      .mockResolvedValue([]);
    await scheduler.tick(now);
    await scheduler.idle();
    expect(vi.mocked(executeJob).mock.calls.map(c => (c[0] as any).url)).toEqual(['a', 'a', 'onSuccess']);
  });
});
