import { useRef, useState } from 'react';
import { AlertTriangle, FileWarning, FolderPlus, History, Loader2, Upload } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { readRestoreSelection, type RestoreUpload } from '../../utils/readRestore';

type RestoreAction = 'create' | 'overwrite' | 'skip' | 'refuse';
type RestoreOutcome = 'created' | 'replaced' | 'exists' | 'refused';

interface RestorePlanItem {
  relativePath: string;
  taskPath: string | null;
  source: 'manifest' | 'uri' | 'filename' | null;
  name: string | null;
  action: RestoreAction;
  reason?: string;
  foldersToCreate: string[];
}

interface RestorePlan {
  items: RestorePlanItem[];
  foldersToCreate: string[];
  counts: { files: number; create: number; overwrite: number; skip: number; refuse: number };
}

interface RestoreResultItem {
  relativePath: string;
  taskPath: string | null;
  name: string | null;
  action: RestoreAction;
  outcome: RestoreOutcome;
  message?: string;
  foldersCreated: string[];
}

interface RestoreSummary {
  files: number;
  created: number;
  replaced: number;
  skipped: number;
  refused: number;
  foldersCreated: string[];
}

interface Selection {
  label: string;
  fileCount: number;
  upload: RestoreUpload;
}

const ACTION_STYLES: Record<RestoreAction, { label: string; className: string }> = {
  create: { label: 'restore', className: 'text-emerald-500' },
  overwrite: { label: 'replace', className: 'text-amber-500' },
  skip: { label: 'skip', className: 'text-muted-foreground' },
  refuse: { label: 'refuse', className: 'text-red-500' }
};

const OUTCOME_STYLES: Record<RestoreOutcome, { label: string; className: string }> = {
  created: { label: 'restored', className: 'text-emerald-500' },
  replaced: { label: 'replaced', className: 'text-amber-500' },
  exists: { label: 'left alone', className: 'text-muted-foreground' },
  refused: { label: 'refused', className: 'text-red-500' }
};

const errorMessage = (err: unknown): string => {
  const e = err as Error & { response?: { data?: { error?: unknown } } };
  const fromBody = e.response?.data?.error;
  return fromBody ? String(fromBody) : e.message;
};

/**
 * Restore Windows Task Scheduler tasks from an export.
 *
 * The whole shape of this component is "show, then do". Picking files runs a
 * **dry run** — the server works out create / replace / skip / refuse for every
 * file from the machine's real tasks and folders, and writes nothing. Only after
 * that plan is on screen is there a button that changes the machine.
 *
 * That ordering is not politeness. `RegisterTaskDefinition` overwrites silently,
 * the agent runs elevated, and the two checkboxes below each widen what a click
 * is allowed to destroy or create — so the moment to learn what a backup
 * contains is before it is applied, not after.
 */
export const RestoreTool = () => {
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  const [selection, setSelection] = useState<Selection | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [createFolders, setCreateFolders] = useState(true);
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [results, setResults] = useState<{ items: RestoreResultItem[]; counts: RestoreSummary } | null>(null);
  const [planning, setPlanning] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runPlan = async (current: Selection, opts: { overwrite: boolean; createFolders: boolean }) => {
    setPlanning(true);
    setError(null);
    setResults(null);
    try {
      const res = await api.post('/tools/restore/tasks', { ...current.upload, ...opts, dryRun: true });
      setPlan((res.data as { plan: RestorePlan }).plan);
    } catch (err: unknown) {
      setPlan(null);
      setError(errorMessage(err));
    } finally {
      setPlanning(false);
    }
  };

  const onFilesChosen = async (fileList: FileList | null, label: string) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setResults(null);
    setPlan(null);
    setError(null);

    try {
      const upload = await readRestoreSelection(files);
      const current: Selection = {
        label: files.length === 1 ? files[0].name : label,
        fileCount: files.length,
        upload
      };
      setSelection(current);
      await runPlan(current, { overwrite, createFolders });
    } catch (err: unknown) {
      setError(`Could not read the files you picked: ${errorMessage(err)}`);
    }
  };

  // Re-planning on every toggle keeps the numbers honest: both checkboxes change
  // what would happen to real tasks, so a stale plan next to a changed checkbox
  // would be a screen that disagrees with the button under it.
  const toggleOption = (key: 'overwrite' | 'createFolders', value: boolean) => {
    const next = { overwrite, createFolders, [key]: value };
    if (key === 'overwrite') setOverwrite(value);
    else setCreateFolders(value);
    if (selection) void runPlan(selection, next);
  };

  const commit = async () => {
    if (!selection || !plan) return;
    setRestoring(true);
    setError(null);
    try {
      const res = await api.post('/tools/restore/tasks', {
        ...selection.upload,
        overwrite,
        createFolders,
        dryRun: false
      });
      const payload = res.data as { results: RestoreResultItem[]; counts: RestoreSummary };
      setResults({ items: payload.results, counts: payload.counts });
      setPlan(null);

      const restored = payload.counts.created + payload.counts.replaced;
      toast(
        restored > 0
          ? `Restored ${restored} task${restored === 1 ? '' : 's'}.`
          : 'Nothing was restored — see the results below.',
        restored > 0 ? 'success' : 'error'
      );
    } catch (err: unknown) {
      setError(errorMessage(err));
      toast(`Restore failed: ${errorMessage(err)}`, 'error');
    } finally {
      setRestoring(false);
    }
  };

  const writes = plan ? plan.counts.create + plan.counts.overwrite : 0;
  const guessedPaths = plan?.items.filter(i => i.source === 'filename').length ?? 0;

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-5 flex flex-col h-full min-h-[26rem]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <History size={20} />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold">Restore tasks from a backup</h3>
          <p className="text-sm text-muted-foreground">
            Register Windows tasks back onto <strong>this machine</strong> from an export. Cronsole shows you
            exactly what it would do before anything is written.
          </p>
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept=".zip,.xml,.json"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => {
          void onFilesChosen(e.target.files, `${e.target.files?.length ?? 0} files`);
          e.target.value = '';
        }}
      />
      <input
        ref={folderInput}
        type="file"
        // Not in React's JSX typings; the attribute is what Chromium/Firefox/Safari read.
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => {
          void onFilesChosen(e.target.files, 'exported folder');
          e.target.value = '';
        }}
      />

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={planning || restoring}
          className="bg-background border border-border hover:border-primary px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <Upload size={16} /> Choose a .zip or files
        </button>
        <button
          onClick={() => folderInput.current?.click()}
          disabled={planning || restoring}
          className="bg-background border border-border hover:border-primary px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 transition-colors disabled:opacity-50"
        >
          <FolderPlus size={16} /> Choose an exported folder
        </button>
      </div>

      {selection && (
        <div className="text-xs text-muted-foreground">
          Reading <span className="font-bold text-foreground">{selection.label}</span>
          {selection.fileCount > 1 && ` · ${selection.fileCount} files`}
        </div>
      )}

      <fieldset className="space-y-3 border-t border-border pt-4">
        <legend className="sr-only">Restore options</legend>

        <label className="flex items-start gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={overwrite}
            onChange={e => toggleOption('overwrite', e.target.checked)}
          />
          <span>
            <span className="font-semibold">Overwrite tasks that already exist</span>
            <span className="block text-xs text-muted-foreground">
              Off by default. A task already on this machine is left exactly as it is, and reported as skipped —
              Windows replaces a same-named task without asking.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-3 text-sm cursor-pointer">
          <input
            type="checkbox"
            className="mt-1 accent-primary"
            checked={createFolders}
            onChange={e => toggleOption('createFolders', e.target.checked)}
          />
          <span>
            <span className="font-semibold">Recreate missing Task Scheduler folders</span>
            <span className="block text-xs text-muted-foreground">
              Cronsole normally creates no folders but its own. Restoring is the exception, because the folder tree is
              part of what you backed up — every folder it creates is listed below.{' '}
              <strong>Removing one afterwards needs an elevated Task Scheduler</strong>, since the agent creates it
              with administrator rights.
            </span>
          </span>
        </label>
      </fieldset>

      {error && (
        <div className="text-sm rounded-xl border border-red-500/40 bg-red-500/10 text-red-500 px-4 py-3">
          {error}
        </div>
      )}

      {planning && (
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Checking what is already on this machine…
        </div>
      )}

      {plan && !planning && (
        <div className="rounded-xl border border-border bg-background/60 p-4 space-y-3">
          <div className="text-sm font-bold">
            {writes > 0
              ? `This will change ${writes} task${writes === 1 ? '' : 's'} on this machine.`
              : 'This would change nothing on this machine.'}
          </div>

          <ul className="text-xs text-muted-foreground space-y-1">
            {plan.counts.create > 0 && <li><span className="text-emerald-500 font-bold">{plan.counts.create}</span> restored as new tasks</li>}
            {plan.counts.overwrite > 0 && <li><span className="text-amber-500 font-bold">{plan.counts.overwrite}</span> would replace an existing task</li>}
            {plan.counts.skip > 0 && <li><span className="font-bold">{plan.counts.skip}</span> already exist and would be left alone</li>}
            {plan.counts.refuse > 0 && <li><span className="text-red-500 font-bold">{plan.counts.refuse}</span> refused — see below</li>}
          </ul>

          {plan.foldersToCreate.length > 0 && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
              <div className="font-bold mb-1 flex items-center gap-1.5">
                <FolderPlus size={12} /> {plan.foldersToCreate.length} folder{plan.foldersToCreate.length === 1 ? '' : 's'} will be created
              </div>
              <div className="text-muted-foreground break-words">{plan.foldersToCreate.join(' · ')}</div>
              <div className="text-muted-foreground mt-1">
                These are created by the elevated agent, so removing one later needs an elevated Task Scheduler.
              </div>
            </div>
          )}

          {guessedPaths > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-500 flex items-start gap-2">
              <FileWarning size={12} className="mt-0.5 shrink-0" />
              <span>
                {guessedPaths} task path{guessedPaths === 1 ? ' was' : 's were'} worked out from the filename — these files
                carried no export manifest and no path inside the XML. Check the destinations below before restoring.
              </span>
            </div>
          )}

          <PlanTable items={plan.items} />

          <div className="flex justify-end pt-1">
            <button
              onClick={commit}
              disabled={restoring || writes === 0}
              className="bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {restoring ? <Loader2 size={16} className="animate-spin" /> : <History size={16} />}
              {restoring ? 'Restoring…' : `Restore ${writes} task${writes === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="rounded-xl border border-border bg-background/60 p-4 space-y-3">
          <div className="text-sm font-bold">
            Restored {results.counts.created + results.counts.replaced} of {results.counts.files} files
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            {results.counts.created > 0 && <li>{results.counts.created} created</li>}
            {results.counts.replaced > 0 && <li>{results.counts.replaced} replaced</li>}
            {results.counts.skipped > 0 && <li>{results.counts.skipped} already existed and were left alone</li>}
            {results.counts.refused > 0 && (
              <li className="text-red-500 flex items-center gap-1.5">
                <AlertTriangle size={12} /> {results.counts.refused} refused
              </li>
            )}
            {results.counts.foldersCreated.length > 0 && (
              <li>Created {results.counts.foldersCreated.length} folder(s): {results.counts.foldersCreated.join(' · ')}</li>
            )}
          </ul>
          <ResultTable items={results.items} />
          <p className="text-xs text-muted-foreground">
            Restored tasks are on the machine now. Import them from the Dashboard to track them in Cronsole.
          </p>
        </div>
      )}
    </div>
  );
};

/** Shared row shell so the plan and the result read as the same table. */
const RowList = ({ rows }: { rows: { key: string; verb: { label: string; className: string }; path: string; note?: string }[] }) => {
  const shown = rows.slice(0, 12);
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-border/60 divide-y divide-border/60">
      {shown.map(row => (
        <div key={row.key} className="px-3 py-2 text-xs">
          <div className="flex items-baseline gap-2">
            <span className={`font-bold uppercase tracking-wide shrink-0 w-16 ${row.verb.className}`}>{row.verb.label}</span>
            <code className="break-all text-foreground">{row.path}</code>
          </div>
          {row.note && <div className="text-muted-foreground mt-0.5 pl-[4.5rem]">{row.note}</div>}
        </div>
      ))}
      {rows.length > shown.length && (
        <div className="px-3 py-2 text-xs text-muted-foreground">…and {rows.length - shown.length} more</div>
      )}
    </div>
  );
};

const PlanTable = ({ items }: { items: RestorePlanItem[] }) => {
  // Refusals first: they are the rows a user needs to read, and burying them
  // under 90 successful lines is how a warning goes unread.
  const order: RestoreAction[] = ['refuse', 'overwrite', 'create', 'skip'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.action) - order.indexOf(b.action));

  return (
    <RowList
      rows={sorted.map(item => ({
        key: item.relativePath,
        verb: ACTION_STYLES[item.action],
        path: item.taskPath ?? item.relativePath,
        note: item.reason ?? (item.source === 'filename' ? 'Destination worked out from the filename.' : undefined)
      }))}
    />
  );
};

const ResultTable = ({ items }: { items: RestoreResultItem[] }) => {
  const order: RestoreOutcome[] = ['refused', 'replaced', 'created', 'exists'];
  const sorted = [...items].sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome));

  return (
    <RowList
      rows={sorted.map(item => ({
        key: item.relativePath,
        verb: OUTCOME_STYLES[item.outcome],
        path: item.taskPath ?? item.relativePath,
        note: item.outcome === 'created' || item.outcome === 'replaced' ? undefined : item.message
      }))}
    />
  );
};
