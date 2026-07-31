/**
 * Turning a sync response into the one sentence the dashboard owed the user.
 *
 * Sync Now can only refresh folders you already track — it **cannot discover a
 * new one**. So tasks can sit one fence away indefinitely while every sync
 * reports a cheerful "Tasks synced." That silence is the defect (troubleshooting
 * #20): a user created tasks in two new folders, pressed Sync Now repeatedly,
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

  // An import that forgot exclusions brought back tasks the user had removed on
  // purpose. That is the correct behavior — importing a folder is asking for the
  // folder — but it must be *stated*, or a row reappears with no explanation and
  // untrack looks broken. Said first, because it is the surprising part.
  const restored = results.reduce((n, r) => n + (r.exclusionsCleared ?? 0), 0);
  const restoredNote = restored > 0
    ? `Re-imported ${restored} task${restored === 1 ? '' : 's'} you had removed from Cronsole. `
    : '';

  const count = results.reduce((n, r) => n + (r.untracked?.count ?? 0), 0);
  if (count <= 0) return restoredNote ? restoredNote.trimEnd() : null;

  const folders = new Set(results.flatMap(r => r.untracked?.folders ?? [])).size;

  const tasksWord = count === 1 ? 'task' : 'tasks';
  const foldersWord = folders === 1 ? 'folder' : 'folders';
  const verb = count === 1 ? "isn't" : "aren't";
  const object = count === 1 ? 'it' : 'them';

  return (
    `${restoredNote}Synced. ${count} ${tasksWord} in ${folders} ${foldersWord} ${verb} imported — ` +
    `use Import to add ${object}.`
  );
}
