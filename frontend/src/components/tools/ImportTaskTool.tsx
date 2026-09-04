import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileJson, Loader2, RotateCcw, Undo2, Upload } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { importTaskFile, TaskFileImportError } from '../../utils/importTaskFile';
import { HelpButton } from '../HelpButton';
import { ToolCard } from './ToolCard';

/**
 * Two ways to turn a stored definition back into a running task: a file the user
 * has, and the archive Cronsole kept when it deleted one.
 *
 * They share a card because they are one idea — *rebuild a task from a saved
 * definition* — and because they fail the same way and refuse for the same
 * reason (`parseTaskBundle` decides both). Splitting them would put the same
 * sentence about Windows XML on two cards.
 *
 * Both are **Cronsole-native only**, and that is a property of the format rather
 * than a policy: a native task's row *is* the task, so it round-trips, while a
 * Windows task's definition lives on the machine as Task Scheduler XML — which
 * is the card directly below this one.
 */

interface ArchiveRow {
  id: string;
  name: string;
  platform: string;
  deletedVia: string;
  deletedAt: string;
  executionsArchived: number;
  restorable: { ok: boolean; reason?: string };
}

const relative = (iso: string): string => {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

export const ImportTaskTool = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ total: number; archives: ArchiveRow[] }>({
    queryKey: ['task-archives'],
    queryFn: async () => (await api.get('/tools/task-archives')).data
  });

  /** Both paths create a task, so both invalidate the same things. */
  const afterCreate = () => {
    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    queryClient.invalidateQueries({ queryKey: ['task-archives'] });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      const task = await importTaskFile(file);
      afterCreate();
      // The task is created ACTIVE, so the next fire is the fact worth saying —
      // "imported" alone leaves the user unsure whether anything is scheduled.
      toast(
        task.nextRunTime
          ? `Imported "${task.name}" — first run ${new Date(task.nextRunTime).toLocaleString()}.`
          : `Imported "${task.name}".`,
        'success'
      );
    } catch (err) {
      // Kept on screen as well as toasted: a refusal here is a paragraph naming
      // another screen, and a toast that disappears is the wrong place for it.
      setError(err instanceof TaskFileImportError ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const restore = async (row: ArchiveRow) => {
    setRestoring(row.id);
    setError(null);
    try {
      const res = await api.post(`/tools/task-archives/${encodeURIComponent(row.id)}/restore`);
      const task = (res.data as { task: { name: string } }).task;
      afterCreate();
      // "as a new task" is not pedantry: the old id is gone, the archived runs
      // do not come back, and someone looking for their history needs to know
      // before they go hunting for it.
      toast(`Restored "${task.name}" as a new task.`, 'success');
    } catch (err) {
      const body = (err as { response?: { data?: { error?: unknown } } }).response?.data?.error;
      setError(body ? String(body) : (err as Error).message);
    } finally {
      setRestoring(null);
    }
  };

  const archives = data?.archives ?? [];

  return (
    <ToolCard
      icon={FileJson}
      title="Import a task"
      titleAdornment={<HelpButton topic="task-import" />}
      description={<>
        Recreate a <strong>Cronsole-native</strong> task from a file you exported, or bring back one you
        deleted. Windows tasks are Task Scheduler XML and restore from the card below.
      </>}
    >
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => {
          void onFile(e.target.files?.[0]);
          e.target.value = ''; // allow re-picking the same file
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={importing}
          className="bg-background border border-border hover:border-primary px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
          Choose a task .json
        </button>
        <p className="text-xs text-muted-foreground">
          Creates a new task — importing the same file twice gives you two.
        </p>
      </div>

      {error && (
        <p className="text-xs text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 leading-relaxed">
          {error}
        </p>
      )}

      <div className="border-t border-border pt-3 space-y-2">
        <h4 className="text-[10px] font-black uppercase tracking-wider text-subtle-foreground flex items-center gap-1.5">
          <Undo2 size={11} /> Deleted tasks
        </h4>

        {isLoading ? (
          <p className="text-xs text-muted-foreground flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </p>
        ) : archives.length === 0 ? (
          /* Says what this list is FOR, not just that it is empty — otherwise an
             empty list reads as "nothing was ever deleted", which is a stronger
             claim than Cronsole can make about other platforms. */
          <p className="text-xs text-muted-foreground leading-relaxed">
            Nothing here yet. Cronsole archives a Cronsole-native task's definition before deleting it, so it
            can be rebuilt. Deletions on other platforms are not recoverable from here.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-y-auto custom-scrollbar">
            {archives.map(row => (
              <li
                key={row.id}
                className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold truncate">{row.name}</p>
                  <p className="text-[10px] text-subtle-foreground">
                    deleted {relative(row.deletedAt)} · {row.executionsArchived} run
                    {row.executionsArchived === 1 ? '' : 's'} kept
                    {/* The reason travels with the verdict. A disabled button
                        whose explanation is in a title= cannot be read on the
                        phone this app has to work on. */}
                    {!row.restorable.ok && ' · not restorable'}
                  </p>
                  {!row.restorable.ok && row.restorable.reason && (
                    <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                      {row.restorable.reason}
                    </p>
                  )}
                </div>
                {row.restorable.ok && (
                  <button
                    onClick={() => void restore(row)}
                    disabled={restoring !== null}
                    className="shrink-0 bg-surface border border-border hover:border-primary px-3 py-1.5 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {restoring === row.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <RotateCcw size={12} />}
                    Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </ToolCard>
  );
};
