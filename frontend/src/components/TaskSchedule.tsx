import { CalendarClock } from 'lucide-react';
import type { Task } from '../types';
import { useSettings } from '../hooks/useSettings';
import { taskSchedulePreview } from '../utils/schedule';
import { zoneLabel } from '../utils/timezone';

interface TaskScheduleProps {
  task: Task;
  /** `sm` for the grid card, `xs` for the denser kanban / timeline cards. */
  size?: 'sm' | 'xs';
  className?: string;
}

/**
 * The one-line schedule shown on a task card ("Daily at 8:00 AM PDT").
 *
 * Read in the Settings zone like every other schedule surface, and honest about
 * the two cases that aren't a clock time: an unrecognized cron is shown raw
 * rather than guessed at, and a task with no cron trigger says so instead of
 * rendering blank — a blank line reads as "nothing scheduled", which is a
 * different claim from "scheduled by something cron can't express".
 */
export const TaskSchedule = ({ task, size = 'sm', className = '' }: TaskScheduleProps) => {
  const { settings } = useSettings();
  const sched = taskSchedulePreview(task, settings.timezone);

  const title =
    sched.kind === 'human'
      ? `Stored as UTC cron: ${sched.cron} · read in ${zoneLabel(settings.timezone)}`
      : sched.kind === 'cron'
        ? `Stored UTC cron — Cronsole can't describe this shape in words`
        : "This task runs on a trigger Cronsole can't express as cron (boot, logon, event, or on-demand only)";

  const text = size === 'xs' ? 'text-[10px]' : 'text-xs';
  const icon = size === 'xs' ? 10 : 12;
  const tone =
    sched.kind === 'none'
      ? 'text-subtle-foreground italic'
      : sched.kind === 'cron'
        ? 'text-muted-foreground font-mono'
        : 'text-muted-foreground font-semibold';

  return (
    <div
      className={`flex items-center gap-1.5 ${text} ${tone} min-w-0 ${className}`}
      title={title}
    >
      <CalendarClock size={icon} className="shrink-0 text-subtle-foreground" />
      <span className="truncate">{sched.text}</span>
    </div>
  );
};
