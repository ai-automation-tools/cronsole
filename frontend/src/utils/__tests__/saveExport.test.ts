import { describe, it, expect, vi } from 'vitest';
import {
  base64ToBytes,
  filenameFromDisposition,
  supportsDirectoryPicker,
  writeFilesToDirectory,
  type DirectoryHandleLike,
  type ExportFilePayload
} from '../saveExport';

/**
 * A stand-in for the File System Access API.
 *
 * The real picker opens a native OS dialog, which no automated test can drive —
 * so the *writing* half is verified here against a fake handle, and the picker
 * itself stays a manual check. Recording that split honestly beats pretending
 * the whole path is covered.
 */
function fakeDirectory() {
  const written = new Map<string, Uint8Array>();
  const madeDirs: string[] = [];

  const makeDir = (prefix: string): DirectoryHandleLike => ({
    name: prefix || 'root',
    async getDirectoryHandle(name: string) {
      const path = prefix ? `${prefix}/${name}` : name;
      madeDirs.push(path);
      return makeDir(path);
    },
    async getFileHandle(name: string) {
      const path = prefix ? `${prefix}/${name}` : name;
      return {
        async createWritable() {
          const chunks: Uint8Array[] = [];
          return {
            async write(data: BufferSource | Blob | string) {
              chunks.push(data as Uint8Array);
            },
            async close() {
              written.set(path, chunks[0] ?? new Uint8Array());
            }
          };
        }
      };
    }
  });

  return { handle: makeDir(''), written, madeDirs };
}

const payload = (relativePath: string, bytes: number[]): ExportFilePayload => ({
  relativePath,
  taskPath: '\\X',
  contentBase64: btoa(String.fromCharCode(...bytes))
});

describe('base64ToBytes', () => {
  it('decodes to exact bytes', () => {
    expect([...base64ToBytes(btoa('AB'))]).toEqual([65, 66]);
  });

  it('preserves a UTF-16 LE BOM instead of mangling it as text', () => {
    // FF FE is not valid UTF-8. Anything that decodes this as a string on the
    // way through produces a file Windows silently refuses to re-import.
    const bytes = base64ToBytes(btoa(String.fromCharCode(0xff, 0xfe, 0x3c, 0x00)));
    expect([...bytes]).toEqual([0xff, 0xfe, 0x3c, 0x00]);
  });

  it('handles an empty payload', () => {
    expect(base64ToBytes('').length).toBe(0);
  });
});

describe('writeFilesToDirectory', () => {
  it('writes a flat file', async () => {
    const { handle, written } = fakeDirectory();
    await writeFilesToDirectory(handle, [payload('RootTask.xml', [1, 2, 3])]);
    expect([...written.get('RootTask.xml')!]).toEqual([1, 2, 3]);
  });

  it('creates nested folders so the export mirrors the Task Scheduler tree', async () => {
    const { handle, written, madeDirs } = fakeDirectory();
    await writeFilesToDirectory(handle, [payload('Work/Backups/Nightly.xml', [9])]);
    expect(madeDirs).toEqual(['Work', 'Work/Backups']);
    expect(written.has('Work/Backups/Nightly.xml')).toBe(true);
  });

  it('writes raw bytes, not text — the BOM must survive to disk', async () => {
    const { handle, written } = fakeDirectory();
    await writeFilesToDirectory(handle, [payload('T.xml', [0xff, 0xfe, 0x41, 0x00])]);
    const bytes = written.get('T.xml')!;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect([...bytes]).toEqual([0xff, 0xfe, 0x41, 0x00]);
  });

  it('reports progress for every file and returns the count', async () => {
    const { handle } = fakeDirectory();
    const onProgress = vi.fn();
    const count = await writeFilesToDirectory(
      handle,
      [payload('a.xml', [1]), payload('b/c.xml', [2]), payload('d.xml', [3])],
      onProgress
    );
    expect(count).toBe(3);
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it('skips an entry with no filename rather than throwing mid-export', async () => {
    const { handle, written } = fakeDirectory();
    const count = await writeFilesToDirectory(handle, [payload('', [1]), payload('ok.xml', [2])]);
    expect(count).toBe(1);
    expect(written.has('ok.xml')).toBe(true);
  });
});

describe('filenameFromDisposition', () => {
  it('reads a quoted filename', () => {
    expect(filenameFromDisposition('attachment; filename="taskhub-tasks.zip"', 'x.zip')).toBe('taskhub-tasks.zip');
  });

  it('reads an unquoted filename', () => {
    expect(filenameFromDisposition('attachment; filename=plain.md', 'x.md')).toBe('plain.md');
  });

  it('falls back when the header is missing or unparseable', () => {
    expect(filenameFromDisposition(undefined, 'fallback.zip')).toBe('fallback.zip');
    expect(filenameFromDisposition('attachment', 'fallback.zip')).toBe('fallback.zip');
  });
});

describe('supportsDirectoryPicker', () => {
  it('is false when the browser has no picker (the ZIP-fallback path)', () => {
    expect(supportsDirectoryPicker()).toBe(false);
  });

  it('is true once the API is present', () => {
    (window as unknown as { showDirectoryPicker: () => void }).showDirectoryPicker = () => {};
    expect(supportsDirectoryPicker()).toBe(true);
    delete (window as unknown as { showDirectoryPicker?: () => void }).showDirectoryPicker;
  });
});
