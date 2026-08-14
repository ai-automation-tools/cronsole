import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

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
 */
interface ToolCardProps {
  icon: LucideIcon;
  title: ReactNode;
  description: ReactNode;
  /** Right-aligned header slot — a back link, a mode switch. */
  action?: ReactNode;
  children: ReactNode;
}

export const ToolCard = ({ icon: Icon, title, description, action, children }: ToolCardProps) => (
  <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 flex flex-col">
    <div className="flex items-start gap-2.5">
      <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold text-sm flex items-center gap-1.5">{title}</h3>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
      {action}
    </div>
    {children}
  </div>
);
