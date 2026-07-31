import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, FolderDown, Loader2, ShieldAlert } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import {
  downloadBlob,
  filenameFromDisposition,
  pickDirectory,
  supportsDirectoryPicker,
  writeFilesToDirectory,
  type ExportFilePayload
} from '../../utils/saveExport';

interface PlatformFolder {
  path: string;
  taskCount: number;
  writable: boolean;
}

interface ExportCounts {
  enumerated: number;
  selected: number;
  exported: number;
  failed: number;
  skippedSystem: number;
}

interface ExportFailure {
  externalId: string;
  name: string;
  message: string;
}

interface ExportResult {
  counts: ExportCounts;
  failures: ExportFailure[];
  destination: string;
}

/** First folder segment is `Microsoft` — i.e. Windows' own tasks. */
const isSystemFolder = (path: string) => {
  const first = path.split('\\').filter(Boolean)[0];
  return (first ?? '').toLowerCase() === 'microsoft';
};

const isWithin = (folder: string, parent: string) => {
  const a = folder.toLowerCase();
  const b = parent.toLowerCase();
  return b === '\\' || a === b || a.startsWith(b + '\\');
};

/**
 * Bulk export of Windows Task Scheduler tasks.
 *
 * Exports what is on the **machine**, not only what Cronsole has imported — the
 * tasks most at risk of being lost are the ones nothing else is tracking. The UI
 * says so out loud, because an "Export all" that quietly means "all the ones we
 * happen to know about" is the same invisible fence that made un-imported tasks
 * impossible to notice in the first place.
 */
export const BulkExportTool = () => {
  const { toast } = useToast();
  const [scope, setScope] = useState<'all' | 'folder'>('all');
  const [folder, setFolder] = useState('');
  const [includeSubfolders, setIncludeSubfolders] = useState(true);
  const [includeSystem, setIncludeSystem] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ written: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);

  // A browser capability — it cannot change while the component is mounted.
  const canPickDirectory = supportsDirectoryPicker();

  const { data, isLoading, error } = useQuery<{ folders: PlatformFolder[]; defaultFolder: string }>({
    queryKey: ['task-folders'],
    queryFn: async () => (await api.get('/tasks/folders')).data
  });

  const folders = useMemo(() => data?.folders ?? [], [data]);
  const selectableFolders = folders.filter(f => includeSystem || !isSystemFolder(f.path));

  // A pre-flight count from the folder listing, which already carries per-folder
  // task counts — no extra agent round-trip to tell the user what they're about
  // to do.
  const estimate = useMemo(() => {
    const relevant = folders.filter(f => includeSystem || !isSystemFolder(f.path));
    if (scope === 'all') return relevant.reduce((sum, f) => sum + f.taskCount, 0);
    if (!folder) return 0;
    return relevant
      .filter(f => (includeSubfolders ? isWithin(f.path, folder) : f.path.toLowerCase() === folder.toLowerCase()))
      .reduce((sum, f) => sum + f.taskCount, 0);
  }, [folders, scope, folder, includeSubfolders, includeSystem]);

  const systemTaskCount = useMemo(
    () => folders.filter(f => isSystemFolder(f.path)).reduce((sum, f) => sum + f.taskCount, 0),
    [folders]
  );

  const runExport = async () => {
    if (scope === 'folder' && !folder) {
      toast('Pick a folder to export.', 'error');
      return;
    }

    const body = {
      scope,
      folder: scope === 'folder' ? folder : undefined,
      includeSubfolders,
      includeSystem
    };

    // The picker opens BEFORE the request: it needs transient user activation,
    // and awaiting the export first can consume it. Cancelling then costs
    // nothing rather than throwing away a finished export.
    let directory = null;
    if (canPickDirectory) {
      try {
        directory = await pickDirectory();
      } catch {
        toast('Could not open the folder picker.', 'error');
        return;
      }
      if (!directory) return; // user cancelled
    }

    setBusy(true);
    setResult(null);
    setProgress(null);

    try {
      if (directory) {
        const res = await api.post('/tools/export/tasks', { ...body, format: 'files' });
        const payload = res.data as { counts: ExportCounts; failures: ExportFailure[]; files: ExportFilePayload[] };
        setProgress({ written: 0, total: payload.files.length });
        await writeFilesToDirectory(directory, payload.files, (written, total) => setProgress({ written, total }));
        setResult({ counts: payload.counts, failures: payload.failures, destination: directory.name });
        toast(`Exported ${payload.counts.exported} task${payload.counts.exported === 1 ? '' : 's'} to "${directory.name}".`, 'success');
      } else {
        const res = await api.post('/tools/export/tasks', { ...body, format: 'zip' }, { responseType: 'blob' });
        const filename = filenameFromDisposition(res.headers['content-disposition'] as string | undefined, 'cronsole-tasks.zip');
        downloadBlob(res.data as Blob, filename);
        // A binary response has no JSON body to carry the counts, so the server
        // puts them in a header — otherwise "3 of 95 failed" would vanish.
        const counts = JSON.parse((res.headers['x-cronsole-export-counts'] as string) || 'null') as ExportCounts | null;
        if (counts) setResult({ counts, failures: [], destination: filename });
        toast(`Exported ${counts?.exported ?? 0} tasks to ${filename}.`, 'success');
      }
    } catch (err: unknown) {
      const e = err as Error & { response?: { data?: unknown } };
      let message = e.message;
      // With responseType 'blob' the error body is a Blob — read it back so the
      // server's real message ("The Windows agent is offline…") survives.
      const data = e.response?.data;
      if (data instanceof Blob) {
        try {
          message = JSON.parse(await data.text())?.error ?? message;
        } catch { /* keep the original */ }
      } else if (data && typeof data === 'object' && 'error' in data) {
        message = String((data as { error: unknown }).error);
      }
      toast(`Export failed: ${message}`, 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="bg-surface border border-border rounded-2xl p-6 space-y-5 flex flex-col h-full min-h-[26rem]">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <FolderDown size={20} />
        </div>
        <div className="min-w-0">
          <h3 className="font-bold">Back up scheduled tasks</h3>
          <p className="text-sm text-muted-foreground">
            Save Windows Task Scheduler tasks as native XML. Exports what is on <strong>this machine</strong> —
            including tasks you never imported into Cronsole.
          </p>
        </div>
      </div>

      {error && (
        <div className="text-sm rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500 px-4 py-3">
          Couldn't read this machine's folders — the Windows agent may be offline. Export needs the agent.
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="text-[10px] font-bold uppercase tracking-widest text-subtle-foreground mb-2">What to export</legend>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="export-scope"
            className="mt-1 accent-primary"
            checked={scope === 'all'}
            onChange={() => setScope('all')}
          />
          <span className="text-sm">
            <span className="font-semibold">Every folder on this machine</span>
            <span className="block text-xs text-muted-foreground">A full backup of your scheduled tasks.</span>
          </span>
        </label>

        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="export-scope"
            className="mt-1 accent-primary"
            checked={scope === 'folder'}
            onChange={() => setScope('folder')}
          />
          <span className="text-sm">
            <span className="font-semibold">One folder</span>
            <span className="block text-xs text-muted-foreground">Pick a Task Scheduler folder below.</span>
          </span>
        </label>
      </fieldset>

      {scope === 'folder' && (
        <div className="space-y-3 pl-7">
          <select
            value={folder}
            onChange={e => setFolder(e.target.value)}
            disabled={isLoading}
            aria-label="Folder to export"
            className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary disabled:opacity-50"
          >
            <option value="">{isLoading ? 'Loading folders…' : 'Choose a folder…'}</option>
            {selectableFolders.map(f => (
              <option key={f.path} value={f.path}>
                {f.path === '\\' ? '\\  (root)' : f.path} — {f.taskCount} task{f.taskCount === 1 ? '' : 's'}
              </option>
            ))}
          </select>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="accent-primary"
              checked={includeSubfolders}
              onChange={e => setIncludeSubfolders(e.target.checked)}
            />
            Include subfolders
          </label>
        </div>
      )}

      <label className="flex items-start gap-3 text-sm cursor-pointer border-t border-border pt-4">
        <input
          type="checkbox"
          className="mt-1 accent-primary"
          checked={includeSystem}
          onChange={e => setIncludeSystem(e.target.checked)}
        />
        <span>
          <span className="font-semibold">Include Windows' own tasks</span>
          <span className="block text-xs text-muted-foreground">
            {systemTaskCount > 0
              ? `${systemTaskCount} tasks under \\Microsoft\\ are excluded by default — they belong to Windows and would bury your own.`
              : 'Tasks under \\Microsoft\\ belong to Windows and are excluded by default.'}
          </span>
        </span>
      </label>

      <div className="rounded-xl bg-background/60 border border-border/60 px-4 py-3 text-xs text-muted-foreground flex items-start gap-2">
        <ShieldAlert size={14} className="mt-0.5 shrink-0 text-amber-500" />
        <span>
          Exported XML contains each task's full command line and arguments, and the account it runs as.
          If any of your tasks pass secrets on the command line, they will be in these files — save them somewhere you'd keep a password.
        </span>
      </div>

      <div className="flex items-center justify-between gap-4 flex-wrap mt-auto">
        <div className="text-xs text-muted-foreground">
          {isLoading ? 'Counting tasks…' : (
            <>
              About <span className="font-bold text-foreground">{estimate}</span> task{estimate === 1 ? '' : 's'}
              {' · '}
              {canPickDirectory ? "you'll choose a destination folder" : 'downloads as a .zip'}
            </>
          )}
        </div>
        <button
          onClick={runExport}
          disabled={busy || (scope === 'folder' && !folder)}
          className="bg-primary hover:bg-primary-hover text-primary-foreground px-5 py-2.5 rounded-xl text-sm font-bold flex items-center gap-2 shadow-lg shadow-primary/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
          {busy ? 'Exporting…' : 'Export tasks'}
        </button>
      </div>

      {progress && (
        <div className="text-xs text-muted-foreground">
          Writing {progress.written} of {progress.total} files…
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-border bg-background/60 p-4 space-y-2 text-sm">
          <div className="font-bold">
            Exported {result.counts.exported} of {result.counts.selected} tasks to {result.destination}
          </div>
          <ul className="text-xs text-muted-foreground space-y-1">
            <li>{result.counts.enumerated} tasks found on this machine</li>
            {result.counts.skippedSystem > 0 && (
              <li>{result.counts.skippedSystem} Windows system tasks skipped</li>
            )}
            <li>A <code>_cronsole-export.json</code> manifest lists exactly what was saved.</li>
          </ul>

          {result.counts.failed > 0 && (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-500 mb-1">
                <AlertTriangle size={12} /> {result.counts.failed} task{result.counts.failed === 1 ? '' : 's'} could not be exported
              </div>
              <ul className="text-[11px] text-muted-foreground space-y-0.5">
                {result.failures.slice(0, 5).map(f => (
                  <li key={f.externalId}><code>{f.externalId}</code> — {f.message}</li>
                ))}
                {result.failures.length > 5 && <li>…and {result.failures.length - 5} more (see the manifest).</li>}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
