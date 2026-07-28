/**
 * Reading a backup back off disk — the input half of `saveExport.ts`.
 *
 * Task Scheduler XML is UTF-16 LE with a BOM, and those bytes have to reach the
 * agent unaltered or Windows refuses the import. So nothing here ever decodes a
 * file to text: every file is read as bytes and base64-encoded, exactly as the
 * export sends them in the other direction. Reading a `.xml` as a string and
 * posting it as JSON is the same trap the MCP export tool hit, arriving from the
 * opposite side.
 */

export interface RestoreUpload {
  /** A whole `.zip`, base64. Mutually exclusive with `files`. */
  archiveBase64?: string;
  /** Individually picked files (or a picked directory), base64 each. */
  files?: { relativePath: string; contentBase64: string }[];
}

/**
 * Base64 for arbitrary bytes.
 *
 * Chunked rather than one `String.fromCharCode(...bytes)`: spreading a multi-MB
 * archive into arguments overflows the call stack, which shows up as a crash on
 * exactly the large backup you most wanted to restore.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The path a picked file should be known by — its position inside a picked folder, if any. */
export function relativePathOf(file: File): string {
  const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  if (!webkitPath) return file.name;
  // Drop the picked folder's own name, so `MyBackup/Work/Nightly.xml` becomes
  // `Work/Nightly.xml` and the folder tree inside the export is what survives —
  // otherwise every restored task would gain a phantom top-level folder.
  const segments = webkitPath.split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(1).join('/') : webkitPath;
}

/**
 * Turn a FileList into the request body the restore route takes.
 *
 * A single `.zip` is sent as an archive for the server to expand, because the
 * server already has JSZip and the browser does not — and adding a zip library
 * to the bundle to do work the backend can do is a cost with no return.
 */
export async function readRestoreSelection(fileList: File[]): Promise<RestoreUpload> {
  const single = fileList.length === 1 ? fileList[0] : null;
  if (single && /\.zip$/i.test(single.name)) {
    return { archiveBase64: bytesToBase64(new Uint8Array(await single.arrayBuffer())) };
  }

  const files = await Promise.all(
    fileList.map(async file => ({
      relativePath: relativePathOf(file),
      contentBase64: bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    }))
  );

  return { files };
}
