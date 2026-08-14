import { Terminal, FolderOpen, FileText, ShieldCheck } from 'lucide-react';
import type { RunLevel, WindowsActionValues } from '../../utils/taskEditing';

interface Props {
  value: WindowsActionValues;
  onChange: (next: WindowsActionValues) => void;
  disabled?: boolean;
}

/**
 * What a **Windows Task Scheduler** task runs, plus the two settings the
 * `/actions` route accepts.
 *
 * Saving this asks an elevated agent to rewrite a task on the machine: it can
 * fail at the platform, and it needs the agent online. That is why the parent
 * reports this section's outcome separately from the label writes beside it —
 * those cannot fail in the same way and must not be reported as though they could.
 */
export const WindowsActionFields = ({ value, onChange, disabled }: Props) => {
  const set = <K extends keyof WindowsActionValues>(key: K, next: WindowsActionValues[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="edit-win-command" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
          <Terminal size={11} /> Command <span className="text-danger-text">*</span>
        </label>
        <textarea
          id="edit-win-command"
          value={value.command}
          disabled={disabled}
          onChange={e => set('command', e.target.value)}
          rows={3}
          spellCheck={false}
          className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y disabled:opacity-50"
        />
        <p className="text-[11px] text-subtle-foreground">
          Runs directly (no <span className="font-mono">cmd.exe</span> shell). Quote arguments with spaces — <span className="font-mono">"C:\Program Files\..."</span> stays one argument.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-win-cwd" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
          <FolderOpen size={11} /> Working directory
        </label>
        <input
          id="edit-win-cwd"
          value={value.workingDirectory}
          disabled={disabled}
          onChange={e => set('workingDirectory', e.target.value)}
          placeholder="(optional)"
          spellCheck={false}
          className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <label htmlFor="edit-win-description" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
          <FileText size={11} /> Description
        </label>
        <input
          id="edit-win-description"
          value={value.description}
          disabled={disabled}
          onChange={e => set('description', e.target.value)}
          placeholder="(optional)"
          className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
        />
      </div>

      <div className="space-y-2">
        <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ShieldCheck size={11} /> Run level
        </span>
        <div className="flex gap-2">
          {([
            { value: 'least' as const, label: 'Standard' },
            { value: 'highest' as const, label: 'Highest privileges' }
          ]).map(opt => (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => set('runLevel', opt.value as RunLevel)}
              className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all disabled:opacity-50 ${
                value.runLevel === opt.value
                  ? 'bg-primary border-primary text-primary-foreground'
                  : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {value.runLevel === 'highest' && (
          <p className="text-[11px] text-warning-text">
            Saving may require the agent to run elevated; Windows can refuse the change if the task is admin-owned.
          </p>
        )}
      </div>
    </div>
  );
};
