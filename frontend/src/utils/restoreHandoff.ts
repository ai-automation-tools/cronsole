/**
 * A file picked on one screen, opened on another.
 *
 * Import takes *a file* — any file a Cronsole export produced — but a Windows
 * backup cannot be imported the way a Cronsole task can. Its definition is Task
 * Scheduler XML, and putting one back is the restore flow: a dry run first, the
 * plan on screen, `createFolders` and `overwrite` stated, a sha256 inside the
 * signature. **That flow has exactly one definition** (`RestoreTool`), and a
 * second copy of it living inside the Import modal is how a restore preview and
 * a restore stop agreeing about what a click will do.
 *
 * So Import hands the file over instead of re-implementing the destination:
 * stage it here, open the Restore card, and let the tool that owns restoring do
 * the planning. The user picked a file and sees a plan for it — the screen it
 * happened on is Cronsole's problem, not theirs.
 *
 * A module-level store rather than router state: a `File` survives history state
 * technically, but it would then also survive a reload and a back button, and a
 * file that reappears from a previous session on a screen that acts on machines
 * is the wrong kind of durable. This is consumed once and gone.
 */

let staged: File[] | null = null;

/** Hand files to the Restore tool. Replaces anything staged and not yet taken. */
export function stageRestore(files: File[]): void {
  staged = files.length ? files : null;
}

/** Take what was staged, exactly once. `null` when nothing is waiting. */
export function takeStagedRestore(): File[] | null {
  const files = staged;
  staged = null;
  return files;
}
