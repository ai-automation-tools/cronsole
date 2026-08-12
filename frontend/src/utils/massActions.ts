import type { Task } from '../types';
import type { HealthTier } from './taskFilters';

/**
 * The Mass Actions console's model: what a scope is, what it resolves to, and
 * how much friction the resulting operation has to cost.
 *
 * **Scope-first, not checkbox-first.** The dashboard's selection answers "these
 * ones", which is right for three tasks you are looking at and useless at 250:
 * `254 selected` cannot survive into a confirmation dialog as anything a person
 * can check. A scope can — *"Disable 47 tasks in `\Backups`"* names the same set
 * in terms the user chose it by, so the dialog is re-readable rather than a
 * number they have to trust. That is the whole reason this surface exists; it is
 * not the dashboard's bulk bar behind an extra click.
 *
 * Everything here is pure. The console does the fetching and the mutating; the
 * decisions — what is in scope, what each verb may touch, how many batches it
 * takes, how hard the confirmation should be — are here so they are pinned by
 * tests rather than by whoever edits the component next.
 */

/** Ceiling on one bulk request, mirroring `MAX_TASKS_PER_BULK` on the server. */
export const MAX_TASKS_PER_BULK = 100;

/**
 * Above this, the confirmation stops being one click.
 *
 * The gap this closes: bulk status and untrack already confirmed, and already
 * named the number they would change — but the dialog for 254 tasks was the
 * *same dialog* as the dialog for 3. Nothing got harder as the blast radius
 * grew, so habit built on small batches carried straight through to a
 * machine-wide one. Relocating the buttons to another tab does not fix that; it
 * is friction by obscurity, and it wears off. A dialog that hardens with scale
 * is friction by design.
 *
 * 25 is chosen to sit above any batch a person assembles deliberately and well
 * below the scale at which they have stopped reading.
 */
export const TYPE_TO_CONFIRM_THRESHOLD = 25;

export type MassScopeKind = 'all' | 'category' | 'platform' | 'status' | 'health';

export interface MassScope {
  kind: MassScopeKind;
  /** The chosen category / platform / status / tier. Unused for `'all'`. */
  value: string;
  /**
   * Whether Windows' own `\Microsoft\` tasks are in scope. **Excluded by
   * default**, and the count of what that excluded is always reported — the
   * same rule bulk export follows, and for the same reason: a fence nobody can
   * see is indistinguishable from there being nothing behind it.
   */
  includeSystem: boolean;
}

/**
 * The scope an action opens on: **by category**, not everything.
 *
 * A mass action that starts pointed at every task makes the widest possible
 * operation the path of least resistance — you would have to actively narrow it
 * to do the ordinary thing. Category is how these tasks are already organised
 * (a Windows task's category comes from its Task Scheduler folder), so it is
 * both the common case and a scope the user can read back.
 *
 * `value` is empty here because the categories are not known until the task list
 * loads; the console fills it through `defaultScopeValue`. A category scope with
 * an empty value resolves to **nothing**, which would render as "no tasks here"
 * on open — so callers must not use this literal without that step.
 */
export const DEFAULT_SCOPE: MassScope = { kind: 'category', value: '', includeSystem: false };

/**
 * The value a scope kind should start on, given what this machine actually has.
 *
 * One definition, used both when an action is opened and when the kind is
 * switched — two spellings of "pick a sensible starting value" is how one of
 * them ends up leaving `value` empty and silently resolving to nothing.
 */
export function defaultScopeValue(
  kind: MassScopeKind,
  options: { categories: string[]; platforms: string[] }
): string {
  switch (kind) {
    case 'all':
      return '';
    case 'category':
      return options.categories[0] ?? '';
    case 'platform':
      return options.platforms[0] ?? '';
    case 'status':
      return 'ACTIVE';
    case 'health':
      return 'critical';
  }
}

/** The five verbs the console offers. Import is a different flow — see the tool. */
export type MassVerb = 'enable' | 'disable' | 'categorize' | 'untrack' | 'export';

export interface ScopeResolution {
  /** Tasks the scope selects, after the system lens. */
  tasks: Task[];
  /** How many `\Microsoft\` tasks the default fence kept out. Always stated. */
  systemExcluded: number;
}

/**
 * Resolve a scope against the task list.
 *
 * `isSystem` is the server's verdict and is never re-derived here — the same
 * rule the dashboard follows, because a second definition of "is this
 * `\Microsoft\`?" is what silently took a folder out of every sync (trap #20a).
 */
export function resolveScope(
  tasks: Task[] | undefined,
  scope: MassScope,
  tiers?: Map<string, HealthTier>
): ScopeResolution {
  const all = tasks ?? [];

  const inScope = all.filter(task => {
    switch (scope.kind) {
      case 'all':
        return true;
      case 'category':
        return (task.category || 'Uncategorized') === scope.value;
      case 'platform':
        return task.platform === scope.value;
      case 'status':
        return task.status === scope.value;
      case 'health':
        // Absent from the map is `unknown`, never `ok` — absence of evidence is
        // not evidence of health, and a scope that quietly counted unscanned
        // tasks as healthy would be acting on a guess.
        return (tiers?.get(task.id) ?? 'unknown') === scope.value;
    }
  });

  const systemExcluded = scope.includeSystem
    ? 0
    : inScope.filter(t => t.isSystem === true).length;

  return {
    tasks: scope.includeSystem ? inScope : inScope.filter(t => t.isSystem !== true),
    systemExcluded
  };
}

/**
 * Which of the resolved tasks a given verb would actually change.
 *
 * Every button states this number rather than the scope size, for the reason
 * the server's `unchanged` outcome exists: asking to enable 47 tasks of which 44
 * are already enabled is a 3-task operation, and calling it 47 inflates the
 * number in exactly the direction that erodes trust in it.
 *
 * These are *predictions*, made from what Cronsole currently believes. The
 * server re-decides per task and its answer is the one that counts — a task the
 * platform has since changed will come back `unchanged`, which is correct and
 * is why the report is per item.
 */
export function eligibleFor(tasks: Task[], verb: MassVerb): Task[] {
  switch (verb) {
    case 'enable':
      // MISSING has nothing to toggle — the platform already lost it.
      return tasks.filter(t => t.status !== 'ACTIVE' && t.status !== 'MISSING');
    case 'disable':
      return tasks.filter(t => t.status === 'ACTIVE');
    case 'categorize':
      // The only verb that can touch every task in scope: a category is a
      // Cronsole label, so nothing about a task can refuse one.
      return tasks;
    case 'untrack':
      // A Cronsole-native task's row *is* the task, so there is nothing to
      // keep running after removing it.
      return tasks.filter(t => t.platform !== 'TASKHUB_NATIVE');
    case 'export':
      // Native XML is a Task Scheduler format; native tasks export as JSON
      // through their own per-task route.
      return tasks.filter(t => t.platform === 'WINDOWS_TASK_SCHEDULER');
  }
}

/**
 * How many of the in-scope Windows tasks would have their Task Scheduler folder
 * and their Cronsole category disagree after a recategorize.
 *
 * Mirrors the server's `detachedFromFolder`, and exists so the number can be
 * stated **before** the click. A warning that arrives with the result arrives
 * too late to change the decision.
 */
export function detachedByCategorize(tasks: Task[], category: string): number {
  return tasks.filter(
    t =>
      t.platform === 'WINDOWS_TASK_SCHEDULER' &&
      (t.category || 'Uncategorized') !== category
  ).length;
}

/**
 * Split into request-sized batches.
 *
 * The server's 100-task ceiling is a correctness bound, not a performance one:
 * each Windows task can cost its full ~15s agent timeout, so an unbounded list
 * turns one HTTP request into an arbitrarily long hang. Chunking honors that
 * bound instead of arguing with it — and buys something a single huge request
 * could not have anyway, since a batch that runs for twenty minutes behind one
 * spinner cannot report progress or be stopped.
 *
 * Each chunk is independently atomic where its verb is (untrack writes each row
 * and its `TaskExclusion` together), so a run that stops between chunks leaves
 * completed tasks completed and untouched tasks untouched — never a task
 * half-done. Partial completion is reported per item, like every other partial
 * result here.
 */
export function chunk<T>(items: T[], size: number = MAX_TASKS_PER_BULK): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Does an operation of this size have to be typed out rather than clicked? */
export function needsTypedConfirmation(count: number): boolean {
  return count >= TYPE_TO_CONFIRM_THRESHOLD;
}

/**
 * Human description of a scope — the string that has to survive into the
 * confirmation dialog, because it is the part `254 selected` could not say.
 */
export function describeScope(scope: MassScope, platformName: (id: string) => string): string {
  switch (scope.kind) {
    case 'all':
      return scope.includeSystem ? 'every tracked task' : 'every tracked task of yours';
    case 'category':
      return `the "${scope.value}" category`;
    case 'platform':
      return platformName(scope.value);
    case 'status':
      return `tasks that are ${scope.value.toLowerCase()}`;
    case 'health':
      return scope.value === 'ok'
        ? 'tasks scored healthy'
        : scope.value === 'unknown'
          ? 'tasks with no health evidence'
          : `tasks scored ${scope.value}`;
  }
}

/** Past-participle for a verb, matching the server's own summary vocabulary. */
export const VERB_PAST: Record<MassVerb, string> = {
  enable: 'enabled',
  disable: 'disabled',
  categorize: 'recategorized',
  untrack: 'removed from Cronsole',
  export: 'exported'
};

/**
 * The inverse of a status verb, for undo.
 *
 * Deliberately **only** status. Untrack's undo is a re-import (a different
 * operation with a different result), and categorize's would need each task's
 * prior category stored — so offering a general "undo" would promise two things
 * it cannot do in order to advertise the one it can.
 */
export function inverseOf(verb: MassVerb): MassVerb | null {
  if (verb === 'enable') return 'disable';
  if (verb === 'disable') return 'enable';
  return null;
}
