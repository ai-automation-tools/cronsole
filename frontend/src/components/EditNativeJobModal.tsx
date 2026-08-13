import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Terminal, Loader2, FolderOpen, Globe, Server } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { errorMessage } from '../utils/errorMessage';
import { Modal } from './ui/Modal';

/**
 * Edit what a **Cronsole-native** task does.
 *
 * The counterpart to `EditActionModal`, and deliberately a separate component
 * rather than a mode of it, because the two edits differ in the thing that
 * matters most about a form: what it costs to be wrong. Editing a Windows action
 * asks an elevated agent to rewrite a task on the machine, can fail at the
 * platform, and needs the agent online. Here the DB row **is** the task — the
 * save is the change, it cannot be refused by a platform, and it works with the
 * agent offline.
 *
 * **The whole job is sent, never a patch.** The two job types share no fields,
 * so a merge would leave a stored `url` sitting behind an EXEC job as something
 * the executor never reads and a reader cannot explain. Switching type here is a
 * deliberate act with a warning attached, not a side effect of clearing a field.
 */

type JobType = 'HTTP' | 'EXEC';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

export interface NativeJobInitial {
  jobType: JobType;
  /** HTTP */
  url: string;
  method: string;
  headers: string;
  body: string;
  /** EXEC — one command line; the backend tokenizes it, no shell. */
  command: string;
  workingDirectory: string;
}

interface Props {
  task: Task;
  initial: NativeJobInitial;
  /** Where a native task actually executes, for the EXEC warning. */
  executionHost?: string;
  onClose: () => void;
}

/** Parse the headers textarea. Returns null (not {}) when it cannot be read. */
function parseHeaders(text: string): Record<string, string> | null {
  const trimmed = text.trim();
  if (!trimmed) return {};
  // JSON first, since that is what the API stores and what an export round-trips.
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v)]));
      }
      return null;
    } catch {
      return null;
    }
  }
  // Otherwise `Name: value` per line, which is how anyone who has used curl
  // expects to type a header — and pasting one from docs should not need
  // reformatting into JSON first.
  const out: Record<string, string> = {};
  for (const line of trimmed.split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(':');
    if (at <= 0) return null;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return out;
}

export const EditNativeJobModal = ({ task, initial, executionHost, onClose }: Props) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [jobType, setJobType] = useState<JobType>(initial.jobType);
  const [url, setUrl] = useState(initial.url);
  const [method, setMethod] = useState(initial.method || 'GET');
  const [headers, setHeaders] = useState(initial.headers);
  const [body, setBody] = useState(initial.body);
  const [command, setCommand] = useState(initial.command);
  const [workingDirectory, setWorkingDirectory] = useState(initial.workingDirectory);
  const [headerError, setHeaderError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (jobType === 'HTTP') {
        const parsed = parseHeaders(headers);
        if (!parsed) throw new Error('Headers must be JSON, or one "Name: value" per line.');
        return api.patch(`/tasks/${task.id}/job`, {
          job: {
            jobType: 'HTTP',
            url: url.trim(),
            method,
            ...(Object.keys(parsed).length ? { headers: parsed } : {}),
            ...(body.trim() ? { body } : {})
          }
        });
      }
      return api.patch(`/tasks/${task.id}/job`, {
        job: {
          jobType: 'EXEC',
          // Sent as a command line on purpose: the backend tokenizes it with the
          // same `toStructuredAction` the create and Windows paths use, so there
          // is one definition of "how a command line becomes argv" and the
          // browser never holds a copy that can drift from it.
          command: command.trim(),
          ...(workingDirectory.trim() ? { workingDirectory: workingDirectory.trim() } : {})
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(`Updated what "${task.name}" runs.`, 'success');
      onClose();
    },
    onError: (error: unknown) => {
      toast(`Update failed: ${errorMessage(error, 'Could not save that job.')}`, 'error');
    }
  });

  const typeChanged = jobType !== initial.jobType;
  const canSave = !mutation.isPending && (
    jobType === 'HTTP' ? !!url.trim() : !!command.trim()
  );

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-[60]"
      closeOnBackdrop={false}
      labelledBy="edit-job-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
      <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
        <div>
          <p className="text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1.5 text-foreground">
            <Server size={11} /> Cronsole-native
          </p>
          <h2 id="edit-job-title" className="text-xl font-bold">Edit Job</h2>
          <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
            Changes what <span className="font-semibold text-foreground">{task.name}</span> runs. Its schedule is
            preserved. No agent involved — this task is run by the Cronsole backend itself, so the change
            applies immediately.
          </p>
        </div>
        <button onClick={onClose} aria-label="Close edit job" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
          <XCircle size={20} />
        </button>
      </header>

      <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
        <div className="space-y-2">
          <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Job type</span>
          <div className="flex gap-2">
            {([
              { value: 'HTTP' as const, label: 'Call a URL', icon: Globe },
              { value: 'EXEC' as const, label: 'Run a program', icon: Terminal }
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => setJobType(opt.value)}
                className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 ${
                  jobType === opt.value
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                }`}
              >
                <opt.icon size={12} /> {opt.label}
              </button>
            ))}
          </div>
          {/*
            Changing type replaces the job outright rather than merging, so the
            old side's fields are discarded. Said before the click — a warning
            that arrives with the result arrives too late to change the decision.
          */}
          {typeChanged && (
            <p className="text-[11px] text-warning-text">
              This replaces the whole job — the {initial.jobType === 'HTTP' ? 'URL, method, headers and body' : 'command and working directory'} currently
              saved will be discarded. The task keeps its name, schedule and history.
            </p>
          )}
        </div>

        {jobType === 'HTTP' ? (
          <>
            <div className="space-y-2">
              <label htmlFor="job-url" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Globe size={11} /> URL <span className="text-danger-text">*</span>
              </label>
              <input
                id="job-url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                spellCheck={false}
                placeholder="https://example.com/ping"
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="job-method" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Method</label>
              <select
                id="job-method"
                value={method}
                onChange={e => setMethod(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
              >
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="job-headers" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Headers</label>
              <textarea
                id="job-headers"
                value={headers}
                onChange={e => { setHeaders(e.target.value); setHeaderError(null); }}
                onBlur={() => setHeaderError(parseHeaders(headers) ? null : 'Use JSON, or one "Name: value" per line.')}
                rows={3}
                spellCheck={false}
                placeholder={'Authorization: Bearer …\nContent-Type: application/json'}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y"
              />
              {headerError
                ? <p className="text-[11px] text-danger-text">{headerError}</p>
                : <p className="text-[11px] text-subtle-foreground">JSON, or one <span className="font-mono">Name: value</span> per line.</p>}
            </div>

            <div className="space-y-2">
              <label htmlFor="job-body" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Body</label>
              <textarea
                id="job-body"
                value={body}
                onChange={e => setBody(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder="(optional)"
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y"
              />
            </div>
          </>
        ) : (
          <>
            <div className="space-y-2">
              <label htmlFor="job-command" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Terminal size={11} /> Command <span className="text-danger-text">*</span>
              </label>
              <textarea
                id="job-command"
                value={command}
                onChange={e => setCommand(e.target.value)}
                rows={3}
                spellCheck={false}
                placeholder={'node "C:\\jobs\\digest.js"'}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y"
              />
              <p className="text-[11px] text-subtle-foreground">
                Runs directly (no shell). Quote arguments with spaces. For pipes or <span className="font-mono">&amp;&amp;</span>, name a
                shell explicitly — <span className="font-mono">cmd.exe /c "…"</span>.
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="job-cwd" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FolderOpen size={11} /> Working directory
              </label>
              <input
                id="job-cwd"
                value={workingDirectory}
                onChange={e => setWorkingDirectory(e.target.value)}
                placeholder="(optional)"
                spellCheck={false}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
              />
            </div>

            {/*
              Where this runs is not cosmetic. A native job executes wherever the
              BACKEND runs — inside the container on a Dockerized stack, against a
              filesystem that is not the user's — so the same path fails as
              "executable not found" for a file they can see in Explorer.
            */}
            {executionHost && (
              <p className="text-[11px] text-warning-text">
                Runs on <span className="font-semibold">{executionHost}</span>. Paths are resolved there, not on the
                machine you are browsing from.
              </p>
            )}
          </>
        )}
      </div>

      <footer className="p-6 bg-background border-t border-border flex gap-4">
        <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Cancel</button>
        <button
          onClick={() => mutation.mutate()}
          disabled={!canSave}
          className="flex-[2] py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover"
        >
          {mutation.isPending
            ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
            : <><Server size={16} /> Save Job</>}
        </button>
      </footer>
    </Modal>
  );
};
