import { describe, it, expect } from 'vitest';
import {
  PlatformType,
  ScriptType,
  OsTarget,
  TemplateCategory
} from '@prisma/client';
import { bundledCatalog } from './bundled.js';
import { registryTemplateSchema } from './schema.js';
import { normalizeTemplate } from './normalize.js';
import { BundledCatalogSource } from './source.js';

const byId = <T extends { id: string }>(list: T[], id: string): T => {
  const found = list.find((t) => t.id === id);
  if (!found) throw new Error(`fixture missing template ${id}`);
  return found;
};

describe('bundled catalog snapshot', () => {
  it('every entry validates against the v1 schema', () => {
    for (const t of bundledCatalog) {
      const parsed = registryTemplateSchema.safeParse(t);
      expect(parsed.success, `${(t as { id?: string }).id} failed: ` +
        (parsed.success ? '' : parsed.error.message)).toBe(true);
    }
  });

  it('has the expected shape: 24 templates (4 patterns + 20 starters)', () => {
    expect(bundledCatalog).toHaveLength(24);
    expect(bundledCatalog.filter((t) => t.isStarter)).toHaveLength(20);
    expect(bundledCatalog.filter((t) => !t.isStarter)).toHaveLength(4);
  });

  it('has unique ids', () => {
    const ids = bundledCatalog.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the legacy tpl_* ids so DB rows / favorites are not orphaned', () => {
    expect(bundledCatalog.every((t) => t.id.startsWith('tpl_'))).toBe(true);
  });
});

describe('normalizeTemplate -> Prisma shape', () => {
  it('maps a Windows starter faithfully (PowerShell Script)', () => {
    const n = normalizeTemplate(byId(bundledCatalog, 'tpl_starter_powershell_script'));
    expect(n).toMatchObject({
      id: 'tpl_starter_powershell_script',
      name: 'PowerShell Script',
      sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
      targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
      scriptType: ScriptType.POWERSHELL,
      os: OsTarget.WINDOWS,
      category: TemplateCategory.OTHER,
      scheduleExpression: '0 9 * * *',
      isStarter: true
    });
    // commandTemplate passes through verbatim, and command mirrors it (the quote
    // around {{scriptPath}} — the tokenizer's "one argument" signal — survives).
    expect(n.commandTemplate).toBe(
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"'
    );
    expect(n.command).toBe(n.commandTemplate);
    expect((n.parameters as { key: string }[])[0].key).toBe('scriptPath');
  });

  it('maps a shell pattern (Daily Database Backup)', () => {
    const n = normalizeTemplate(byId(bundledCatalog, 'tpl_daily_database_backup'));
    expect(n.sourcePlatform).toBe(PlatformType.WINDOWS_TASK_SCHEDULER);
    expect(n.targetPlatforms).toEqual([PlatformType.WINDOWS_TASK_SCHEDULER]);
    expect(n.scriptType).toBe(ScriptType.EXECUTABLE);
    expect(n.category).toBe(TemplateCategory.BACKUP);
    expect(n.isStarter).toBe(false);
    expect(n.commandTemplate).toBe(
      'cmd.exe /c "pg_dump -U {{dbUser}} {{dbName}} > {{backupPath}}"'
    );
  });

  it('maps a multi-target AI pattern (Morning News Digest)', () => {
    const n = normalizeTemplate(byId(bundledCatalog, 'tpl_morning_news_digest'));
    expect(n.sourcePlatform).toBe(PlatformType.CLAUDE_CODE);
    expect(n.targetPlatforms).toEqual([PlatformType.CLAUDE_CODE, PlatformType.CHATGPT]);
    expect(n.scriptType).toBe(ScriptType.AI_PROMPT);
    expect(n.os).toBe(OsTarget.CROSS_PLATFORM);
    expect(n.category).toBe(TemplateCategory.AI_AGENT);
  });

  it('maps a cross-platform target to both platforms (Git Sync)', () => {
    const n = normalizeTemplate(byId(bundledCatalog, 'tpl_starter_git_sync'));
    expect(n.targetPlatforms).toEqual([
      PlatformType.WINDOWS_TASK_SCHEDULER,
      PlatformType.MACOS_LAUNCHD
    ]);
    expect(n.sourcePlatform).toBe(PlatformType.WINDOWS_TASK_SCHEDULER);
    expect(n.category).toBe(TemplateCategory.DEV_WORKFLOW);
  });

  it('lowers a structured exec action to a command string', () => {
    const n = normalizeTemplate({
      schemaVersion: '1.0',
      id: 'tpl_synthetic_exec',
      name: 'Synthetic',
      trigger: { kind: 'schedule', cron: '0 0 * * *' },
      action: { kind: 'exec', program: 'node', args: ['{{scriptPath}}'] },
      compatibleTargets: ['windows']
    });
    expect(n.command).toBe('node {{scriptPath}}');
    expect(n.commandTemplate).toBe(n.command);
  });
});

describe('BundledCatalogSource', () => {
  it('lists all 24 normalized templates', async () => {
    const src = new BundledCatalogSource();
    const list = await src.list();
    expect(list).toHaveLength(24);
    expect(src.name).toBe('bundled');
  });
});

describe('v1 schema guards', () => {
  it('rejects a template with neither action nor commandTemplate', () => {
    const parsed = registryTemplateSchema.safeParse({
      schemaVersion: '1.0',
      id: 'tpl_bad',
      name: 'Bad',
      trigger: { kind: 'schedule', cron: '0 0 * * *' },
      compatibleTargets: ['windows']
    });
    expect(parsed.success).toBe(false);
  });
});
