import { useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, CopyPlus, Info } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../api';

const platformLabel = (p: string) =>
  ({
    WINDOWS_TASK_SCHEDULER: 'Windows',
    MACOS_LAUNCHD: 'macOS',
    CLAUDE_CODE: 'Claude',
    CHATGPT: 'ChatGPT',
    JULES: 'Jules',
    OPEN_CLAW: 'Open Claw',
    HERMES: 'Hermes'
  }[p] ?? p.split('_')[0]);

interface CloneTaskModalProps {
  task: Task;
  onClose: () => void;
}

export const CloneTaskModal = ({ task, onClose }: CloneTaskModalProps) => {
  const queryClient = useQueryClient();
  const [name, setName] = useState(`${task.name} (Copy)`);
  const [category, setCategory] = useState(task.category || 'Uncategorized');
  
  // Extract schedule and command from metadata or set defaults
  const [schedule, setSchedule] = useState(() => {
    if (task.schedule) return task.schedule;
    const meta = task.metadata as Record<string, any>;
    if (meta && meta.schedule) return meta.schedule;
    if (meta && meta.Triggers && typeof meta.Triggers === 'string') return meta.Triggers;
    return '0 3 * * *'; // fallback default
  });

  const [command, setCommand] = useState(() => {
    const meta = task.metadata as Record<string, any>;
    if (meta && meta.command) return meta.command;
    if (meta && meta.action) return meta.action;
    if (meta && meta.Actions && typeof meta.Actions === 'string') return meta.Actions;
    // Check if task contains an ExecAction in metadata structure
    if (meta && meta.Actions && Array.isArray(meta.Actions) && meta.Actions.length > 0) {
      const act = meta.Actions[0];
      return `${act.Path || act.path || ''} ${act.Arguments || act.arguments || ''}`.trim();
    }
    return 'echo Hello from Cloned Task'; // fallback default
  });

  const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

  const cloneMutation = useMutation({
    mutationFn: async () => {
      if (DEMO_MODE) {
        // Simulate creation in DEMO mode by adding a task to react-query cache
        const newTask: Task = {
          id: `cloned-${Date.now()}`,
          name,
          category,
          platform: task.platform,
          status: 'ACTIVE',
          externalId: task.platform === 'WINDOWS_TASK_SCHEDULER' ? `\\Cloned\\${name.replace(/\s+/g, '')}` : `cloned_${Date.now()}`,
          updatedAt: new Date().toISOString(),
          metadata: {
            schedule,
            command,
            state: 'Ready',
            clonedFrom: task.id
          }
        };

        queryClient.setQueryData(['tasks'], (prev: Task[] | undefined) => {
          if (!prev) return [newTask];
          return [newTask, ...prev];
        });
        return;
      }

      return api.post('/tasks', {
        name,
        platform: task.platform,
        category,
        schedule,
        command
      });
    },
    onSuccess: () => {
      if (!DEMO_MODE) {
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
      }
      alert(
        DEMO_MODE
          ? `Demo Mode — Cloned "${task.name}" as "${name}" locally.`
          : `Task "${name}" successfully cloned on ${platformLabel(task.platform)}!`
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      alert(`Clone failed: ${err.response?.data?.error || err.message}`);
    }
  });

  const isValid = name.trim() && schedule.trim() && command.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-slate-800 flex justify-between items-start bg-slate-900/50">
          <div>
            <p className="text-[10px] text-blue-500 uppercase font-black tracking-widest mb-1">Clone Existing Task</p>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <CopyPlus size={18} className="text-blue-400" />
              Clone: {task.name}
            </h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Create a copy of this task on {platformLabel(task.platform)}.
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-500 transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          {/* New Task Name */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">New Task Name</label>
            <input 
              value={name} 
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Daily Backup (Copy)"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Category */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Category</label>
            <input 
              value={category} 
              onChange={e => setCategory(e.target.value)}
              placeholder="e.g. Backup, Cleanup, Dev"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          {/* Schedule */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron expression)
            </label>
            <input 
              value={schedule} 
              onChange={e => setSchedule(e.target.value)}
              placeholder="e.g. 0 3 * * *"
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm font-mono text-blue-300 outline-none focus:border-blue-500 transition-colors" 
            />
            <p className="text-[9px] text-slate-500">
              Format: Minute Hour Day-of-month Month Day-of-week (e.g. `0 3 * * *` is 3:00 AM daily)
            </p>
          </div>

          {/* Command to Execute */}
          <div className="space-y-2">
            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">Command to Execute</label>
            <textarea 
              value={command} 
              onChange={e => setCommand(e.target.value)}
              placeholder="e.g. pg_dump -U postgres my_db > backup.sql"
              rows={3}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm font-mono text-slate-200 outline-none focus:border-blue-500 transition-colors resize-none" 
            />
          </div>

          {DEMO_MODE && (
            <div className="text-[11px] text-slate-500 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 flex items-center gap-2">
              <Info size={13} className="text-blue-500 shrink-0" /> Demo Mode — task will be simulated in frontend memory.
            </div>
          )}
        </div>

        <footer className="p-6 bg-slate-950 border-t border-slate-800 flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors">Cancel</button>
          <button 
            onClick={() => cloneMutation.mutate()} 
            disabled={!isValid || cloneMutation.isPending}
            className="flex-[2] bg-blue-600 hover:bg-blue-500 py-3 rounded-2xl font-bold shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            {cloneMutation.isPending ? <><Loader2 size={16} className="animate-spin" /> Cloning…</> : <>Confirm Clone</>}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default CloneTaskModal;
