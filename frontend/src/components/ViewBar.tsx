import { useState } from 'react';
import { Bookmark, BookmarkPlus, Check, RotateCcw, X } from 'lucide-react';
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
      className="flex flex-wrap items-center gap-2"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-subtle-foreground">
        <Bookmark size={12} /> Views
      </span>

      {views.map(view => {
        const active = view.id === activeViewId;
        const count = counts.get(view.id);
        return (
          <span key={view.id} className="relative group/view">
            <button
              onClick={() => onSelect(view)}
              aria-pressed={active}
              title={view.blurb}
              className={`flex items-center gap-1.5 pl-3 pr-3 py-1.5 rounded-xl text-xs font-bold transition-all active:scale-95 border ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-surface text-muted-foreground border-border hover:text-foreground hover:border-foreground/20'
              } ${isBuiltinView(view.id) ? '' : 'group-hover/view:pr-7'}`}
            >
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
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded-md opacity-0 group-hover/view:opacity-100 focus:opacity-100 text-subtle-foreground hover:text-red-400 transition-opacity"
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/40"
          title={`Custom filters — ${currentDescription}. Not one of your saved views.`}
        >
          Custom
          <button
            onClick={onReset}
            className="hover:text-amber-200 transition-colors"
            title="Reset to the default dashboard"
            aria-label="Reset filters to the default dashboard"
          >
            <RotateCcw size={11} />
          </button>
        </span>
      )}

      {naming ? (
        <span className="flex items-center gap-1">
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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-surface border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95"
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
