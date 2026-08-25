import { BookOpen, ExternalLink } from 'lucide-react';
import { sourceDoc } from '../../data/docs';

/**
 * **"Read the full guide for this source" — the last thing on every source card.**
 *
 * Each source is a different *kind* of thing, and a card has room for what it
 * is and what it can do, never for how to use it: the token to generate, the
 * scope that 404s instead of 403ing, the tool the agent will refuse, the run
 * history that does not exist. That belongs in a document, and a document
 * nobody can find from the thing it describes may as well not exist.
 *
 * **Styled as the Add-a-source action, one size down.** That button is the
 * primary action of the panel it closes; this is a secondary action on a card
 * that already has its own controls, so it keeps the shape and the glyph pair —
 * a book for *documentation*, an arrow for *new tab* — at `text-xs` on a
 * `rounded-lg`, in muted rather than primary. Same family, less weight, the way
 * the folder header relates to the logo hero.
 *
 * **A platform with no document renders nothing.** `sourceDoc` returns null for
 * anything not in its map — quick links have no connector and so nothing to
 * document — and a button that goes nowhere is worse than an absent one.
 */
export const SourceDocLink = ({ platform, label }: { platform: string; label: string }) => {
  const href = sourceDoc(platform);
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Opens the ${label} guide on GitHub in a new tab`}
      className="self-start inline-flex items-center gap-1.5 bg-muted hover:bg-muted/70 text-muted-foreground hover:text-foreground border border-border px-3 py-2 rounded-lg text-xs font-bold transition-all duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <BookOpen size={13} className="shrink-0" />
      Read: using {label}
      <ExternalLink size={11} className="shrink-0 opacity-70" />
    </a>
  );
};

export default SourceDocLink;
