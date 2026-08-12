import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

/**
 * **A Claude routine's declaration IS its task, and this suite exists because
 * treating those as two things produced a task that could not be removed.**
 *
 * Claude Code exposes no API to list routines, so `ClaudeConnector.syncTasks`
 * reads back the registry the user declared in `PlatformConnection.config`. That
 * makes the round trip *config → sync → task row* a closed loop with no network
 * in it — which is exactly why it belongs here rather than in a mocked unit
 * test: the bug was never in one function, it was in two correct-looking
 * mechanisms disagreeing across a sync.
 *
 * The symptom, in the user's words: *"I keep deleting it by clicking Remove from
 * Cronsole but it keeps coming back."* Untrack wrote a `TaskExclusion` against
 * the user's own config, the declaration stayed, and importing the Claude
 * category — which legitimately clears exclusions — undid the fence. Two
 * mechanisms, one fact, opposite directions. Troubleshooting #47.
 */

const ROUTINE = 'trig_01TESTROUTINEID';
const TOKEN = 'sk-ant-oat01-not-a-real-token';

/** Declare a routine the way the Platforms tab does, then import it. */
async function connectAndImport(auth: string, id = ROUTINE, name = 'Weekly planner') {
  await request(app)
    .post('/api/tools/platforms/claude/routines')
    .set('Authorization', auth)
    .send({ id, token: TOKEN, name })
    .expect(201);

  await request(app)
    .post('/api/tasks/sync')
    .set('Authorization', auth)
    .send({ categories: ['Claude'] })
    .expect(200);
}

describe('a Claude task is its declaration', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('claude-routines@example.com');
  });

  it('imports a declared routine as a task under the Claude category', async () => {
    await connectAndImport(owner.auth);

    const task = await prisma.task.findFirst({
      where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE }
    });
    expect(task).not.toBeNull();
    expect(task!.externalId).toBe(ROUTINE);
    expect(task!.category).toBe('Claude');
  });

  it('brings the task back after an untrack — which is why untrack must refuse', async () => {
    // This reproduces the reported loop against real Postgres, by deleting the
    // row the way untrack used to and then syncing. It is not asserting desired
    // behaviour; it is pinning WHY the refusal exists, so that removing the
    // refusal later fails loudly here instead of quietly on someone's dashboard.
    await connectAndImport(owner.auth);
    const task = (await prisma.task.findFirst({
      where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE }
    }))!;

    // Exactly what untrack did: drop the row, remember the exclusion.
    await prisma.task.delete({ where: { id: task.id } });
    await prisma.taskExclusion.create({
      data: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE, externalId: ROUTINE }
    });

    // Importing the Claude category clears exclusions inside it — correct by
    // design (it is the documented way back), and fatal here, because the
    // declaration the fence was hiding is still in the config.
    await request(app)
      .post('/api/tasks/sync')
      .set('Authorization', owner.auth)
      .send({ categories: ['Claude'] })
      .expect(200);

    expect(
      await prisma.task.count({ where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE } })
    ).toBe(1);
  });

  it('removes the routine and its tracked task in one request', async () => {
    await connectAndImport(owner.auth);
    const task = (await prisma.task.findFirst({
      where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE }
    }))!;
    // A run this task performed, to prove the history goes with it rather than
    // blocking the delete on a foreign key.
    await prisma.executionLog.create({ data: { taskId: task.id, status: 'SUCCESS' } });

    const res = await request(app)
      .delete(`/api/tools/platforms/claude/routines/${ROUTINE}`)
      .set('Authorization', owner.auth)
      .expect(200);

    expect(res.body.tasksRemoved).toBe(1);
    expect(await prisma.task.findUnique({ where: { id: task.id } })).toBeNull();
    expect(await prisma.executionLog.count({ where: { taskId: task.id } })).toBe(0);
    // No exclusion: the declaration was the only thing putting this task in the
    // list, so there is nothing left to fence against — and a stale one would
    // silently swallow the routine if it were ever re-added.
    expect(await prisma.taskExclusion.count()).toBe(0);
  });

  it('stays removed across a sync, unlike untracking it', async () => {
    // The property the whole change is for. Same gesture that used to fail.
    await connectAndImport(owner.auth);
    await request(app)
      .delete(`/api/tools/platforms/claude/routines/${ROUTINE}`)
      .set('Authorization', owner.auth)
      .expect(200);

    await request(app)
      .post('/api/tasks/sync')
      .set('Authorization', owner.auth)
      .send({ categories: ['Claude'] })
      .expect(200);

    expect(
      await prisma.task.count({ where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE } })
    ).toBe(0);
  });

  it('leaves another routine and its task alone', async () => {
    // A per-routine removal must not be a per-connection one. Both live in the
    // same config blob, which is precisely how a rewrite loses the other.
    await connectAndImport(owner.auth);
    await connectAndImport(owner.auth, 'trig_01SECONDROUTINE', 'Nightly digest');

    await request(app)
      .delete(`/api/tools/platforms/claude/routines/${ROUTINE}`)
      .set('Authorization', owner.auth)
      .expect(200);

    const remaining = await prisma.task.findMany({
      where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE }
    });
    expect(remaining.map(t => t.externalId)).toEqual(['trig_01SECONDROUTINE']);

    // And the surviving routine keeps its token — the reason edit exists at all.
    const list = await request(app)
      .get('/api/tools/platforms/claude/routines')
      .set('Authorization', owner.auth)
      .expect(200);
    expect(list.body.routines).toHaveLength(1);
    expect(list.body.routines[0].hasToken).toBe(true);
  });

  it("cannot remove another user's routine", async () => {
    await connectAndImport(owner.auth);
    const other = await createUser('other-claude@example.com');

    await request(app)
      .delete(`/api/tools/platforms/claude/routines/${ROUTINE}`)
      .set('Authorization', other.auth)
      .expect(404);

    expect(
      await prisma.task.count({ where: { userId: owner.user.id, platform: PlatformType.CLAUDE_CODE } })
    ).toBe(1);
  });
});
