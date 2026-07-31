import { PlatformType } from '@prisma/client';
import { prisma } from '../db.js';
import { HttpError } from '../middleware/errorHandler.js';
import { DEFAULT_TASK_FOLDER, normalizeWindowsTaskFolder, windowsTaskPath } from './windowsTaskFolder.js';

/**
 * Validation + collision guard for Windows task names.
 *
 * Task Scheduler stores each task as a file under
 * C:\Windows\System32\Tasks\<folder>\<name>, so names follow filename rules.
 * More importantly, RegisterTaskDefinition silently OVERWRITES an existing
 * task with the same name in the same folder — so before creating we refuse
 * names that collide with a task Cronsole already tracks (409). Untracked
 * same-name tasks can still be overwritten (the agent can't cheaply enumerate
 * pre-register), but every Cronsole-created task is tracked, so the common
 * self-collision is closed.
 *
 * The collision is **per folder**, because that is how Task Scheduler's
 * overwrite works: \Work\Backup and \TaskHub\Backup are different tasks, while
 * two \Work\Backup are the same one. So the guard takes the target folder — it
 * used to assume \TaskHub\, and once folders became selectable that assumption
 * would have made it silently stop matching, which is worse than having no
 * guard at all: the UI would still imply you were protected while Windows
 * overwrote the task without an error.
 */

// Characters Windows rejects in task (file) names (control chars are
// checked separately by code point, keeping this file escape-free).
const INVALID_CHARS = /[\\/:*?"<>|]/;
const MAX_NAME_LENGTH = 200;

/** Returns a user-facing problem description, or null when the name is fine. */
export function windowsTaskNameError(name: string): string | null {
  if (!name.trim()) return 'Task name is required.';
  if (name.length > MAX_NAME_LENGTH) {
    return `Task name must be ${MAX_NAME_LENGTH} characters or fewer.`;
  }
  if (INVALID_CHARS.test(name) || hasControlChar(name)) {
    return 'Task name cannot contain \\ / : * ? " < > | or control characters.';
  }
  // Windows strips trailing dots/spaces from file names, so "Backup." would
  // silently collapse onto "Backup" on disk — refuse rather than collide.
  if (name.endsWith('.') || name.endsWith(' ')) {
    return 'Task name cannot end with a dot or a space.';
  }
  return null;
}

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) < 32) return true;
  }
  return false;
}

/**
 * Throw a 400 for an invalid name or a 409 when a tracked task already owns
 * <folder>\<name> (Windows names are case-insensitive, so match that way).
 *
 * `folder` defaults to \TaskHub for callers that haven't opted into choosing
 * one; it is assumed to have already passed windowsTaskFolderError.
 */
export async function assertWindowsTaskNameAvailable(
  userId: string,
  name: string,
  folder: string = DEFAULT_TASK_FOLDER
): Promise<void> {
  const problem = windowsTaskNameError(name);
  if (problem) {
    throw new HttpError(400, problem);
  }

  // Prisma's insensitive mode compiles to ILIKE, where `\` is the escape
  // character — a path like \TaskHub\x silently never matches. So match
  // insensitively on the backslash-free NAME column (pattern chars there only
  // widen the candidate set), then compare the full path exactly in JS.
  const candidates = await prisma.task.findMany({
    where: {
      userId,
      platform: PlatformType.WINDOWS_TASK_SCHEDULER,
      name: { equals: name, mode: 'insensitive' }
    },
    select: { id: true, name: true, externalId: true }
  });
  const target = windowsTaskPath(folder, name).toLowerCase();
  const existing = candidates.find(t => t.externalId.toLowerCase() === target);
  if (existing) {
    const where = normalizeWindowsTaskFolder(folder);
    throw new HttpError(
      409,
      `A Windows task named "${existing.name}" already exists in ${where} — creating another would overwrite it. Choose a different name, a different folder, or delete the existing task first.`
    );
  }
}
