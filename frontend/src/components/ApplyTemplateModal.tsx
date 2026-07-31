import { useEffect, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, ArrowRight, AlertTriangle, CheckCircle2, FolderTree } from 'lucide-react';
import type { Template } from '../types';
import { api } from '../api';
import { platformLabel, isCreatablePlatform } from '../platform';
import { useToast } from '../hooks/useToast';
import { useSettings } from '../hooks/useSettings';
import { describeCron } from '../utils/schedule';
import { CRON_PRESETS } from '../utils/cronPresets';
import { Modal } from './ui/Modal';

// Substitute {{key}} placeholders — preview only. The apply request sends the
// raw parameter values; the backend owns the real substitution per-token, so a
// value with quotes/spaces is always exactly one argument (templateCommand.ts).
const resolveCommand = (tpl: string, values: Record<string, string>) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in values ? values[k] : `{{${k}}}`));

/** Mirrors DEFAULT_TASK_FOLDER in backend/src/utils/windowsTaskFolder.ts. */
const DEFAULT_FOLDER = '\\Cronsole';

interface AgentFolder {
  path: string;
  taskCount: number;
  writable: boolean;
}

interface ApplyTemplateModalProps {
  template: Template;
  onClose: () => void;
}

export const ApplyTemplateModal = ({ template, onClose }: ApplyTemplateModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = template.parameters ?? [];
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(params.map(p => [p.key, p.default ?? '']))
  );
  // Only platforms Cronsole can actually create a task on are selectable; the
  // rest are compatibility labels (no agent/API yet). Default to the first
  // creatable target so Apply doesn't silently fail on an uncreatable platform.
  const creatableTargets = template.targetPlatforms.filter(isCreatablePlatform);
  const [platform, setPlatform] = useState(creatableTargets[0] ?? '');
  const [name, setName] = useState(template.name);
  const [schedule, setSchedule] = useState(template.scheduleExpression);
  // Windows only: the REAL Task Scheduler folder the task lands in. For a
  // Windows task the "category" is a projection of this folder
  // (TaskService.extractCategory reads the root segment), so choosing a folder
  // IS choosing the category — unlike native tasks, where categories are local.
  // Only EXISTING folders are offered: Cronsole creates just its own \Cronsole
  // (the one folder it also prunes), because removing a folder needs elevation
  // and anything else it created would be litter only the user could clear.
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const isWindows = platform === 'WINDOWS_TASK_SCHEDULER';
  const { settings: prefs } = useSettings();

  // Honest human reading of the cron (null when we can't describe it); local
  // vs UTC follows the Settings timezone mode, like the task detail view.
  const humanSchedule = describeCron(schedule, prefs.timezone);

  const baseCommand = template.commandTemplate ?? template.command ?? '';
  const resolved = resolveCommand(baseCommand, values).trim();
  const missing = params.filter(p => p.required && !values[p.key]?.trim());
  const incomplete = missing.length > 0 || resolved.includes('{{');

  // Debounce the schedule so the preview doesn't fire per keystroke.
  const [debouncedSchedule, setDebouncedSchedule] = useState(schedule);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSchedule(schedule), 400);
    return () => clearTimeout(t);
  }, [schedule]);

  interface SchedulePreview {
    score: number;
    warnings: string[];
  }

  const { data: preview } = useQuery<SchedulePreview | null>({
    queryKey: ['template-preview', template.id, platform, debouncedSchedule],
    queryFn: async () => {
      const res = await api.post(`/templates/${template.id}/preview`, {
        platform,
        schedule: debouncedSchedule
      });
      return res.data;
    },
    enabled: !!platform && !!debouncedSchedule.trim(),
    staleTime: 60_000,
    retry: false
  });

  // The machine's real Task Scheduler folders. Windows only, and only while the
  // modal is open. A failure here is not fatal: the selector falls back to the
  // default folder rather than blocking the apply — the backend and agent both
  // validate the folder anyway, so an out-of-date list can't cause a bad write.
  const { data: foldersData, isLoading: foldersLoading, isError: foldersError } = useQuery<{
    folders: AgentFolder[];
    defaultFolder: string;
  } | null>({
    queryKey: ['task-folders', platform],
    queryFn: async () => {
      const res = await api.get('/tasks/folders', { params: { platform } });
      return res.data;
    },
    enabled: isWindows,
    staleTime: 60_000,
    retry: false
  });

  // Offer only writable folders that ALREADY EXIST — plus the default, which is
  // the one folder Cronsole creates lazily (and prunes again when emptied), so it
  // belongs here even on a fresh machine where it doesn't exist yet.
  // \Microsoft\ is excluded rather than shown-and-disabled: the reason is
  // explained once, below, which is honest without cluttering the list with
  // dozens of unusable system folders.
  const writableFolders = (foldersData?.folders ?? []).filter(f => f.writable);
  const folderOptions = Array.from(
    new Set<string>([DEFAULT_FOLDER, ...writableFolders.map(f => f.path)])
  ).sort((a, b) => (a === DEFAULT_FOLDER ? -1 : b === DEFAULT_FOLDER ? 1 : a.localeCompare(b)));

  const folderReady = !isWindows || !!folder;

  const applyMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/templates/${template.id}/apply`, {
        platform,
        schedule,
        name: name.trim(),
        parameters: values,
        // Windows only — other platforms have no native folder hierarchy and
        // the backend rejects the field for them.
        ...(isWindows ? { folder } : {})
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(
        `Task created on ${platformLabel(platform)} from "${template.name}".`,
        'success'
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Apply failed: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  const canApply =
    !!platform && isCreatablePlatform(platform) && !!name.trim() && !!schedule.trim() && !incomplete && folderReady && !applyMutation.isPending;

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="apply-template-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <p className="text-[10px] text-foreground uppercase font-black tracking-widest mb-1">Apply Template</p>
            <h2 id="apply-template-title" className="text-xl font-bold">{template.name}</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">{template.description}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Target platform</label>
            <div className="flex flex-wrap gap-2">
              {template.targetPlatforms.map(p => {
                const creatable = isCreatablePlatform(p);
                return (
                  <button
                    key={p}
                    onClick={() => creatable && setPlatform(p)}
                    disabled={!creatable}
                    title={creatable ? undefined : 'Cronsole can’t create tasks on this platform yet — no agent or API.'}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      platform === p
                        ? 'bg-primary border-primary text-primary-foreground'
                        : creatable
                          ? 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                          : 'bg-background border-border/50 text-subtle-foreground/60 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {platformLabel(p)}{!creatable && ' *'}
                  </button>
                );
              })}
            </div>
            {creatableTargets.length === 0 && (
              <p className="text-[11px] text-amber-400 bg-amber-500/5 border border-amber-500/30 rounded-xl px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                This is a compatible pattern — Cronsole can’t create tasks on its target platform(s) yet (no agent or API). Copy the command below to set it up manually.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              Task name <span className="text-red-400">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
            <p className="text-[10px] text-subtle-foreground italic">
              Reusing a template? Give each task its own name — a duplicate name is rejected instead of overwriting the existing task{isWindows ? ' in the same folder' : ''}.
            </p>
          </div>

          {isWindows && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FolderTree size={11} /> Task Scheduler folder
              </label>

              {foldersLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-subtle-foreground px-3 py-2.5">
                  <Loader2 size={11} className="animate-spin" /> Reading folders from your machine…
                </div>
              ) : (
                <select
                  aria-label="Task Scheduler folder"
                  value={folder}
                  onChange={e => setFolder(e.target.value)}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                >
                  {folderOptions.map(path => {
                    const meta = writableFolders.find(f => f.path === path);
                    const count = meta ? ` (${meta.taskCount} task${meta.taskCount === 1 ? '' : 's'})` : '';
                    return (
                      <option key={path} value={path}>
                        {path}{path === DEFAULT_FOLDER ? ' — default' : count}
                      </option>
                    );
                  })}
                </select>
              )}

              {foldersError ? (
                <p className="text-[10px] text-amber-400 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                  Couldn’t read your folders (the agent may be offline). You can still create the task in {DEFAULT_FOLDER}.
                </p>
              ) : (
                <p className="text-[10px] text-subtle-foreground italic">
                  Where the task lives in Windows Task Scheduler — this also becomes its category in Cronsole.
                  {' '}<span className="not-italic">Only folders that already exist are listed. Cronsole creates just its own {DEFAULT_FOLDER} (and removes it again when empty) — deleting a folder needs admin rights, so it won’t leave one behind that only you could clear. To use a new folder, create it in Task Scheduler first.</span>
                  {' '}<span className="not-italic">\Microsoft\ isn’t offered: Windows keeps its own tasks there, and a name collision would silently overwrite one.</span>
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · UTC)
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
            />
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.cron}
                  onClick={() => setSchedule(p.cron)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                    schedule === p.cron
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {humanSchedule && (
              <p className="text-[10px] text-subtle-foreground flex items-center gap-1.5">
                <Clock size={10} className="shrink-0" /> Runs {humanSchedule.charAt(0).toLowerCase() + humanSchedule.slice(1)}{prefs.timezone === 'local' ? ' (your local time)' : ''}
              </p>
            )}
            {preview && preview.score >= 1 && (
              <p className="text-[10px] text-green-500 flex items-center gap-1.5">
                <CheckCircle2 size={11} className="shrink-0" /> Schedule converts cleanly to a native trigger.
              </p>
            )}
            {preview && preview.score < 1 && (
              <div className="text-[11px] text-amber-400 bg-amber-500/5 border border-amber-500/30 rounded-xl px-3 py-2 space-y-1">
                {preview.warnings.map((w, i) => (
                  <p key={i} className="flex items-start gap-1.5">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {w}
                  </p>
                ))}
              </div>
            )}
          </div>

          {params.map(p => (
            <div key={p.key} className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
                {p.label}{p.required && <span className="text-red-400 ml-1">*</span>}
              </label>
              {p.type === 'select' ? (
                <select 
                  value={values[p.key] ?? ''} 
                  onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
                >
                  {(p.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input 
                  value={values[p.key] ?? ''} 
                  onChange={e => setValues(v => ({ ...v, [p.key]: e.target.value }))}
                  placeholder={p.type === 'path' ? 'C:\\path\\to\\file' : p.type === 'url' ? 'https://…' : ''}
                  className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors font-mono" 
                />
              )}
              {p.help && <p className="text-[10px] text-subtle-foreground italic">{p.help}</p>}
            </div>
          ))}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Resolved command</label>
            <pre className={`bg-background border rounded-xl px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all ${incomplete ? 'border-amber-500/40 text-amber-300' : 'border-border text-green-300'}`}>
              {resolved || '—'}
            </pre>
            {incomplete && <p className="text-[10px] text-amber-500 italic">Fill the required fields above before applying.</p>}
          </div>
        </div>

        <footer className="p-6 bg-background border-t border-border flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Cancel</button>
          <button 
            onClick={() => applyMutation.mutate()} 
            disabled={!canApply}
            className="flex-[2] bg-primary hover:bg-primary-hover py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            {applyMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Applying…</> : <>Create Task <ArrowRight size={16} /></>}
          </button>
        </footer>
    </Modal>
  );
};
export default ApplyTemplateModal;
