import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
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
  defaultScopeValue,
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
import { HelpButton } from '../HelpButton';
import { ToolCard } from './ToolCard';

/**
 * The Mass Actions console — **the only** place Cronsole changes many tasks at
 * once. Pick an action, then pick which tasks it applies to.
 *
 * **This replaced row selection entirely** (2026-08-12). The dashboard used to
 * carry a checkbox per row, a select-all and a bulk bar; all of it is gone. Two
 * ways to say "these tasks" is one too many, and selection was the weaker one:
 * `254 selected` cannot survive into a confirmation as anything a person can
 * check, and it capped out at what a single request would accept — on a real
 * machine "Select all 269" built a batch every button then 400'd on. A scope
 * survives — *"Disable 47 tasks in Backups"* names the set in the terms it was
 * chosen by — and it batches.
 *
 * The safe-path worry that argued for keeping selection turned out not to
 * apply: **"Remove from Cronsole" sits beside "Delete from Windows" in the task
 * modal, per task**, which is where that pairing always actually lived. The bulk
 * bar was never what kept the safe option next to the destructive one.
 *
 * What carries the safety here is the **typed confirmation above
 * `TYPE_TO_CONFIRM_THRESHOLD`** — a dialog that hardens as the blast radius
 * grows. Being on another tab is organisation, not protection; friction by
 * obscurity wears off in a week.
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
  updated: { label: 'Done', className: 'text-success-text' },
  unchanged: { label: 'No change', className: 'text-subtle-foreground' },
  refused: { label: 'Refused', className: 'text-warning-text' },
  failed: { label: 'Failed', className: 'text-danger-text' },
  skipped: { label: 'Not attempted', className: 'text-neutral-text' }
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
const VERB_META: Record<
  Exclude<MassVerb, 'export'>,
  { label: string; blurb: string; icon: typeof Power; tint: string }
> = {
  enable: {
    label: 'Enable tasks',
    blurb: 'Turn tasks back on so they run on their schedules again.',
    icon: Power,
    tint: 'bg-success/15 text-success-text'
  },
  disable: {
    label: 'Disable tasks',
    blurb: 'Stop tasks running, without deleting anything. Reversible.',
    icon: PowerOff,
    tint: 'bg-warning/15 text-warning-text'
  },
  categorize: {
    label: 'Move to a category',
    blurb: 'Relabel tasks in Cronsole. Nothing moves on your machine.',
    icon: FolderInput,
    tint: 'bg-info/15 text-info-text'
  },
  // Never "Remove" on its own — the label is the only thing standing between
  // this and the delete it is deliberately not.
  untrack: {
    label: 'Remove from Cronsole',
    blurb: 'Stop tracking them here. They keep running on their platform.',
    icon: EyeOff,
    tint: 'bg-isolate/15 text-isolate-text'
  }
};

const VERBS = Object.keys(VERB_META) as Exclude<MassVerb, 'export'>[];

export const MassActionsTool = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  /**
   * The action the user picked from the list, and the step they are on.
   *
   * `null` = the action list; anything else = configuring the scope for that
   * one verb. Deliberately **not** shared with `pendingVerb` (the confirmation):
   * backing out of a configured action must not leave a half-built scope
   * pointed at whatever they open next.
   */
  const [activeVerb, setActiveVerb] = useState<Exclude<MassVerb, 'export'> | null>(null);
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

  /**
   * What the chosen action would actually change, inside the chosen scope.
   *
   * Everything downstream — the plan list, the button count, the confirmation —
   * reads this one value, so the number on the button and the number in the
   * dialog cannot drift apart. It is the eligible set, never the scope size:
   * asking to enable 80 tasks of which 70 already run is a 10-task operation.
   */
  const willChange = activeVerb ? eligibleFor(inScope, activeVerb) : [];

  /**
   * The scope an action opens on. Goes through `defaultScopeValue` rather than
   * using `DEFAULT_SCOPE` literally: the default kind is `category`, whose value
   * cannot be known until the task list has loaded, and an empty one resolves to
   * nothing — which would read as "there are no tasks here" on open.
   */
  const openingScope = (): MassScope => ({
    ...DEFAULT_SCOPE,
    value: defaultScopeValue(DEFAULT_SCOPE.kind, { categories, platforms })
  });

  const setKind = (kind: MassScopeKind) => {
    // Each kind needs a value that exists, or the scope resolves to nothing and
    // reads as "there is nothing here" rather than "you haven't chosen yet".
    setScope(s => ({ ...s, kind, value: defaultScopeValue(kind, { categories, platforms }) }));
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

  // ---- Action-first flow --------------------------------------------------
  //
  // The console asks "what do you want to do?" before "to which tasks?" — the
  // opposite of both the dashboard's old row selection and this card's first
  // version. Two reasons that order is better here:
  //
  //  - **It is discoverable.** A vertical list of verbs answers "what can this
  //    do?" on sight. A scope picker with four buttons under it answers that
  //    only after you have already made a choice you had no basis for.
  //  - **Each verb asks only for what it needs.** Categorize wants a target
  //    category; the others do not. Per-action configuration means the
  //    confirmation is the last thing you meet, rather than the place you
  //    discover a required field.
  //
  // The scope belongs to the chosen action, not to the card: backing out must
  // never leave a half-built scope aimed at whatever you open next.
  const chosen = activeVerb ? VERB_META[activeVerb] : null;

  return (
    <ToolCard
      icon={Layers}
      title="Mass actions"
      titleAdornment={<HelpButton topic="mass-actions" />}
      description={<>
        Change many tasks at once. Pick what you want to do, then choose which tasks it applies
        to. Nothing is asked of a platform until you confirm.
      </>}
      action={activeVerb && !busy ? (
        <button
          onClick={() => { setActiveVerb(null); setReport(null); }}
          className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground hover:text-foreground transition-colors shrink-0"
        >
          <ArrowLeft size={13} /> All actions
        </button>
      ) : undefined}
    >

      {/* ---- Step 1: what do you want to do? ----------------------------- */}
      {!activeVerb && (
        <ul className="space-y-2">
          {VERBS.map(verb => {
            const meta = VERB_META[verb];
            const Icon = meta.icon;
            return (
              <li key={verb}>
                <button
                  onClick={() => { setActiveVerb(verb); setScope(openingScope()); setReport(null); }}
                  className="w-full flex items-center gap-4 text-left bg-raised border border-border rounded-xl px-4 py-3 hover:border-primary/50 transition-all active:scale-[0.99] group"
                >
                  <span className={`p-2 rounded-lg shrink-0 ${meta.tint}`}>
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-foreground">{meta.label}</span>
                    <span className="block text-xs text-muted-foreground">{meta.blurb}</span>
                  </span>
                  <ChevronRight
                    size={16}
                    className="text-subtle-foreground group-hover:text-foreground transition-colors shrink-0"
                  />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ---- Step 2: to which tasks? ------------------------------------- */}
      {activeVerb && chosen && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className={`p-2 rounded-lg ${chosen.tint}`}>
              <chosen.icon size={16} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold">{chosen.label}</p>
              <p className="text-xs text-muted-foreground">{chosen.blurb}</p>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">
              Which tasks?
            </p>
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
                    : kind === 'category' ? 'By category'
                      : kind === 'platform' ? 'By platform'
                        : kind === 'status' ? 'By status' : 'By health'}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {scope.kind !== 'all' && (
                <select
                  value={scope.value}
                  disabled={busy}
                  onChange={e => { setScope(s => ({ ...s, value: e.target.value })); setReport(null); }}
                  aria-label={`Which ${scope.kind}`}
                  className="bg-background border border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary disabled:opacity-40"
                >
                  {scope.kind === 'category' && categories.map(c => <option key={c} value={c}>{c}</option>)}
                  {scope.kind === 'platform' && platforms.map(p => <option key={p} value={p}>{platformLabel(p)}</option>)}
                  {scope.kind === 'status' && ['ACTIVE', 'DISABLED', 'MISSING'].map(s => <option key={s} value={s}>{s}</option>)}
                  {scope.kind === 'health' && ['critical', 'attention', 'unknown', 'ok'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              )}

              {/* The system fence. Off by default, and what it costs is always
                  printed — a fence nobody can see is indistinguishable from
                  there being nothing behind it. */}
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={scope.includeSystem}
                  disabled={busy}
                  onChange={e => { setScope(s => ({ ...s, includeSystem: e.target.checked })); setReport(null); }}
                  className="accent-primary"
                />
                Include Windows&rsquo; own tasks
                {!scope.includeSystem && systemExcluded > 0 && (
                  <span className="text-warning-text font-bold tabular-nums">({systemExcluded} excluded)</span>
                )}
              </label>
            </div>
          </div>

          {/* ---- The plan ------------------------------------------------- */}
          <div className="bg-raised border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <span className="text-sm font-bold">
                {willChange.length} task{willChange.length === 1 ? '' : 's'} will be {VERB_PAST[activeVerb]}
              </span>
              <span className="text-[11px] text-subtle-foreground">
                {describeScope(scope, platformLabel)}
                {inScope.length > willChange.length &&
                  ` · ${inScope.length} in scope, ${inScope.length - willChange.length} need no change`}
                {willChange.length > MAX_TASKS_PER_BULK &&
                  ` · ${chunk(willChange).length} batches of up to ${MAX_TASKS_PER_BULK}`}
              </span>
            </div>

            {willChange.length > 0 ? (
              <ul className="max-h-40 overflow-y-auto text-xs space-y-1 pr-1">
                {willChange.slice(0, 200).map(t => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-muted-foreground">
                    <span className="truncate">{t.name}</span>
                    <span className="text-subtle-foreground shrink-0 tabular-nums">{t.status}</span>
                  </li>
                ))}
                {willChange.length > 200 && (
                  <li className="text-subtle-foreground italic pt-1">
                    …and {willChange.length - 200} more. All {willChange.length} are included; the
                    list is truncated, not the operation.
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-xs text-subtle-foreground">
                Nothing here would change
                {!scope.includeSystem && systemExcluded > 0
                  ? ` — though ${systemExcluded} of Windows’ own tasks are in this scope. Tick “Include Windows’ own tasks” to reach them.`
                  : inScope.length > 0
                    ? ` — all ${inScope.length} tasks in this scope are already in that state.`
                    : '.'}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setPendingVerb(activeVerb)}
              disabled={busy || willChange.length === 0}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold border transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 ${
                activeVerb === 'enable'
                  ? 'bg-success hover:bg-success-hover text-success-foreground border-transparent'
                  : 'bg-primary hover:bg-primary-hover text-primary-foreground border-transparent'
              }`}
            >
              <chosen.icon size={13} />
              {chosen.label}
              {willChange.length > 0 && <span className="tabular-nums opacity-80">{willChange.length}</span>}
            </button>

            {undoable && !busy && (
              <button
                onClick={undo}
                title={`Put those ${lastRun!.changedIds.length} tasks back the way they were`}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-background border border-primary/50 text-foreground hover:border-primary transition-all active:scale-95"
              >
                <Undo2 size={13} /> Undo ({lastRun!.changedIds.length})
              </button>
            )}
          </div>
        </div>
      )}

      {/* ---- Progress & result ------------------------------------------- */}
      {busy && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin text-primary" />
          <span className="tabular-nums">{progress.done} of {progress.total} processed</span>
          <span className="text-subtle-foreground">
            Each Windows task is a round trip to the agent, so this is not instant.
          </span>
        </div>
      )}

      {report && phase === 'done' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-bold">
            <span className="flex items-center gap-1.5 text-success-text">
              <CheckCircle2 size={13} /> {report.updated} done
            </span>
            {report.unchanged > 0 && <span className="text-subtle-foreground">{report.unchanged} already so</span>}
            {report.refused > 0 && <span className="text-warning-text">{report.refused} refused</span>}
            {report.failed > 0 && <span className="text-danger-text">{report.failed} failed</span>}
            {report.skipped > 0 && <span className="text-neutral-text">{report.skipped} not attempted</span>}
          </div>

          {report.haltedReason && (
            <p className="flex items-start gap-2 text-xs text-warning-text bg-warning/10 border border-warning/30 rounded-xl p-3">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <span>
                Stopped early: {report.haltedReason} Everything after that point is listed as not
                attempted — nothing was silently dropped. Fix the agent and run the same scope
                again; tasks already done will come back as &ldquo;already so&rdquo;.
              </span>
            </p>
          )}

          {/* Anything that is not a clean success is worth reading individually,
              which is the whole reason the report is per task. */}
          {report.items.some(i => i.outcome !== 'updated') && (
            <ul className="max-h-48 overflow-y-auto text-xs space-y-1 pr-1 border-t border-border pt-3">
              {report.items.filter(i => i.outcome !== 'updated').map(i => (
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
          count={willChange.length}
          scopeSize={inScope.length}
          categories={categories}
          detachedCount={cat => detachedByCategorize(willChange, cat)}
          onCancel={() => setPendingVerb(null)}
          onConfirm={confirmed}
        />
      )}

      <p className="text-[11px] text-subtle-foreground mt-auto pt-2">
        Operations of {TYPE_TO_CONFIRM_THRESHOLD} tasks or more must be confirmed by typing the
        count. Enable and disable can be undone; removing from Cronsole is undone by re-importing,
        and recategorizing is not undoable — so those say so rather than offering a button that
        would not work. <strong>Exporting</strong> in bulk is the Bulk export card below, which
        already takes all / folder / selection; <strong>importing</strong> is the Dashboard's Import
        button, which asks whether you mean the tasks already on this machine or a task file.
      </p>
    </ToolCard>
  );
};

export default MassActionsTool;
