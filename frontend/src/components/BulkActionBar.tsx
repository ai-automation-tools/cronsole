import { CheckSquare, Download, EyeOff, FolderInput, Loader2, Power, PowerOff, X } from 'lucide-react';

/**
 * The bulk-action toolbar, shown only while something is selected.
 *
 * Three things here are load-bearing rather than decorative.
 *
 * **It names how many selected tasks are not on screen.** All four views render
 * from one `filteredTasks` array, but that array itself branches on view mode:
 * kanban deliberately shows the disabled tasks the other three hide. So
 * switching views can leave a selection holding rows the user can no longer see.
 * Silently dropping them would be the cheaper fix and the dishonest one — the
 * selection is keyed by id and survives, so the bar states the gap, exactly as
 * the active/all toggle already does with `Active Only · 110 hidden`.
 *
 * **It states the count before the click**, in the button itself — the same
 * shape the Import modal settled on ("Import 354 tasks"), for the same reason:
 * a number that arrives after the action is a report, not a decision. Every
 * button counts what it will *actually* change, never the selection size: a
 * selection of 12 whose 9 enabled rows are already enabled is a 3-task Enable.
 *
 * **Untrack sits beside the destructive actions and is not one of them.**
 * Removing 40 accidentally-imported rows and destroying 40 real scheduled tasks
 * are one click apart in the UI and a world apart in consequence, so the safe
 * one is present, labelled for what it does ("Remove from Cronsole", never
 * "Remove"), and is the one that reads as ordinary. A safe path that is harder
 * to find than the destructive one stops being used.
 */
interface BulkActionBarProps {
  selectedCount: number;
  /** Of the selection, how many are not in the current view's task list. */
  offscreenCount: number;
  /** How many of the selected tasks are currently ACTIVE / not. */
  enabledCount: number;
  disabledCount: number;
  /**
   * How many can be untracked — i.e. exist on a platform outside Cronsole. A
   * Cronsole-native task's row *is* the task, so there is nothing to keep.
   */
  untrackableCount: number;
  /** How many can be exported as Task Scheduler XML (Windows tasks). */
  exportableCount: number;
  onEnable: () => void;
  onDisable: () => void;
  onRecategorize: () => void;
  onUntrack: () => void;
  onExport: () => void;
  onClear: () => void;
  isPending: boolean;
}

const plural = (n: number) => `${n} task${n === 1 ? '' : 's'}`;

export const BulkActionBar = ({
  selectedCount,
  offscreenCount,
  enabledCount,
  disabledCount,
  untrackableCount,
  exportableCount,
  onEnable,
  onDisable,
  onRecategorize,
  onUntrack,
  onExport,
  onClear,
  isPending
}: BulkActionBarProps) => {
  if (selectedCount === 0) return null;

  // The visible label is terse ("Enable 3"); the accessible name has to carry
  // the noun and the reason, because a screen reader gets no help from the
  // surrounding chip. `title` alone would not do it — a button with text content
  // takes its accessible name from that text, not from its tooltip.
  const enableLabel =
    disabledCount === 0 ? 'Enable — every selected task is already enabled' : `Enable ${plural(disabledCount)}`;
  const disableLabel =
    enabledCount === 0 ? 'Disable — every selected task is already disabled' : `Disable ${plural(enabledCount)}`;
  const untrackLabel =
    untrackableCount === 0
      ? 'Remove from Cronsole — Cronsole-native tasks exist only here, so there is nothing to keep'
      : `Remove ${plural(untrackableCount)} from Cronsole, leaving them running on their platform`;
  const exportLabel =
    exportableCount === 0
      ? 'Export XML — only Windows Task Scheduler tasks export as native XML'
      : `Export ${plural(exportableCount)} as Task Scheduler XML`;

  const buttonBase =
    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100';
  const neutralButton = `${buttonBase} bg-muted hover:bg-muted/80 text-foreground border border-border`;

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="flex flex-wrap items-center gap-3 bg-primary/10 border border-primary/40 rounded-2xl px-4 py-3 shadow-lg"
    >
      <span className="flex items-center gap-2 text-xs font-bold text-foreground">
        <CheckSquare size={14} className="text-primary" />
        {selectedCount} selected
        {offscreenCount > 0 && (
          <span
            className="text-warning-text font-semibold"
            title="Kanban shows disabled tasks the other views hide, so switching views can leave part of your selection off screen. It is still selected and will still be acted on."
          >
            · {offscreenCount} not visible here
          </span>
        )}
      </span>

      <div className="flex flex-wrap items-center gap-2 ml-auto">
        {/* Each button names what it will actually change — not the selection
            size. Asking to enable 12 tasks of which 9 are already enabled is a
            3-task operation, and saying "Enable 12" would be the same inflation
            the server's `unchanged` outcome exists to avoid. */}
        <button
          onClick={onEnable}
          disabled={isPending || disabledCount === 0}
          className={`${buttonBase} bg-success hover:bg-success-hover text-success-foreground`}
          title={enableLabel}
          aria-label={enableLabel}
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
          Enable {disabledCount > 0 && disabledCount}
        </button>

        <button
          onClick={onDisable}
          disabled={isPending || enabledCount === 0}
          className={neutralButton}
          title={disableLabel}
          aria-label={disableLabel}
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <PowerOff size={13} />}
          Disable {enabledCount > 0 && enabledCount}
        </button>

        {/* Recategorize applies to every selected task and cannot refuse any of
            them, so it is the one button with no eligibility count to state. */}
        <button
          onClick={onRecategorize}
          disabled={isPending}
          className={neutralButton}
          title={`Move ${plural(selectedCount)} into a category`}
          aria-label={`Move ${plural(selectedCount)} into a category`}
        >
          <FolderInput size={13} />
          Categorize
        </button>

        <button
          onClick={onExport}
          disabled={isPending || exportableCount === 0}
          className={neutralButton}
          title={exportLabel}
          aria-label={exportLabel}
        >
          <Download size={13} />
          Export {exportableCount > 0 && exportableCount}
        </button>

        {/* "Remove from Cronsole", never "Remove". The label is the only thing
            standing between this and the delete it is deliberately not. */}
        <button
          onClick={onUntrack}
          disabled={isPending || untrackableCount === 0}
          className={neutralButton}
          title={untrackLabel}
          aria-label={untrackLabel}
        >
          <EyeOff size={13} />
          Untrack {untrackableCount > 0 && untrackableCount}
        </button>

        <button
          onClick={onClear}
          disabled={isPending}
          className="p-1.5 rounded-xl text-subtle-foreground hover:text-foreground hover:bg-background transition-colors disabled:opacity-40"
          title="Clear selection"
          aria-label="Clear selection"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default BulkActionBar;
