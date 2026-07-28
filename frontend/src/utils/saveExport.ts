/**
 * Writing a bulk export to disk.
 *
 * A web page cannot write to an arbitrary filesystem path — that is a hard
 * browser limitation, not a gap we can code around. The honest options are:
 *
 *   1. **File System Access API** (`showDirectoryPicker`) — a real folder picker
 *      and real per-file writes. Chromium only, and it needs a secure context —
 *      but `localhost` counts as one, and TaskHub is a local-first app, so the
 *      primary path works for most users.
 *   2. **A single ZIP download** everywhere else. Lands in the browser's
 *      download folder like any other file.
 *
 * The tempting third option — have the agent write the files, since it is
 * already on the machine and already elevated — is deliberately NOT taken. It
 * would turn a task-scheduler agent into a general elevated arbitrary-file-write
 * primitive reachable from the backend, which is a categorically larger attack
 * surface than everything the agent does today, traded for a directory picker.
 */

/** Minimal shape of the File System Access API bits we use. */
interface FileSystemWritable {
  write(data: BufferSource | Blob | string): Promise<void>;
  close(): Promise<void>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritable>;
}
export interface DirectoryHandleLike {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}
type DirectoryPicker = (options?: { mode?: 'read' | 'readwrite'; id?: string }) => Promise<DirectoryHandleLike>;

export interface ExportFilePayload {
  relativePath: string;
  taskPath: string | null;
  contentBase64: string;
}

/** True when the browser can write into a folder the user picks. */
export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker === 'function';
}

/**
 * Ask the user for a destination folder.
 *
 * **Must be called from a user gesture.** Chrome requires transient activation,
 * and an `await` on a network request beforehand can consume it — so the picker
 * opens *before* the export request, not after. That also fails fast: cancelling
 * costs nothing instead of discarding a completed export.
 *
 * Returns null when the user cancels.
 */
export async function pickDirectory(): Promise<DirectoryHandleLike | null> {
  const picker = (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  if (!picker) return null;
  try {
    return await picker({ mode: 'readwrite', id: 'taskhub-export' });
  } catch (err) {
    // AbortError is the user clicking Cancel — not a failure worth reporting.
    if ((err as DOMException)?.name === 'AbortError') return null;
    throw err;
  }
}

/**
 * Decode base64 to raw bytes.
 *
 * The XML is UTF-16 LE with a BOM — the only encoding Windows re-imports. It
 * travels as base64 rather than a JSON string precisely so these bytes survive
 * the trip untouched; decoding it as text anywhere along the way produces a file
 * Windows silently refuses to import.
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  // Explicitly ArrayBuffer-backed (not SharedArrayBuffer) so the bytes satisfy
  // BufferSource where the writable stream expects them.
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Write every file into `directory`, creating subfolders as needed so the export
 * mirrors the Task Scheduler folder tree it came from.
 */
export async function writeFilesToDirectory(
  directory: DirectoryHandleLike,
  files: ExportFilePayload[],
  onProgress?: (written: number, total: number) => void
): Promise<number> {
  let written = 0;

  for (const file of files) {
    const segments = file.relativePath.split('/').filter(Boolean);
    const filename = segments.pop();
    if (!filename) continue;

    let target = directory;
    for (const segment of segments) {
      target = await target.getDirectoryHandle(segment, { create: true });
    }

    const handle = await target.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    // Uint8Array, not a string — see base64ToBytes.
    await writable.write(base64ToBytes(file.contentBase64));
    await writable.close();

    written++;
    onProgress?.(written, files.length);
  }

  return written;
}

/** Save a Blob through the browser's normal download path. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Pull the server's filename out of a Content-Disposition header. */
export function filenameFromDisposition(header: string | undefined, fallback: string): string {
  return header?.match(/filename="?([^"]+)"?/)?.[1] ?? fallback;
}
