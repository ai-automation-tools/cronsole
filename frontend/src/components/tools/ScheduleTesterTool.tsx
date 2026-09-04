import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, Check, Info } from 'lucide-react';
import { api } from '../../api';
import { useScheduleZone } from '../../hooks/useScheduleZone';
import { ScheduleBuilder } from '../ScheduleBuilder';
import { ToolCard } from './ToolCard';

interface SchedulePreview {
  score: number;
  warnings: string[];
  trigger: { type: string; startBoundary: string; daysOfWeek?: string[]; repetition?: { interval: string } } | null;
  lossy?: 'approximated' | 'replaced';
  requestedRuns: string[];
  effectiveRuns: string[] | null;
  diverges: boolean;
}

const PLATFORMS = [
  { value: 'WINDOWS_TASK_SCHEDULER', label: 'Windows Task Scheduler' },
  { value: 'TASKHUB_NATIVE', label: 'Cronsole-native' }
] as const;

/**
 * Both zones, always — the point is to remove doubt, not to honor a preference.
 * The primary reading follows the Settings zone (so it matches every other
 * surface) and UTC stays beside it, because UTC is what the API and Task
 * Scheduler actually hold.
 */
const bothZones = (iso: string, zone: string): { primary: string; utc: string } => {
  const d = new Date(iso);
  return {
    primary: d.toLocaleString(undefined, { timeZone: zone }),
    utc: `${d.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`
  };
};

const describeTrigger = (t: SchedulePreview['trigger']): string => {
  if (!t) return 'no trigger';
  const parts = [t.type, `at ${t.startBoundary}`];
  if (t.daysOfWeek?.length) parts.push(`on ${t.daysOfWeek.join(', ')}`);
  if (t.repetition?.interval) parts.push(`repeating every ${t.repetition.interval}`);
  return parts.join(' ');
};

/**
 * Try a schedule before it exists.
 *
 * This is the cheapest answer to the most expensive trap in the project: on
 * Windows a cron does not run — a *trigger* does, and any expression the
 * converter doesn't recognize is **discarded** for a fixed hourly trigger. So
 * `0 4 1 1 *`, picked precisely because it can't fire during a test, registers
 * as ~8,760 runs a year (troubleshooting #14). That was documented in three
 * places and visible in none.
 *
 * The design rule the backend enforces and this UI must not undermine: run times
 * are shown only where they can be *derived*, never inferred. An approximated
 * step returns no effective dates at all, and this card says so in words rather
 * than filling the gap with the cron's own times.
 */
export const ScheduleTesterTool = () => {
  const zone = useScheduleZone();
  // Typed in the user's zone like every other cron field; converted once before
  // it goes to the preview route, which reads UTC like the rest of the backend.
  const [cron, setCron] = useState('0 4 1 1 *');
  const [platform, setPlatform] = useState<string>('WINDOWS_TASK_SCHEDULER');
  const stored = zone.toUtc(cron);
  const [debounced, setDebounced] = useState(stored.cron);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(stored.cron), 300);
    return () => clearTimeout(id);
  }, [stored.cron]);

  const { data, isFetching } = useQuery<SchedulePreview>({
    queryKey: ['schedule-preview', debounced, platform],
    queryFn: async () => (await api.post('/tasks/preview', { platform, schedule: debounced })).data,
    enabled: debounced.trim().length > 0
  });

  const invalid = data && data.score === 0;

  return (
    <ToolCard
      icon={CalendarClock}
      title="Schedule tester"
      description={<>
        Type a cron and see what the platform will actually do with it — the trigger it becomes and
        the next five times it fires. Creates nothing.
      </>}
    >
      <div className="space-y-2.5">
        {/*
          The same control every authoring surface uses, so what you test here
          is assembled the way the thing you ship is. The Cron tab stays the
          default register of this card: the expressions worth testing are
          mostly the ones the picker cannot make.
        */}
        <ScheduleBuilder
          inputId="schedule-tester-cron"
          label="Cron (5 fields)"
          value={cron}
          onChange={setCron}
          zoneLabel={zone.label}
        />
        {stored.reason ? (
          <span className="block text-[10px] text-warning-text">{stored.reason}</span>
        ) : stored.shifted ? (
          <span className="block text-[10px] text-subtle-foreground">
            Stored and tested as <span className="font-mono text-foreground">{stored.cron}</span> UTC.
          </span>
        ) : null}

        <div className="flex flex-wrap gap-1.5">
          {/* The trap itself, one click away — a schedule tester that can't show
              you the failure it exists for is a worse demo than no demo. It sits
              apart from the presets because it is not a schedule to copy. */}
          <button
            onClick={() => setCron('0 4 1 1 *')}
            className="text-[11px] px-2 py-1 rounded-lg border border-warning/40 text-warning-text hover:bg-warning/10 transition-colors"
          >
            Once a year (try it)
          </button>
        </div>

        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest text-subtle-foreground">Target</span>
          <select
            value={platform}
            onChange={e => setPlatform(e.target.value)}
            aria-label="Platform to test against"
            className="mt-1.5 block w-full max-w-md bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
          >
            {PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
        {isFetching && !data && <p className="text-xs text-muted-foreground">Checking…</p>}

        {invalid && (
          <div className="rounded-xl bg-danger/10 border border-danger/30 px-4 py-3 text-xs text-danger-text flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>{data!.warnings[0]}</span>
          </div>
        )}

        {data && !invalid && (
          <>
            {data.diverges ? (
              <div className="rounded-xl bg-warning/10 border border-warning/40 px-4 py-3 text-xs text-warning-text flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  <strong>This is not the schedule you typed.</strong>{' '}
                  {data.lossy === 'replaced'
                    ? 'Your expression was discarded and replaced with a fixed trigger that is not derived from it — it will run far more often than you asked.'
                    : 'The registered trigger differs from your expression.'}
                </span>
              </div>
            ) : (
              <div className="rounded-xl bg-primary/10 border border-primary/30 px-4 py-3 text-xs text-primary flex items-start gap-2">
                <Check size={14} className="mt-0.5 shrink-0" />
                <span>
                  {data.trigger
                    ? 'Converts exactly — the trigger fires when your cron says it should.'
                    : 'Cronsole runs this expression itself, exactly as written.'}
                </span>
              </div>
            )}

            {data.trigger && (
              <div className="text-xs text-muted-foreground">
                <span className="text-[10px] font-bold uppercase tracking-widest text-subtle-foreground">Registers as</span>
                <p className="font-mono mt-0.5 text-foreground">{describeTrigger(data.trigger)}</p>
              </div>
            )}

            {data.warnings.length > 0 && (
              <ul className="text-xs text-warning-text space-y-1">
                {data.warnings.map((w, i) => <li key={i}>• {w}</li>)}
              </ul>
            )}

            <RunList
              title={data.diverges ? 'What you asked for' : 'Next runs'}
              runs={data.requestedRuns}
              zone={zone.zone}
              muted={data.diverges}
            />

            {data.diverges && data.effectiveRuns && (
              <RunList
                title="What will actually run"
                runs={data.effectiveRuns}
                zone={zone.zone}
                emphasize
              />
            )}

            {data.lossy === 'approximated' && (
              <div className="rounded-xl bg-background/60 border border-border/60 px-4 py-3 text-[11px] text-muted-foreground flex items-start gap-2">
                <Info size={13} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  Actual run times aren't shown for this one. The step doesn't divide evenly, so Windows repeats
                  continuously while cron restarts each hour — the two drift apart, and any dates here would be a
                  guess rather than a reading.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </ToolCard>
  );
};

const RunList = ({
  title,
  runs,
  zone,
  muted,
  emphasize
}: {
  title: string;
  runs: string[];
  zone: string;
  muted?: boolean;
  emphasize?: boolean;
}) => (
  <div>
    <span className="text-[10px] font-bold uppercase tracking-widest text-subtle-foreground">{title}</span>
    {runs.length === 0 ? (
      <p className="text-xs text-muted-foreground mt-1">
        Never — this expression has no upcoming occurrences.
      </p>
    ) : (
      <ul className={`mt-1 space-y-0.5 text-xs font-mono ${emphasize ? 'text-warning-text' : muted ? 'text-muted-foreground' : 'text-foreground'}`}>
        {runs.map(iso => {
          const { primary, utc } = bothZones(iso, zone);
          return (
            <li key={iso} className="flex flex-wrap gap-x-2">
              <span>{primary}</span>
              <span className="text-subtle-foreground">({utc})</span>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);
