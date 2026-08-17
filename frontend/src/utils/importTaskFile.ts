import { api } from '../api';

/**
 * One definition of "the user picked a task file".
 *
 * Two surfaces offer the gesture — the Tools tab card, where someone goes
 * looking for backup and restore, and the New Task modal, where someone is
 * already trying to create the thing the file describes. They are far apart in
 * the UI and close together in behaviour, which is exactly the pair that drifts:
 * one would keep the JSON parse error and the other would report "import
 * failed", and only one of those tells you the file is the problem.
 *
 * Deliberately thin. Every judgement about whether a file may become a task is
 * the backend's (`services/taskImport.ts`) — a check here would be one the REST
 * route still ignores, and the route is what the MCP tool and any script go
 * through.
 */

export interface ImportedTask {
  id: string;
  name: string;
  platform: string;
  schedule: string | null;
  nextRunTime: string | null;
}

/** Thrown for anything the user can act on: a bad file, or a refusal. */
export class TaskFileImportError extends Error {}

/**
 * Read a picked file and create the task it describes.
 *
 * The two failure kinds are kept apart on purpose. "That file is not valid
 * JSON" is about the file you chose; a 400 from the route is about what the file
 * *says*, and its wording names the screen that can handle it (a Windows bundle
 * points at Tools → Restore). Collapsing them into "import failed" throws away
 * the half that tells you what to do next.
 */
export async function importTaskFile(file: File): Promise<ImportedTask> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new TaskFileImportError(
      `${file.name} is not valid JSON. Pick the .json file Cronsole's Export produced.`
    );
  }

  try {
    // The body IS the file — the same contract POST /api/templates/import has,
    // so "import this" is one request carrying exactly what was downloaded.
    const res = await api.post('/tasks/import', parsed);
    return (res.data as { task: ImportedTask }).task;
  } catch (err) {
    const body = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error;
    if (body) throw new TaskFileImportError(String(body));
    throw new TaskFileImportError(
      (err as Error).message || 'Import failed — is the backend running?'
    );
  }
}
