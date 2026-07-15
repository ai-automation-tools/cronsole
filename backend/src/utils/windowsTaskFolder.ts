/**
 * Validation + normalization for Windows Task Scheduler folder paths.
 *
 * Task Scheduler folders are real directories under
 * C:\Windows\System32\Tasks\, so each segment follows filename rules — the
 * same constraints as a task name, applied per segment.
 *
 * Why this is security-relevant rather than cosmetic:
 * `RegisterTaskDefinition` **silently overwrites** an existing task with the
 * same name in the same folder, and the agent runs **elevated**. So an
 * unvalidated folder lets a caller — the dashboard, or an AI through the MCP
 * `create_task_from_template` tool — clobber a real system task under
 * \Microsoft\Windows\ with no error at all. That is the confident-lie failure
 * mode with OS-level consequences, so \Microsoft\ is refused outright.
 *
 * The agent re-validates independently (it holds the elevation, so it must not
 * trust its caller). This module is the backend half; keep the two in sync.
 */

/** Where TaskHub puts created tasks unless told otherwise. */
export const DEFAULT_TASK_FOLDER = '\\TaskHub';

/**
 * Refused root. Windows' own scheduled tasks live under \Microsoft\Windows\,
 * and overwriting one is both silent and elevated. Compared case-insensitively
 * against the first segment, so \microsoft, \MICROSOFT\Windows, and
 * \Microsoft\Windows\SystemRestore are all refused together.
 */
const RESERVED_ROOT = 'microsoft';

// Characters Windows rejects in a path segment. The separators (\ and /) are
// excluded here because they delimit segments and are split on first.
const INVALID_SEGMENT_CHARS = /[:*?"<>|]/;
const MAX_SEGMENT_LENGTH = 200;
const MAX_DEPTH = 8;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 32) return true;
  }
  return false;
}

/**
 * Returns a user-facing problem description, or null when the folder is usable.
 * Accepts both separators; callers should normalize before use.
 */
export function windowsTaskFolderError(folder: string): string | null {
  if (typeof folder !== 'string' || !folder.trim()) {
    return 'Folder is required.';
  }

  const segments = folder.split(/[\\/]/).filter(s => s.length > 0);

  // The root folder itself is legitimate — plenty of third-party tasks live there.
  if (segments.length === 0) return null;

  if (segments.length > MAX_DEPTH) {
    return `Folder can be at most ${MAX_DEPTH} levels deep.`;
  }

  for (const segment of segments) {
    // Traversal. Task Scheduler has no notion of a relative path, so these are
    // never legitimate and are only ever an attempt to escape the target.
    if (segment === '.' || segment === '..') {
      return 'Folder cannot contain . or .. segments.';
    }
    if (segment.length > MAX_SEGMENT_LENGTH) {
      return `Each folder name must be ${MAX_SEGMENT_LENGTH} characters or fewer.`;
    }
    if (INVALID_SEGMENT_CHARS.test(segment) || hasControlChar(segment)) {
      return 'Folder names cannot contain : * ? " < > | or control characters.';
    }
    // Windows strips trailing dots/spaces from directory names, so "Work." would
    // silently collapse onto "Work" on disk — refuse rather than collide.
    if (segment.endsWith('.') || segment.endsWith(' ')) {
      return 'Folder names cannot end with a dot or a space.';
    }
  }

  if (segments[0].toLowerCase() === RESERVED_ROOT) {
    return 'TaskHub will not create tasks under \\Microsoft\\ — that is where Windows keeps its own scheduled tasks, and a name collision there would silently overwrite one. Choose another folder.';
  }

  return null;
}

/**
 * Canonical form: a leading backslash, backslash separators, no trailing
 * separator. The root folder normalizes to '\'. Assumes the folder already
 * passed windowsTaskFolderError.
 */
export function normalizeWindowsTaskFolder(folder: string): string {
  const segments = folder.split(/[\\/]/).filter(s => s.length > 0);
  if (segments.length === 0) return '\\';
  return '\\' + segments.join('\\');
}

/**
 * Build the full task path (the `externalId`) for a task in a folder.
 * Root-folder tasks are `\Name`, not `\\Name`.
 */
export function windowsTaskPath(folder: string, name: string): string {
  const normalized = normalizeWindowsTaskFolder(folder);
  return normalized === '\\' ? `\\${name}` : `${normalized}\\${name}`;
}
