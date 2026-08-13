import { useEffect, useState } from 'react';
import { useQueryClient, useMutation, useQuery } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, ArrowRight, AlertTriangle, CheckCircle2, FolderTree } from 'lucide-react';
import type { Template } from '../types';
import { api } from '../api';
import { platformLabel } from '../platform';
import { usePlatformCreatability } from '../hooks/usePlatformMatrix';
import { useToast } from '../hooks/useToast';
import { useSettings } from '../hooks/useSettings';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { describeCron } from '../utils/schedule';
import { CRON_PRESETS, presetLabel } from '../utils/cronPresets';
import { Modal } from './ui/Modal';
import { ScheduleZoneHint } from './ScheduleZoneHint';

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
  // Only platforms Cronsole can actually create a task on **here** are
  // selectable; the rest are compatibility labels. The verdict comes from the
  // server's capability matrix, not from a set compiled into this bundle — for
  // Claude it depends on whether a Claude Code session is readable on the
  // machine running the backend, which no literal can know.
  const { creatability, isLoading: creatabilityLoading } = usePlatformCreatability();
  const creatableTargets = template.targetPlatforms.filter(p => creatability(p) === 'yes');
  // The selection is **derived** until the user makes one, rather than seeded by
  // an effect: the default depends on an answer that arrives after first render,
  // and syncing that into state is how a modal ends up preselecting a platform
  // it is about to disable. `chosen` is empty until a click; `platform` is what
  // the rest of the modal reads.
  const [chosen, setPlatform] = useState('');
  // While the matrix is in flight, fall back to the template's first declared
  // target so the form is usable immediately. It can only ever be *corrected*
  // downward — Apply itself requires a `yes`, so an optimistic selection never
  // turns into a request the platform would refuse.
  const platform = chosen
    || creatableTargets[0]
    || (creatabilityLoading ? template.targetPlatforms[0] ?? '' : '');
  const [name, setName] = useState(template.name);
  const zone = useScheduleZone();
  // The template's `scheduleExpression` is UTC (registry schedules always are),
  // so it is read into the user's zone for editing and converted back on apply.
  // A template that says "daily at 8" should mean 8 o'clock where the user
  // lives, not 8 UTC — which is 1 AM in Pacific and was the bug.
  const [schedule, setSchedule] = useState(() => zone.toZone(template.scheduleExpression).cron);
  const storedSchedule = zone.toUtc(schedule);
  // Windows only: the REAL Task Scheduler folder the task lands in. For a
  // Windows task the "category" is a projection of this folder
  // (TaskService.extractCategory reads the root segment), so choosing a folder
  // IS choosing the category — unlike native tasks, where categories are local.
  // Only EXISTING folders are offered: Cronsole creates just its own \Cronsole
  // (the one folder it also prunes), because removing a folder needs elevation
  // and anything else it created would be litter only the user could clear.
  const [folder, setFolder] = useState(DEFAULT_FOLDER);
  const isWindows = platform === 'WINDOWS_TASK_SCHEDULER';
  const isClaude = platform === 'CLAUDE_CODE';
  // Claude only: the repositories the routine may check out and work in. Never
  // defaulted and never guessed — a routine with no sources still runs, it
  // simply has no checkout, whereas attaching the wrong repository to an agent
  // that can commit is not a mistake the user can see before it happens.
  const [repositories, setRepositories] = useState('');
  const { settings: prefs } = useSettings();

  // Honest human reading of the cron (null when we can't describe it), rendered
  // in the Settings zone like the task detail view. `describeCron` takes the
  // STORED (UTC) expression and does its own shift, so it is fed the converted
  // form rather than what's in the input.
  const humanSchedule = describeCron(storedSchedule.cron, prefs.timezone);

  const baseCommand = template.commandTemplate ?? template.command ?? '';
  const resolved = resolveCommand(baseCommand, values).trim();
  const missing = params.filter(p => p.required && !values[p.key]?.trim());
  const incomplete = missing.length > 0 || resolved.includes('{{');

  // Debounce the schedule so the preview doesn't fire per keystroke. The backend
  // only ever sees UTC — it converts to a Windows trigger and the agent converts
  // back to local, so sending the zone-local form would double-apply the offset.
  const [debouncedSchedule, setDebouncedSchedule] = useState(storedSchedule.cron);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSchedule(storedSchedule.cron), 400);
    return () => clearTimeout(t);
  }, [storedSchedule.cron]);

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

  // One repository per line; blank lines dropped so a trailing newline is not a
  // repository the routine is told to check out.
  const repoList = repositories.split('\n').map(r => r.trim()).filter(Boolean);

  const applyMutation = useMutation({
    mutationFn: async () => {
      return api.post(`/templates/${template.id}/apply`, {
        platform,
        // Always UTC on the wire — the zone lives in the browser only.
        schedule: storedSchedule.cron,
        name: name.trim(),
        parameters: values,
        // Windows only — other platforms have no native folder hierarchy and
        // the backend rejects the field for them.
        ...(isWindows ? { folder } : {}),
        // Claude only, and omitted entirely when blank rather than sent as [].
        ...(isClaude && repoList.length ? { repositoryUrls: repoList } : {})
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
    !!platform && creatability(platform) === 'yes' && !!name.trim() && !!schedule.trim() && !incomplete && folderReady && !applyMutation.isPending;

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
          <button onClick={onClose} aria-label="Close apply template" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Target platform</label>
            <div className="flex flex-wrap gap-2">
              {template.targetPlatforms.map(p => {
                const can = creatability(p);
                return (
                  <button
                    key={p}
                    // `unknown` stays clickable: the matrix has not answered
                    // yet, and greying a control out is an assertion. Apply is
                    // still gated on a `yes`, so nothing can be submitted
                    // against a platform that turns out to refuse it.
                    onClick={() => can !== 'no' && setPlatform(p)}
                    disabled={can === 'no'}
                    title={
                      can === 'yes' ? undefined
                        : can === 'unknown' ? 'Checking what Cronsole can do on this platform…'
                          : 'Cronsole can’t create tasks on this platform on this install — see the Platforms tab for why.'
                    }
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      platform === p
                        ? 'bg-primary border-primary text-primary-foreground'
                        : can !== 'no'
                          ? 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                          : 'bg-background border-border/50 text-subtle-foreground/60 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    {platformLabel(p)}{can === 'no' && ' *'}
                  </button>
                );
              })}
            </div>
            {/* Absence of an answer is not a refusal: while the matrix is in
                flight the modal says it is checking, rather than telling the
                user their platform is unsupported and being wrong a moment later. */}
            {creatabilityLoading && creatableTargets.length === 0 && (
              <p className="text-[11px] text-subtle-foreground flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin shrink-0" />
                Checking what Cronsole can create on this template’s platforms…
              </p>
            )}
            {!creatabilityLoading && creatableTargets.length === 0 && (
              <p className="text-[11px] text-warning-text bg-warning/5 border border-warning/30 rounded-xl px-3 py-2 flex items-start gap-1.5">
                <AlertTriangle size={11} className="shrink-0 mt-0.5" />
                {template.targetPlatforms.includes('CLAUDE_CODE')
                  ? 'Creating a Claude routine needs a Claude Code session on the machine running Cronsole — sign in with the Claude Code CLI (/login), or create the routine at claude.ai and connect it. Copy the prompt below to set it up manually.'
                  : 'This is a compatible pattern — Cronsole can’t create tasks on its target platform(s) here (no agent or API). Copy the command below to set it up manually.'}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              Task name <span className="text-danger-text">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
            {isWindows && (
              // Windows only, because the guard is Windows only: a created
              // task's name becomes its path, and RegisterTaskDefinition
              // silently overwrites a same-named task in the same folder.
              // Native and Claude ids are minted, so two tasks may share a name.
              <p className="text-[10px] text-subtle-foreground italic">
                Reusing a template? Give each task its own name — a duplicate name is rejected instead of overwriting the existing task in the same folder.
              </p>
            )}
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
                <p className="text-[10px] text-warning-text flex items-start gap-1.5">
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

          {isClaude && (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FolderTree size={11} /> Repositories <span className="normal-case tracking-normal font-semibold text-subtle-foreground">(optional)</span>
              </label>
              <textarea
                aria-label="Repositories"
                value={repositories}
                onChange={e => setRepositories(e.target.value)}
                rows={2}
                placeholder="https://github.com/owner/repo"
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
              />
              <p className="text-[10px] text-subtle-foreground italic">
                One repository URL per line. The routine runs in a cloud environment Anthropic owns —
                <span className="not-italic"> a routine with no repository still runs, it just has no checkout</span>, so a
                prompt that reads or edits code needs the repository attached here. Cronsole never guesses one:
                the routine can commit, and attaching the wrong repo is not a mistake you can see before it happens.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · {zone.label})
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
                  {presetLabel(p, zone.label)}
                </button>
              ))}
            </div>
            {humanSchedule && (
              <p className="text-[10px] text-subtle-foreground flex items-center gap-1.5">
                <Clock size={10} className="shrink-0" /> Runs {humanSchedule.charAt(0).toLowerCase() + humanSchedule.slice(1)}
              </p>
            )}
            <ScheduleZoneHint
              typed={schedule}
              stored={storedSchedule}
              zoneLabel={zone.label}
              driftsWithDst={!isWindows}
            />
            {preview && preview.score >= 1 && (
              <p className="text-[10px] text-success-text flex items-center gap-1.5">
                <CheckCircle2 size={11} className="shrink-0" /> Schedule converts cleanly to a native trigger.
              </p>
            )}
            {preview && preview.score < 1 && (
              <div className="text-[11px] text-warning-text bg-warning/5 border border-warning/30 rounded-xl px-3 py-2 space-y-1">
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
                {p.label}{p.required && <span className="text-danger-text ml-1">*</span>}
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
            {/* A Claude routine's "command" is its prompt — natural language,
                not argv — so calling it a command in that mode reads as though
                something will be executed on the user's machine. */}
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              {isClaude ? 'Resolved prompt' : 'Resolved command'}
            </label>
            <pre className={`bg-background border rounded-xl px-3 py-2.5 text-xs font-mono whitespace-pre-wrap break-all ${incomplete ? 'border-warning/40 text-warning-text' : 'border-border text-success-text'}`}>
              {resolved || '—'}
            </pre>
            {incomplete && <p className="text-[10px] text-warning-text italic">Fill the required fields above before applying.</p>}
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
