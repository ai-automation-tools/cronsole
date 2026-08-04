import { describe, it, expect, vi } from 'vitest';
import type { TaskInfo } from '../../connectors/platform.interface.js';
import {
  buildManifest,
  exportRelativePath,
  isSystemTaskPath,
  isWithinFolder,
  normalizeFolder,
  runBulkExport,
  selectExportCandidates,
  taskFolderOf,
  toTaskXmlBuffer,
  type ExportCandidate
} from '../bulkExport.js';

const task = (externalId: string, name?: string): TaskInfo => ({
  externalId,
  name: name ?? externalId.split('\\').filter(Boolean).pop() ?? 'task',
  status: 'ACTIVE'
});

describe('taskFolderOf', () => {
  it('strips the task name, leaving the folder', () => {
    expect(taskFolderOf('\\Work\\Backups\\Nightly')).toBe('\\Work\\Backups');
    expect(taskFolderOf('\\Cronsole\\MyTask')).toBe('\\Cronsole');
  });

  it('reports the root for a task with no folder', () => {
    expect(taskFolderOf('\\RootLevelTask')).toBe('\\');
  });

  it('accepts forward slashes, which the agent has been seen to emit', () => {
    expect(taskFolderOf('/Work/Nightly')).toBe('\\Work');
  });
});

describe('isSystemTaskPath', () => {
  it('matches anything under \\Microsoft\\, case-insensitively', () => {
    expect(isSystemTaskPath('\\Microsoft\\Windows\\Defrag\\ScheduledDefrag')).toBe(true);
    expect(isSystemTaskPath('\\microsoft\\Windows\\Foo')).toBe(true);
    expect(isSystemTaskPath('\\MICROSOFT\\Bar')).toBe(true);
  });

  it('does NOT match a user task merely NAMED Microsoft in the root', () => {
    // The check is on the folder, not the raw path — otherwise a root-level task
    // called "Microsoft" would be silently excluded from the user's own backup.
    expect(isSystemTaskPath('\\Microsoft')).toBe(false);
  });

  it('does not match a lookalike folder', () => {
    expect(isSystemTaskPath('\\MicrosoftTeams\\Updater')).toBe(false);
  });

  it('does not match ordinary user folders', () => {
    expect(isSystemTaskPath('\\Cronsole\\Nightly')).toBe(false);
    expect(isSystemTaskPath('\\Nightly')).toBe(false);
  });
});

describe('isWithinFolder', () => {
  it('treats the root as containing everything', () => {
    expect(isWithinFolder('\\Work\\Deep', '\\')).toBe(true);
  });

  it('matches a folder and its descendants', () => {
    expect(isWithinFolder('\\Work', '\\Work')).toBe(true);
    expect(isWithinFolder('\\Work\\Backups', '\\Work')).toBe(true);
  });

  it('does not match a sibling with a shared prefix', () => {
    // "\WorkStuff" starts with "\Work" as a string but is a different folder.
    expect(isWithinFolder('\\WorkStuff', '\\Work')).toBe(false);
  });
});

describe('selectExportCandidates', () => {
  const machine = [
    task('\\Cronsole\\Nightly'),
    task('\\Work\\Backup'),
    task('\\Work\\Backups\\Deep'),
    task('\\RootTask'),
    task('\\Microsoft\\Windows\\Defrag\\ScheduledDefrag'),
    task('\\Microsoft\\Windows\\Update\\Scan')
  ];

  it('excludes Windows system tasks by default and reports how many', () => {
    const result = selectExportCandidates(machine, { scope: 'all' });
    expect(result.selected.map(c => c.externalId)).toEqual([
      '\\Cronsole\\Nightly',
      '\\Work\\Backup',
      '\\Work\\Backups\\Deep',
      '\\RootTask'
    ]);
    expect(result.skippedSystem).toBe(2);
    expect(result.totalSeen).toBe(6);
  });

  it('includes system tasks when explicitly asked', () => {
    const result = selectExportCandidates(machine, { scope: 'all', includeSystem: true });
    expect(result.selected).toHaveLength(6);
    expect(result.skippedSystem).toBe(0);
  });

  it('scopes to one folder, including subfolders by default', () => {
    const result = selectExportCandidates(machine, { scope: 'folder', folder: '\\Work' });
    expect(result.selected.map(c => c.externalId)).toEqual(['\\Work\\Backup', '\\Work\\Backups\\Deep']);
  });

  it('can exclude subfolders', () => {
    const result = selectExportCandidates(machine, {
      scope: 'folder',
      folder: '\\Work',
      includeSubfolders: false
    });
    expect(result.selected.map(c => c.externalId)).toEqual(['\\Work\\Backup']);
  });

  it('normalizes the requested folder so user input matches agent output', () => {
    const result = selectExportCandidates(machine, { scope: 'folder', folder: 'Work/' });
    expect(result.selected).toHaveLength(2);
  });

  it('still excludes system tasks inside a system folder scope unless opted in', () => {
    const scoped = selectExportCandidates(machine, { scope: 'folder', folder: '\\Microsoft' });
    expect(scoped.selected).toHaveLength(0);
    expect(scoped.skippedSystem).toBe(2);

    const optedIn = selectExportCandidates(machine, {
      scope: 'folder',
      folder: '\\Microsoft',
      includeSystem: true
    });
    expect(optedIn.selected).toHaveLength(2);
  });

  it('skips tasks with no path rather than emitting a nameless entry', () => {
    const result = selectExportCandidates([task(''), task('\\Real')], { scope: 'all' });
    expect(result.selected.map(c => c.externalId)).toEqual(['\\Real']);
  });

  describe("scope: 'selection'", () => {
    it('takes exactly the named tasks, in machine order', () => {
      const result = selectExportCandidates(machine, {
        scope: 'selection',
        externalIds: ['\\RootTask', '\\Work\\Backup']
      });
      expect(result.selected.map(c => c.externalId)).toEqual(['\\Work\\Backup', '\\RootTask']);
      expect(result.requestedMissing).toEqual([]);
    });

    it('names what was asked for and not found, rather than quietly exporting fewer', () => {
      // The reason this scope needs its own field. A region-based scope returns
      // whatever is there; a selection names specific tasks, and a named task
      // that is gone is a fact about the request — an archive silently missing
      // the one task the user most needed is the failure worth spending a field
      // on.
      const result = selectExportCandidates(machine, {
        scope: 'selection',
        externalIds: ['\\Work\\Backup', '\\Work\\DeletedNatively']
      });
      expect(result.selected.map(c => c.externalId)).toEqual(['\\Work\\Backup']);
      expect(result.requestedMissing).toEqual(['\\Work\\DeletedNatively']);
    });

    it('matches paths case-insensitively, like every other path comparison here', () => {
      // A stored externalId and the agent's enumeration can differ in case and
      // mean the same task. A case-sensitive miss would report a task the user
      // is looking at as absent from their own machine.
      const result = selectExportCandidates(machine, {
        scope: 'selection',
        externalIds: ['\\work\\BACKUP']
      });
      expect(result.selected.map(c => c.externalId)).toEqual(['\\Work\\Backup']);
      expect(result.requestedMissing).toEqual([]);
    });

    it('exports a selected system task without needing includeSystem', () => {
      // An explicit selection is an explicit request: the fence exists so a
      // machine-wide export is not buried under ~257 \Microsoft\ tasks, not to
      // override a row the user deliberately ticked. Same rule as
      // filterExcluded — a fence must never swallow a direct request.
      const result = selectExportCandidates(machine, {
        scope: 'selection',
        externalIds: ['\\Microsoft\\Windows\\Update\\Scan']
      });
      expect(result.selected).toHaveLength(1);
      expect(result.skippedSystem).toBe(0);
    });

    it('reports a requested path only once, however many times it was asked for', () => {
      const result = selectExportCandidates(machine, {
        scope: 'selection',
        externalIds: ['\\Gone', '\\Gone']
      });
      expect(result.requestedMissing).toEqual(['\\Gone']);
    });

    it('leaves requestedMissing empty for the region-based scopes', () => {
      expect(selectExportCandidates(machine, { scope: 'all' }).requestedMissing).toEqual([]);
      expect(
        selectExportCandidates(machine, { scope: 'folder', folder: '\\Work' }).requestedMissing
      ).toEqual([]);
    });
  });
});

describe('exportRelativePath', () => {
  const candidate = (externalId: string, name: string): ExportCandidate => ({
    externalId,
    name,
    folder: taskFolderOf(externalId)
  });

  it('mirrors the Task Scheduler folder tree', () => {
    const taken = new Set<string>();
    expect(exportRelativePath(candidate('\\Work\\Backups\\Nightly', 'Nightly'), taken))
      .toBe('Work/Backups/Nightly.xml');
  });

  it('puts root tasks at the top level', () => {
    expect(exportRelativePath(candidate('\\RootTask', 'RootTask'), new Set())).toBe('RootTask.xml');
  });

  it('keeps same-named tasks in different folders apart', () => {
    const taken = new Set<string>();
    const a = exportRelativePath(candidate('\\Work\\Backup', 'Backup'), taken);
    const b = exportRelativePath(candidate('\\Cronsole\\Backup', 'Backup'), taken);
    expect(a).not.toBe(b);
    expect(a).toBe('Work/Backup.xml');
    expect(b).toBe('Cronsole/Backup.xml');
  });

  it('suffixes a residual collision instead of overwriting', () => {
    // Both sanitize to the same filename — without the counter one file would
    // silently replace the other and the backup would be short by one.
    const taken = new Set<string>();
    const a = exportRelativePath(candidate('\\Work\\My:Task', 'My:Task'), taken);
    const b = exportRelativePath(candidate('\\Work\\My*Task', 'My*Task'), taken);
    expect(a).toBe('Work/My_Task.xml');
    expect(b).toBe('Work/My_Task (2).xml');
  });

  it('never produces an empty filename, even when every character is unsafe', () => {
    expect(exportRelativePath(candidate('\\Work\\???', '???'), new Set())).toBe('Work/___.xml');
    // A name that sanitizes away entirely still gets a filename rather than a
    // bare ".xml" the OS would reject.
    expect(exportRelativePath(candidate('\\Work\\.', '.'), new Set())).toBe('Work/_.xml');
  });
});

describe('toTaskXmlBuffer', () => {
  it('emits a UTF-16 LE BOM followed by UTF-16 LE bytes', () => {
    const buf = toTaskXmlBuffer('AB');
    // FF FE, then 'A' = 41 00, 'B' = 42 00.
    expect([...buf]).toEqual([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
  });

  it('round-trips non-ASCII content that UTF-8 would mangle', () => {
    const xml = '<Task>café — ü</Task>';
    const buf = toTaskXmlBuffer(xml);
    expect(buf.subarray(2).toString('utf16le')).toBe(xml);
  });
});

describe('runBulkExport', () => {
  const candidates: ExportCandidate[] = [
    { externalId: '\\A\\One', name: 'One', folder: '\\A' },
    { externalId: '\\A\\Two', name: 'Two', folder: '\\A' },
    { externalId: '\\B\\Three', name: 'Three', folder: '\\B' }
  ];

  it('exports every candidate', async () => {
    const exportOne = vi.fn(async (id: string) => ({ success: true, xml: `<x>${id}</x>` }));
    const { files, failures } = await runBulkExport(candidates, exportOne);

    expect(exportOne).toHaveBeenCalledTimes(3);
    expect(failures).toHaveLength(0);
    expect(files.map(f => f.relativePath)).toEqual(['A/One.xml', 'A/Two.xml', 'B/Three.xml']);
  });

  it('records a failure and keeps going — a backup of 2 beats a backup of 0', async () => {
    const exportOne = async (id: string) =>
      id === '\\A\\Two'
        ? { success: false, message: 'Access is denied' }
        : { success: true, xml: '<x/>' };

    const { files, failures } = await runBulkExport(candidates, exportOne);
    expect(files).toHaveLength(2);
    expect(failures).toEqual([
      { externalId: '\\A\\Two', name: 'Two', message: 'Access is denied' }
    ]);
  });

  it('treats a thrown error as a failure, not a crash', async () => {
    const exportOne = async (id: string) => {
      if (id === '\\B\\Three') throw new Error('Agent export timeout');
      return { success: true, xml: '<x/>' };
    };

    const { files, failures } = await runBulkExport(candidates, exportOne);
    expect(files).toHaveLength(2);
    expect(failures[0].message).toBe('Agent export timeout');
  });

  it('treats a success with no XML as a failure rather than writing an empty file', async () => {
    const { files, failures } = await runBulkExport(
      [candidates[0]],
      async () => ({ success: true, xml: undefined })
    );
    expect(files).toHaveLength(0);
    expect(failures).toHaveLength(1);
  });

  it('bounds concurrency so 95 tasks do not start 95 timers at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const many = Array.from({ length: 20 }, (_, i): ExportCandidate => ({
      externalId: `\\A\\T${i}`,
      name: `T${i}`,
      folder: '\\A'
    }));

    await runBulkExport(
      many,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise(r => setTimeout(r, 1));
        inFlight--;
        return { success: true, xml: '<x/>' };
      },
      { concurrency: 3 }
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // genuinely concurrent, not accidentally serial
  });

  it('produces the same filenames regardless of completion order', async () => {
    // Names are assigned up front in enumeration order; if they were assigned on
    // completion, a slow first export would shuffle the collision suffixes.
    const collide: ExportCandidate[] = [
      { externalId: '\\A\\X:1', name: 'X:1', folder: '\\A' },
      { externalId: '\\A\\X*1', name: 'X*1', folder: '\\A' }
    ];
    const exportOne = async (id: string) => {
      if (id === '\\A\\X:1') await new Promise(r => setTimeout(r, 5));
      return { success: true, xml: '<x/>' };
    };

    const { files } = await runBulkExport(collide, exportOne, { concurrency: 2 });
    const byId = Object.fromEntries(files.map(f => [f.externalId, f.relativePath]));
    expect(byId['\\A\\X:1']).toBe('A/X_1.xml');
    expect(byId['\\A\\X*1']).toBe('A/X_1 (2).xml');
  });
});

describe('buildManifest', () => {
  it('records what was exported, skipped, and failed', () => {
    const selection = { scope: 'all' as const };
    const selectionResult = {
      selected: [{ externalId: '\\A\\One', name: 'One', folder: '\\A' }],
      skippedSystem: 257,
      totalSeen: 352,
      requestedMissing: []
    };
    const files = [{ relativePath: 'A/One.xml', externalId: '\\A\\One', bytes: Buffer.from('x') }];
    const failures = [{ externalId: '\\A\\Two', name: 'Two', message: 'nope' }];

    const manifest = buildManifest(selection, selectionResult, files, failures, new Date('2026-07-28T10:00:00Z'));

    expect(manifest.counts).toEqual({
      enumerated: 352,
      selected: 1,
      exported: 1,
      failed: 1,
      skippedSystem: 257,
      requestedMissing: 0
    });
    expect(manifest.exportedAt).toBe('2026-07-28T10:00:00.000Z');
    expect(manifest.files).toEqual([{ relativePath: 'A/One.xml', taskPath: '\\A\\One' }]);
    expect(manifest.failures).toEqual(failures);
  });

  it('normalizes the recorded folder so the manifest says what was really scoped', () => {
    const manifest = buildManifest(
      { scope: 'folder', folder: 'Work/Backups/' },
      { selected: [], skippedSystem: 0, totalSeen: 0, requestedMissing: [] },
      [],
      [],
      new Date()
    );
    expect(manifest.machineScope.folder).toBe('\\Work\\Backups');
  });
});

describe('normalizeFolder', () => {
  it('canonicalizes separators and trailing slashes', () => {
    expect(normalizeFolder('Work/Backups/')).toBe('\\Work\\Backups');
    expect(normalizeFolder('\\\\Work\\\\')).toBe('\\Work');
    expect(normalizeFolder('')).toBe('\\');
  });
});
