import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, ChevronDown, ChevronRight, HelpCircle, ShieldCheck } from 'lucide-react';
import { api } from '../api';
import type { Task } from '../types';

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
 * "Which of my tasks need attention?" — the question a 352-row dashboard cannot
 * answer by scrolling.
 *
 * The design rule this component exists to honor: **a score is a claim, so it
 * never appears without its evidence.** Every row expands to the signals that
 * produced it, and each signal names the field it came from. There is no bare
 * number anywhere in here, and the number that does appear is labelled as a
 * ranking, because that is all it is.
 *
 * `unknown` is shown as its own tier rather than folded into "fine". A task
 * TaskHub has no run evidence for is not healthy — it is unmeasured, and saying
 * so is the difference between a dashboard and a reassurance.
 */
export const NeedsAttentionPanel = ({
  tasks,
  onTaskSelect
}: {
  tasks: Task[] | undefined;
  onTaskSelect: (task: Task) => void;
}) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [includeSystem, setIncludeSystem] = useState(false);

  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ['task-health'],
    queryFn: async () => (await api.get('/tools/task-health')).data
  });

  // Silent when there is nothing to say. A permanent panel reporting "all good"
  // is the banner that trains you to stop reading banners.
  if (isLoading || error || !data) return null;

  // Windows' own tasks are excluded by default, the same way the dashboard's
  // Personal lens excludes them. Live testing made the case: on a real machine
  // 4 of the 5 worst-scoring tasks were `\Microsoft\` entries the user will
  // never act on — which is precisely the burial the lens was built to stop.
  // They stay reachable behind the toggle, with the count named, because
  // silently dropping 257 rows is the other half of the same mistake.
  const unhealthy = data.tasks.filter(t => t.tier !== 'ok');
  const systemHidden = includeSystem ? 0 : unhealthy.filter(t => t.isSystem).length;
  const needsAttention = includeSystem ? unhealthy : unhealthy.filter(t => !t.isSystem);

  if (unhealthy.length === 0) return null;

  const shown = showAll ? needsAttention : needsAttention.slice(0, 5);
  const visible = needsAttention;
  const critical = visible.filter(t => t.tier === 'critical').length;
  const attention = visible.filter(t => t.tier === 'attention').length;
  const unknown = visible.filter(t => t.tier === 'unknown').length;

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-sm">Needs attention</h3>
            <p className="text-xs text-muted-foreground">
              {critical > 0 && <span className="text-red-500 font-semibold">{critical} critical</span>}
              {critical > 0 && (attention > 0 || unknown > 0) && ' · '}
              {attention > 0 && <span className="text-amber-500 font-semibold">{attention} to check</span>}
              {attention > 0 && unknown > 0 && ' · '}
              {unknown > 0 && <span className="text-slate-400 font-semibold">{unknown} unmeasured</span>}
              {visible.length === 0 && 'nothing needs attention'}
              {visible.length > 0 && <>{' of '}{data.counts.tasks} tasks</>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-subtle-foreground">
          {(systemHidden > 0 || includeSystem) && (
            <button
              onClick={() => { setIncludeSystem(!includeSystem); setShowAll(false); }}
              aria-pressed={includeSystem}
              className="font-semibold hover:text-foreground transition-colors"
            >
              {includeSystem ? 'Hide Windows\' own' : `${systemHidden} system hidden`}
            </button>
          )}
          <span className="flex items-center gap-1.5"><ShieldCheck size={12} /> {data.counts.ok} healthy</span>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {shown.map(health => {
          const style = TIER_STYLE[health.tier as Exclude<HealthTier, 'ok'>];
          const isOpen = expanded === health.taskId;
          const task = tasks?.find(t => t.id === health.taskId);

          return (
            <li key={health.taskId}>
              <button
                onClick={() => setExpanded(isOpen ? null : health.taskId)}
                aria-expanded={isOpen}
                className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-background/50 transition-colors"
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
                <div className="px-5 pb-4 pl-[3.25rem] space-y-2">
                  {health.signals.map(signal => (
                    <div key={signal.code} className="text-xs">
                      <div className="flex items-start gap-1.5">
                        {signal.severity === 'critical' && <AlertOctagon size={12} className="mt-0.5 shrink-0 text-red-500" />}
                        {signal.severity === 'warn' && <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-500" />}
                        {signal.severity === 'info' && <HelpCircle size={12} className="mt-0.5 shrink-0 text-muted-foreground" />}
                        <span className="font-medium">{signal.summary}</span>
                      </div>
                      {/* The evidence is the point. A claim without its source is
                          what this whole feature exists not to be. */}
                      <div className="text-muted-foreground pl-[1.125rem] mt-0.5">{signal.evidence}</div>
                    </div>
                  ))}

                  <div className="flex items-center justify-between gap-3 pt-1">
                    <span className="text-[11px] text-subtle-foreground">
                      Ranking score {health.score ?? '—'}{health.score !== null && '/100'} · used to order this list, not to grade the task
                    </span>
                    {task && (
                      <button
                        onClick={() => onTaskSelect(task)}
                        className="text-xs font-semibold text-primary hover:underline shrink-0"
                      >
                        Open task
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {needsAttention.length > shown.length && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground border-t border-border transition-colors"
        >
          Show {needsAttention.length - shown.length} more
        </button>
      )}
    </div>
  );
};
