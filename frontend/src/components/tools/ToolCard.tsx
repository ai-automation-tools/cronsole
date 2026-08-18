import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useSettings } from '../../hooks/useSettings';

/**
 * The shell every Tools-tab card sits in.
 *
 * It exists because the literal
 * `bg-surface border border-border rounded-2xl p-6 space-y-5 flex flex-col h-full min-h-[26rem]`
 * was copy-pasted into all eight tool components. Eight copies of a size is
 * eight places to miss when the size changes, and the drift shows up as one card
 * a few pixels off its neighbours — visible, annoying, and nobody's obvious bug.
 * One definition, so "make the tool cards smaller" is one edit.
 *
 * **No height floor and no `h-full`: a card is exactly as tall as it needs to
 * be.** Both existed to tidy a two-column grid — `h-full` levelled the cards in
 * a row, `min-h` stopped a short one looking stubby beside a tall one. The tab
 * is one card per row now, so there is nothing to level against and the floor
 * would only pad a short card with the dead space it was meant to disguise.
 *
 * Anything that can run long (the health list, a restore plan, an idle report)
 * carries its own `max-h-* overflow-y-auto`, so it stays bounded on its own
 * terms rather than relying on the card to bound it. That was already true
 * before the height came off, which is what made removing it safe.
 *
 * ## The card is closed until you open it
 *
 * Ten full tools stacked open made the tab a page you scroll *past* rather than
 * one you pick from: the last three cards were below the fold on every screen,
 * and finding a tool meant recognising its body rather than reading its name.
 * Closed, the tab is a menu — icon, name, and the sentence that says what the
 * tool is for, which is exactly the information you need to choose one.
 *
 * It is also what stops the tab from being a burst of eight queries every time
 * it is opened. Nine of the ten cards fetch on mount (tasks, task health twice,
 * analytics, folders, downloads, archives, history, a schedule preview) — all of
 * it work for a tool the user has not asked for yet. **A closed card's body has
 * never mounted, so it has asked for nothing.**
 *
 * Two rules make that safe:
 * - **Once opened, the body stays mounted** and is hidden with `hidden` rather
 *   than unmounted. Closing a card must not throw away a half-built mass action,
 *   a loaded restore plan, or a typed cron — a disclosure is a view control, not
 *   a reset. `hidden` (not a CSS class) so the content leaves the tab order and
 *   the accessibility tree with it.
 * - **Open/closed persists** (`Settings.openTools`, keyed on `id`), because a
 *   tool you were using is a tool you are still using two tab switches later.
 *   Same reasoning as `railCollapsed`.
 *
 * The disclosure sits at the **bottom** of the card, full-bleed. At the top it
 * would compete with the help button and the header's own action slot; at the
 * bottom it reads as the drawer handle it is, and its position doesn't move when
 * the header grows a second line on a narrow window.
 */
interface ToolCardProps {
  /**
   * Stable key for the open/closed preference. Not derived from the title:
   * retitling a card would otherwise silently forget that the user had it open.
   */
  id: string;
  icon: LucideIcon;
  /**
   * Plain text, because the disclosure names the card it opens ("Show task
   * health"). Anything that isn't the name — a help button, a version tag —
   * goes in `titleAdornment`.
   */
  title: string;
  /** Trailing header decoration: a `HelpButton`, a version badge. Always visible, open or closed. */
  titleAdornment?: ReactNode;
  description: ReactNode;
  /** Right-aligned header slot — a back link, a mode switch. Rendered only while open, since it acts on the body. */
  action?: ReactNode;
  children: ReactNode;
}

export const ToolCard = ({ id, icon: Icon, title, titleAdornment, description, action, children }: ToolCardProps) => {
  const { settings, update } = useSettings();
  const open = settings.openTools.includes(id);
  // Has this card ever been open? Gates the *first* mount only; after that the
  // body stays mounted and `hidden` does the hiding.
  const [mounted, setMounted] = useState(open);
  const panelId = `tool-panel-${id}`;

  const toggle = () => {
    if (!open) setMounted(true);
    update('openTools', open ? settings.openTools.filter(t => t !== id) : [...settings.openTools, id]);
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 flex flex-col">
      <div className="flex items-start gap-2.5">
        <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-sm flex items-center gap-1.5">{title}{titleAdornment}</h3>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</p>
        </div>
        {open && action}
      </div>

      {/* `flex flex-col gap-3` reproduces exactly what the card's own `space-y-3`
          used to give these children when they were its direct descendants —
          including the `mt-auto` and `flex-1` several tools use to pin a footnote
          to the bottom of their body. */}
      {mounted && (
        <div id={panelId} hidden={!open} className="flex flex-col gap-3">
          {children}
        </div>
      )}

      {/* Full-bleed against the card's `p-4`, so it reads as part of the card's
          edge rather than a button sitting near it. */}
      <button
        type="button"
        data-testid={`tool-disclosure-${id}`}
        onClick={toggle}
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        aria-label={`${open ? 'Hide' : 'Show'} ${title}`}
        className="-mx-4 -mb-4 flex items-center justify-center gap-1.5 rounded-b-2xl border-t border-border
                   px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground
                   hover:text-foreground hover:bg-muted transition"
      >
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        {open ? 'Hide' : 'Show'}
      </button>
    </div>
  );
};
