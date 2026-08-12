import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, CopyPlus } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../api';
import { platformLabel } from '../platform';
import { useToast } from '../hooks/useToast';
import { Modal } from './ui/Modal';

interface CloneTaskModalProps {
  task: Task;
  onClose: () => void;
}

export const CloneTaskModal = ({ task, onClose }: CloneTaskModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState(`${task.name} (Copy)`);
  const [category, setCategory] = useState(task.category || 'Uncategorized');
  
  // Extract schedule and command from metadata or set defaults
  const [schedule, setSchedule] = useState(() => {
    if (task.schedule) return task.schedule;
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.schedule === 'string') return meta.schedule;
    if (typeof meta.Triggers === 'string') return meta.Triggers;
    return '0 3 * * *'; // fallback default
  });

  const [command, setCommand] = useState(() => {
    const meta = (task.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.command === 'string') return meta.command;
    if (typeof meta.action === 'string') return meta.action;
    if (typeof meta.Actions === 'string') return meta.Actions;
    // Check if task contains an ExecAction in metadata structure
    if (Array.isArray(meta.Actions) && meta.Actions.length > 0) {
      const act = meta.Actions[0] as Record<string, unknown>;
      const path = typeof act.Path === 'string' ? act.Path : typeof act.path === 'string' ? act.path : '';
      const args = typeof act.Arguments === 'string' ? act.Arguments : typeof act.arguments === 'string' ? act.arguments : '';
      return `${path} ${args}`.trim();
    }
    return 'echo Hello from Cloned Task'; // fallback default
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      return api.post('/tasks', {
        name,
        platform: task.platform,
        category,
        schedule,
        command
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(
        `Task "${name}" successfully cloned on ${platformLabel(task.platform)}!`,
        'success'
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Clone failed: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  const isValid = name.trim() && schedule.trim() && command.trim();

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="clone-task-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <p className="text-[10px] text-foreground uppercase font-black tracking-widest mb-1">Clone Existing Task</p>
            <h2 id="clone-task-title" className="text-xl font-bold flex items-center gap-2">
              <CopyPlus size={18} className="text-foreground" />
              Clone: {task.name}
            </h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              Create a copy of this task on {platformLabel(task.platform)}.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close clone task" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          {/* New Task Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider block">New Task Name</label>
            <input 
              value={name} 
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Daily Backup (Copy)"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider block">Category</label>
            <input 
              value={category} 
              onChange={e => setCategory(e.target.value)}
              placeholder="e.g. Backup, Cleanup, Dev"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron expression)
            </label>
            <input 
              value={schedule} 
              onChange={e => setSchedule(e.target.value)}
              placeholder="e.g. 0 3 * * *"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors" 
            />
            <p className="text-[9px] text-subtle-foreground">
              Format: Minute Hour Day-of-month Month Day-of-week (e.g. `0 3 * * *` is 3:00 AM daily)
            </p>
          </div>

          {/* Command to Execute */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider block">Command to Execute</label>
            <textarea 
              value={command} 
              onChange={e => setCommand(e.target.value)}
              placeholder="e.g. pg_dump -U postgres my_db > backup.sql"
              rows={3}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors resize-none" 
            />
          </div>

        </div>

        <footer className="p-6 bg-background border-t border-border flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Cancel</button>
          <button 
            onClick={() => cloneMutation.mutate()} 
            disabled={!isValid || cloneMutation.isPending}
            className="flex-[2] bg-primary hover:bg-primary-hover py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            {cloneMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Cloning…</> : <>Confirm Clone</>}
          </button>
        </footer>
    </Modal>
  );
};

export default CloneTaskModal;
