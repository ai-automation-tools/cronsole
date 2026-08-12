import { useState } from 'react';
import { Bookmark, BookmarkPlus, Check, RotateCcw, Star, X } from 'lucide-react';
import { isBuiltinView, type SavedView } from '../utils/savedViews';

/**
 * Saved views — the named filter combinations across the top of the dashboard.
 *
 * At 350+ tasks "show me everything" is never the question, and until now every
 * filter reset on each visit, so the useful question had to be re-assembled by
 * hand each time. A view is that question kept.
 *
 * Two honesty rules shape this bar, both inherited from the toggles below it:
 *
 * **A chip counts what it would show, or it shows no count at all.** The
 * "Failures" view is answered by the server's health scan; until that arrives
 * there is no honest number, so the chip renders a `–` rather than a `0`. Zero
 * means "nothing is failing", which is a claim, and a much more comforting one
 * than "I have not looked yet".
 *
 * **Tweaking any filter drops you to "Custom".** Leaving "Failures" lit while
 * the list underneath has been narrowed to one category would make the label a
 * lie about its own contents — the same reason `Active Only` had to start
 * naming the 110 rows it was holding back.
 */
interface ViewBarProps {
  views: SavedView[];
  /** The view the current filters *are*, or null for an ad-hoc combination. */
  activeViewId: string | null;
  /** Per-view match count; `null` where it cannot yet be evidenced. */
  counts: Map<string, number | null>;
  /** One line naming what the current ad-hoc filters constrain. */
  currentDescription: string;
  onSelect: (view: SavedView) => void;
  onSave: (name: string) => void;
  onDelete: (view: SavedView) => void;
  /** Back to the default dashboard (active, personal, no other constraints). */
  onReset: () => void;
}

export const ViewBar = ({
  views,
  activeViewId,
  counts,
  currentDescription,
  onSelect,
  onSave,
  onDelete,
  onReset
}: ViewBarProps) => {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
    setNaming(false);
  };

  return (
    <div
      role="group"
      aria-label="Saved views"
      /*
        One scrolling row on a phone, wrapping chips on a desktop.
        Wrapping is right when there is width to wrap into; at 375px six views
        became four stacked rows before a single task was visible, which is the
        first-viewport problem this pass exists to fix. A horizontal scroller
        costs one gesture and keeps the list one line tall.
        `-mx-4 px-4` bleeds it to the screen edge so the last chip is visibly
        cut off rather than sitting flush — an edge-aligned row reads as complete
        and nobody swipes it.
      */
      className="flex items-center gap-2 overflow-x-auto sm:overflow-visible sm:flex-wrap -mx-4 px-4 sm:mx-0 sm:px-0 pb-1.5 sm:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-subtle-foreground shrink-0">
        <Bookmark size={12} /> Views
      </span>

      {views.map(view => {
        const active = view.id === activeViewId;
        const count = counts.get(view.id);
        return (
          <span key={view.id} className="relative group/view shrink-0">
            <button
              onClick={() => onSelect(view)}
              aria-pressed={active}
              title={view.blurb}
              className={`flex items-center gap-1.5 whitespace-nowrap pl-3 pr-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted-foreground border-border hover:text-foreground hover:border-foreground/20'
              } ${isBuiltinView(view.id) ? '' : 'group-hover/view:pr-7'}`}
            >
              {/*
                The Favorites chip carries the same star the tasks do, in the
                same amber. It is `text-warning-text`, never a raw `text-yellow-…`
                utility: one literal cannot be legible on both the dark surface
                and the light one, which is why every status colour here is a
                role token (see index.css). `fill-current` matches a *starred*
                task's star rather than the hollow outline of an unstarred one —
                the chip stands for the set, not for the act of starring.
              */}
              {view.id === 'favorites' && (
                <Star
                  size={11}
                  aria-hidden="true"
                  className={`shrink-0 fill-current ${active ? '' : 'text-warning-text'}`}
                />
              )}
              {view.name}
              {/*
                `null` is not zero. A view whose count depends on the health
                scan has no number until that lands, and printing 0 there would
                assert something the app has not checked.
              */}
              <span
                className={`px-1 py-0.5 rounded text-[9px] tabular-nums ${
                  active ? 'bg-black/20' : 'bg-muted text-subtle-foreground'
                }`}
                title={count === null ? 'Waiting on the health check — no count yet' : undefined}
              >
                {count === null || count === undefined ? '–' : count}
              </span>
            </button>
            {!isBuiltinView(view.id) && (
              <button
                onClick={() => onDelete(view)}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-md opacity-0 group-hover/view:opacity-100 focus:opacity-100 text-subtle-foreground hover:text-danger-text transition-opacity"
                title={`Delete the "${view.name}" view`}
                aria-label={`Delete the "${view.name}" view`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}

      {/*
        The Custom chip only exists while it is true. A permanently-present
        "Custom" would be another always-there control to ignore; appearing
        exactly when no saved view describes the list is what makes it readable
        as a status rather than a button.
      */}
      {activeViewId === null && (
        <span
          className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-bold bg-warning/15 text-warning-text border border-warning/40"
          title={`Custom filters — ${currentDescription}. Not one of your saved views.`}
        >
          Custom
          <button
            onClick={onReset}
            className="hover:text-warning-text transition-colors"
            title="Reset to the default dashboard"
            aria-label="Reset filters to the default dashboard"
          >
            <RotateCcw size={11} />
          </button>
        </span>
      )}

      {naming ? (
        <span className="flex items-center gap-1 shrink-0">
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') { setNaming(false); setName(''); }
            }}
            placeholder="Name this view"
            aria-label="Name this view"
            maxLength={40}
            className="px-2.5 py-1.5 rounded-xl text-xs bg-background border border-primary/50 text-foreground placeholder:text-subtle-foreground focus:outline-none focus:border-primary w-40"
          />
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="p-1.5 rounded-xl bg-primary text-primary-foreground disabled:opacity-40 transition-all active:scale-95"
            title="Save view"
            aria-label="Save view"
          >
            <Check size={13} />
          </button>
          <button
            onClick={() => { setNaming(false); setName(''); }}
            className="p-1.5 rounded-xl text-subtle-foreground hover:text-foreground transition-colors"
            title="Cancel"
            aria-label="Cancel naming this view"
          >
            <X size={13} />
          </button>
        </span>
      ) : (
        // Offered only for a combination that is not already a view — saving a
        // second copy of "Failures" under another name is how a view list stops
        // being worth reading.
        activeViewId === null && (
          <button
            onClick={() => setNaming(true)}
            className="flex items-center gap-1.5 shrink-0 whitespace-nowrap px-3 py-1.5 rounded-xl text-xs font-bold bg-surface border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95"
            title={`Save these filters as a named view — ${currentDescription}`}
          >
            <BookmarkPlus size={13} /> Save view
          </button>
        )
      )}
    </div>
  );
};

export default ViewBar;
