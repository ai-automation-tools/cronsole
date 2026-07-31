import { describe, it, expect, vi } from 'vitest';
import {
  decodeTaskXml,
  folderChainFor,
  isRestoreCandidate,
  planRestore,
  readExportManifest,
  readTaskUri,
  restorePathFromRelative,
  runRestore,
  summarizeRestore,
  type DecodedTaskFile,
  type RestoreMachineState,
  type RestorePlan
} from '../taskRestore.js';
import { toTaskXmlBuffer } from '../bulkExport.js';

const XML = (uri?: string) =>
  '<?xml version="1.0" encoding="UTF-16"?>' +
  '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">' +
  '<RegistrationInfo>' +
  (uri ? `<URI>${uri}</URI>` : '') +
  '</RegistrationInfo>' +
  '<Actions><Exec><Command>powershell.exe</Command></Exec></Actions>' +
  '</Task>';

const decoded = (relativePath: string, xml: string): DecodedTaskFile => ({ relativePath, xml });

const machine = (
  tasks: string[] = [],
  folders: string[] = ['\\', '\\TaskHub']
): RestoreMachineState => ({ existingTaskPaths: tasks, existingFolders: folders });

const NO_MANIFEST = new Map<string, string>();

describe('decodeTaskXml', () => {
  // The one encoding that matters: it is what bulkExport writes and the only one
  // Windows re-imports. A restore that could not read its own export would be a
  // backup loop that never closes.
  it('reads back exactly what toTaskXmlBuffer wrote (UTF-16 LE + BOM)', () => {
    const original = XML('\\Work\\Nightly');
    const result = decodeTaskXml(toTaskXmlBuffer(original));
    expect(result).toEqual({ xml: original });
  });

  it('reads UTF-16 BE, UTF-8 with a BOM, and plain UTF-8', () => {
    const original = XML();

    const utf16be = Buffer.concat([
      Buffer.from([0xfe, 0xff]),
      Buffer.from(Buffer.from(original, 'utf16le')).swap16()
    ]);
    expect(decodeTaskXml(utf16be)).toEqual({ xml: original });

    const utf8bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(original, 'utf8')]);
    expect(decodeTaskXml(utf8bom)).toEqual({ xml: original });

    expect(decodeTaskXml(Buffer.from(original, 'utf8'))).toEqual({ xml: original });
  });

  // Refused here, by name, rather than handed to an elevated agent to fail
  // somewhere less legible.
  it('refuses an empty file and anything that is not a task definition', () => {
    expect(decodeTaskXml(Buffer.alloc(0))).toEqual({ error: expect.stringContaining('empty') });
    expect(decodeTaskXml(Buffer.from('{"not":"xml"}', 'utf8'))).toEqual({
      error: expect.stringContaining('<Task>')
    });
    // A README that happens to be in the folder — plausible, and not a task.
    expect(decodeTaskXml(Buffer.from('# Backup notes\n', 'utf8'))).toHaveProperty('error');
  });

  it('does not mistake a UTF-16 file read as UTF-8 for a task', () => {
    // The failure this guards: dropping the BOM branch would decode UTF-16 as
    // UTF-8 into NUL-riddled mojibake, and a loose `includes('<Task')` check
    // would still pass on it.
    const mojibake = Buffer.from(toTaskXmlBuffer(XML()).toString('latin1'), 'utf8');
    const result = decodeTaskXml(mojibake);
    if ('xml' in result) expect(result.xml).toContain('<Task');
  });
});

describe('target resolution', () => {
  it('reads the task path Windows wrote into the XML', () => {
    expect(readTaskUri(XML('\\Work\\Backups\\Nightly'))).toBe('\\Work\\Backups\\Nightly');
    expect(readTaskUri(XML('Work/Backups/Nightly'))).toBe('\\Work\\Backups\\Nightly');
    expect(readTaskUri(XML())).toBeNull();
    expect(readTaskUri(XML('  '))).toBeNull();
  });

  it('decodes XML entities in a URI', () => {
    expect(readTaskUri(XML('\\Work\\Bells &amp; Whistles'))).toBe('\\Work\\Bells & Whistles');
  });

  it('derives a path from the file position as the last resort', () => {
    expect(restorePathFromRelative('Work/Backups/Nightly.xml')).toBe('\\Work\\Backups\\Nightly');
    expect(restorePathFromRelative('Ping.XML')).toBe('\\Ping');
    expect(restorePathFromRelative('')).toBeNull();
  });

  it('prefers the manifest, then the URI, then the filename — and says which', () => {
    const manifest = new Map([['work/nightly.xml', '\\Real\\Place\\Nightly']]);
    const files = [
      decoded('Work/Nightly.xml', XML('\\Wrong\\FromXml')),
      decoded('Elsewhere/Other.xml', XML('\\From\\Uri')),
      decoded('Plain/Guess.xml', XML())
    ];

    const plan = planRestore(files, manifest, machine([], ['\\', '\\Real\\Place', '\\From', '\\Plain']), {
      overwrite: false,
      createFolders: false
    });

    expect(plan.items.map(i => [i.taskPath, i.source])).toEqual([
      ['\\Real\\Place\\Nightly', 'manifest'],
      ['\\From\\Uri', 'uri'],
      ['\\Plain\\Guess', 'filename']
    ]);
  });
});

describe('readExportManifest', () => {
  it('maps relative paths to the task paths the export recorded', () => {
    const manifest = readExportManifest([
      {
        relativePath: '_cronsole-export.json',
        bytes: Buffer.from(
          JSON.stringify({ files: [{ relativePath: 'Work/A.xml', taskPath: '\\Work\\A' }] }),
          'utf8'
        )
      }
    ]);
    expect(manifest.get('work/a.xml')).toBe('\\Work\\A');
  });

  it('survives a corrupt manifest instead of failing the restore', () => {
    // Precision is lost (every file falls back to its URI); correctness is not.
    expect(
      readExportManifest([{ relativePath: '_cronsole-export.json', bytes: Buffer.from('{oh no', 'utf8') }]).size
    ).toBe(0);
  });

  it('does not treat the manifest itself as a task to restore', () => {
    expect(isRestoreCandidate('_cronsole-export.json')).toBe(false);
    expect(isRestoreCandidate('Work/_cronsole-export.json')).toBe(false);
    expect(isRestoreCandidate('Work/Nightly.xml')).toBe(true);
    expect(isRestoreCandidate('Work/notes.txt')).toBe(false);
  });
});

describe('folderChainFor', () => {
  it('lists every ancestor outermost first', () => {
    expect(folderChainFor('\\A\\B\\Task')).toEqual(['\\A', '\\A\\B']);
    expect(folderChainFor('\\RootTask')).toEqual([]);
  });
});

describe('planRestore', () => {
  it('plans a plain create when nothing is in the way', () => {
    const plan = planRestore(
      [decoded('TaskHub/Ping.xml', XML('\\TaskHub\\Ping'))],
      NO_MANIFEST,
      machine(),
      { overwrite: false, createFolders: false }
    );
    expect(plan.items[0]).toMatchObject({ action: 'create', taskPath: '\\TaskHub\\Ping', name: 'Ping' });
    expect(plan.counts).toMatchObject({ files: 1, create: 1, overwrite: 0, skip: 0, refuse: 0 });
  });

  // The headline decision: an existing task is left alone unless asked.
  it('skips an existing task by default and overwrites only when told to', () => {
    const files = [decoded('TaskHub/Ping.xml', XML('\\TaskHub\\Ping'))];
    const state = machine(['\\TaskHub\\Ping']);

    const skipped = planRestore(files, NO_MANIFEST, state, { overwrite: false, createFolders: false });
    expect(skipped.items[0].action).toBe('skip');
    expect(skipped.items[0].reason).toContain('already exists');

    const replaced = planRestore(files, NO_MANIFEST, state, { overwrite: true, createFolders: false });
    expect(replaced.items[0].action).toBe('overwrite');
  });

  it('matches existing tasks case-insensitively, as Windows does', () => {
    const plan = planRestore(
      [decoded('a.xml', XML('\\TaskHub\\PING'))],
      NO_MANIFEST,
      machine(['\\taskhub\\ping']),
      { overwrite: false, createFolders: false }
    );
    expect(plan.items[0].action).toBe('skip');
  });

  // Refused independently of the agent, which refuses it again. \Microsoft\ is
  // where a silent overwrite would destroy a real Windows task.
  it('refuses anything targeting \\Microsoft\\', () => {
    const plan = planRestore(
      [decoded('Microsoft/Windows/Defender.xml', XML('\\Microsoft\\Windows\\Defender'))],
      NO_MANIFEST,
      machine([], ['\\', '\\Microsoft\\Windows']),
      { overwrite: true, createFolders: true }
    );
    expect(plan.items[0].action).toBe('refuse');
    expect(plan.items[0].reason).toContain('Microsoft');
  });

  it('does not mistake a user task named Microsoft for a system task', () => {
    const plan = planRestore(
      [decoded('Microsoft.xml', XML('\\Microsoft'))],
      NO_MANIFEST,
      machine(),
      { overwrite: false, createFolders: false }
    );
    expect(plan.items[0].action).toBe('create');
  });

  describe('missing folders', () => {
    const files = [decoded('Work/Backups/Nightly.xml', XML('\\Work\\Backups\\Nightly'))];

    it('refuses when recreating folders is off, naming the SHALLOWEST missing one', () => {
      const plan = planRestore(files, NO_MANIFEST, machine(), { overwrite: false, createFolders: false });
      expect(plan.items[0].action).toBe('refuse');
      // \Work, not \Work\Backups — sending someone to create the deeper folder
      // first is sending them to do the wrong thing.
      expect(plan.items[0].reason).toContain('\\Work does not exist');
      expect(plan.foldersToCreate).toEqual([]);
    });

    it('creates the whole missing chain when asked, and reports every folder', () => {
      const plan = planRestore(files, NO_MANIFEST, machine(), { overwrite: false, createFolders: true });
      expect(plan.items[0].action).toBe('create');
      expect(plan.items[0].foldersToCreate).toEqual(['\\Work', '\\Work\\Backups']);
      expect(plan.foldersToCreate).toEqual(['\\Work', '\\Work\\Backups']);
    });

    it('counts a shared folder once across the whole restore', () => {
      const plan = planRestore(
        [
          decoded('Work/A.xml', XML('\\Work\\A')),
          decoded('Work/B.xml', XML('\\Work\\B'))
        ],
        NO_MANIFEST,
        machine(),
        { overwrite: false, createFolders: true }
      );
      expect(plan.foldersToCreate).toEqual(['\\Work']);
      expect(plan.items[1].foldersToCreate).toEqual([]);
    });

    it('needs no folder for a task restored to the root', () => {
      const plan = planRestore(
        [decoded('Loose.xml', XML('\\Loose'))],
        NO_MANIFEST,
        machine([], ['\\']),
        { overwrite: false, createFolders: false }
      );
      expect(plan.items[0].action).toBe('create');
    });
  });

  // Both would "succeed" and only one would survive — the worst kind of success.
  it('refuses a second file targeting a path an earlier one already claimed', () => {
    const plan = planRestore(
      [decoded('a.xml', XML('\\TaskHub\\Ping')), decoded('b.xml', XML('\\TaskHub\\Ping'))],
      NO_MANIFEST,
      machine(),
      { overwrite: false, createFolders: false }
    );
    expect(plan.items.map(i => i.action)).toEqual(['create', 'refuse']);
    expect(plan.items[1].reason).toContain('already targets');
  });

  it('carries a decode failure through as a refusal with its reason', () => {
    const plan = planRestore(
      [{ relativePath: 'broken.xml', error: 'The file is empty.' }],
      NO_MANIFEST,
      machine(),
      { overwrite: false, createFolders: false }
    );
    expect(plan.items[0]).toMatchObject({ action: 'refuse', reason: 'The file is empty.', taskPath: null });
  });
});

describe('runRestore', () => {
  const planOf = (files: DecodedTaskFile[], state: RestoreMachineState, opts = { overwrite: false, createFolders: true }) =>
    planRestore(files, NO_MANIFEST, state, opts);

  const xmlFor = (files: DecodedTaskFile[]) => (relativePath: string) =>
    files.find(f => f.relativePath === relativePath)?.xml;

  it('only sends creates and overwrites to the agent', async () => {
    const files = [
      decoded('new.xml', XML('\\TaskHub\\New')),
      decoded('old.xml', XML('\\TaskHub\\Old')),
      { relativePath: 'bad.xml', error: 'nope' } as DecodedTaskFile
    ];
    const plan = planOf(files, machine(['\\TaskHub\\Old']));
    const importOne = vi.fn().mockResolvedValue({ success: true, outcome: 'created' as const, foldersCreated: [] });

    const results = await runRestore(plan, xmlFor(files), importOne);

    expect(importOne).toHaveBeenCalledTimes(1);
    expect(importOne).toHaveBeenCalledWith('\\TaskHub\\New', files[0].xml);
    expect(results.map(r => r.outcome)).toEqual(['created', 'exists', 'refused']);
    // A skip carries the plan's reason, so the result explains itself without
    // the reader going back to the plan.
    expect(results[1].message).toContain('already exists');
  });

  it('keeps going when one task fails, and records which', async () => {
    const files = [decoded('a.xml', XML('\\TaskHub\\A')), decoded('b.xml', XML('\\TaskHub\\B'))];
    const plan = planOf(files, machine());
    const importOne = vi.fn(async (taskPath: string) =>
      taskPath.endsWith('A')
        ? Promise.reject(new Error('Windows denied the write'))
        : { success: true, outcome: 'created' as const, foldersCreated: [] }
    );

    const results = await runRestore(plan, xmlFor(files), importOne);

    expect(results[0]).toMatchObject({ outcome: 'refused', message: 'Windows denied the write' });
    expect(results[1].outcome).toBe('created');
  });

  it('keeps the plan\'s intent beside the agent\'s outcome when they disagree', async () => {
    // The machine changed between planning and restoring. That gap is worth
    // seeing rather than quietly reconciling.
    const files = [decoded('a.xml', XML('\\TaskHub\\A'))];
    const plan = planOf(files, machine());
    const results = await runRestore(plan, xmlFor(files), async () => ({
      success: false,
      outcome: 'exists' as const,
      message: 'A task already exists at this path.',
      foldersCreated: []
    }));

    expect(results[0].action).toBe('create');
    expect(results[0].outcome).toBe('exists');
  });

  it('summarizes outcomes and dedupes the folders that were created', () => {
    const summary = summarizeRestore([
      { relativePath: 'a', taskPath: '\\A', name: 'A', action: 'create', outcome: 'created', foldersCreated: ['\\Work'] },
      { relativePath: 'b', taskPath: '\\B', name: 'B', action: 'create', outcome: 'created', foldersCreated: ['\\Work'] },
      { relativePath: 'c', taskPath: '\\C', name: 'C', action: 'overwrite', outcome: 'replaced', foldersCreated: [] },
      { relativePath: 'd', taskPath: '\\D', name: 'D', action: 'skip', outcome: 'exists', foldersCreated: [] },
      { relativePath: 'e', taskPath: null, name: null, action: 'refuse', outcome: 'refused', foldersCreated: [] }
    ]);

    expect(summary).toEqual({
      files: 5,
      created: 2,
      replaced: 1,
      skipped: 1,
      refused: 1,
      foldersCreated: ['\\Work']
    });
  });

  it('refuses rather than guessing when a planned file has no contents', async () => {
    const files = [decoded('a.xml', XML('\\TaskHub\\A'))];
    const plan: RestorePlan = planOf(files, machine());
    const results = await runRestore(plan, () => undefined, async () => {
      throw new Error('should never be called');
    });
    expect(results[0].outcome).toBe('refused');
  });
});
