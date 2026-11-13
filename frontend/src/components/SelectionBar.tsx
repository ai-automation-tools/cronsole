import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  Bookmark,
  CheckSquare,
  EyeOff,
  FolderInput,
  Loader2,
  Power,
  PowerOff,
  Star,
  StarOff,
  X
} from 'lucide-react';
import type { Task } from '../types';
import { useToast } from '../hooks/useToast';
import { useCollections, useCreateCollection, useSetCollectionMembers } from '../hooks/useCollections';
import { detachedByCategorize, type MassVerb } from '../utils/massActions';
import {
  describeSelection,
  eligibleForSelection,
  OUTCOME_STYLE,
  runBulk,
  type BulkReport,
  type BulkVerb
} from '../utils/bulkRun';
import { MassActionConfirm } from './tools/MassActionConfirm';
import { Modal } from './ui/Modal';

/**
 * **The dashboard's selection bar** — act on the tasks you ticked.
 *
 * Selection came back on 2026-11-13 (it was removed 2026-08-12 in favour of the
 * scope-first Mass Actions console). It returns under the rules that removal
 * named, rather than around them:
 *
 *  - **It runs the same routes and the same runner** (`utils/bulkRun.ts`), so a
 *    selection and a scope cannot disagree about what a bulk run did, and every
 *    run reports per task.
 *  - **It acts only on what is on screen.** The selection is intersected with
 *    the filtered list by the dashboard, so changing a filter can never leave
 *    an invisible task in the batch, and *Select all* means *all shown*.
 *  - **The confirmation can say what it is about.** The four console verbs go
 *    through `MassActionConfirm` with the selection **named** (first few task
 *    names), and its typed count past 25. Labels (favorite, collection, system
 *    tasks) touch no platform and come with Undo, so they run on the click.
 *  - **Every button states how many tasks it would change**, not the selection
 *    size — `eligibleFor`'s rule.
 */

const CONFIRMED: MassVerb[] = ['enable', 'disable', 'categorize', 'untrack'];

const PAST: Record<BulkVerb, string> = {
  enable: 'enabled',
  disable: 'disabled',
  categorize: 'recategorized',
  untrack: 'removed from Cronsole',
  favorite: 'favorited',
  unfavorite: 'unfavorited',
  hide: 'moved to system tasks',
  unhide: 'moved out of system tasks'
};

const INVERSE: Partial<Record<BulkVerb, BulkVerb>> = {
  enable: 'disable',
  disable: 'enable',
  favorite: 'unfavorite',
  unfavorite: 'favorite',
  hide: 'unhide',
  unhide: 'hide'
};

interface Props {
  selected: Task[];
  shownCount: number;
  categories: string[];
  onSelectAll: () => void;
  onClear: () => void;
  onExit: () => void;
  /** True while the current view shows system tasks — so a move there changes nothing on screen. */
  systemShown?: boolean;
}

const BarButton = ({
  icon,
  label,
  count,
  onClick,
  disabled,
  tone = 'default'
}: {
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled || count === 0}
    title={count === 0 ? 'None of the selected tasks would change' : undefined}
    className={`flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold transition-colors active:scale-95 disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 ${
      tone === 'danger'
        ? 'border-danger/30 bg-danger/10 text-danger-text hover:bg-danger/20'
        : 'border-border bg-background text-foreground hover:border-ring/50'
    }`}
  >
    {icon}
    {label}
    <span className="tabular-nums text-muted-foreground">{count}</span>
  </button>
);

export const SelectionBar = ({ selected, shownCount, categories, onSelectAll, onClear, onExit, systemShown }: Props) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: collections } = useCollections();
  const setMembers = useSetCollectionMembers();
  const createCollection = useCreateCollection();

  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<MassVerb | null>(null);
  const [report, setReport] = useState<BulkReport | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  const n = selected.length;
  const count = (verb: BulkVerb) => eligibleForSelection(selected, verb).length;

  const run = async (verb: BulkVerb, targets: Task[], category?: string) => {
    if (targets.length === 0) return;
    setBusy(true);
    try {
      const total = await runBulk(verb, targets, { category });
      const changed = total.items.filter(i => i.outcome === 'updated').map(i => i.taskId);
      const bad = total.refused + total.failed + total.skipped;
      const inverse = INVERSE[verb];
      toast(
        `${total.updated} ${PAST[verb]}${bad ? ` · ${bad} not` : ''}` +
          // Otherwise a move that worked looks like one that didn't: the tasks stay put.
          (verb === 'hide' && systemShown && total.updated
            ? '. This view shows system tasks, so they stay visible — switch to Mine to hide them.'
            : ''),
        bad ? 'error' : 'success',
        inverse && changed.length
          ? {
              label: 'Undo',
              onClick: () => run(inverse, targets.filter(t => changed.includes(t.id)))
            }
          : undefined
      );
      // Per task, never per batch: what did not happen is listed with its reason.
      if (bad) setReport(total);
    } catch (error) {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Could not ${verb} the selection: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setBusy(false);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['task-health'] });
      queryClient.invalidateQueries({ queryKey: ['collections'] });
    }
  };

  const label = (verb: BulkVerb) => run(verb, eligibleForSelection(selected, verb));

  const addToCollection = async (id: string) => {
    const collection = collections?.find(c => c.id === id);
    if (!collection) return;
    const already = selected.filter(t => t.collectionIds?.includes(id)).length;
    setBusy(true);
    try {
      const res = await setMembers.mutateAsync({ id, add: selected.map(t => t.id) });
      const added = n - already - res.ignored.length;
      toast(
        `${added} added to “${collection.name}”` +
          (already ? ` · ${already} already in it` : '') +
          (res.ignored.length ? ` · ${res.ignored.length} not found` : ''),
        res.ignored.length ? 'error' : 'success'
      );
    } catch {
      toast(`Could not add to “${collection.name}”.`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const createWithSelection = async () => {
    const name = (newName ?? '').trim();
    if (!name) return;
    setBusy(true);
    try {
      await createCollection.mutateAsync({ name, taskIds: selected.map(t => t.id) });
      toast(`Collection “${name}” created with ${n} task${n === 1 ? '' : 's'}.`, 'success');
      setNewName(null);
    } catch (error) {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Could not create the collection: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        role="region"
        aria-label="Selected tasks"
        className="sticky bottom-4 z-40 -mt-16 rounded-2xl border border-primary/40 bg-raised/95 p-3 shadow-2xl backdrop-blur"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 pr-1 text-sm font-bold">
            {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckSquare size={15} className="text-primary-text" />}
            <span className="tabular-nums">{n}</span> selected
          </span>
          {n < shownCount && (
            <button type="button" onClick={onSelectAll} className="text-xs font-semibold text-primary-text hover:underline">
              Select all {shownCount} shown
            </button>
          )}
          {n > 0 && (
            <button type="button" onClick={onClear} className="text-xs font-semibold text-muted-foreground hover:text-foreground">
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onExit}
            aria-label="Stop selecting"
            title="Stop selecting (Esc)"
            className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-surface hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {n === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">Click tasks to select them.</p>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
            {newName === null ? (
              <label className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2 text-xs font-semibold">
                <Bookmark size={14} className="text-primary-text" aria-hidden />
                <select
                  aria-label="Add the selection to a collection"
                  value=""
                  disabled={busy}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === '__new') setNewName('');
                    else if (v) addToCollection(v);
                  }}
                  className="bg-transparent outline-none"
                >
                  <option value="">Add to collection…</option>
                  {collections?.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                  <option value="__new">+ New collection…</option>
                </select>
              </label>
            ) : (
              <form
                className="flex shrink-0 items-center gap-1.5"
                onSubmit={e => { e.preventDefault(); createWithSelection(); }}
              >
                <input
                  autoFocus
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); setNewName(null); } }}
                  placeholder="Collection name"
                  aria-label="New collection name"
                  className="h-8 w-40 rounded-lg border border-border bg-background px-2 text-xs outline-none focus:border-primary"
                />
                <button type="submit" disabled={busy || !newName.trim()} className="h-8 rounded-lg bg-primary px-3 text-xs font-bold text-primary-foreground disabled:opacity-40">
                  Create
                </button>
                <button type="button" onClick={() => setNewName(null)} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </form>
            )}

            <BarButton icon={<Star size={14} />} label="Favorite" count={count('favorite')} disabled={busy} onClick={() => label('favorite')} />
            {count('unfavorite') > 0 && (
              <BarButton icon={<StarOff size={14} />} label="Unfavorite" count={count('unfavorite')} disabled={busy} onClick={() => label('unfavorite')} />
            )}
            <BarButton icon={<Archive size={14} />} label="Move to system tasks" count={count('hide')} disabled={busy} onClick={() => label('hide')} />
            {count('unhide') > 0 && (
              <BarButton icon={<ArchiveRestore size={14} />} label="Move out of system tasks" count={count('unhide')} disabled={busy} onClick={() => label('unhide')} />
            )}
            <BarButton icon={<Power size={14} />} label="Enable" count={count('enable')} disabled={busy} onClick={() => setPending('enable')} />
            <BarButton icon={<PowerOff size={14} />} label="Disable" count={count('disable')} disabled={busy} onClick={() => setPending('disable')} />
            <BarButton icon={<FolderInput size={14} />} label="Move to category" count={n} disabled={busy} onClick={() => setPending('categorize')} />
            <BarButton icon={<EyeOff size={14} />} label="Remove from Cronsole" tone="danger" count={count('untrack')} disabled={busy} onClick={() => setPending('untrack')} />
          </div>
        )}
      </div>

      {pending && CONFIRMED.includes(pending) && (
        <MassActionConfirm
          verb={pending}
          scopeLabel={describeSelection(selected)}
          count={eligibleForSelection(selected, pending as BulkVerb).length}
          scopeSize={n}
          categories={categories}
          detachedCount={category => detachedByCategorize(selected, category)}
          onCancel={() => setPending(null)}
          onConfirm={category => {
            const verb = pending as BulkVerb;
            setPending(null);
            run(verb, eligibleForSelection(selected, verb), category);
          }}
        />
      )}

      {report && (
        <Modal
          onClose={() => setReport(null)}
          labelledBy="selection-report-title"
          panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg shadow-2xl"
        >
          <div className="space-y-4 p-6">
            <h3 id="selection-report-title" className="text-lg font-bold">
              {report.updated} done · {report.refused + report.failed + report.skipped} not
            </h3>
            {report.haltedReason && (
              <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-xs text-warning-text">
                Stopped early: {report.haltedReason}
              </p>
            )}
            <ul className="max-h-72 space-y-1 overflow-y-auto pr-1 text-xs">
              {report.items.filter(i => i.outcome !== 'updated').map(i => (
                <li key={i.taskId} className="flex items-start justify-between gap-3">
                  <span className="min-w-0">
                    <span className="font-semibold text-foreground">{i.name}</span>
                    {i.message && <span className="block text-muted-foreground">{i.message}</span>}
                  </span>
                  <span className={`shrink-0 font-bold ${OUTCOME_STYLE[i.outcome].className}`}>
                    {OUTCOME_STYLE[i.outcome].label}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setReport(null)}
                className="rounded-xl bg-primary px-5 py-2 text-sm font-bold text-primary-foreground"
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};
