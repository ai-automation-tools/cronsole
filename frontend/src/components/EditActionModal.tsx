import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Terminal, Loader2, FolderOpen, FileText, ShieldCheck } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { Modal } from './ui/Modal';

type RunLevel = 'least' | 'highest';

interface EditActionModalProps {
  task: Task;
  /** Prefilled from the task's single reported exec action + settings. */
  initial: {
    command: string;
    workingDirectory: string;
    description: string;
    runLevel: RunLevel;
  };
  onClose: () => void;
}

/**
 * Edit the action (executable + args + working dir) and selected settings
 * (description, run level) of an existing Windows Task Scheduler task. Sends the
 * command string + fields to PATCH /tasks/:id/actions — the backend structures
 * the command into a no-shell { executable, args[] } action (same model as
 * create) and the agent replaces the task's exec action, preserving its
 * trigger, principal identity, and other settings. Requires the agent online.
 */
export const EditActionModal = ({ task, initial, onClose }: EditActionModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [command, setCommand] = useState(initial.command);
  const [workingDirectory, setWorkingDirectory] = useState(initial.workingDirectory);
  const [description, setDescription] = useState(initial.description);
  const [runLevel, setRunLevel] = useState<RunLevel>(initial.runLevel);

  const mutation = useMutation({
    mutationFn: async () =>
      api.patch(`/tasks/${task.id}/actions`, {
        command: command.trim(),
        workingDirectory: workingDirectory.trim(),
        description: description.trim(),
        runLevel
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(`Updated "${task.name}".`, 'success');
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const message = err.response?.data?.error || err.message;
      toast(
        message === 'Agent offline'
          ? 'Update failed: the Windows agent is not connected. Check that the CronsoleAgent scheduled task is running.'
          : `Update failed: ${message}`,
        'error'
      );
    }
  });

  const changed =
    command.trim() !== initial.command.trim() ||
    workingDirectory.trim() !== initial.workingDirectory.trim() ||
    description.trim() !== initial.description.trim() ||
    runLevel !== initial.runLevel;
  const canSave = !!command.trim() && changed && !mutation.isPending;

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-[60]"
      closeOnBackdrop={false}
      labelledBy="edit-action-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <p className="text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1.5 text-foreground">
              <Terminal size={11} /> Windows Task Scheduler
            </p>
            <h2 id="edit-action-title" className="text-xl font-bold">Edit Command &amp; Settings</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              Changes what <span className="font-semibold text-foreground">{task.name}</span> runs — its schedule and run-as identity are preserved. Requires the Windows agent to be online.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Terminal size={11} /> Command <span className="text-danger-text">*</span>
            </label>
            <textarea
              value={command}
              onChange={e => setCommand(e.target.value)}
              rows={3}
              spellCheck={false}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-y"
            />
            <p className="text-[11px] text-subtle-foreground">
              Runs directly (no <span className="font-mono">cmd.exe</span> shell). Quote arguments with spaces — <span className="font-mono">"C:\Program Files\..."</span> stays one argument.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FolderOpen size={11} /> Working directory
            </label>
            <input
              value={workingDirectory}
              onChange={e => setWorkingDirectory(e.target.value)}
              placeholder="(optional)"
              spellCheck={false}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={11} /> Description
            </label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="(optional)"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <ShieldCheck size={11} /> Run level
            </label>
            <div className="flex gap-2">
              {([
                { value: 'least' as const, label: 'Standard' },
                { value: 'highest' as const, label: 'Highest privileges' }
              ]).map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setRunLevel(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                    runLevel === opt.value
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {runLevel === 'highest' && (
              <p className="text-[11px] text-warning-text">
                Saving may require the agent to run elevated; Windows can refuse the change if the task is admin-owned.
              </p>
            )}
          </div>
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
              : <><Terminal size={16} /> Save Changes</>}
          </button>
        </footer>
    </Modal>
  );
};
export default EditActionModal;
