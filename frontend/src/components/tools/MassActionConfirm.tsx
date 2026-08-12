import { useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import {
  needsTypedConfirmation,
  TYPE_TO_CONFIRM_THRESHOLD,
  type MassVerb
} from '../../utils/massActions';

/**
 * The confirmation that gets harder as the operation gets bigger.
 *
 * **This is the actual safety mechanism of the Mass Actions console** — not the
 * fact that the console lives on another tab. Bulk status and untrack already
 * confirmed before this existed, and already named the number they would change;
 * what was missing is that the dialog for 254 tasks was the *same dialog* as the
 * dialog for 3. Nothing about it got harder as the blast radius grew, so habit
 * built on small batches carried straight through to a machine-wide one. Moving
 * a button to a different tab is friction by obscurity and wears off; a dialog
 * that hardens with scale is friction by design.
 *
 * Two things it must do that a plain confirm cannot:
 *
 *  - **Say the scope in words.** `254 selected` is not checkable; *"every
 *    tracked task of yours"* is. The count alone cannot be verified by the
 *    person reading it, so the sentence has to carry what the set *was chosen
 *    by* — the reason the console is scope-first in the first place.
 *  - **Cost a deliberate act past the threshold.** Typing the number is not
 *    security theatre: it is the smallest gesture that cannot be produced by
 *    the muscle memory of clicking "OK" in the same place for the tenth time.
 */
interface Props {
  verb: MassVerb;
  /** Human phrase for the scope — see `describeScope`. */
  scopeLabel: string;
  /** How many tasks the verb will actually change. */
  count: number;
  /** How many are in scope at all, so a large no-op is legible. */
  scopeSize: number;
  categories: string[];
  /** For categorize: how many Windows tasks would detach from their folder. */
  detachedCount: (category: string) => number;
  onCancel: () => void;
  onConfirm: (category?: string) => void;
}

const COPY: Record<MassVerb, { title: (n: string) => string; body: string; cta: (n: number) => string }> = {
  enable: {
    title: n => `Enable ${n}?`,
    body: 'They will start running on their schedules again. Each Windows task is applied through the local agent.',
    cta: n => `Enable ${n}`
  },
  disable: {
    title: n => `Disable ${n}?`,
    body: 'They will stop running on their schedules. Nothing is deleted, and you can re-enable them at any time — including with the Undo button after this runs.',
    cta: n => `Disable ${n}`
  },
  categorize: {
    title: n => `Move ${n} into a category?`,
    body: 'A category is a Cronsole label. Nothing moves on your machine, and no Task Scheduler folder changes.',
    cta: n => `Move ${n}`
  },
  untrack: {
    title: n => `Remove ${n} from Cronsole?`,
    body: 'This removes Cronsole’s records and their run history. Nothing on your machine is touched — these scheduled tasks keep running on their own schedules. Re-import their category to track them again.',
    cta: n => `Remove ${n} from Cronsole`
  },
  export: {
    title: n => `Export ${n}?`,
    body: 'Each Windows task is written as native Task Scheduler XML.',
    cta: n => `Export ${n}`
  }
};

export const MassActionConfirm = ({
  verb,
  scopeLabel,
  count,
  scopeSize,
  categories,
  detachedCount,
  onCancel,
  onConfirm
}: Props) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState('');
  const [category, setCategory] = useState(categories[0] ?? '');

  const copy = COPY[verb];
  const noun = `${count} task${count === 1 ? '' : 's'}`;
  const mustType = needsTypedConfirmation(count);
  const typedOk = !mustType || typed.trim() === String(count);
  const categoryOk = verb !== 'categorize' || category.trim().length > 0;
  const canConfirm = typedOk && categoryOk && count > 0;

  const detached = verb === 'categorize' ? detachedCount(category) : 0;

  return (
    <Modal
      onClose={onCancel}
      role="alertdialog"
      labelledBy="mass-confirm-title"
      describedBy="mass-confirm-desc"
      // Focus lands on Cancel, not the confirm button: the default action of a
      // destructive dialog must never be the destructive one.
      initialFocusRef={cancelRef}
      closeOnBackdrop={false}
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl"
    >
      <div className="p-6 space-y-5">
        <div>
          <h3 id="mass-confirm-title" className="text-lg font-bold">
            {copy.title(noun)}
          </h3>
          {/* The scope in words. This is the half a count cannot supply. */}
          <p className="text-xs text-primary font-bold mt-1">Scope: {scopeLabel}</p>
        </div>

        <p id="mass-confirm-desc" className="text-sm text-muted-foreground">
          {copy.body}
        </p>

        {/* A large scope that resolves to a small change is worth saying out
            loud — otherwise the dialog looks like it is about the scope. */}
        {scopeSize > count && (
          <p className="text-xs text-subtle-foreground">
            {scopeSize} tasks are in scope; {scopeSize - count} of them need no change and will be
            left alone.
          </p>
        )}

        {verb === 'categorize' && (
          <div className="space-y-2">
            <label htmlFor="mass-category" className="text-[10px] font-bold text-subtle-foreground">
              CATEGORY
            </label>
            <input
              id="mass-category"
              list="mass-category-options"
              value={category}
              onChange={e => setCategory(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
              placeholder="e.g. Backups"
            />
            <datalist id="mass-category-options">
              {categories.map(c => <option key={c} value={c} />)}
            </datalist>
            {/* Named before the click, because a warning that arrives with the
                result arrives too late to change the decision it was about. */}
            {detached > 0 && (
              <p className="text-xs text-amber-400">
                {detached} Windows task{detached === 1 ? '' : 's'} will have a category that no longer
                matches its Task Scheduler folder. That is allowed and nothing moves on your machine —
                but the two will disagree from now on.
              </p>
            )}
          </div>
        )}

        {mustType && (
          <div className="space-y-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
            <p className="flex items-start gap-2 text-xs text-amber-400 font-bold">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                This is {count} tasks — at or above the {TYPE_TO_CONFIRM_THRESHOLD}-task line where a
                click stops being enough. Type <strong>{count}</strong> to confirm.
              </span>
            </p>
            {/* The placeholder must NOT be the bare count. Caught in the browser:
                a grey `70` in an empty field reads as already filled in, so the
                dialog looks satisfied when it is not — and the one thing this
                control cannot afford is to look like it has been answered.
                Stating the number in the sentence above is fine and deliberate:
                typing is not a secret, it is a deliberate act that muscle memory
                cannot produce. */}
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              inputMode="numeric"
              aria-label={`Type ${count} to confirm`}
              placeholder={`Type ${count} here`}
              className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary tabular-nums"
            />
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(verb === 'categorize' ? category.trim() : undefined)}
            disabled={!canConfirm}
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-6 py-2 rounded-xl text-sm font-bold disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-95"
          >
            {copy.cta(count)}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default MassActionConfirm;
