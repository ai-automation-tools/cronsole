import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../db.js', () => ({
  prisma: { task: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() } }
}));

import { CronsoleNativeConnector } from '../CronsoleNativeConnector.js';
import { prisma } from '../../db.js';

/**
 * **What a template applied to Cronsole-native actually stores.**
 *
 * This connector is the only write path for the template-apply and clone flows,
 * and it refused every non-URL command until 2026-08-13 — which is why the
 * catalog had no `cronsole-native` templates at all. These cases pin the thing
 * that made that refusal costly to remove: the job it writes must be a spec
 * `validateJob` accepts and `NativeTaskExecutor` can run, because for this
 * platform the stored `metadata.job` **is** the task.
 */

const create = prisma.task.create as unknown as ReturnType<typeof vi.fn>;
const connector = new CronsoleNativeConnector();
const CONFIG = { userId: 'u1' };

/** The `data` Prisma was asked to write on the most recent create. */
const written = () => create.mock.calls.at(-1)![0].data;

beforeEach(() => {
  vi.clearAllMocks();
  create.mockResolvedValue({ id: 't1' });
});

describe('CronsoleNativeConnector.createTask', () => {
  it('stores an HTTP job when the command is a URL', async () => {
    const result = await connector.createTask(
      'Ping health', '*/5 * * * *', 'https://example.com/health', CONFIG
    );

    expect(result.success).toBe(true);
    expect(result.externalId).toMatch(/^native_/);
    expect(written().metadata).toEqual({
      job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET', headers: undefined, body: undefined }
    });
  });

  it('stores an EXEC job when the command is a program — not a refusal', async () => {
    const result = await connector.createTask(
      'Nightly prune', '0 3 * * *', 'node scripts/prune.js --days 30', CONFIG
    );

    expect(result.success).toBe(true);
    expect(written().metadata.job).toMatchObject({
      jobType: 'EXEC',
      executable: 'node',
      args: ['scripts/prune.js', '--days', '30']
    });
  });

  it('keeps a structured action’s argument boundaries instead of re-tokenizing', async () => {
    // The case the whole `options.action` path exists for: a parameter value
    // with a space is ONE argument in the structured form, and two after a
    // round trip through the command line.
    await connector.createTask(
      'Backup', '0 2 * * *', 'pwsh -File "C:\\My Scripts\\backup.ps1"', CONFIG,
      { action: { executable: 'pwsh', args: ['-File', 'C:\\My Scripts\\backup.ps1'] } }
    );

    expect(written().metadata.job.args).toEqual(['-File', 'C:\\My Scripts\\backup.ps1']);
  });

  it('refuses a command that resolves to no executable, and writes nothing', async () => {
    const result = await connector.createTask('Empty', '0 3 * * *', '   ', CONFIG);

    expect(result.success).toBe(false);
    expect(result.message).toBe('Job executable is required');
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an uncomputable schedule rather than storing a task that never runs', async () => {
    const result = await connector.createTask('Bad cron', 'not a cron', 'node x.js', CONFIG);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/5-field cron/);
    expect(create).not.toHaveBeenCalled();
  });

  it('files the task under the caller’s category, else Cronsole', async () => {
    await connector.createTask('A', '0 3 * * *', 'node a.js', CONFIG, { category: 'Reports' });
    expect(written().category).toBe('Reports');

    await connector.createTask('B', '0 3 * * *', 'node b.js', CONFIG);
    expect(written().category).toBe('Cronsole');
  });
});
