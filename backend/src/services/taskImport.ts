import { PlatformType } from '@prisma/client';
import { CRONSOLE_TASK_VERSION } from './taskArchive.js';
import type { NativeTaskInput } from './nativeTaskCreate.js';

/**
 * Reading a Cronsole task file back in — the missing half of
 * `GET /api/tasks/:id/export`.
 *
 * That route, and the pre-delete archive that shares its bundle builder, have
 * produced `cronsoleTaskVersion` JSON since they shipped, and until now nothing
 * in the codebase could read one. An export with no importer is a download that
 * looks like a backup, and an archive with no restore is most of the way back to
 * having no archive at all — the failure only discovered on the day it matters.
 *
 * **Parsing is separate from creating on purpose.** Two callers hand a bundle to
 * `createNativeTask`: the import route (a file the user picked) and the archive
 * restore route (a bundle Cronsole wrote itself). Only the first is untrusted,
 * but both go through here, because a bundle written by an older version of
 * Cronsole is exactly as unverified as one a stranger typed.
 */

/** A refusal the caller should surface as a 400 — a bad file, not a bug. */
export class TaskImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskImportError';
  }
}

/** The major version this build can read. A different major is refused by name. */
const SUPPORTED_MAJOR = CRONSOLE_TASK_VERSION.split('.')[0];

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Name the *other* JSON files Cronsole hands out, rather than saying "not a task
 * file" and leaving the user to guess which of three exports they picked.
 *
 * Cronsole downloads three shapes of JSON — a task bundle, a template (or a
 * whole catalog), and a settings backup — and they land in the same Downloads
 * folder with similar names. A refusal that can tell them apart costs four lines
 * and saves the round trip through the wrong screen.
 */
function describeWrongFile(input: Record<string, unknown>): string | null {
  if ('cronsoleCatalogVersion' in input || Array.isArray(input.templates)) {
    return 'That looks like a Cronsole *template catalog* export. Templates are imported on the ' +
      'Templates tab (Import), and applying one is what creates a task from it.';
  }
  if ('commandTemplate' in input || ('schemaVersion' in input && 'action' in input)) {
    return 'That looks like a single Cronsole *template*, not a task. Import it on the Templates ' +
      'tab, then Apply it to create a task.';
  }
  if ('settings' in input || 'cronsoleSettingsVersion' in input) {
    return 'That looks like a Cronsole *settings* export. Load it from Settings → Data & reset → Import.';
  }
  return null;
}

/**
 * Validate a task bundle and lower it to the input `createNativeTask` takes.
 *
 * Everything refused here is refused **by name**, for the reason `buildNativeJob`
 * hands an unrecognized `jobType` through instead of coercing it: a file that
 * quietly becomes a different task than it describes is worse than a 400.
 */
export function parseTaskBundle(input: unknown): NativeTaskInput {
  if (!isPlainObject(input)) {
    throw new TaskImportError(
      Array.isArray(input)
        ? 'That file holds a list. A Cronsole task file describes exactly one task — import them one at a time.'
        : 'That is not a Cronsole task file. Expected a JSON object with a "cronsoleTaskVersion" field, ' +
          'as produced by Export on a Cronsole-native task.'
    );
  }

  // The archive detail route (`GET /api/tools/task-archives/:id`) returns the
  // bundle nested under `bundle`, alongside the run history. Unwrapping it means
  // a caller can hand back what it was just given — including an MCP client
  // pasting a tool result — instead of hitting a refusal about a shape Cronsole
  // itself produced.
  const bundle = isPlainObject(input.bundle) && 'cronsoleTaskVersion' in input.bundle
    ? input.bundle
    : input;

  const version = bundle.cronsoleTaskVersion;
  if (typeof version !== 'string' || !version.trim()) {
    const hint = describeWrongFile(bundle);
    throw new TaskImportError(
      hint ??
        'That file has no "cronsoleTaskVersion", so it is not a Cronsole task export. ' +
          'To restore a Windows task, use Tools → Restore with the .xml the export produced — ' +
          'a Windows task\'s definition is Task Scheduler XML, not JSON.'
    );
  }

  const major = version.split('.')[0];
  if (major !== SUPPORTED_MAJOR) {
    throw new TaskImportError(
      `That file is cronsoleTaskVersion ${version}; this Cronsole reads ${SUPPORTED_MAJOR}.x ` +
        `(current: ${CRONSOLE_TASK_VERSION}). The format changed incompatibly, so importing it would ` +
        'produce a task that is not the one the file describes.'
    );
  }

  const task = bundle.task;
  if (!isPlainObject(task)) {
    throw new TaskImportError('That file has no "task" object, so there is nothing to import.');
  }

  // A bundle carries the platform it was exported from, and only Cronsole-native
  // can round-trip: a native task's DB row *is* the task, while a Windows task's
  // definition lives on the machine. Importing a non-native bundle as native
  // would create a different kind of task than the file describes — so it is
  // refused by name, with the route that can actually do it.
  const platform = task.platform;
  if (platform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    throw new TaskImportError(
      'That bundle is from a Windows Task Scheduler task, and it records the task\'s identity but not its ' +
        'definition — that lives on the machine as Task Scheduler XML. Export the task to .xml and restore ' +
        'it with Tools → Restore, which registers it back through the agent.'
    );
  }
  if (platform !== PlatformType.TASKHUB_NATIVE) {
    throw new TaskImportError(
      `That bundle is from a ${String(platform ?? 'unknown')} task. Only Cronsole-native tasks can be ` +
        'imported from a file — every other platform owns its own definition, so Cronsole would be ' +
        'creating a copy rather than restoring the task.'
    );
  }

  const name = typeof task.name === 'string' ? task.name.trim() : '';
  if (!name) {
    throw new TaskImportError('That bundle has no task name.');
  }

  const schedule = typeof task.schedule === 'string' ? task.schedule.trim() : '';
  if (!schedule) {
    throw new TaskImportError(
      `"${name}" has no schedule in the file. A Cronsole-native task is scheduled by the backend, so ` +
        'there is no default to fall back on.'
    );
  }

  // `null` and missing are different facts and get different sentences: a null
  // job is what the archive writes for a task whose definition it could not
  // capture, which is a fact about that platform rather than a malformed file.
  if (task.job === null) {
    throw new TaskImportError(
      `"${name}" has no job spec in the file — the definition was never captured, so there is nothing to run.`
    );
  }
  if (!isPlainObject(task.job)) {
    throw new TaskImportError(
      `"${name}" has no readable job spec, so Cronsole cannot tell what the task was supposed to do.`
    );
  }

  return {
    name,
    // The platform owns neither of these, so the file is the only source — but a
    // missing category is a label, not a definition, and has a real default.
    category: typeof task.category === 'string' && task.category.trim() ? task.category.trim() : undefined,
    schedule,
    job: task.job
  };
}
