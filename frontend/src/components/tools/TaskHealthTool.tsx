import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, ChevronUp, HelpCircle, Loader2, ShieldCheck } from 'lucide-react';
import { api } from '../../api';

export type HealthTier = 'ok' | 'attention' | 'critical' | 'unknown';

export interface HealthSignal {
  code: string;
  severity: 'critical' | 'warn' | 'info';
  summary: string;
  evidence: string;
  weight: number;
}

export interface TaskHealth {
  taskId: string;
  name: string;
  platform: string;
  category: string;
  /** Windows' own task, per the server's single definition. */
  isSystem: boolean;
  tier: HealthTier;
  score: number | null;
  signals: HealthSignal[];
}

interface HealthResponse {
  evaluatedAt: string;
  counts: { tasks: number; critical: number; attention: number; unknown: number; ok: number };
  tasks: TaskHealth[];
}

const TIER_STYLE: Record<Exclude<HealthTier, 'ok'>, { label: string; dot: string; text: string }> = {
  critical: { label: 'Critical', dot: 'bg-red-500', text: 'text-red-500' },
  attention: { label: 'Attention', dot: 'bg-amber-500', text: 'text-amber-500' },
  unknown: { label: 'Unknown', dot: 'bg-slate-400', text: 'text-slate-400' }
};

/**
 * "Which of my tasks need attention?" — the question a 350-row dashboard cannot
 * answer by scrolling.
 *
 * It lives on the **Tools** tab rather than the Dashboard: it reads across every
 * task and acts on none, which is exactly what that tab is for, and a panel this
 * tall was taking over the main content area on the one screen people use to do
 * actual work.
 *
 * The design rule it exists to honor: **a score is a claim, so it never appears
 * without its evidence.** Every row expands to the signals that produced it, and
 * each signal names the field it came from. The number is labelled as a ranking,
 * because that is all it is.
 *
 * `unknown` is its own tier rather than folded into "fine". A task Cronsole has no
 * run evidence for is not healthy — it is unmeasured, and saying so is the
 * difference between a dashboard and a reassurance.
 */
export const TaskHealthTool = () => {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  // Collapsed by default — the summary answers the question; the list is opt-in.
  const [open, setOpen] = useState(false);
  const [includeSystem, setIncludeSystem] = useState(false);

  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ['task-health'],
    queryFn: async () => (await api.get('/tools/task-health')).data
  });

  // Windows' own tasks are excluded by default, the same way the dashboard's
  // Personal lens excludes them. Live testing made the case: on a real machine
  // 4 of the 5 worst-scoring tasks were `\Microsoft\` entries the user will
  // never act on — precisely the burial the lens exists to stop. They stay
  // reachable behind the toggle, with the count named, because silently
  // dropping 99 rows is the other half of the same mistake.
  const unhealthy = (data?.tasks ?? []).filter(t => t.tier !== 'ok');
  const systemHidden = includeSystem ? 0 : unhealthy.filter(t => t.isSystem).length;
  const visible = includeSystem ? unhealthy : unhealthy.filter(t => !t.isSystem);
  const shown = showAll ? visible : visible.slice(0, 6);

  const critical = visible.filter(t => t.tier === 'critical').length;
  const attention = visible.filter(t => t.tier === 'attention').length;
  const unknown = visible.filter(t => t.tier === 'unknown').length;

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-5 flex flex-col h-full min-h-[26rem]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Activity size={20} />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold">Task health</h3>
          <p className="text-sm text-muted-foreground">
            Which tasks need attention, and the evidence behind each verdict — read from
            Windows' own run results, not just Cronsole's records.
          </p>
        </div>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Checking every task…
        </div>
      )}

      {error && (
        <div className="text-sm rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500 px-4 py-3">
          Couldn't read task health right now.
        </div>
      )}

      {data && (
        <>
          {/* The summary IS the default view. A card on a utility tab should
              answer its question in one glance; the per-task detail is a
              deliberate second click, not something that fills the tab.
              Centred in whatever height the row settles at, so the slack of an
              equal-height grid reads as breathing room rather than a gap. */}
          <div className="flex-1 flex flex-col justify-center gap-4 border-t border-border pt-4">
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Critical', value: critical, className: 'text-red-500' },
              { label: 'Attention', value: attention, className: 'text-amber-500' },
              { label: 'Unmeasured', value: unknown, className: 'text-slate-400' },
              { label: 'Healthy', value: data.counts.ok, className: 'text-emerald-500' }
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

          <div className="flex items-center justify-between gap-3 flex-wrap text-xs">
            <span className="text-muted-foreground">
              across {data.counts.tasks} task{data.counts.tasks === 1 ? '' : 's'}
            </span>
            {(systemHidden > 0 || includeSystem) && (
              <button
                onClick={() => { setIncludeSystem(!includeSystem); setShowAll(false); }}
                aria-pressed={includeSystem}
                className="font-semibold text-subtle-foreground hover:text-foreground transition-colors"
              >
                {includeSystem ? "Hide Windows' own" : `${systemHidden} system hidden`}
              </button>
            )}
          </div>
          </div>

          <div className="pt-1">
            {visible.length === 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-semibold">
                <ShieldCheck size={13} /> Nothing needs attention
              </div>
            ) : (
              <button
                onClick={() => { setOpen(!open); setShowAll(false); setExpanded(null); }}
                aria-expanded={open}
                className="w-full bg-background border border-border hover:border-primary px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                {open
                  ? 'Hide the list'
                  : `Show ${visible.length} task${visible.length === 1 ? '' : 's'} needing attention`}
              </button>
            )}
          </div>

          {open && visible.length > 0 && (
            <ul className="rounded-xl border border-border divide-y divide-border overflow-hidden max-h-96 overflow-y-auto">
              {shown.map(health => {
                const style = TIER_STYLE[health.tier as Exclude<HealthTier, 'ok'>];
                const isOpen = expanded === health.taskId;

                return (
                  <li key={health.taskId}>
                    <button
                      onClick={() => setExpanded(isOpen ? null : health.taskId)}
                      aria-expanded={isOpen}
                      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-background/50 transition-colors"
                    >
                      {isOpen ? <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
                              : <ChevronRight size={14} className="shrink-0 text-muted-foreground" />}
                      <span className={`h-2 w-2 rounded-full shrink-0 ${style.dot}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate">{health.name}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {/* The headline signal, never the score on its own. */}
                          {health.signals.find(s => s.severity !== 'info')?.summary ??
                            health.signals[0]?.summary ??
                            'No run evidence yet.'}
                        </span>
                      </span>
                      <span className={`text-[10px] font-bold uppercase tracking-wide shrink-0 ${style.text}`}>
                        {style.label}
                      </span>
                    </button>

                    {isOpen && (
                      <div className="px-4 pb-4 pl-11 space-y-2">
                        {health.signals.map(signal => (
                          <div key={signal.code} className="text-xs">
                            <div className="flex items-start gap-1.5">
                              {signal.severity === 'critical' && <AlertOctagon size={12} className="mt-0.5 shrink-0 text-red-500" />}
                              {signal.severity === 'warn' && <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />}
                              {signal.severity === 'info' && <HelpCircle size={12} className="mt-0.5 shrink-0 text-muted-foreground" />}
                              <span className="font-medium">{signal.summary}</span>
                            </div>
                            {/* The evidence is the point. A claim without its source
                                is what this whole feature exists not to be. */}
                            <div className="text-muted-foreground pl-[1.125rem] mt-0.5">{signal.evidence}</div>
                          </div>
                        ))}

                        <div className="flex items-center justify-between gap-3 pt-1">
                          <span className="text-[11px] text-subtle-foreground">
                            Ranking score {health.score ?? '—'}{health.score !== null && '/100'} · orders this list, doesn't grade the task
                          </span>
                          <button
                            onClick={() => navigate(`/tasks/${health.taskId}`)}
                            className="text-xs font-semibold text-primary hover:underline shrink-0"
                          >
                            Open task
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}

              {visible.length > shown.length && (
                <li>
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full px-4 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Show {visible.length - shown.length} more
                  </button>
                </li>
              )}
            </ul>
          )}

          {/* A way back out from the bottom. Once the whole list is open the
              control that opened it has scrolled out of reach, and making
              someone scroll up to close what they scrolled down to read is the
              kind of small rudeness nobody reports and everybody feels. */}
          {open && showAll && visible.length > 0 && (
            <button
              onClick={() => { setShowAll(false); setOpen(false); setExpanded(null); }}
              className="w-full text-xs font-semibold text-muted-foreground hover:text-foreground border-t border-border pt-4 flex items-center justify-center gap-1.5 transition-colors"
            >
              <ChevronUp size={13} /> Collapse
            </button>
          )}
        </>
      )}
    </div>
  );
};
