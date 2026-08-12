import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, FolderInput, Loader2, X } from 'lucide-react';
import { Modal } from './ui/Modal';

/**
 * Pick the category a bulk selection moves into.
 *
 * A modal rather than a `prompt()`, for the reason every other dialog here is:
 * a free-text box invites `Backups`, `backups` and `Back ups` as three
 * categories, so the existing ones are offered as chips and typing is the
 * fallback rather than the default.
 *
 * **It says what recategorizing does not do.** A Windows task's category is
 * derived from its real Task Scheduler folder, so on the dashboard the label
 * and the folder look like the same fact — and after this they are not. The
 * server counts and reports that (`detachedFromFolder`), but a warning that
 * only arrives in the result toast is a warning that arrives too late to change
 * the decision. So the count of affected Windows tasks is stated here, before
 * the click, and the action is still allowed: it is a legitimate thing to want,
 * and it was always possible one task at a time.
 */
interface BulkCategoryModalProps {
  /** How many tasks the change will apply to. */
  taskCount: number;
  /** How many of those are Windows tasks whose label would leave its folder. */
  windowsCount: number;
  /** Categories already in use, for the chips. `All` is filtered out. */
  existingCategories: string[];
  onApply: (category: string) => void;
  onClose: () => void;
  isPending: boolean;
}

export const BulkCategoryModal = ({
  taskCount,
  windowsCount,
  existingCategories,
  onApply,
  onClose,
  isPending
}: BulkCategoryModalProps) => {
  const [category, setCategory] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const chips = useMemo(
    () => existingCategories.filter(c => c && c !== 'All'),
    [existingCategories]
  );

  const trimmed = category.trim();
  const canApply = trimmed.length > 0 && !isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canApply) onApply(trimmed);
  };

  return (
    <Modal
      onClose={onClose}
      labelledBy="bulk-category-title"
      describedBy="bulk-category-desc"
      initialFocusRef={inputRef}
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl"
    >
      <form onSubmit={submit} className="p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="bulk-category-title" className="text-lg font-bold flex items-center gap-2">
              <FolderInput size={18} className="text-primary" />
              Move {taskCount} task{taskCount === 1 ? '' : 's'} into a category
            </h2>
            <p id="bulk-category-desc" className="text-sm text-muted-foreground mt-1">
              Categories group tasks on this dashboard. Nothing on your machine is changed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-subtle-foreground hover:text-foreground hover:bg-background transition-colors"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2">
          <label htmlFor="bulk-category-input" className="text-xs font-bold text-foreground">
            Category
          </label>
          <input
            id="bulk-category-input"
            ref={inputRef}
            value={category}
            onChange={e => setCategory(e.target.value)}
            maxLength={100}
            placeholder="e.g. Backups"
            className="w-full px-3 py-2 rounded-xl bg-background border border-border text-sm text-foreground placeholder:text-subtle-foreground focus:outline-none focus:border-primary"
          />
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {chips.map(chip => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setCategory(chip)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                    trimmed === chip
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background text-muted-foreground border-border hover:text-foreground'
                  }`}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}
        </div>

        {windowsCount > 0 && (
          <p
            className="flex gap-2 text-xs text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2"
            role="note"
          >
            <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            <span>
              {windowsCount} of these {windowsCount === 1 ? 'is a Windows task' : 'are Windows tasks'}. Their
              category comes from the Task Scheduler folder they live in, and this only changes the label —
              they stay in the same folder on your machine.
            </span>
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-muted hover:bg-muted/80 text-foreground border border-border transition-all active:scale-95"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canApply}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold bg-primary hover:bg-primary/90 text-primary-foreground transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {isPending && <Loader2 size={14} className="animate-spin" />}
            {/* The count is in the button, like every other confirm in this app:
                a number that arrives after the action is a report, not a
                decision. */}
            Move {taskCount} task{taskCount === 1 ? '' : 's'}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default BulkCategoryModal;
