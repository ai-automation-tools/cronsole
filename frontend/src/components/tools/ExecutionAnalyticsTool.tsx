import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, Clock, Info, Loader2, Timer, TrendingUp } from 'lucide-react';
import { api } from '../../api';
import { ToolCard } from './ToolCard';

type View = 'failures' | 'duration' | 'idle';

interface TrendDay {
  day: string;
  runs: number;
  succeeded: number;
  failed: number;
  pending: number;
}

interface DurationTrend {
  taskId: string;
  name: string;
  recentMedianMs: number;
  baselineMedianMs: number;
  changeRatio: number;
  recentSamples: number;
  baselineSamples: number;
}

interface IdleTask {
  taskId: string;
  name: string;
  platform: string;
  category: string;
  isSystem: boolean;
  lastRunAt: string;
  daysSinceLastRun: number;
  evidence: string;
}

interface UnassessedTask {
  taskId: string;
  name: string;
  isSystem: boolean;
  reason: 'disabled' | 'no-schedule' | 'never-run' | 'no-run-evidence';
  evidence: string;
}

interface AnalyticsResponse {
  window: { from: string; to: string; days: number; timeZone: string };
  totals: { runs: number; succeeded: number; failed: number; pending: number };
  trend: { covered: { from: string; to: string }; partial: boolean; days: TrendDay[] };
  duration: {
    considered: number;
    excludedManualTriggerRuns: number;
    minimumSamplesPerSide: number;
    tasks: DurationTrend[];
  };
  idle: { thresholdDays: number; tasks: IdleTask[]; unassessed: UnassessedTask[] };
}

const PERIODS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' }
] as const;

const VIEWS: { id: View; label: string; icon: typeof BarChart3 }[] = [
  { id: 'failures', label: 'Failures', icon: BarChart3 },
  { id: 'duration', label: 'Duration', icon: Timer },
  { id: 'idle', label: 'Idle', icon: Clock }
];

const seconds = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);

/** `2026-07-22` → `Wed 22 Jul`. Parsed as a local date, not a UTC instant. */
const dayLabel = (day: string): string => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });
};

/**
 * Daily runs, stacked succeeded / failed / pending.
 *
 * **Secondary encoding is not optional here.** Emerald and red separate by only
 * ΔE 8.1 under deuteranopia — just above the floor — so identity never rests on
 * hue: every segment carries a 2px surface gap, the legend is always present,
 * and hovering or tab-focusing a bar prints the actual numbers above the chart.
 * A reader who cannot tell the colors apart can still read the day.
 *
 * Zero-run days are drawn as an empty column rather than skipped. A trend that
 * omits its empty days draws a straight line across an outage, which reads as
 * the opposite of what the gap means.
 */
const TrendChart = ({ days, onHover }: { days: TrendDay[]; onHover: (day: TrendDay | null) => void }) => {
  const peak = Math.max(1, ...days.map(d => d.runs));
  // Bars share the width evenly; the gap is a fraction so 7 days and 90 days
  // both look deliberate rather than one looking padded and the other crowded.
  const slot = 100 / days.length;
  const gap = Math.min(slot * 0.25, 0.9);
  const width = Math.max(slot - gap, 0.4);

  return (
    <div className="relative">
      <svg
        viewBox="0 0 100 40"
        preserveAspectRatio="none"
        className="w-full h-28"
        role="img"
        aria-label={`Runs per day, ${days.length} days. Peak ${peak} runs.`}
      >
        {days.map((day, i) => {
          const total = day.runs === 0 ? 0 : (day.runs / peak) * 38;
          const parts = [
            { key: 'failed', value: day.failed, className: 'fill-danger' },
            { key: 'pending', value: day.pending, className: 'fill-neutral-text dark:fill-neutral-text' },
            { key: 'succeeded', value: day.succeeded, className: 'fill-success' }
          ].filter(p => p.value > 0);

          const description = `${dayLabel(day.day)}: ${day.runs} run${day.runs === 1 ? '' : 's'}, ${day.failed} failed`;

          let y = 39;
          return (
            <g
              key={day.day}
              tabIndex={0}
              role="button"
              // Labelled, not just <title>-d: an SVG <title> is a native tooltip
              // and is not reliably the accessible name of the group carrying it.
              aria-label={description}
              className="outline-none focus-visible:opacity-70 hover:opacity-70 transition-opacity"
              onMouseEnter={() => onHover(day)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(day)}
              onBlur={() => onHover(null)}
            >
              <title>{description}</title>
              {/* A transparent full-height hit target, so a 0-run day and a
                  1-run day are equally easy to point at. */}
              <rect x={i * slot} y={0} width={slot} height={40} className="fill-transparent" />
              {day.runs === 0 ? (
                <rect
                  x={i * slot + gap / 2}
                  y={38.4}
                  width={width}
                  height={0.6}
                  className="fill-border"
                />
              ) : (
                parts.map(part => {
                  const h = Math.max((part.value / day.runs) * total, 0.6);
                  y -= h;
                  const top = y;
                  // 2px surface gap between stacked segments — the mark spec, and
                  // the thing that keeps red-on-green legible without hue.
                  y -= 0.5;
                  return (
                    <rect
                      key={part.key}
                      x={i * slot + gap / 2}
                      y={top}
                      width={width}
                      height={h}
                      rx={0.35}
                      className={part.className}
                    />
                  );
                })
              )}
            </g>
          );
        })}
        <line x1="0" y1="39.7" x2="100" y2="39.7" className="stroke-border" strokeWidth="0.3" />
      </svg>
    </div>
  );
};

/**
 * Execution analytics — the three questions a per-task history cannot answer:
 * *"what failed this month?"*, *"which tasks are getting slower?"*, and
 * *"what hasn't run lately?"*
 *
 * Three views in one card rather than three cards, because they are one dataset
 * read three ways and splitting them would put the same period selector on the
 * Tools tab three times.
 *
 * Each view states its own source, because they differ and the difference is the
 * whole feature. Failures and duration read runs **Cronsole performed**; idle
 * reads **Windows' own last-run time**, since a Windows task firing on its own
 * schedule writes nothing to Cronsole's log. The empty states carry this too —
 * on a Windows-only machine the duration list is legitimately empty, and an
 * empty list with no explanation reads as a broken feature.
 */
export const ExecutionAnalyticsTool = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('failures');
  const [days, setDays] = useState(30);
  const [hovered, setHovered] = useState<TrendDay | null>(null);
  const [includeSystem, setIncludeSystem] = useState(false);

  // The reader thinks in local days, so the server cuts the buckets in the
  // reader's zone. Sending it beats guessing: bucketing in UTC puts a 6pm run
  // on tomorrow's bar and looks entirely normal doing it.
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);

  const { data, isLoading, error } = useQuery<AnalyticsResponse>({
    queryKey: ['analytics', days, timeZone],
    queryFn: async () => (await api.get('/tools/analytics', { params: { days, tz: timeZone } })).data
  });

  const idleVisible = (data?.idle.tasks ?? []).filter(t => includeSystem || !t.isSystem);
  const idleSystemHidden = (data?.idle.tasks ?? []).filter(t => t.isSystem).length;

  return (
    <ToolCard
      icon={TrendingUp}
      title="Execution analytics"
      description={<>
        What failed, what's getting slower, and what hasn't run — the questions a
        per-task history can't answer.
      </>}
    >

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-background border border-border rounded-xl p-1" role="tablist">
          {VIEWS.map(v => (
            <button
              key={v.id}
              role="tab"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                view === v.id
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <v.icon size={13} />
              {v.label}
            </button>
          ))}
        </div>

        {view !== 'idle' && (
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            aria-label="Period"
            className="bg-background border border-border rounded-xl px-3 py-2 text-xs outline-none focus:border-primary ml-auto"
          >
            {PERIODS.map(p => (
              <option key={p.days} value={p.days}>{p.label}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Reading run history…
        </div>
      )}

      {error && (
        <div className="text-sm rounded-xl border border-warning/40 bg-warning/10 text-warning-text px-4 py-3">
          Couldn't read execution analytics right now.
        </div>
      )}

      {data && view === 'failures' && (
        <div className="flex-1 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2 border-t border-border pt-4">
            {[
              { label: 'Runs', value: data.totals.runs, className: 'text-foreground' },
              { label: 'Failed', value: data.totals.failed, className: 'text-danger-text' },
              { label: 'Succeeded', value: data.totals.succeeded, className: 'text-success-text' }
            ].map(stat => (
              <div key={stat.label} className="text-center">
                <div className={`text-2xl font-bold tabular-nums ${stat.value === 0 ? 'text-subtle-foreground' : stat.className}`}>
                  {stat.value}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-subtle-foreground font-semibold">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* The readout is the tooltip. In a card this narrow a floating one
              would cover the bars it describes, and this version is readable by
              keyboard too — the bars are focusable. */}
          <div
            role="status"
            aria-live="polite"
            className="text-xs text-muted-foreground h-4 tabular-nums"
          >
            {hovered ? (
              <>
                <span className="font-semibold text-foreground">{dayLabel(hovered.day)}</span>
                {' · '}{hovered.runs} run{hovered.runs === 1 ? '' : 's'}
                {hovered.failed > 0 && <span className="text-danger-text font-semibold">{' · '}{hovered.failed} failed</span>}
              </>
            ) : (
              <span className="text-subtle-foreground">Hover or tab a bar for that day's numbers</span>
            )}
          </div>

          <TrendChart days={data.trend.days} onHover={setHovered} />

          <div className="flex items-center gap-4 text-[10px] font-semibold uppercase tracking-wide text-subtle-foreground">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-success" />Succeeded</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-danger" />Failed</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-neutral-text dark:bg-neutral-text" />Pending</span>
          </div>

          {data.trend.partial && (
            <div className="text-xs rounded-xl border border-warning/40 bg-warning/10 text-warning-text px-3 py-2">
              Too many runs to chart the whole period. The bars above cover
              {' '}{dayLabel(data.trend.covered.from.slice(0, 10))} onwards; the totals cover all {data.totals.runs}.
            </div>
          )}

          <div className="rounded-xl bg-background/60 border border-border/60 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2 mt-auto">
            <Info size={14} className="mt-0.5 shrink-0 text-primary" />
            <span>
              Runs <strong>Cronsole performed</strong> — dashboard runs and Cronsole-native jobs. A Windows task
              firing on its own schedule isn't recorded, so an empty period means Cronsole triggered nothing, not
              that nothing ran. Days are cut in {data.window.timeZone}.
            </span>
          </div>
        </div>
      )}

      {data && view === 'duration' && (
        <div className="flex-1 flex flex-col gap-3 border-t border-border pt-4">
          {data.duration.tasks.length === 0 ? (
            <div className="flex-1 flex flex-col justify-center gap-3">
              <div className="text-sm text-muted-foreground">
                Nothing to compare yet.
              </div>
              <div className="rounded-xl bg-background/60 border border-border/60 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
                <Info size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  Only <strong>Cronsole-native</strong> tasks can be timed. For a Windows task, the recorded
                  duration is how long the agent took to <em>accept</em> the start — not how long the job took —
                  so ranking those would compare handshakes, not work.
                  {data.duration.excludedManualTriggerRuns > 0 && (
                    <> {data.duration.excludedManualTriggerRuns} run
                      {data.duration.excludedManualTriggerRuns === 1 ? ' was' : 's were'} left out for that reason.</>
                  )}
                  {' '}A task needs {data.duration.minimumSamplesPerSide} recent and{' '}
                  {data.duration.minimumSamplesPerSide} earlier runs before a change is a trend.
                </span>
              </div>
            </div>
          ) : (
            <>
              <div className="text-xs text-muted-foreground">
                Recent runs against each task's earlier baseline — median, so one slow night isn't a trend.
              </div>
              <ul className="rounded-xl border border-border divide-y divide-border overflow-hidden max-h-72 overflow-y-auto">
                {data.duration.tasks.map(task => {
                  const slower = task.changeRatio >= 1;
                  return (
                    <li key={task.taskId} className="px-4 py-3 flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <button
                          onClick={() => navigate(`/tasks/${task.taskId}`)}
                          className="block text-sm font-semibold truncate hover:text-primary transition-colors text-left"
                        >
                          {task.name}
                        </button>
                        <span className="block text-xs text-muted-foreground truncate">
                          {seconds(task.recentMedianMs)} now vs {seconds(task.baselineMedianMs)} typical
                          {' · '}{task.recentSamples} recent / {task.baselineSamples} earlier runs
                        </span>
                      </span>
                      <span
                        className={`text-xs font-bold tabular-nums shrink-0 ${
                          task.changeRatio >= 2 ? 'text-warning-text' : 'text-muted-foreground'
                        }`}
                      >
                        {slower ? '↑' : '↓'} {(slower ? task.changeRatio : 1 / task.changeRatio).toFixed(1)}×
                      </span>
                    </li>
                  );
                })}
              </ul>
              {data.duration.excludedManualTriggerRuns > 0 && (
                <div className="text-xs text-subtle-foreground mt-auto">
                  {data.duration.excludedManualTriggerRuns} Windows run
                  {data.duration.excludedManualTriggerRuns === 1 ? '' : 's'} excluded — their duration times the
                  agent handshake, not the job.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {data && view === 'idle' && (
        <div className="flex-1 flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
            <span className="text-muted-foreground">
              Scheduled tasks with no run in {data.idle.thresholdDays} days
            </span>
            {(idleSystemHidden > 0 || includeSystem) && (
              <button
                onClick={() => setIncludeSystem(!includeSystem)}
                aria-pressed={includeSystem}
                className="font-semibold text-subtle-foreground hover:text-foreground transition-colors"
              >
                {includeSystem ? "Hide Windows' own" : `${idleSystemHidden} system hidden`}
              </button>
            )}
          </div>

          {idleVisible.length === 0 ? (
            /*
             * The all-clear is only the all-clear when there is genuinely
             * nothing idle. If every idle task happens to be one of Windows'
             * own, filtering them out empties the list — and printing "every
             * scheduled task has run recently" next to "N system hidden" states
             * a fact and its own contradiction in the same breath.
             *
             * So the message is scoped to the population it actually describes.
             * Same rule as the health card summing to a different total than its
             * label (troubleshooting #38): never let a filtered list narrate an
             * unfiltered claim.
             */
            idleSystemHidden > 0 ? (
              <div className="text-sm text-muted-foreground">
                No idle tasks outside Windows' own —{' '}
                <button
                  onClick={() => setIncludeSystem(true)}
                  className="font-semibold text-foreground hover:text-primary transition-colors underline underline-offset-2"
                >
                  {idleSystemHidden} system task{idleSystemHidden === 1 ? ' is' : 's are'} idle
                </button>
                .
              </div>
            ) : (
              <div className="text-sm text-success-text font-semibold">
                Every scheduled task has run recently.
              </div>
            )
          ) : (
            <ul className="rounded-xl border border-border divide-y divide-border overflow-hidden max-h-72 overflow-y-auto">
              {idleVisible.map(task => (
                <li key={task.taskId} className="px-4 py-3 flex items-center gap-3">
                  <AlertTriangle size={13} className="shrink-0 text-warning-text" />
                  <span className="min-w-0 flex-1">
                    <button
                      onClick={() => navigate(`/tasks/${task.taskId}`)}
                      className="block text-sm font-semibold truncate hover:text-primary transition-colors text-left"
                    >
                      {task.name}
                    </button>
                    {/* The evidence, not just the verdict. Which source said so
                        is the difference between a fact and an assertion. */}
                    <span className="block text-xs text-muted-foreground truncate" title={task.evidence}>
                      {task.evidence}
                    </span>
                  </span>
                  <span className="text-xs font-bold tabular-nums shrink-0 text-warning-text">
                    {task.daysSinceLastRun}d
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Not idle, and not silently dropped either. A task that is disabled,
              on-demand, or has never reported a run is unmeasured — and saying so
              is what stops "nothing is idle" from being mistaken for "everything
              is fine". */}
          {data.idle.unassessed.length > 0 && (
            <div className="text-xs text-subtle-foreground mt-auto">
              {(() => {
                const count = (reason: UnassessedTask['reason']) =>
                  data.idle.unassessed.filter(u => u.reason === reason && (includeSystem || !u.isSystem)).length;
                const parts = [
                  [count('disabled'), 'disabled'],
                  [count('no-schedule'), 'run on demand'],
                  [count('never-run'), 'never run'],
                  [count('no-run-evidence'), 'no run data from the agent']
                ].filter(([n]) => (n as number) > 0);
                return parts.length === 0 ? null : (
                  <>Not assessed: {parts.map(([n, label]) => `${n} ${label}`).join(' · ')}.</>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </ToolCard>
  );
};
