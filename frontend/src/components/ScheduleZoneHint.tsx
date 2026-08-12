import { AlertTriangle, Globe } from 'lucide-react';
import type { CronShift } from '../utils/timezone';

interface ScheduleZoneHintProps {
  /** The cron as typed, in the user's zone. */
  typed: string;
  /** The result of converting it to UTC for storage. */
  stored: CronShift;
  /** Zone name for the prose — "PDT", "UTC". */
  zoneLabel: string;
  /** Cronsole-native tasks evaluate the stored cron in UTC forever; Windows doesn't. */
  driftsWithDst?: boolean;
}

/**
 * What actually gets stored, shown beside the cron field.
 *
 * The field takes a time in the user's zone, but the database, the API, the MCP
 * tools and the agent all speak UTC — so anyone comparing the dashboard against
 * `list_tasks` output or a `SELECT` would otherwise find two different
 * expressions and no explanation. Printing the stored form is the cheapest way
 * to keep the translation visible rather than magic.
 *
 * It also carries the two honest caveats: an expression that could not be
 * converted (`shift.reason`), and the DST asymmetry for Cronsole-native tasks.
 */
export const ScheduleZoneHint = ({
  typed,
  stored,
  zoneLabel,
  driftsWithDst
}: ScheduleZoneHintProps) => {
  const trimmed = typed.trim();
  if (!trimmed) return null;

  return (
    <div className="space-y-1">
      {stored.reason ? (
        <p className="text-[10px] text-warning-text flex items-start gap-1.5">
          <AlertTriangle size={11} className="shrink-0 mt-0.5" />
          {stored.reason}
        </p>
      ) : stored.shifted ? (
        <p className="text-[10px] text-subtle-foreground flex items-start gap-1.5">
          <Globe size={11} className="shrink-0 mt-0.5" />
          <span>
            Read as {zoneLabel}. Stored as{' '}
            <span className="font-mono text-foreground">{stored.cron}</span> UTC — that’s the
            expression the API, the MCP tools and Task Scheduler see.
          </span>
        </p>
      ) : (
        <p className="text-[10px] text-subtle-foreground flex items-start gap-1.5">
          <Globe size={11} className="shrink-0 mt-0.5" />
          This schedule has no fixed clock time, so it reads the same in {zoneLabel} and UTC.
        </p>
      )}

      {driftsWithDst && stored.shifted && (
        <p className="text-[10px] text-subtle-foreground italic">
          Cronsole runs this expression in UTC, so it will shift by an hour when {zoneLabel}{' '}
          changes for daylight saving. Windows tasks hold their local time instead.
        </p>
      )}
    </div>
  );
};

export default ScheduleZoneHint;
