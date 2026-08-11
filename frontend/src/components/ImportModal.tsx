import { useState, useEffect, useMemo } from 'react';
import { Loader2, XCircle, Check } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { Modal } from './ui/Modal';
import { useSettings } from '../hooks/useSettings';
import { platformLabel } from '../platform';

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
  const { data: discovery, isLoading, error } = useQuery<DiscoveredPlatform[]>({
    // No request/response logging here: `/discover` returns every task name and
    // native path on the machine, and a local-first app's console is read over
    // shoulders and in screenshots.
    queryKey: ['discovery'],
    queryFn: async () => (await api.get('/tasks/discover')).data
  });

  const { settings, update } = useSettings();
  const [selected, setSelected] = useState<string[]>([]);

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
          <div>
            <h2 id="import-modal-title" className="text-xl font-bold">Import & Sync</h2>
            <p className="text-[10px] text-subtle-foreground uppercase font-bold tracking-wider">Select categories to pull into dashboard</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors"><XCircle size={20} /></button>
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
               <div key={platform.platform} className="space-y-2 mb-6 last:mb-0">
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
                              className="text-[10px] font-bold px-2 py-0.5 rounded-lg border bg-amber-500/10 border-amber-500/30 text-amber-400"
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
                  <span className="text-amber-400">
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
