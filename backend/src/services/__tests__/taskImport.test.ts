import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { parseTaskBundle, TaskImportError } from '../taskImport.js';
import { buildNativeTaskBundle, CRONSOLE_TASK_VERSION } from '../taskArchive.js';

/**
 * The importer's whole job is deciding what a file is allowed to become, so the
 * tests that matter are the refusals — an accepted file becomes a scheduled task
 * on someone's machine.
 *
 * The round-trip case is first and is the one that keeps the two halves honest:
 * it builds its input with `buildNativeTaskBundle`, the same function the export
 * route and the pre-delete archive use, so a change to the export shape fails
 * here rather than silently producing files nothing can read.
 */

const task = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 't1',
    userId: 'u1',
    platform: PlatformType.TASKHUB_NATIVE,
    externalId: 'native_abc',
    name: 'Nightly digest',
    category: 'Reports',
    schedule: '0 4 * * *',
    metadata: { job: { jobType: 'HTTP', url: 'https://example.com/hook', method: 'POST' } },
    ...over
    // The bundle builder reads five fields; the rest of the Prisma row is noise.
  }) as never;

const expectRefusal = (input: unknown, match: RegExp) => {
  expect(() => parseTaskBundle(input)).toThrow(TaskImportError);
  expect(() => parseTaskBundle(input)).toThrow(match);
};

describe('parseTaskBundle', () => {
  it('round-trips exactly what the export route produces', () => {
    const parsed = parseTaskBundle(buildNativeTaskBundle(task()));

    expect(parsed).toEqual({
      name: 'Nightly digest',
      category: 'Reports',
      schedule: '0 4 * * *',
      job: { jobType: 'HTTP', url: 'https://example.com/hook', method: 'POST' }
    });
  });

  it('unwraps the archive detail shape, so a caller can hand back what it was given', () => {
    // GET /api/tools/task-archives/:id nests the bundle beside the run history.
    const archiveDetail = {
      id: 'arch_1',
      name: 'Nightly digest',
      executions: [],
      bundle: buildNativeTaskBundle(task())
    };

    expect(parseTaskBundle(archiveDetail).name).toBe('Nightly digest');
  });

  it('leaves category unset when the file has none, rather than inventing one', () => {
    // `createNativeTask` owns the default. Two defaults is how an import and a
    // create put the same task in two different places on the rail.
    const bundle = buildNativeTaskBundle(task({ category: '   ' }));
    expect(parseTaskBundle(bundle).category).toBeUndefined();
  });

  describe('refuses, by name', () => {
    it('a Windows bundle — its definition is XML on the machine, not in the file', () => {
      const bundle = buildNativeTaskBundle(
        task({ platform: PlatformType.WINDOWS_TASK_SCHEDULER, metadata: {} })
      );
      // Both facts are wrong about this file (no job, wrong platform) and the
      // platform is the more useful one to lead with, because it names the route
      // that CAN restore it.
      expectRefusal(bundle, /Tools → Restore/);
      expectRefusal(bundle, /Windows Task Scheduler/);
    });

    it('any other platform', () => {
      expectRefusal(buildNativeTaskBundle(task({ platform: PlatformType.CLAUDE_CODE })), /CLAUDE_CODE/);
    });

    it('a template catalog export, and says where it does belong', () => {
      expectRefusal({ cronsoleCatalogVersion: '1', templates: [] }, /Templates tab/);
    });

    it('a single template', () => {
      expectRefusal({ id: 'git-fetch', schemaVersion: 1, action: {}, commandTemplate: 'git fetch' }, /template/i);
    });

    it('a settings export', () => {
      expectRefusal({ settings: { theme: 'dark' } }, /Settings/);
    });

    it('an unversioned object, pointing at the XML path for Windows', () => {
      expectRefusal({ task: { name: 'x' } }, /cronsoleTaskVersion/);
    });

    it('a future major version, naming both versions', () => {
      const bundle = { ...buildNativeTaskBundle(task()), cronsoleTaskVersion: '2.0' };
      expectRefusal(bundle, /2\.0/);
      expectRefusal(bundle, new RegExp(CRONSOLE_TASK_VERSION.replace('.', '\\.')));
    });

    it('a list — one file is one task', () => {
      expectRefusal([buildNativeTaskBundle(task())], /one task/);
    });

    it('a captured-nothing archive (job: null) differently from a malformed one', () => {
      const nulled = buildNativeTaskBundle(task({ metadata: {} }));
      expectRefusal(nulled, /never captured/);
      expectRefusal({ ...nulled, task: { ...nulled.task, job: 'powershell.exe' } }, /no readable job spec/);
    });

    it('a bundle with no schedule, since native has no default to fall back on', () => {
      expectRefusal(buildNativeTaskBundle(task({ schedule: null })), /no schedule/);
    });

    it('a bundle with no name', () => {
      expectRefusal(buildNativeTaskBundle(task({ name: '' })), /no task name/);
    });
  });

  it('accepts a minor-version bump — the format is forward compatible within a major', () => {
    const bundle = { ...buildNativeTaskBundle(task()), cronsoleTaskVersion: '1.7' };
    expect(parseTaskBundle(bundle).name).toBe('Nightly digest');
  });

  it('does not validate the job itself — that is validateJob\'s call, at create time', () => {
    // Deliberate: one definition of what a runnable job is, shared with the
    // executor. A second opinion here is how an import accepts a spec creation
    // would have refused, or refuses one it would have accepted.
    const bundle = buildNativeTaskBundle(task({ metadata: { job: { jobType: 'NONSENSE' } } }));
    expect(parseTaskBundle(bundle).job).toEqual({ jobType: 'NONSENSE' });
  });
});
