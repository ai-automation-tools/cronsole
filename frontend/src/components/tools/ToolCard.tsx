import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The header + body shell every Tools-tab card sits in.
 *
 * It exists because the literal
 * `bg-surface border border-border rounded-2xl p-6 space-y-5 flex flex-col h-full min-h-[26rem]`
 * was copy-pasted into all ten tool components. One definition, so "make the
 * tool cards smaller" is one edit.
 *
 * **Always renders its body — visibility and lazy mounting are the caller's
 * job, not this component's.** That used to live here: a per-card
 * Show/Hide disclosure backed by `Settings.openTools`, because ten tools
 * stacked open at once made the tab a page you scroll past, and nine of the
 * ten fire a query on mount (tasks, task health twice, analytics, folders,
 * downloads, archives, history, a schedule preview) — a closed card that
 * never mounted had asked for nothing.
 *
 * `ToolsScreen`'s sidebar now owns exactly that job at the screen level: it
 * mounts a tool's component the first time it is selected and keeps it
 * mounted-but-`hidden` afterward, so switching away and back does not lose a
 * half-built mass action or a loaded restore plan — the same property the
 * old per-card disclosure had, achieved by "which one tool is showing"
 * instead of "which several cards are open". A second disclosure inside the
 * card would just be a Hide button with no way to get back to what it hid.
 */
interface ToolCardProps {
  icon: LucideIcon;
  /** Plain text — anything that isn't the name goes in `titleAdornment`. */
  title: string;
  /** Trailing header decoration: a `HelpButton`, a version badge. */
  titleAdornment?: ReactNode;
  description: ReactNode;
  /** Right-aligned header slot — a back link, a mode switch. */
  action?: ReactNode;
  children: ReactNode;
}

export const ToolCard = ({ icon: Icon, title, titleAdornment, description, action, children }: ToolCardProps) => (
  <div className="bg-surface border border-border rounded-2xl p-4 space-y-3 flex flex-col">
    <div className="flex items-start gap-2.5">
      <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-bold text-sm flex items-center gap-1.5">{title}{titleAdornment}</h3>
        <p className="text-xs text-muted-foreground leading-snug mt-0.5">{description}</p>
      </div>
      {action}
    </div>
    <div className="flex flex-col gap-3">{children}</div>
  </div>
);
