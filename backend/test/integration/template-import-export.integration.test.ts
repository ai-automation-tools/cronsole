import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { PlatformType, ScriptType, OsTarget, TemplateCategory } from '@prisma/client';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db.js';
import { createUser } from './helpers.js';

const app = createApp();

/** A parameterized Windows starter, close to a real bundled row. */
async function seedTemplate(userId: string, id = 'tpl_ie_fixture') {
  return prisma.template.create({
    data: {
      id,
      userId,
      name: 'Import/Export Fixture',
      description: 'Round-trip probe',
      sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
      targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
      scheduleExpression: '0 9 * * *',
      command: 'powershell.exe -NoProfile -File script.ps1',
      commandTemplate: 'powershell.exe -NoProfile -File "{{scriptPath}}"',
      parameters: [{ key: 'scriptPath', label: 'Script', type: 'path', required: true }],
      scriptType: ScriptType.POWERSHELL,
      os: OsTarget.WINDOWS,
      category: TemplateCategory.MONITORING,
      isStarter: true
    }
  });
}

describe('template import/export', () => {
  let owner: Awaited<ReturnType<typeof createUser>>;

  beforeEach(async () => {
    owner = await createUser('ie-owner@example.com');
  });

  it('exports the whole catalog as a v1 bundle', async () => {
    await seedTemplate(owner.user.id);
    const res = await request(app).get('/api/templates/export').set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="taskhub-catalog-/);
    expect(res.body.taskhubCatalogVersion).toBe('1.0');
    const entry = res.body.templates.find((t: { id: string }) => t.id === 'tpl_ie_fixture');
    expect(entry).toMatchObject({
      schemaVersion: '1.0',
      id: 'tpl_ie_fixture',
      runtime: 'powershell',
      os: 'windows',
      category: 'monitoring',
      commandTemplate: 'powershell.exe -NoProfile -File "{{scriptPath}}"',
      compatibleTargets: ['windows']
    });
  });

  it('exports a single template as a bare v1 object with ?id', async () => {
    await seedTemplate(owner.user.id);
    const res = await request(app)
      .get('/api/templates/export?id=tpl_ie_fixture')
      .set('Authorization', owner.auth);

    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('taskhub-template-tpl_ie_fixture.json');
    expect(res.body.id).toBe('tpl_ie_fixture');
    expect(res.body.templates).toBeUndefined(); // a bare object, not a bundle
  });

  it('404s exporting an unknown single template', async () => {
    const res = await request(app)
      .get('/api/templates/export?id=nope')
      .set('Authorization', owner.auth);
    expect(res.status).toBe(404);
  });

  it('round-trips: export a template, wipe it, re-import from the bundle', async () => {
    await seedTemplate(owner.user.id);
    const exported = await request(app).get('/api/templates/export').set('Authorization', owner.auth);

    await prisma.template.delete({ where: { id: 'tpl_ie_fixture' } });
    expect(await prisma.template.findUnique({ where: { id: 'tpl_ie_fixture' } })).toBeNull();

    const res = await request(app)
      .post('/api/templates/import')
      .set('Authorization', owner.auth)
      .send(exported.body);

    expect(res.status).toBe(200);
    expect(res.body.created).toContain('tpl_ie_fixture');

    const back = await prisma.template.findUnique({ where: { id: 'tpl_ie_fixture' } });
    expect(back).toMatchObject({
      name: 'Import/Export Fixture',
      commandTemplate: 'powershell.exe -NoProfile -File "{{scriptPath}}"',
      scriptType: ScriptType.POWERSHELL,
      os: OsTarget.WINDOWS,
      isStarter: true
    });
  });

  it('re-importing an existing template reports it as updated', async () => {
    await seedTemplate(owner.user.id);
    const single = await request(app)
      .get('/api/templates/export?id=tpl_ie_fixture')
      .set('Authorization', owner.auth);

    const res = await request(app)
      .post('/api/templates/import')
      .set('Authorization', owner.auth)
      .send(single.body);

    expect(res.status).toBe(200);
    expect(res.body.updated).toContain('tpl_ie_fixture');
    expect(res.body.created).toEqual([]);
  });

  it('imports the good entries and 400s only when nothing imports', async () => {
    // A valid new template + a schema-invalid one → 200, partial success.
    const good = {
      schemaVersion: '1.0',
      id: 'tpl_ie_new',
      name: 'New One',
      trigger: { kind: 'schedule', cron: '30 6 * * 1' },
      runtime: 'bash',
      commandTemplate: 'echo {{msg}}',
      parameters: [{ key: 'msg', required: true }],
      compatibleTargets: ['taskhub-native']
    };
    const partial = await request(app)
      .post('/api/templates/import')
      .set('Authorization', owner.auth)
      .send({ templates: [good, { id: 'tpl_broken', name: 'no trigger' }] });
    expect(partial.status).toBe(200);
    expect(partial.body.created).toContain('tpl_ie_new');
    expect(partial.body.errors).toHaveLength(1);

    // All invalid → 400, nothing imported.
    const allBad = await request(app)
      .post('/api/templates/import')
      .set('Authorization', owner.auth)
      .send([{ id: 'x', name: 'still broken' }]);
    expect(allBad.status).toBe(400);
    expect(allBad.body.created).toEqual([]);
  });

  it('rejects an imported template with an unfillable placeholder', async () => {
    const bad = {
      schemaVersion: '1.0',
      id: 'tpl_ie_unfillable',
      name: 'Unfillable',
      trigger: { kind: 'schedule', cron: '0 0 * * *' },
      runtime: 'powershell',
      commandTemplate: 'powershell.exe -File {{scriptPath}}', // scriptPath not declared
      parameters: [],
      compatibleTargets: ['windows']
    };
    const res = await request(app)
      .post('/api/templates/import')
      .set('Authorization', owner.auth)
      .send(bad);

    expect(res.status).toBe(400);
    expect(res.body.errors[0].error).toMatch(/unfilled placeholder/i);
    expect(await prisma.template.findUnique({ where: { id: 'tpl_ie_unfillable' } })).toBeNull();
  });

  it('round-trips tags: import with tags → GET shows them → export includes them', async () => {
    const withTags = {
      schemaVersion: '1.0',
      id: 'tpl_ie_tagged',
      name: 'Tagged',
      trigger: { kind: 'schedule', cron: '0 2 * * *' },
      runtime: 'bash',
      commandTemplate: 'echo hi',
      compatibleTargets: ['taskhub-native'],
      tags: ['dev', 'git', 'build']
    };
    const imp = await request(app)
      .post('/api/templates/import')
      .set('Authorization', owner.auth)
      .send(withTags);
    expect(imp.status).toBe(200);
    expect(imp.body.created).toContain('tpl_ie_tagged');

    // Tags surface on GET /templates (frontend facet reads this).
    const list = await request(app).get('/api/templates').set('Authorization', owner.auth);
    const row = list.body.find((t: { id: string }) => t.id === 'tpl_ie_tagged');
    expect(row.tags).toEqual(['dev', 'git', 'build']);

    // ...and survive export.
    const exp = await request(app)
      .get('/api/templates/export?id=tpl_ie_tagged')
      .set('Authorization', owner.auth);
    expect(exp.body.tags).toEqual(['dev', 'git', 'build']);
  });

  it('401s when unauthenticated', async () => {
    expect((await request(app).get('/api/templates/export')).status).toBe(401);
    expect((await request(app).post('/api/templates/import').send({})).status).toBe(401);
  });
});
