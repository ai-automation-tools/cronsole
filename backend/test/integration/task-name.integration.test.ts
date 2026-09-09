import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, TaskStatus } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';
import { TaskService } from '../../src/services/TaskService.js';

// Windows task-name guard (Apply-modal upgrades, ROADMAP P2): create paths
// reject invalid names (400) and names colliding with a tracked \Cronsole\ task
// (409) BEFORE any connector call — RegisterTaskDefinition would otherwise
// silently overwrite the existing scheduler entry. Both POST /tasks and
// POST /templates/:id/apply share the guard. No agent runs in this harness, so
// reaching the connector would surface as a 500 "Agent offline" instead of the
// expected 4xx — which is exactly what proves the guard fires first.

const app = createApp();

async function createTrackedWindowsTask(userId: string, name: string, folder = '\\Cronsole') {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      externalId: `${folder}\\${name}`,
      name,
      // Windows category is a projection of the real root folder — see
      // TaskService.extractCategory.
      category: folder.split('\\').filter(Boolean)[0] ?? 'Uncategorized',
      status: TaskStatus.ACTIVE
    }
  });
}

describe('Windows task-name guard', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('namer@example.com');
    // No platform connection needed: every case here must 4xx on the name
    // guard BEFORE the route ever looks up a connection or connector.
  });

  it('POST /tasks 409s on a name already tracked under \\Cronsole\\ (case-insensitive)', async () => {
    await createTrackedWindowsTask(owner.user.id, 'Nightly Backup');

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'nightly backup',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  // --- Folder-aware collision (ROADMAP P2 "Windows folder selector on apply") ---
  // The guard used to hardcode \Cronsole\<name>. Once a folder became selectable
  // that assumption would have silently stopped matching — creating "Backup" in
  // \Work would not have seen the tracked \Work\Backup, and Windows would have
  // overwritten it with no error. Worse than no guard: the UI still implies
  // you're protected. These pin the per-folder behavior.

  it('POST /tasks 409s on a collision in a NON-Cronsole folder', async () => {
    await createTrackedWindowsTask(owner.user.id, 'Backup', '\\Work');

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'Backup',
        folder: '\\Work',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
    // The message must name the folder it actually checked, not "Cronsole".
    expect(res.body.error).toMatch(/\\Work/);
  });

  it('POST /tasks allows the same name in a DIFFERENT folder', async () => {
    // \Cronsole\Backup and \Work\Backup are different Windows tasks — the guard
    // must not block this, or folders would be pointless.
    await createTrackedWindowsTask(owner.user.id, 'Backup', '\\Cronsole');

    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'Backup',
        folder: '\\Work',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    // Past the guard: no agent in this harness, so it fails at the connector.
    // That it is NOT a 409 is the point.
    expect(res.status).not.toBe(409);
  });

  it('POST /tasks 400s on a folder under \\Microsoft\\ (any case)', async () => {
    for (const folder of ['\\Microsoft', '\\microsoft\\Windows', '\\MICROSOFT\\Windows\\SystemRestore']) {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', owner.auth)
        .send({
          name: 'Sneaky',
          folder,
          platform: 'WINDOWS_TASK_SCHEDULER',
          schedule: '0 3 * * *',
          command: 'echo hi'
        });

      expect(res.status, folder).toBe(400);
      expect(res.body.error, folder).toMatch(/Microsoft/i);
    }
  });

  it('POST /tasks still 400s on \\Microsoft\\ WITH createFolder set', async () => {
    // The whole safety case for createFolder is that it widens whether a folder
    // may be CREATED, never WHERE a task may land. If the flag could carry a
    // create into \Microsoft\, it would hand an elevated agent the ability to
    // overwrite a real system task — so the refusal must be independent of it.
    for (const folder of ['\\Microsoft', '\\microsoft\\Windows']) {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', owner.auth)
        .send({
          name: 'Sneaky',
          folder,
          createFolder: true,
          platform: 'WINDOWS_TASK_SCHEDULER',
          schedule: '0 3 * * *',
          command: 'echo hi'
        });

      expect(res.status, folder).toBe(400);
      expect(res.body.error, folder).toMatch(/Microsoft/i);
    }
  });

  it('POST /tasks rejects a non-boolean createFolder rather than coercing it', async () => {
    // A truthy string must not become an opt-in. The flag is signed, so a
    // silently coerced value would be signed too — an opt-in nobody typed.
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'Coerced',
        folder: '\\NewTree',
        createFolder: 'yes',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(400);
  });

  it('POST /tasks 400s on a traversal folder', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'Sneaky',
        folder: '\\Cronsole\\..\\Microsoft\\Windows',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(400);
  });

  it('POST /templates/:id/apply 400s on a \\Microsoft\\ folder', async () => {
    // The apply path is what an AI reaches through the MCP tool, so it needs the
    // same refusal as the direct create path — not just the modal's own gating.
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'PowerShell Starter',
        sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        scheduleExpression: '0 3 * * *',
        command: 'echo hi'
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({
        platform: 'WINDOWS_TASK_SCHEDULER',
        name: 'Sneaky',
        folder: '\\Microsoft\\Windows',
        command: 'echo hi'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Microsoft/i);
  });

  it('POST /tasks 400s on a name with Windows-invalid characters', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .set('Authorization', owner.auth)
      .send({
        name: 'bad/name?',
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 3 * * *',
        command: 'echo hi'
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot contain/);
  });

  it('POST /templates/:id/apply 409s when the chosen name collides', async () => {
    await createTrackedWindowsTask(owner.user.id, 'PS Runner');
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'PowerShell Starter',
        sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        scheduleExpression: '0 3 * * *',
        commandTemplate: 'powershell.exe -File "{{scriptPath}}"',
        parameters: [
          { key: 'scriptPath', label: 'Script file path', type: 'path', required: true }
        ]
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({
        platform: 'WINDOWS_TASK_SCHEDULER',
        name: 'PS Runner',
        schedule: '0 3 * * *',
        parameters: { scriptPath: 'C:\\scripts\\run.ps1' }
      });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  it('POST /templates/:id/apply falls back to the template name and still collides', async () => {
    await createTrackedWindowsTask(owner.user.id, 'PowerShell Starter');
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'PowerShell Starter',
        sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        scheduleExpression: '0 3 * * *',
        command: 'echo hi'
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({ platform: 'WINDOWS_TASK_SCHEDULER', command: 'echo hi' });

    expect(res.status).toBe(409);
  });

  it('native apply keeps metadata.job intact (regression: the Windows-only apply upsert must not touch native rows)', async () => {
    // CronsoleNativeConnector.createTask writes its own row with metadata.job;
    // the apply route's immediate-upsert (Windows only) must not overwrite it,
    // or the native task becomes permanently non-runnable.
    const { createNativeConnection } = await import('./helpers.js');
    await createNativeConnection(owner.user.id);
    const template = await prisma.template.create({
      data: {
        userId: owner.user.id,
        name: 'Native Ping',
        sourcePlatform: PlatformType.TASKHUB_NATIVE,
        targetPlatforms: [PlatformType.TASKHUB_NATIVE],
        scheduleExpression: '0 3 * * *',
        command: 'https://example.com/ping'
      }
    });

    const res = await request(app)
      .post(`/api/templates/${template.id}/apply`)
      .set('Authorization', owner.auth)
      .send({ platform: 'TASKHUB_NATIVE', name: 'Native Ping Applied' });

    expect(res.status).toBe(200);
    const row = await prisma.task.findFirst({
      where: { userId: owner.user.id, platform: PlatformType.TASKHUB_NATIVE, name: 'Native Ping Applied' }
    });
    expect(row).not.toBeNull();
    const metadata = row!.metadata as { job?: { jobType?: string; url?: string } };
    expect(metadata.job?.jobType).toBe('HTTP');
    expect(metadata.job?.url).toBe('https://example.com/ping');
  });

  it('does not guard native tasks (random externalIds, duplicates allowed)', async () => {
    const res = await request(app)
      .post('/api/tasks/native')
      .set('Authorization', owner.auth)
      .send({
        name: 'Nightly Backup',
        schedule: '0 3 * * *',
        job: { jobType: 'HTTP', url: 'https://example.com/ping', method: 'GET' }
      });

    expect(res.status).toBe(200);
  });
});

/**
 * Renaming — a Cronsole label, and the sync that used to undo it.
 *
 * The guard above exists because a *created* Windows task's name becomes part of
 * its path. A rename never touches the path, so none of that applies to it — but
 * the reverse question does, and it is the one that kept renaming off the
 * product: does the next sync put the old name back?
 */
describe('renaming a task', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('rename@example.com');
  });

  async function windowsTask(name: string, folder = 'Edge-Radar') {
    return prisma.task.create({
      data: {
        userId: owner.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: `\\${folder}\\${name}`,
        name,
        category: folder,
        schedule: '0 3 * * *',
        status: TaskStatus.ACTIVE,
        metadata: { command: 'echo hi' }
      }
    });
  }

  it('renames the Cronsole row and leaves externalId — the machine — untouched', async () => {
    const task = await windowsTask('Nightly Backup');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth)
      .send({ name: '  Backup (2am)  ' })
      .expect(200);

    expect(res.body.name).toBe('Backup (2am)');
    // The path is the identity AND the way to find it in Task Scheduler. If a
    // rename ever moved it, every signed agent command for this task would
    // address a task that does not exist.
    expect(res.body.externalId).toBe('\\Edge-Radar\\Nightly Backup');
  });

  it('survives a sync that reports the platform name', async () => {
    // The whole reason this feature was blocked. `upsertTasks` wrote `name` on
    // update, so a rename reverted on the next pass — invisibly, minutes later,
    // with nothing in the UI to explain it.
    const task = await windowsTask('Nightly Backup');
    await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth)
      .send({ name: 'Backup (2am)' })
      .expect(200);

    // Exactly what a sync does with the machine's answer for this same task.
    await TaskService.upsertTasks(owner.user.id, PlatformType.WINDOWS_TASK_SCHEDULER, [
      { externalId: '\\Edge-Radar\\Nightly Backup', name: 'Nightly Backup', status: 'ACTIVE' }
    ]);

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.name).toBe('Backup (2am)');
    // Platform facts still refresh — this is "labels are ours", not "stop syncing".
    expect(after!.status).toBe(TaskStatus.ACTIVE);
  });

  it('accepts name and category together, and rejects an empty body', async () => {
    const task = await windowsTask('Both At Once');

    const res = await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth)
      .send({ name: 'Renamed', category: 'Reports' })
      .expect(200);
    expect(res.body.name).toBe('Renamed');
    expect(res.body.category).toBe('Reports');

    // An empty PATCH is a caller mistake, not a no-op success — silently
    // returning 200 would let a broken rename look like it worked.
    await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth)
      .send({})
      .expect(400);
  });

  it('rejects a blank or whitespace-only name', async () => {
    const task = await windowsTask('Keep My Name');

    await request(app)
      .patch(`/api/tasks/${task.id}`)
      .set('Authorization', owner.auth)
      .send({ name: '   ' })
      .expect(400);

    const after = await prisma.task.findUnique({ where: { id: task.id } });
    expect(after!.name).toBe('Keep My Name');
  });

  it("cannot rename another user's task", async () => {
    const other = await createUser('other-rename@example.com');
    const theirs = await prisma.task.create({
      data: {
        userId: other.user.id,
        platform: PlatformType.WINDOWS_TASK_SCHEDULER,
        externalId: '\\Theirs\\Private',
        name: 'Private',
        category: 'Theirs',
        schedule: '0 3 * * *',
        status: TaskStatus.ACTIVE,
        metadata: {}
      }
    });

    await request(app)
      .patch(`/api/tasks/${theirs.id}`)
      .set('Authorization', owner.auth)
      .send({ name: 'Pwned' })
      .expect(404);

    const after = await prisma.task.findUnique({ where: { id: theirs.id } });
    expect(after!.name).toBe('Private');
  });
});
