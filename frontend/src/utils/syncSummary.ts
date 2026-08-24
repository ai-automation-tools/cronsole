/**
 * Turning a sync response into the one sentence the dashboard owed the user.
 *
 * A plain Sync can only refresh folders you already track — it **cannot discover a
 * new one**. So tasks can sit one fence away indefinitely while every sync
 * reports a cheerful "Tasks synced." That silence is the defect (troubleshooting
 * #20): a user created tasks in two new folders, pressed Sync repeatedly,
 * and spent a full debugging session establishing that nothing was broken.
 *
 * Kept as a pure function so the copy — including its plural forms — is pinned
 * by tests rather than only existing inside a mutation callback.
 */

export interface SyncPlatformResult {
  platform: string;
  error?: string;
  untracked?: { count: number; folders: string[]; systemCount: number; excludedCount?: number };
  /** Untracks forgotten because the user explicitly re-imported those folders. */
  exclusionsCleared?: number;
  /**
   * What this platform's sync **covered**, in the connector's own words.
   *
   * Routine and true on a healthy run — "read 9 workflows across 3 repositories,
   * 3 scheduled" — so it rides with the success toast and obeys `toastOnSuccess`.
   */
  notes?: string[];
  /**
   * What this platform's sync could **not** do while still returning what it had.
   *
   * A repository that failed while others worked; a listing truncated at a page
   * limit. Never suppressed, for the same reason the untracked sentence is not:
   * *it worked* noise and *this part did not* are opposite things, and a partial
   * read reported as success noise is how a truncated sync passes for a whole one.
   */
  warnings?: string[];
}

export interface SyncResponse {
  results?: SyncPlatformResult[];
}

/**
 * The un-imported sentence, or `null` when everything the platforms reported is
 * already tracked (the caller then falls back to the plain success message).
 *
 * Folders are counted across platforms as a **set**: two platforms reporting the
 * same folder name is one folder to the user, and inflating the number would be
 * its own small dishonesty in a message whose entire job is to be accurate.
 */
export function describeUntracked(data: SyncResponse | undefined): string | null {
  const results = data?.results ?? [];

  const warnings = results.flatMap(r => r.warnings ?? []);
  const warningText = warnings.length ? `${warnings.join(' ')} ` : '';

  // An import that forgot exclusions brought back tasks the user had removed on
  // purpose. That is the correct behavior — importing a folder is asking for the
  // folder — but it must be *stated*, or a row reappears with no explanation and
  // untrack looks broken. Said first, because it is the surprising part.
  const restored = results.reduce((n, r) => n + (r.exclusionsCleared ?? 0), 0);
  const restoredNote = restored > 0
    ? `Re-imported ${restored} task${restored === 1 ? '' : 's'} you had removed from Cronsole. `
    : '';

  const count = results.reduce((n, r) => n + (r.untracked?.count ?? 0), 0);
  if (count <= 0) {
    const said = `${restoredNote}${warningText}`.trimEnd();
    return said || null;
  }

  const folders = new Set(results.flatMap(r => r.untracked?.folders ?? [])).size;

  const tasksWord = count === 1 ? 'task' : 'tasks';
  const foldersWord = folders === 1 ? 'folder' : 'folders';
  const verb = count === 1 ? "isn't" : "aren't";
  const object = count === 1 ? 'it' : 'them';

  // Names the control as it is labelled on screen. It used to say "use Import",
  // which stopped being true the day Import became the file importer and
  // adopting a machine's folders moved under Sync.
  return (
    `${restoredNote}${warningText}Synced. ${count} ${tasksWord} in ${folders} ${foldersWord} ${verb} imported — ` +
    `add ${object} from Sync › Add tasks from this machine.`
  );
}

/**
 * What the sync **covered** — the line that answers *"why is nothing here?"*.
 *
 * **A sync that correctly imported nothing and a sync that is broken look
 * identical without it**, and that is not hypothetical: a real defect hid behind
 * exactly this silence until the database was read by hand (troubleshooting
 * #75), while the ordinary case it resembles — a repository whose workflows all
 * run on `push` — is working perfectly. Saying what was looked at separates the
 * two in one sentence.
 *
 * Separate from {@link describeUntracked} because it is *success* information:
 * it appears on a completely healthy sync, so it belongs to the toast a user can
 * turn off. Anything that must be seen is a `warning` and travels with the other
 * function.
 */
export function describeCoverage(data: SyncResponse | undefined): string | null {
  const notes = (data?.results ?? []).flatMap(r => r.notes ?? []);
  return notes.length ? notes.join(' ') : null;
}
