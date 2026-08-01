import { CheckSquare, Loader2, Power, PowerOff, X } from 'lucide-react';

/**
 * The bulk-action toolbar, shown only while something is selected.
 *
 * Two things here are load-bearing rather than decorative.
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
 * a number that arrives after the action is a report, not a decision.
 */
interface BulkActionBarProps {
  selectedCount: number;
  /** Of the selection, how many are not in the current view's task list. */
  offscreenCount: number;
  /** How many of the selected, on-screen tasks are currently ACTIVE / not. */
  enabledCount: number;
  disabledCount: number;
  onEnable: () => void;
  onDisable: () => void;
  onClear: () => void;
  isPending: boolean;
}

const plural = (n: number) => `${n} task${n === 1 ? '' : 's'}`;

export const BulkActionBar = ({
  selectedCount,
  offscreenCount,
  enabledCount,
  disabledCount,
  onEnable,
  onDisable,
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
            className="text-amber-400 font-semibold"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-success hover:bg-success-hover text-success-foreground transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          title={enableLabel}
          aria-label={enableLabel}
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <Power size={13} />}
          Enable {disabledCount > 0 && disabledCount}
        </button>

        <button
          onClick={onDisable}
          disabled={isPending || enabledCount === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-muted hover:bg-muted/80 text-foreground border border-border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          title={disableLabel}
          aria-label={disableLabel}
        >
          {isPending ? <Loader2 size={13} className="animate-spin" /> : <PowerOff size={13} />}
          Disable {enabledCount > 0 && enabledCount}
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
