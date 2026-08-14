import { useState } from 'react';
import { Terminal, FolderOpen, Globe } from 'lucide-react';
import { parseHeaders, type JobType, type NativeJobValues } from '../../utils/taskEditing';
import { HelpButton } from '../HelpButton';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

interface Props {
  value: NativeJobValues;
  onChange: (next: NativeJobValues) => void;
  /** The type the task is stored with, so a switch away from it can be warned about. */
  storedJobType: JobType;
  /** Where a native task actually executes, for the EXEC warning. */
  executionHost?: string;
  disabled?: boolean;
}

/**
 * What a **Cronsole-native** task does — the one edit with no platform round
 * trip, which is what makes it feel safe and is exactly why its risks are quiet.
 *
 * **The whole job is sent, never a patch.** The two job types share no fields, so
 * a merge would leave a stored `url` sitting behind an EXEC job as something the
 * executor never reads and a reader cannot explain. Switching type is therefore a
 * deliberate act with a warning attached, not a side effect of clearing a field —
 * and the warning arrives *before* the click, since one that arrives with the
 * result arrives too late to change the decision.
 */
export const NativeJobFields = ({ value, onChange, storedJobType, executionHost, disabled }: Props) => {
  const [headerError, setHeaderError] = useState<string | null>(null);

  const set = <K extends keyof NativeJobValues>(key: K, next: NativeJobValues[K]) =>
    onChange({ ...value, [key]: next });

  const typeChanged = value.jobType !== storedJobType;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider inline-flex items-center gap-1">
          Job type<HelpButton topic="native-job-type" />
        </span>
        <div className="flex gap-2">
          {([
            { value: 'HTTP' as const, label: 'Call a URL', icon: Globe },
            { value: 'EXEC' as const, label: 'Run a program', icon: Terminal }
          ]).map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => set('jobType', opt.value)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                value.jobType === opt.value
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
              }`}
            >
              <opt.icon size={12} /> {opt.label}
            </button>
          ))}
        </div>
        {typeChanged && (
          <p className="text-[11px] text-warning-text">
            This replaces the whole job — the {storedJobType === 'HTTP' ? 'URL, method, headers and body' : 'command and working directory'} currently
            saved will be discarded. The task keeps its name, schedule and history.
          </p>
        )}
      </div>

      {value.jobType === 'HTTP' ? (
        <>
          <div className="space-y-2">
            <label htmlFor="job-url" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Globe size={11} /> URL <span className="text-danger-text">*</span>
            </label>
            <input
              id="job-url"
              value={value.url}
              disabled={disabled}
              onChange={e => set('url', e.target.value)}
              spellCheck={false}
              placeholder="https://example.com/ping"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="job-method" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Method</label>
            <select
              id="job-method"
              value={value.method}
              disabled={disabled}
              onChange={e => set('method', e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
            >
              {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="job-headers" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Headers</label>
            <textarea
              id="job-headers"
              value={value.headers}
              disabled={disabled}
              onChange={e => { set('headers', e.target.value); setHeaderError(null); }}
              onBlur={() => setHeaderError(parseHeaders(value.headers) ? null : 'Use JSON, or one "Name: value" per line.')}
              rows={3}
              spellCheck={false}
              placeholder={'Authorization: Bearer …\nContent-Type: application/json'}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
            />
            {headerError
              ? <p className="text-[11px] text-danger-text">{headerError}</p>
              : <p className="text-[11px] text-subtle-foreground">JSON, or one <span className="font-mono">Name: value</span> per line.</p>}
          </div>

          <div className="space-y-2">
            <label htmlFor="job-body" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Body</label>
            <textarea
              id="job-body"
              value={value.body}
              disabled={disabled}
              onChange={e => set('body', e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="(optional)"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
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
              value={value.command}
              disabled={disabled}
              onChange={e => set('command', e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder={'node "C:\\jobs\\digest.js"'}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
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
              value={value.workingDirectory}
              disabled={disabled}
              onChange={e => set('workingDirectory', e.target.value)}
              placeholder="(optional)"
              spellCheck={false}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
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
  );
};
