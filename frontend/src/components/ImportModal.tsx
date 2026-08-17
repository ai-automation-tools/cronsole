import { useState, useEffect, useMemo, useRef } from 'react';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  FileJson,
  Loader2,
  MonitorCog,
  Upload,
  XCircle
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Modal } from './ui/Modal';
import { useSettings } from '../hooks/useSettings';
import { platformLabel } from '../platform';
import { HelpButton } from './HelpButton';
import { importTaskFile, TaskFileImportError, type ImportedTask } from '../utils/importTaskFile';

/**
 * "Import" means two unrelated things, and this modal now asks which.
 *
 * They were never variants of one action. **Discovering** adopts tasks that
 * already exist on the machine — Cronsole creates nothing, and the tasks would
 * run tomorrow whether or not you ever pressed the button. **A task file**
 * creates a task that did not exist a moment ago and starts it running. One
 * tracks, the other creates; the only thing they share is the word.
 *
 * That collision was already costing people: the word "Import" appears on the
 * Dashboard for discovery, on the Templates tab for catalog JSON, and on Tools
 * for a task file — three buttons, three formats, and nothing on any of them
 * saying which was which. So the chooser leads with the **consequence** rather
 * than the source: "nothing is created" against "this creates a task" is the
 * distinction a reader can act on, and the file extensions are the footnote.
 */
type ImportMode = 'choose' | 'discover' | 'file';

/**
 * Categories excluded from the "non-system" preset and unticked on a first run.
 * `Microsoft` is the OS's own tasks (257 of 352 on a real machine); tasks at the
 * scheduler root land in `Uncategorized` and are almost never what someone means
 * to import.
 */
const SYSTEM_CATEGORIES = ['Microsoft', 'Uncategorized'];

interface DiscoveredCategory {
  name: string;
  count: number;
  /**
   * Tasks in this category the user removed from Cronsole, which importing it
   * will bring back. Reported so the number arrives BEFORE the action — a row
   * you deliberately removed reappearing with no warning reads as a bug.
   */
  excludedCount?: number;
}

interface DiscoveredPlatform {
  platform: string;
  categories: DiscoveredCategory[];
}

interface ImportModalProps {
  onClose: () => void;
  onImport: (categories: string[]) => void;
}

export const ImportModal = ({ onClose, onImport }: ImportModalProps) => {
  const [mode, setMode] = useState<ImportMode>('choose');

  const { data: discovery, isLoading, error } = useQuery<DiscoveredPlatform[]>({
    // No request/response logging here: `/discover` returns every task name and
    // native path on the machine, and a local-first app's console is read over
    // shoulders and in screenshots.
    queryKey: ['discovery'],
    queryFn: async () => (await api.get('/tasks/discover')).data,
    // Not fetched until this path is chosen. Discovery is an **agent round
    // trip** — it can take its full timeout and it fails outright when the agent
    // is offline — so spending it while the user is still reading two buttons
    // would put an irrelevant error on the screen of someone importing a file,
    // and bother the agent for a path that never touches it.
    enabled: mode === 'discover'
  });

  const { settings, update } = useSettings();
  const [selected, setSelected] = useState<string[]>([]);

  // The file path. It shares this modal rather than opening a second one
  // because the choice is the point — a chooser that hands off to another modal
  // stacks two dialogs to answer one question.
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedTask | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setFileError(null);
    try {
      // The same helper the Tools card and the New Task modal use, so all three
      // entry points accept the same files and report a bad one identically.
      const task = await importTaskFile(file);
      // No `onImport` here: that runs a platform SYNC, which is the other half
      // of this modal and would be a round trip to an agent this path never
      // touched. The task already exists — the list just has to re-read it.
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setImported(task);
    } catch (err) {
      setFileError(err instanceof TaskFileImportError ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const backToChoose = () => {
    setMode('choose');
    setFileError(null);
    setImported(null);
  };

  const allCategories = useMemo(
    () => discovery?.flatMap(p => p.categories.map(c => c.name)) ?? [],
    [discovery]
  );
  const nonSystem = useMemo(
    () => allCategories.filter(c => !SYSTEM_CATEGORIES.includes(c)),
    [allCategories]
  );

  useEffect(() => {
    if (!discovery) return;
    const remembered = settings.lastImportCategories;
    // Intersect with what actually exists now: a remembered category whose
    // folder is gone must not appear ticked, or the count promises tasks that
    // aren't there.
    const restored = remembered?.filter(c => allCategories.includes(c));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelected(remembered === null ? nonSystem : (restored ?? []));
    // `settings.lastImportCategories` is deliberately not a dependency — this
    // seeds the initial selection, and re-running it when the import writes the
    // setting would stamp over what the user had just ticked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discovery, allCategories, nonSystem]);

  const toggle = (cat: string) => {
    setSelected(prev => prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]);
  };

  // The number arrives BEFORE the click. `/discover` already returns every
  // category's count, so this costs nothing but was never shown — and "Sync 12
  // Categories" hides that those twelve are 214 tasks.
  const preview = useMemo(() => {
    const chosen = (discovery ?? [])
      .flatMap(p => p.categories)
      .filter(c => selected.includes(c.name));
    return {
      folders: chosen.length,
      tasks: chosen.reduce((n, c) => n + c.count, 0),
      returning: chosen.reduce((n, c) => n + (c.excludedCount ?? 0), 0)
    };
  }, [discovery, selected]);

  const commit = () => {
    update('lastImportCategories', selected);
    onImport(selected);
  };

  const presets: Array<{ label: string; title: string; apply: () => void; active: boolean }> = [
    {
      label: 'None',
      title: 'Untick everything',
      apply: () => setSelected([]),
      active: selected.length === 0
    },
    {
      label: 'Non-system',
      title: `Everything except ${SYSTEM_CATEGORIES.join(' and ')}`,
      apply: () => setSelected(nonSystem),
      active: selected.length === nonSystem.length && nonSystem.every(c => selected.includes(c))
    },
    {
      label: 'All',
      title: 'Every category, including the OS\'s own tasks',
      apply: () => setSelected(allCategories),
      active: allCategories.length > 0 && selected.length === allCategories.length
    }
  ];

  /* ── The chooser ──────────────────────────────────────────────────────── */

  if (mode === 'choose') return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="import-modal-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
    >
      <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
        <div>
          <h2 id="import-modal-title" className="text-xl font-bold">Import tasks</h2>
          <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
            Two different things share this word. Pick the one you mean.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close import" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
          <XCircle size={20} />
        </button>
      </header>

      <div className="p-6 space-y-3">
        {/*
          Ordered by how often each is wanted, not by how new it is: adopting the
          machine's existing tasks is the first thing anyone does with Cronsole,
          and a file import is the occasional case.
        */}
        <button
          onClick={() => setMode('discover')}
          className="w-full text-left p-4 rounded-2xl border border-border bg-background/50 hover:border-primary/50 hover:bg-primary/5 transition-all group flex gap-3.5 items-start"
        >
          <div className="h-9 w-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <MonitorCog size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold flex items-center gap-1.5">
              Tasks already on this machine
              <ChevronRight size={14} className="text-subtle-foreground group-hover:translate-x-0.5 transition-transform" />
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Pick folders Cronsole can see and start tracking what is in them.{' '}
              <strong className="text-foreground font-semibold">Nothing is created</strong> — these tasks
              exist already and run whether or not Cronsole knows about them.
            </p>
            <p className="text-[10px] text-subtle-foreground mt-1.5">
              Windows Task Scheduler, and any other platform you have connected.
            </p>
          </div>
        </button>

        <button
          onClick={() => setMode('file')}
          className="w-full text-left p-4 rounded-2xl border border-border bg-background/50 hover:border-native/50 hover:bg-native/5 transition-all group flex gap-3.5 items-start"
        >
          <div className="h-9 w-9 rounded-xl bg-native/10 text-native-text flex items-center justify-center shrink-0">
            <FileJson size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold flex items-center gap-1.5">
              A task file (.json)
              <ChevronRight size={14} className="text-subtle-foreground group-hover:translate-x-0.5 transition-transform" />
            </p>
            <p className="text-xs text-muted-foreground leading-relaxed mt-1">
              Rebuild a Cronsole-native task from a file an Export produced — on this machine or
              another one. <strong className="text-foreground font-semibold">This creates a task</strong>,
              which starts running on the schedule in the file.
            </p>
            {/*
              The third format, named here rather than discovered as a refusal.
              A Windows task's .xml is the one people will reach for next, and
              this modal is where they will look for it.
            */}
            <p className="text-[10px] text-subtle-foreground mt-1.5">
              A Windows task's <code className="font-mono">.xml</code> goes to Tools › Restore instead.
            </p>
          </div>
        </button>
      </div>
    </Modal>
  );

  /* ── A task file ──────────────────────────────────────────────────────── */

  if (mode === 'file') return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="import-modal-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
    >
      <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
        <div className="flex items-start gap-2.5 min-w-0">
          {/* Back rather than only Close: the chooser is a decision, and a
              decision you cannot revisit without starting over is a trap. */}
          <button
            onClick={backToChoose}
            aria-label="Back to import options"
            title="Back"
            className="p-1.5 -ml-1.5 mt-0.5 hover:bg-muted rounded-lg text-subtle-foreground transition-colors shrink-0"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0">
            <h2 id="import-modal-title" className="text-xl font-bold">Import a task file</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              Cronsole-native only. Creates a new task — importing the same file twice gives you two.
            </p>
          </div>
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
          accept="application/json,.json"
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
              <CheckCircle2 size={16} /> Imported “{imported.name}”
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
            Choose a task .json
          </button>
        )}

        {fileError && (
          /* A refusal here is a sentence naming another screen, so it is shown
             rather than toasted — and kept until the next attempt. */
          <p className="text-xs text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 leading-relaxed">
            {fileError}
          </p>
        )}
      </div>

      <footer className="p-6 bg-background border-t border-border flex gap-4">
        {imported ? (
          <>
            <button onClick={() => { setImported(null); setFileError(null); }} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">
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

  /* ── Discovery ────────────────────────────────────────────────────────── */

  if (isLoading) return (
     <Modal onClose={onClose} overlayClassName="z-50" closeOnBackdrop={false}>
        <div className="text-center space-y-4">
           <Loader2 className="animate-spin text-foreground mx-auto" size={48} />
           <p className="text-muted-foreground font-medium">Scanning platforms for tasks...</p>
        </div>
     </Modal>
  );

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="import-modal-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col"
    >
        <header className="p-6 border-b border-border flex justify-between items-center bg-surface/50">
          <div className="flex items-center gap-2.5 min-w-0">
            <button
              onClick={backToChoose}
              aria-label="Back to import options"
              title="Back"
              className="p-1.5 -ml-1.5 hover:bg-muted rounded-lg text-subtle-foreground transition-colors shrink-0"
            >
              <ArrowLeft size={16} />
            </button>
            <div className="min-w-0">
              <h2 id="import-modal-title" className="text-xl font-bold">Import &amp; Sync</h2>
              <p className="text-[10px] text-subtle-foreground uppercase font-bold tracking-wider">Select categories to pull into dashboard</p>
            </div>
          </div>
          {/* The two verbs in this modal's own title are the ones people most
              often swap, and swapping them costs a debugging session — Sync
              reports success forever while never discovering the folder. */}
          <div className="flex items-center gap-1 shrink-0">
            <HelpButton topic="import" size="md" />
            <button onClick={onClose} aria-label="Close import" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors"><XCircle size={20} /></button>
          </div>
        </header>
        <div className="p-6 space-y-4">
          {allCategories.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-subtle-foreground">Select</span>
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={p.apply}
                  title={p.title}
                  aria-pressed={p.active}
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
                    p.active
                      ? 'bg-primary/15 border-primary/40 text-foreground'
                      : 'bg-background/50 border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {p.label}
                </button>
              ))}
              {settings.lastImportCategories !== null && (
                <span
                  className="ml-auto text-[10px] text-subtle-foreground italic"
                  title="Your last import's selection, not everything on the machine."
                >
                  from last import
                </span>
              )}
            </div>
          )}
          <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
            {(error || !discovery || discovery.every(p => p.categories.length === 0)) && (
              <div className="text-center py-8 px-4 space-y-2">
                <p className="text-sm font-bold text-foreground">No tasks discovered</p>
                <p className="text-xs text-subtle-foreground">
                  {error
                    ? 'Discovery failed — is the backend running?'
                    : 'No platform returned any tasks. The Windows agent may be offline — check that the CronsoleAgent scheduled task is running, then try again.'}
                </p>
              </div>
            )}
            {/* A platform with nothing to offer gets no heading. Rendering one
                anyway put a bare "CRONSOLE" label above an empty space — and in
                the agent-offline case it landed directly under "No tasks
                discovered", so the modal denied and promised a list at once. A
                section header is a claim that there is a section. */}
            {discovery?.filter(p => p.categories.length > 0).map(platform => (
               // These are the machine's real folders, so they differ per
               // install — the visual-regression suite masks them and pins the
               // modal's chrome instead.
               <div key={platform.platform} data-testid="discovered-categories" className="space-y-2 mb-6 last:mb-0">
                  {/* platformLabel, not the raw enum: `TASKHUB_NATIVE`.replace(/_/g,' ')
                      rendered "TASKHUB NATIVE" here long after the product became Cronsole,
                      and "WINDOWS TASK SCHEDULER" where every other surface says "Windows". */}
                  <h3 className="text-[10px] font-black text-foreground uppercase tracking-widest ml-1">{platformLabel(platform.platform)}</h3>
                  <div className="grid gap-2">
                    {platform.categories.map((cat) => (
                      <label key={cat.name} className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all cursor-pointer group ${selected.includes(cat.name) ? 'bg-primary/5 border-primary/30' : 'bg-background/50 border-border hover:border-foreground/20'}`}>
                        <div className="flex items-center gap-3">
                          <div className={`w-5 h-5 rounded-lg border flex items-center justify-center transition-all ${selected.includes(cat.name) ? 'bg-primary border-primary text-primary-foreground' : 'border-border bg-surface text-transparent group-hover:border-foreground/30'}`}>
                            <Check size={12} strokeWidth={4} />
                          </div>
                          <div>
                            <span className={`text-sm font-bold transition-colors ${selected.includes(cat.name) ? 'text-foreground' : 'text-muted-foreground'}`}>{cat.name}</span>
                            {(cat.name === 'Microsoft' || cat.name === 'Uncategorized') && !selected.includes(cat.name) && (
                               <span className="ml-2 text-[9px] text-subtle-foreground font-medium italic">(Excluded by default)</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {/*
                            Importing a category forgets the untracks inside it,
                            so tasks the user removed on purpose come back. That
                            is correct — importing IS asking for the folder — but
                            it has to be said before the click, not discovered
                            after it.
                          */}
                          {!!cat.excludedCount && (
                            <span
                              className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-warning/10 border-warning/30 text-warning-text"
                              title={`${cat.excludedCount} task${cat.excludedCount === 1 ? '' : 's'} you removed from Cronsole will be tracked again if you import this category.`}
                            >
                              +{cat.excludedCount} removed
                            </span>
                          )}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border transition-colors ${selected.includes(cat.name) ? 'bg-primary/20 border-primary/20 text-foreground' : 'bg-surface border-border text-subtle-foreground'}`}>{cat.count} task{cat.count === 1 ? '' : 's'}</span>
                        </div>
                        <input type="checkbox" className="hidden" checked={selected.includes(cat.name)} onChange={() => toggle(cat.name)} />
                      </label>
                    ))}
                  </div>
               </div>
            ))}
          </div>
        </div>
        <footer className="p-6 bg-background border-t border-border space-y-3">
          {/* Say what the click will do, before it happens. */}
          <p className="text-xs text-center text-muted-foreground" data-testid="import-preview">
            {preview.folders === 0 ? (
              'Nothing selected — pick at least one category to import.'
            ) : (
              <>
                This will import <span className="font-bold text-foreground">{preview.tasks}</span>{' '}
                task{preview.tasks === 1 ? '' : 's'} across{' '}
                <span className="font-bold text-foreground">{preview.folders}</span>{' '}
                folder{preview.folders === 1 ? '' : 's'}.
                {preview.returning > 0 && (
                  <span className="text-warning-text">
                    {' '}Includes <span className="font-bold">{preview.returning}</span> you had removed.
                  </span>
                )}
              </>
            )}
          </p>
          <div className="flex gap-4">
            <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Discard</button>
            <button
              onClick={commit}
              disabled={selected.length === 0}
              className="flex-[2] bg-primary hover:bg-primary-hover py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm"
            >
              Import {preview.tasks} task{preview.tasks === 1 ? '' : 's'}
            </button>
          </div>
        </footer>
    </Modal>
  );
};
export default ImportModal;
