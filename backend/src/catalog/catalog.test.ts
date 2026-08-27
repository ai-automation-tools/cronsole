import { describe, it, expect } from 'vitest';
import {
  PlatformType,
  ScriptType,
  OsTarget,
  TemplateCategory,
  Prisma
} from '@prisma/client';
import { bundledCatalog } from './bundled.js';
import { registryTemplateSchema } from './schema.js';
import { normalizeTemplate } from './normalize.js';
import { BundledCatalogSource } from './source.js';
import {
  resolveTemplateParams,
  substituteStructuredCommand,
  substituteNativeJob,
  type TemplateParameterDef
} from '../utils/templateCommand.js';
import { buildNativeJob } from '../services/nativeJob.js';
import { validateJob } from '../services/NativeTaskExecutor.js';

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

  it('has the expected shape: 86 templates (4 patterns + 9 dev + 7 ai + 20 starters + 24 extended + 8 native + 8 native scripts&checks + 6 claude routines)', () => {
    expect(bundledCatalog).toHaveLength(86);
    expect(bundledCatalog.filter((t) => t.isStarter)).toHaveLength(24);
    expect(bundledCatalog.filter((t) => t.id.startsWith('dev-'))).toHaveLength(9);
    expect(bundledCatalog.filter((t) => t.id.startsWith('ai-'))).toHaveLength(7);
    expect(bundledCatalog.filter((t) => t.id.startsWith('native-'))).toHaveLength(16);
    expect(bundledCatalog.filter((t) => t.id.startsWith('claude-routine-'))).toHaveLength(6);
  });

  it('Cronsole-native is a real target — the pack that was missing until 2026-08-13', () => {
    // The catalog shipped 55 templates and not one of them targeted the source
    // Cronsole fully owns, so the Templates tab had nothing to offer a user with
    // no agent installed. Pinned as a count, not a boolean: the failure this
    // guards against is the family quietly emptying again.
    const native = bundledCatalog.filter((t) => t.compatibleTargets.includes('cronsole-native'));
    expect(native.length).toBeGreaterThanOrEqual(6);
    for (const t of native) {
      expect(t.tags, `${t.id} missing 'cronsole-native' tag`).toContain('cronsole-native');
    }

    // **`os` describes what the template NEEDS, not where the backend happens to
    // run.** This was a blanket `cross-platform` assertion until 2026-08-15, on
    // the reasoning that a native task runs wherever the backend runs so naming
    // an OS would be a guess about someone else's install. That held while every
    // native template just launched an arbitrary program — the template named no
    // tool, so it made no demand.
    //
    // A `script` template names its **interpreter**, which makes the demand real
    // and knowable: a Windows-PowerShell body cannot run on a Linux container
    // whatever the backend is, so labelling it `cross-platform` would be the
    // confident lie, not the humble answer. The rule that replaces the blanket
    // one: only a template naming a Windows-only runtime may claim `windows`.
    const WINDOWS_ONLY_RUNTIMES = ['powershell', 'batch', 'vbscript'];
    for (const t of native) {
      if (t.os === 'cross-platform') continue;
      expect(
        WINDOWS_ONLY_RUNTIMES,
        `${t.id} claims os=${t.os} but its runtime (${t.runtime}) is not Windows-only`
      ).toContain(t.runtime);
      expect(t.os, `${t.id} may only narrow to windows`).toBe('windows');
    }
  });

  it('every Claude-routine template is a prompt, and none of them is core', () => {
    const routines = bundledCatalog.filter((t) => t.id.startsWith('claude-routine-'));
    for (const t of routines) {
      expect(t.runtime, `${t.id} must be an ai-prompt`).toBe('ai-prompt');
      expect(t.compatibleTargets).toEqual(['claude-code']);
      // Creating a routine needs a readable Claude Code session on the backend's
      // machine. A `core` template is auto-synced into *every* install, so this
      // family staying extended is what keeps "built-in" meaning "applicable".
      expect(t.core, `${t.id} must not be core`).not.toBe(true);
    }
  });

  it('splits into a curated core (auto-synced) and an extended gallery-only set', () => {
    // core: true = bundled + auto-synced into every install's DB by default.
    // The rest are extended — in the registry/gallery, imported on demand.
    const core = bundledCatalog.filter((t) => t.core === true);
    const extended = bundledCatalog.filter((t) => !t.core);
    // Core is a deliberately small sampler (one example across a few common use
    // cases); the rest is browse-and-import from the gallery.
    // 7 since 2026-08-13: the two Cronsole-native entries joined, because native
    // is the only source that works on a fresh install with no agent and no
    // credential — so it is the one family a default catalog can promise.
    // 10 since 2026-08-15: a script starter and two checks, for the same reason
    // one step further — a SCRIPT template needs nothing on disk, so it is the
    // first template in the catalog that is guaranteed to work on a fresh
    // install rather than merely applicable to one.
    expect(core).toHaveLength(10);
    expect(extended).toHaveLength(76);
    expect(core.length).toBeLessThan(bundledCatalog.length); // registry > default
    // Extended Pack templates use the ext-namespace prefixes and are never core.
    for (const t of bundledCatalog.filter((x) => /^(bkp|cln|sys|mon|data|ntf)-/.test(x.id))) {
      expect(t.core, `${t.id} (extended pack) must not be core`).not.toBe(true);
    }
  });

  it('has unique ids', () => {
    const ids = bundledCatalog.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the legacy tpl_* ids so DB rows / favorites are not orphaned', () => {
    // The 24 pre-registry rows keep their tpl_* ids (same DB rows, favorites
    // FKs intact); templates added since (the Developer Pack) use the plain
    // kebab id form the v1 spec prescribes for new registry templates.
    expect(bundledCatalog.filter((t) => t.id.startsWith('tpl_'))).toHaveLength(24);
    for (const t of bundledCatalog.filter((x) => !x.id.startsWith('tpl_'))) {
      expect(t.id, `${t.id} should be plain kebab`).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('every Developer Pack template carries the dev tag', () => {
    for (const t of bundledCatalog.filter((x) => x.id.startsWith('dev-'))) {
      expect(t.tags, `${t.id} missing 'dev' tag`).toContain('dev');
    }
  });

  it('every AI Pack template carries the ai tag', () => {
    for (const t of bundledCatalog.filter((x) => x.id.startsWith('ai-'))) {
      expect(t.tags, `${t.id} missing 'ai' tag`).toContain('ai');
    }
  });

  it('every commandTemplate resolves through the Apply substitution pipeline', () => {
    // The same resolvability guarantee import enforces on untrusted content:
    // every {{placeholder}} is a declared parameter and the command resolves to
    // a non-empty structured action. Synthesizes each param's value the same
    // way (default → first select option → dummy).
    for (const t of bundledCatalog) {
      if (!t.commandTemplate) continue;
      const defs = (t.parameters ?? []) as TemplateParameterDef[];
      const provided: Record<string, string> = {};
      for (const def of defs) {
        provided[def.key] =
          (def.default && def.default.trim() ? def.default : undefined) ??
          def.options?.[0] ??
          'x';
      }
      expect(
        () => substituteStructuredCommand(t.commandTemplate!, resolveTemplateParams(defs, provided)),
        `${t.id} has an unresolvable commandTemplate`
      ).not.toThrow();
    }
  });

  it('every native job spec resolves, and the result is a job the executor accepts', () => {
    // The same guarantee the commandTemplate test gives, for the templates that
    // have no commandTemplate — which is *all* of the SCRIPT and CHECK ones, so
    // without this they were the only family in the catalog with no resolvability
    // cover at all. That gap is the shape this suite exists to catch: a template
    // that applies cleanly and stores a spec the executor refuses at 3am.
    //
    // It goes one step further than the command test and runs `validateJob` on
    // the result, because a resolved job spec CAN be checked end to end —
    // `buildNativeJob` + `validateJob` is exactly what the connector will do.
    for (const t of bundledCatalog) {
      const normalized = normalizeTemplate(t);
      if (normalized.nativeJob === Prisma.DbNull) continue;

      const defs = (t.parameters ?? []) as TemplateParameterDef[];
      const provided: Record<string, string> = {};
      for (const def of defs) {
        provided[def.key] =
          (def.default && def.default.trim() ? def.default : undefined) ??
          def.options?.[0] ??
          // A URL-shaped dummy: several probes require one, and 'x' would fail
          // validation for a reason that says nothing about the template.
          (/url/i.test(def.key) ? 'https://example.com/health' : 'x');
      }

      const resolved = substituteNativeJob(
        normalized.nativeJob,
        resolveTemplateParams(defs, provided)
      ) as Record<string, unknown>;

      expect(JSON.stringify(resolved), `${t.id} left an unfilled placeholder`).not.toContain('{{');
      expect(
        validateJob(buildNativeJob(resolved)),
        `${t.id} builds a job the executor would refuse`
      ).toBeNull();
    }
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
  it('lists all 86 normalized templates', async () => {
    const src = new BundledCatalogSource();
    const list = await src.list();
    expect(list).toHaveLength(86);
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
