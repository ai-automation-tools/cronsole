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
 */

interface HelpButtonProps {
  /** A key of `HELP_TOPICS`. */
  topic: string;
  /** `sm` for inline label rows, `md` beside a heading. */
  size?: 'sm' | 'md';
  className?: string;
}

export const HelpButton = ({ topic, size = 'sm', className = '' }: HelpButtonProps) => {
  const [open, setOpen] = useState(false);
  const found = helpTopic(topic);
  if (!found) return null;

  const px = size === 'sm' ? 13 : 16;

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
