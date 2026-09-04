import { useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { HelpModal } from './HelpModal';
import { helpTopic } from '../data/help';

/**
 * The **?** next to a control — one topic of help, opened in place.
 *
 * Deliberately tiny and deliberately everywhere. The alternative shape is a
 * single Help Center you have to leave the screen for, which is where the
 * answer to *"what does this button actually do?"* goes to be not read; this one
 * sits beside the thing it explains and opens on that thing.
 *
 * Two constraints that are easy to lose:
 *
 * **It is never nested inside another control.** A `?` inside a filter chip
 * would be a button inside a button — invalid, and it steals the chip's click
 * target. It goes beside, always.
 *
 * **It names its topic to a screen reader.** `aria-label` is "Help: <title>",
 * not "Help" — a page carrying eight of these would otherwise present eight
 * identical buttons.
 *
 * An unknown topic id renders **nothing** rather than a button that opens an
 * empty modal, so a typo is a missing affordance rather than a dead end.
 *
 * **`label` is the deliberate exception to "tiny and everywhere."** A topic
 * that only ever answers "what is this?" earns the bare `?`; one that is
 * genuinely a how-to — several setup paths, not a single fact — reads as a
 * labelled pill instead, so a reader scans the row and sees an affordance
 * rather than having to already know the icon opens something. Omit it and
 * every other `?` on every other screen is unchanged.
 */

interface HelpButtonProps {
  /** A key of `HELP_TOPICS`. */
  topic: string;
  /** `sm` for inline label rows, `md` beside a heading. */
  size?: 'sm' | 'md';
  /** Renders a labelled pill instead of a bare icon — see above. */
  label?: string;
  className?: string;
}

export const HelpButton = ({ topic, size = 'sm', label, className = '' }: HelpButtonProps) => {
  const [open, setOpen] = useState(false);
  const found = helpTopic(topic);
  if (!found) return null;

  const px = size === 'sm' ? 13 : 16;

  if (label) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Help: ${found.title}`}
          title={`${label} — ${found.title}`}
          className={`inline-flex items-center gap-1.5 shrink-0 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-bold text-foreground hover:bg-primary/20 hover:border-primary/50 transition-colors active:scale-95 ${className}`}
        >
          <HelpCircle size={14} />
          {label}
        </button>
        {open && <HelpModal topic={topic} onClose={() => setOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Help: ${found.title}`}
        title={`What is this? — ${found.title}`}
        className={`inline-flex items-center justify-center shrink-0 rounded-full text-subtle-foreground hover:text-foreground hover:bg-muted transition-colors active:scale-90 ${
          size === 'sm' ? 'p-0.5' : 'p-1.5'
        } ${className}`}
      >
        <HelpCircle size={px} />
      </button>
      {open && <HelpModal topic={topic} onClose={() => setOpen(false)} />}
    </>
  );
};

export default HelpButton;
