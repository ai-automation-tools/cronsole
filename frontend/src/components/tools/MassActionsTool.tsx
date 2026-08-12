import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  EyeOff,
  FolderInput,
  Layers,
  Loader2,
  Power,
  PowerOff,
  RotateCcw,
  Undo2
} from 'lucide-react';
import { api } from '../../api';
import { platformLabel } from '../../platform';
import type { Task } from '../../types';
import type { HealthTier } from '../../utils/taskFilters';
import {
  chunk,
  DEFAULT_SCOPE,
  describeScope,
  detachedByCategorize,
  eligibleFor,
  inverseOf,
  MAX_TASKS_PER_BULK,
  resolveScope,
  TYPE_TO_CONFIRM_THRESHOLD,
  VERB_PAST,
  type MassScope,
  type MassScopeKind,
  type MassVerb
} from '../../utils/massActions';
import { useToast } from '../../hooks/useToast';
import { MassActionConfirm } from './MassActionConfirm';

/**
 * The Mass Actions console — fleet-scale operations, chosen by scope.
 *
 * **Why this is not just the dashboard's bulk bar behind an extra click.**
 * A checkbox selection answers "these ones", which is exactly right for three
 * tasks on screen and useless at 250: `254 selected` cannot survive into a
 * confirmation as anything a person can verify. A scope can — *"Disable 47 tasks
 * in Backups"* names the set in the terms it was chosen by, so the dialog is
 * re-readable instead of a number to be trusted. Everything else here follows
 * from that: the plan is visible before anything is asked of a platform, the
 * confirmation hardens as the blast radius grows, and the result is reported per
 * task because at this scale partial success *is* the normal case.
 *
 * **The dashboard keeps its selection.** Moving these verbs here is an
 * organizing win, not the safety one — friction by obscurity wears off in a
 * week. The safety mechanism is the typed confirmation above
 * `TYPE_TO_CONFIRM_THRESHOLD`. And "Remove from Cronsole" deliberately still
 * sits one click from Delete on the dashboard, because §9's rule cuts both ways:
 * *a gate that makes the safe path harder than the unsafe one is worse than no
 * gate*, and exiling the safe alternative would push people toward the
 * destructive one.
 *
 * **It adds no backend.** Every verb is an existing `/api/tools` route under the
 * five-outcome contract; the console chunks at the server's own 100-task ceiling
 * rather than arguing with it, which also buys progress reporting that one
 * twenty-minute request could never have given.
 */

type Phase = 'idle' | 'running' | 'done';

interface BulkItem {
  taskId: string;
  name: string;
  platform: string;
  outcome: 'updated' | 'unchanged' | 'refused' | 'failed' | 'skipped';
  message?: string;
}

interface BulkReport {
  requested: number;
  updated: number;
  unchanged: number;
  refused: number;
  failed: number;
  skipped: number;
  haltedReason?: string;
  items: BulkItem[];
}

const EMPTY_REPORT: BulkReport = {
  requested: 0,
  updated: 0,
  unchanged: 0,
  refused: 0,
  failed: 0,
  skipped: 0,
  items: []
};

/** Fold one batch's report into the run's running total. */
function mergeReports(a: BulkReport, b: BulkReport): BulkReport {
  return {
    requested: a.requested + b.requested,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    refused: a.refused + b.refused,
    failed: a.failed + b.failed,
    skipped: a.skipped + b.skipped,
    haltedReason: a.haltedReason ?? b.haltedReason,
    items: [...a.items, ...b.items]
  };
}

const OUTCOME_STYLE: Record<BulkItem['outcome'], { label: string; className: string }> = {
  updated: { label: 'Done', className: 'text-emerald-400' },
  unchanged: { label: 'No change', className: 'text-subtle-foreground' },
  refused: { label: 'Refused', className: 'text-amber-400' },
  failed: { label: 'Failed', className: 'text-red-400' },
  skipped: { label: 'Not attempted', className: 'text-slate-400' }
};

/**
 * The verbs this console runs.
 *
 * **Export and import are deliberately absent.** Both already have a tool that
 * does the job properly — Bulk export takes all / folder / selection and owns
 * the directory-picker and ZIP paths; Import owns discovery and its own
 * defaults. Adding a button here would either duplicate that logic or, worse,
 * be a permanently-disabled control that reads as broken. The card points at
 * them instead.
 */
const VERB_META: Record<Exclude<MassVerb, 'export'>, { label: string; icon: typeof Power }> = {
  enable: { label: 'Enable', icon: Power },
  disable: { label: 'Disable', icon: PowerOff },
  categorize: { label: 'Categorize', icon: FolderInput },
  // Never "Remove" on its own — the label is the only thing standing between
  // this and the delete it is deliberately not.
  untrack: { label: 'Remove from Cronsole', icon: EyeOff }
};

const VERBS = Object.keys(VERB_META) as Exclude<MassVerb, 'export'>[];

export const MassActionsTool = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [scope, setScope] = useState<MassScope>(DEFAULT_SCOPE);
  const [pendingVerb, setPendingVerb] = useState<MassVerb | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [report, setReport] = useState<BulkReport | null>(null);
  /** What the last completed run did, so an inverse can be offered for status. */
  const [lastRun, setLastRun] = useState<{ verb: MassVerb; changedIds: string[] } | null>(null);

  const { data: tasks } = useQuery<Task[]>({
    // Shares the dashboard's cache key on purpose: two keys over one route would
    // let this console act on a task list the dashboard has already moved past.
    queryKey: ['tasks'],
    queryFn: async () => (await api.get('/tasks')).data
  });

  // Health tiers are only fetched when a health scope is actually chosen — it is
  // a scan of every task and its executions, and pure waste otherwise.
  const { data: health } = useQuery<{ tasks: { taskId: string; tier: HealthTier }[] }>({
    queryKey: ['task-health'],
    queryFn: async () => (await api.get('/tools/task-health')).data,
    enabled: scope.kind === 'health'
  });

  const tiers = useMemo(
    () => (health ? new Map(health.tasks.map(t => [t.taskId, t.tier] as const)) : undefined),
    [health]
  );

  const { categories, platforms } = useMemo(() => {
    const cats = new Set<string>();
    const plats = new Set<string>();
    for (const t of tasks ?? []) {
      cats.add(t.category || 'Uncategorized');
      plats.add(t.platform);
    }
    return {
      categories: [...cats].sort(),
      platforms: [...plats].sort()
    };
  }, [tasks]);

  const { tasks: inScope, systemExcluded } = useMemo(
    () => resolveScope(tasks, scope, tiers),
    [tasks, scope, tiers]
  );

  const eligible = pendingVerb ? eligibleFor(inScope, pendingVerb) : [];

  const setKind = (kind: MassScopeKind) => {
    // Each kind needs a value that exists, or the scope resolves to nothing and
    // reads as "there is nothing here" rather than "you haven't chosen yet".
    const value =
      kind === 'category' ? categories[0] ?? ''
        : kind === 'platform' ? platforms[0] ?? ''
          : kind === 'status' ? 'ACTIVE'
            : kind === 'health' ? 'critical'
              : '';
    setScope(s => ({ ...s, kind, value }));
    setReport(null);
    setLastRun(null);
  };

  /**
   * Run one verb over a list of tasks, batch by batch.
   *
   * Halts the whole run when a batch reports a halt: the server stops a batch at
   * the first sign the agent is gone, and continuing into the next batch would
   * collect the same error 100 more times at ~15s each. Everything not attempted
   * is reported as such rather than quietly omitted.
   */
  const execute = useMutation({
    mutationFn: async ({ verb, targets, category }: { verb: MassVerb; targets: Task[]; category?: string }) => {
      const batches = chunk(targets);
      setPhase('running');
      setProgress({ done: 0, total: targets.length });

      let total: BulkReport = { ...EMPTY_REPORT };

      for (const batch of batches) {
        const ids = batch.map(t => t.id);
        let res: BulkReport;

        if (verb === 'enable' || verb === 'disable') {
          res = (await api.post('/tools/tasks/status', {
            taskIds: ids,
            status: verb === 'enable' ? 'ACTIVE' : 'DISABLED'
          })).data;
        } else if (verb === 'categorize') {
          res = (await api.post('/tools/tasks/category', { taskIds: ids, category })).data;
        } else {
          res = (await api.post('/tools/tasks/untrack', { taskIds: ids })).data;
        }

        total = mergeReports(total, res);
        setProgress(p => ({ ...p, done: p.done + batch.length }));
        setReport(total);

        if (res.haltedReason) {
          // Name every task the halt cost, rather than letting them vanish from
          // a run that reported fewer items than it was asked for.
          const attempted = new Set(total.items.map(i => i.taskId));
          const remaining = targets.filter(t => !attempted.has(t.id));
          total = mergeReports(total, {
            ...EMPTY_REPORT,
            requested: remaining.length,
            skipped: remaining.length,
            items: remaining.map(t => ({
              taskId: t.id,
              name: t.name,
              platform: t.platform,
              outcome: 'skipped' as const,
              message: res.haltedReason
            }))
          });
          setReport(total);
          break;
        }
      }

      return { verb, total };
    },
    onSuccess: ({ verb, total }) => {
      setPhase('done');
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-health'] });
      setLastRun({ verb, changedIds: total.items.filter(i => i.outcome === 'updated').map(i => i.taskId) });

      const bad = total.failed + total.refused + total.skipped;
      const summary = `${total.updated} ${VERB_PAST[verb]}${bad ? ` · ${bad} not` : ''}`;
      toast(summary, bad ? 'error' : 'success');
    },
    onError: (error: unknown) => {
      setPhase('done');
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Mass action failed: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  const start = (verb: MassVerb) => {
    setReport(null);
    setPendingVerb(verb);
  };

  const confirmed = (category?: string) => {
    const verb = pendingVerb!;
    const targets = eligibleFor(inScope, verb);
    setPendingVerb(null);
    execute.mutate({ verb, targets, category });
  };

  /** Undo is the inverse verb over exactly the ids the report says changed. */
  const undo = () => {
    if (!lastRun) return;
    const inverse = inverseOf(lastRun.verb);
    if (!inverse) return;
    const targets = (tasks ?? []).filter(t => lastRun.changedIds.includes(t.id));
    setReport(null);
    setLastRun(null);
    execute.mutate({ verb: inverse, targets });
  };

  const busy = phase === 'running';
  const undoable = lastRun && inverseOf(lastRun.verb) && lastRun.changedIds.length > 0;

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-5 flex flex-col h-full min-h-[26rem] xl:col-span-2">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-lg flex items-center gap-2">
            <Layers size={18} className="text-primary" /> Mass actions
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Act on many tasks at once by choosing <strong>what</strong> rather than ticking each one.
            Pick a scope, check what it resolved to, then run. Nothing is asked of a platform until
            you confirm.
          </p>
        </div>
      </div>

      {/* ---- Scope ------------------------------------------------------- */}
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'category', 'platform', 'status', 'health'] as MassScopeKind[]).map(kind => (
            <button
              key={kind}
              onClick={() => setKind(kind)}
              disabled={busy}
              aria-pressed={scope.kind === kind}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 ${
                scope.kind === kind
                  ? 'bg-primary/15 border-primary/50 text-foreground'
                  : 'bg-background border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {kind === 'all' ? 'All tasks'
                : kind === 'category' ? 'Category'
                  : kind === 'platform' ? 'Platform'
                    : kind === 'status' ? 'Status' : 'Health'}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {scope.kind !== 'all' && (
            <select
              value={scope.value}
              disabled={busy}
              onChange={e => { setScope(s => ({ ...s, value: e.target.value })); setReport(null); }}
              aria-label={`${scope.kind} to act on`}
              className="bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-40"
            >
              {scope.kind === 'category' && categories.map(c => <option key={c} value={c}>{c}</option>)}
              {scope.kind === 'platform' && platforms.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}
              {scope.kind === 'status' && ['ACTIVE', 'DISABLED', 'MISSING'].map(s => <option key={s} value={s}>{s}</option>)}
              {scope.kind === 'health' && ['critical', 'attention', 'unknown', 'ok'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          {/*
            The system fence. Off by default, and its cost is always printed —
            the same rule bulk export follows, because a fence nobody can see is
            indistinguishable from there being nothing behind it.
          */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={scope.includeSystem}
              disabled={busy}
              onChange={e => { setScope(s => ({ ...s, includeSystem: e.target.checked })); setReport(null); }}
              className="accent-primary"
            />
            Include Windows' own tasks
            {!scope.includeSystem && systemExcluded > 0 && (
              <span className="text-amber-400 font-bold tabular-nums">({systemExcluded} excluded)</span>
            )}
          </label>
        </div>
      </div>

      {/* ---- The plan ---------------------------------------------------- */}
      <div className="bg-background border border-border rounded-xl p-4 space-y-3">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-sm font-bold">
            {inScope.length} task{inScope.length === 1 ? '' : 's'} in scope
          </span>
          <span className="text-[11px] text-subtle-foreground">
            {describeScope(scope, platformLabel)}
            {inScope.length > MAX_TASKS_PER_BULK &&
              ` · ${chunk(inScope).length} batches of up to ${MAX_TASKS_PER_BULK}`}
          </span>
        </div>

        {inScope.length > 0 && (
          <ul className="max-h-40 overflow-y-auto text-xs space-y-1 pr-1">
            {inScope.slice(0, 200).map(t => (
              <li key={t.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                <span className="truncate">{t.name}</span>
                <span className="text-subtle-foreground shrink-0 tabular-nums">{t.status}</span>
              </li>
            ))}
            {inScope.length > 200 && (
              <li className="text-subtle-foreground italic pt-1">
                …and {inScope.length - 200} more. All {inScope.length} are in scope; the list is
                truncated, not the operation.
              </li>
            )}
          </ul>
        )}

        {inScope.length === 0 && (
          <p className="text-xs text-subtle-foreground">
            Nothing matches this scope
            {!scope.includeSystem && systemExcluded > 0
              ? ` — though ${systemExcluded} of Windows' own tasks do. Tick "Include Windows' own tasks" to reach them.`
              : '.'}
          </p>
        )}
      </div>

      {/* ---- Verbs ------------------------------------------------------- */}
      <div className="flex flex-wrap gap-2">
        {VERBS.map(verb => {
          const meta = VERB_META[verb];
          const Icon = meta.icon;
          // Each button states what it would actually change, never the scope
          // size — the same rule the server's `unchanged` outcome exists for.
          const n = eligibleFor(inScope, verb).length;
          return (
            <button
              key={verb}
              onClick={() => start(verb)}
              disabled={busy || n === 0}
              title={
                n === 0
                  ? `${meta.label} — nothing in this scope would change`
                  : `${meta.label} ${n} task${n === 1 ? '' : 's'}`
              }
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${
                verb === 'enable'
                  ? 'bg-success hover:bg-success-hover text-success-foreground border-transparent'
                  : 'bg-muted hover:bg-muted/80 text-foreground border-border'
              }`}
            >
              <Icon size={13} />
              {meta.label}
              {n > 0 && <span className="tabular-nums opacity-80">{n}</span>}
            </button>
          );
        })}

        {undoable && !busy && (
          <button
            onClick={undo}
            title={`Put those ${lastRun!.changedIds.length} tasks back the way they were`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-background border border-primary/50 text-foreground hover:border-primary transition-all active:scale-95 ml-auto"
          >
            <Undo2 size={13} /> Undo ({lastRun!.changedIds.length})
          </button>
        )}
      </div>

      {/* ---- Progress & result ------------------------------------------- */}
      {busy && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="tabular-nums">
            {progress.done} of {progress.total} processed
          </span>
          <span className="text-subtle-foreground">
            Each Windows task is a round trip to the agent, so this is not instant.
          </span>
        </div>
      )}

      {report && phase === 'done' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 size={13} /> {report.updated} done
            </span>
            {report.unchanged > 0 && <span className="text-subtle-foreground">{report.unchanged} already so</span>}
            {report.refused > 0 && <span className="text-amber-400">{report.refused} refused</span>}
            {report.failed > 0 && <span className="text-red-400">{report.failed} failed</span>}
            {report.skipped > 0 && <span className="text-slate-400">{report.skipped} not attempted</span>}
          </div>

          {report.haltedReason && (
            <p className="flex items-start gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                Stopped early: {report.haltedReason} Everything after that point is listed as not
                attempted — nothing was silently dropped. Fix the agent and run the same scope again;
                tasks already done will come back as "already so".
              </span>
            </p>
          )}

          {/* Anything that is not a clean success is worth reading individually,
              which is the whole reason the report is per task. */}
          {report.items.some(i => i.outcome !== 'updated') && (
            <ul className="max-h-48 overflow-y-auto text-xs space-y-1 pr-1 border-t border-border pt-3">
              {report.items
                .filter(i => i.outcome !== 'updated')
                .map(i => (
                  <li key={i.taskId} className="flex items-start justify-between gap-3">
                    <span className="truncate text-muted-foreground">{i.name}</span>
                    <span className={`shrink-0 font-bold ${OUTCOME_STYLE[i.outcome].className}`}>
                      {OUTCOME_STYLE[i.outcome].label}
                      {i.message && <span className="font-normal opacity-80"> — {i.message}</span>}
                    </span>
                  </li>
                ))}
            </ul>
          )}

          <button
            onClick={() => { setReport(null); setPhase('idle'); }}
            className="text-[11px] font-bold text-subtle-foreground hover:text-foreground flex items-center gap-1.5"
          >
            <RotateCcw size={11} /> Clear result
          </button>
        </div>
      )}

      {pendingVerb && (
        <MassActionConfirm
          verb={pendingVerb}
          scopeLabel={describeScope(scope, platformLabel)}
          count={eligible.length}
          scopeSize={inScope.length}
          categories={categories}
          detachedCount={cat => detachedByCategorize(eligible, cat)}
          onCancel={() => setPendingVerb(null)}
          onConfirm={confirmed}
        />
      )}

      <p className="text-[11px] text-subtle-foreground mt-auto pt-2">
        Operations of {TYPE_TO_CONFIRM_THRESHOLD} tasks or more must be confirmed by typing the
        count. Enable and disable can be undone; removing from Cronsole is undone by re-importing,
        and recategorizing is not undoable — so those say so rather than offering a button that
        would not work. <strong>Exporting</strong> in bulk is the Bulk export card below, which
        already takes all / folder / selection; <strong>importing</strong> is on the Dashboard,
        where discovery lives.
      </p>
    </div>
  );
};

export default MassActionsTool;
