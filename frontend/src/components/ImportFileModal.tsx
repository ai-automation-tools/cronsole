import { useRef, useState } from 'react';
import { CheckCircle2, FileCode2, Loader2, Upload, XCircle } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal } from './ui/Modal';
import { HelpButton } from './HelpButton';
import {
  classifyTaskFile,
  importTaskFile,
  TaskFileImportError,
  type ImportedTask
} from '../utils/importTaskFile';

/**
 * Import means **a file**. Sync means **a source**.
 *
 * The word used to cover both, and the 2026-08-17 chooser asked which you meant
 * *inside* one button. This splits it a level up, where there is nothing left to
 * ask: adopting tasks that already exist on the machine is something you do to a
 * source, so it lives under Sync, and a file — the only thing here that
 * **creates** a task — is what this modal is for.
 *
 * It takes every file a Cronsole export produces, and routes by what the file
 * is rather than by where the user happened to click:
 *
 * - **A Cronsole task `.json`** is rebuilt here, through `POST /tasks/import`.
 * - **A Windows `.xml` or `.zip`** is staged and opened in **Tools › Restore**.
 *   Putting a Windows task back is a restore, not an import — the definition
 *   lives on the machine, so it needs a dry run, a plan on screen, and the
 *   folder/overwrite decisions that ride inside the agent's signature. That flow
 *   has one definition and this modal does not become a second one
 *   (`utils/restoreHandoff.ts`).
 *
 * The old modal refused a Windows file by name and pointed at another screen.
 * Naming the right screen was the honest half; making the reader carry the file
 * there was the half worth removing.
 */
interface ImportFileModalProps {
  onClose: () => void;
  /** Hand a Windows backup to the Restore tool. The caller owns staging and navigation. */
  onWindowsBackup: (file: File) => void;
}

export const ImportFileModal = ({ onClose, onWindowsBackup }: ImportFileModalProps) => {
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedTask | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setError(null);
    try {
      // Decided before anything is parsed: a Windows backup reaching `JSON.parse`
      // produces "not valid JSON", which is true about the bytes and useless
      // about the situation.
      if ((await classifyTaskFile(file)) === 'windows-backup') {
        onWindowsBackup(file);
        return;
      }
      // The same helper the Tools card and the New Task modal use, so all three
      // entry points accept the same files and report a bad one identically.
      const task = await importTaskFile(file);
      // No sync here: the task exists now, so the list has to re-read itself —
      // it does not have to ask a platform anything.
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setImported(task);
    } catch (err) {
      setError(err instanceof TaskFileImportError ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="import-file-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
    >
      <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
        <div className="min-w-0">
          <h2 id="import-file-title" className="text-xl font-bold">Import a task file</h2>
          <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
            A file an export produced. <strong className="text-foreground font-semibold">This creates a task</strong>,
            which starts running on the schedule in the file.
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <HelpButton topic="task-import" size="md" />
          <button onClick={onClose} aria-label="Close import" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors"><XCircle size={20} /></button>
        </div>
      </header>

      <div className="p-6 space-y-4">
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json,text/xml,.xml,.zip"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={e => {
            void onFile(e.target.files?.[0]);
            e.target.value = ''; // allow re-picking the same file
          }}
        />

        {imported ? (
          /* The result stays on screen instead of becoming a toast that fades:
             the first run time is the fact worth reading, and it is the one a
             disappearing message takes with it. */
          <div className="rounded-2xl border border-success/30 bg-success/10 p-4 space-y-1.5">
            <p className="text-sm font-bold text-success-text flex items-center gap-2">
              <CheckCircle2 size={16} /> Imported &ldquo;{imported.name}&rdquo;
            </p>
            <p className="text-xs text-muted-foreground">
              {imported.nextRunTime
                ? <>It is active and will first run <strong className="text-foreground">{new Date(imported.nextRunTime).toLocaleString()}</strong>.</>
                : 'It is active.'}
            </p>
          </div>
        ) : (
          <button
            onClick={() => fileInput.current?.click()}
            disabled={importing}
            className="w-full bg-background border border-border hover:border-primary px-4 py-3 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
          >
            {importing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Choose a file
          </button>
        )}

        {/* Said before the pick, because the two halves behave differently and
            that difference is not the reader's to discover afterwards. */}
        <div className="rounded-2xl border border-border bg-background/50 p-4 space-y-2.5">
          <p className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">What you can pick</p>
          <p className="text-xs text-muted-foreground leading-relaxed flex gap-2.5">
            <FileCode2 size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <span>
              <strong className="text-foreground font-semibold">A Cronsole task .json</strong> — rebuilt here.
              Importing the same file twice gives you two tasks; nothing is matched up or overwritten.
            </span>
          </p>
          <p className="text-xs text-muted-foreground leading-relaxed flex gap-2.5">
            <FileCode2 size={14} className="mt-0.5 shrink-0 text-muted-foreground" />
            <span>
              <strong className="text-foreground font-semibold">A Windows backup .xml or .zip</strong> — opened in
              Tools › Restore, which shows exactly what it would do to your machine before writing anything.
            </span>
          </p>
        </div>

        {error && (
          /* A refusal here is a sentence naming what to do next, so it is shown
             rather than toasted — and kept until the next attempt. */
          <p className="text-xs text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 leading-relaxed">
            {error}
          </p>
        )}
      </div>

      <footer className="p-6 bg-background border-t border-border flex gap-4">
        {imported ? (
          <>
            <button onClick={() => { setImported(null); setError(null); }} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">
              Import another
            </button>
            <button onClick={onClose} className="flex-[2] bg-primary hover:bg-primary-hover py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 transition-all active:scale-95 text-sm">
              Done
            </button>
          </>
        ) : (
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
        )}
      </footer>
    </Modal>
  );
};

export default ImportFileModal;
