import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { serializeConfig } from '../../src/auth/connectionConfig.js';
import { createUser } from './helpers.js';
import { toTaskXmlBuffer } from '../../src/services/bulkExport.js';

const app = createApp();

const TASK_XML =
  '<?xml version="1.0" encoding="UTF-16"?>' +
  '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
  '<RegistrationInfo><URI>\\Work\\Nightly</URI></RegistrationInfo>' +
  '<Actions><Exec><Command>powershell.exe</Command></Exec></Actions>' +
  '</Task>';

/** One file in the shape the browser posts: UTF-16 LE + BOM bytes, base64. */
const xmlFile = (relativePath: string, xml = TASK_XML) => ({
  relativePath,
  contentBase64: toTaskXmlBuffer(xml).toString('base64')
});

async function createWindowsConnection(userId: string) {
  return prisma.platformConnection.create({
    data: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      config: serializeConfig({}),
      isActive: true,
      healthState: 'HEALTHY'
    }
  });
}

describe('restore tasks from an export', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('restore-owner@example.com');
  });

  it('401s when unauthenticated', async () => {
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .send({ files: [xmlFile('Work/Nightly.xml')] });
    expect(res.status).toBe(401);
  });

  it('400s when neither files nor an archive is supplied', async () => {
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send({ overwrite: false });
    expect(res.status).toBe(400);
  });

  it('400s when BOTH files and an archive are supplied', async () => {
    // Ambiguous input is refused rather than silently preferring one — which one
    // won would be invisible, and it decides what lands on the machine.
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send({ files: [xmlFile('Work/Nightly.xml')], archiveBase64: 'UEsDBA==' });
    expect(res.status).toBe(400);
  });

  it('400s when nothing in the selection is a task definition', async () => {
    await createWindowsConnection(owner.user.id);
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send({ files: [{ relativePath: 'notes.txt', contentBase64: Buffer.from('hi').toString('base64') }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/task xml/i);
  });

  it('400s with no Windows connection, before touching anything', async () => {
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send({ files: [xmlFile('Work/Nightly.xml')] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/connect the agent/i);
  });

  it('502s rather than restoring blind when the agent is offline', async () => {
    // The honest refusal: without the machine's current state a plan would
    // confidently promise to create tasks that may already exist.
    await createWindowsConnection(owner.user.id);
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send({ files: [xmlFile('Work/Nightly.xml')], dryRun: true });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/offline/i);
  });

  it('400s an archive that is not a readable zip', async () => {
    await createWindowsConnection(owner.user.id);
    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send({ archiveBase64: Buffer.from('definitely not a zip').toString('base64') });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zip/i);
  });

  it('accepts a body far larger than the global JSON limit', async () => {
    // Pins the route-scoped parser in app.ts. Express's default is 100 kB, so
    // without it a real backup (95 tasks of UTF-16 XML, base64) would 413 —
    // and the failure would look like a broken restore rather than a body cap.
    await createWindowsConnection(owner.user.id);
    const files = Array.from({ length: 160 }, (_, i) =>
      xmlFile(`Work/Task ${i}.xml`, TASK_XML.replace('\\Work\\Nightly', `\\Work\\Task ${i}`))
    );
    const body = { files, dryRun: true };
    expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);

    const res = await request(app)
      .post('/api/tools/restore/tasks')
      .set('Authorization', owner.auth)
      .send(body);

    // 502 (agent offline), NOT 413 — the body got through and the route ran.
    expect(res.status).toBe(502);
  });
});
