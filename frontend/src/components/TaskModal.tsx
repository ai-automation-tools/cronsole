import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Folder, Play, History, Info, Loader2, CheckCircle2, XOctagon, Clock, Trash2 } from 'lucide-react';
import type { Task, ExecutionLogEntry } from '../types';
import { api } from '../api';

interface TaskModalProps {
  task: Task | null;
  onClose: () => void;
  onRun: (task: Task) => void;
  onCategoryUpdate: (taskId: string, category: string) => void;
}

const statusStyle = (status: string) =>
  ({
    SUCCESS: 'bg-green-500/10 text-green-400 border-green-500/30',
    FAILURE: 'bg-red-500/10 text-red-400 border-red-500/30',
    TIMEOUT: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
  }[status] ?? 'bg-muted/10 text-muted-foreground border-border/30');

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'SUCCESS') return <CheckCircle2 size={12} />;
  if (status === 'FAILURE') return <XOctagon size={12} />;
  return <Clock size={12} />;
};

export const TaskModal = ({ task, onClose, onRun, onCategoryUpdate }: TaskModalProps) => {
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'runs'>('overview');

  const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

  useEffect(() => {
    if (task) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewCategory(task.category || '');
      setIsEditingCategory(false);
      setActiveTab('overview');
    }
  }, [task]);

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (DEMO_MODE) return;
      return api.delete(`/tasks/${task!.id}`);
    },
    onSuccess: () => {
      if (!DEMO_MODE) queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      alert(`Delete failed: ${err.response?.data?.error || err.message}`);
    }
  });

  const { data: executions, isLoading: executionsLoading, isError: executionsError } = useQuery<ExecutionLogEntry[]>({
    queryKey: ['executions', task?.id],
    queryFn: async () => {
      const res = await api.get(`/tasks/${task!.id}/executions`);
      return res.data;
    },
    enabled: !!task && activeTab === 'runs' && !DEMO_MODE,
    staleTime: 15_000
  });

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-border flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-primary/20 text-foreground border border-primary/30">
                {task.platform}
              </span>
              <h2 className="text-2xl font-bold">{task.name}</h2>
            </div>
            <code className="text-xs text-subtle-foreground bg-background px-2 py-1 rounded">{task.externalId}</code>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-muted-foreground transition-colors">
            <XCircle size={24} />
          </button>
        </header>
        <div className="px-6 pt-4 border-b border-border flex gap-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-t-lg text-xs font-bold transition-all border-b-2 ${activeTab === 'overview' ? 'text-foreground border-primary' : 'text-subtle-foreground border-transparent hover:text-foreground'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('runs')}
            className={`px-4 py-2 rounded-t-lg text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${activeTab === 'runs' ? 'text-foreground border-primary' : 'text-subtle-foreground border-transparent hover:text-foreground'}`}
          >
            <History size={12} /> Run History
          </button>
        </div>

        {activeTab === 'runs' && (
          <div className="p-6 overflow-y-auto flex-1 text-foreground space-y-3">
            {DEMO_MODE ? (
              <div className="text-xs text-subtle-foreground bg-background border border-border rounded-xl px-4 py-3 flex items-center gap-2">
                <Info size={14} className="text-foreground shrink-0" /> Run history isn't available in the demo.
              </div>
            ) : executionsLoading ? (
              <div className="flex items-center justify-center py-16 text-subtle-foreground gap-2 text-sm">
                <Loader2 size={18} className="animate-spin" /> Loading run history…
              </div>
            ) : executionsError ? (
              <div className="text-xs text-red-400 bg-red-500/5 border border-red-500/30 rounded-xl px-4 py-3">
                Failed to load run history.
              </div>
            ) : !executions || executions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-subtle-foreground gap-2">
                <History size={32} className="opacity-30" />
                <p className="text-sm font-medium">No recorded runs yet</p>
                <p className="text-xs text-subtle-foreground">Manual runs and TaskHub-scheduled fires will appear here.</p>
              </div>
            ) : (
              executions.map(run => (
                <div key={run.id} className="bg-background border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${statusStyle(run.status)}`}>
                      <StatusIcon status={run.status} /> {run.status}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(run.triggeredAt).toLocaleString()}
                      {run.durationMs != null && (
                        <span className="text-subtle-foreground"> · {run.durationMs >= 1000 ? `${(run.durationMs / 1000).toFixed(1)}s` : `${run.durationMs}ms`}</span>
                      )}
                    </span>
                  </div>
                  {run.log && (
                    <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap break-all bg-surface/60 rounded-lg p-2.5 border border-border/60 max-h-28 overflow-y-auto">
                      {run.log}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'overview' && (
        <div className="p-6 overflow-y-auto space-y-8 flex-1 text-foreground">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-background p-4 rounded-xl border border-border">
              <span className="text-xs text-subtle-foreground block mb-1">Status</span>
              <span className="font-semibold text-foreground uppercase tracking-tighter text-sm">{task.status}</span>
            </div>
            <div className="bg-background p-4 rounded-xl border border-border">
              <span className="text-xs text-subtle-foreground block mb-1">Last Updated</span>
              <span className="font-semibold text-sm">{new Date(task.updatedAt).toLocaleString()}</span>
            </div>
          </div>

          <div className="bg-background p-4 rounded-xl border border-border">
            <span className="text-xs text-subtle-foreground block mb-2 uppercase font-bold tracking-widest">Local Category</span>
            {isEditingCategory ? (
              <div className="flex gap-2">
                <input 
                  type="text" 
                  autoFocus
                  value={newCategory} 
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (onCategoryUpdate(task.id, newCategory), setIsEditingCategory(false))}
                  className="bg-surface border border-border rounded-lg px-3 py-1 text-sm flex-1 outline-none focus:border-primary"
                  placeholder="Enter category name..."
                />
                <button 
                  onClick={() => { onCategoryUpdate(task.id, newCategory); setIsEditingCategory(false); }}
                  className="bg-primary hover:bg-primary-hover px-3 py-1 rounded-lg text-xs font-bold"
                >
                  Save
                </button>
                <button 
                  onClick={() => setIsEditingCategory(false)}
                  className="bg-muted hover:bg-muted px-3 py-1 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Folder size={14} className="text-foreground" />
                  <span className="text-sm font-semibold">{task.category || 'Uncategorized'}</span>
                </div>
                <button 
                  onClick={() => { setNewCategory(task.category); setIsEditingCategory(true); }}
                  className="text-xs text-foreground hover:text-foreground font-bold"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-subtle-foreground uppercase">Platform Metadata</h3>
            <pre className="text-[10px] bg-background p-4 rounded-xl border border-border overflow-x-auto font-mono text-foreground/80">
              {JSON.stringify(task.metadata, null, 2)}
            </pre>
          </div>
        </div>
        )}
        <footer className="p-6 bg-background border-t border-border flex gap-4">
          {task.platform === 'TASKHUB_NATIVE' && (
            <button
              onClick={() => {
                if (confirm(`Delete "${task.name}" and its run history? This cannot be undone.`)) {
                  deleteMutation.mutate();
                }
              }}
              disabled={deleteMutation.isPending}
              className="bg-red-500/10 hover:bg-red-500/20 text-red-400 px-4 py-3 rounded-xl font-bold transition-all border border-red-500/30 active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50"
              title="Delete this TaskHub-native task"
            >
              {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Delete
            </button>
          )}
          <button className="flex-1 bg-muted hover:bg-muted py-3 rounded-xl font-bold transition-all border border-border active:scale-95 text-sm">
            Edit Schedule
          </button>
          <button 
            onClick={() => { onRun(task); onClose(); }} 
            className="flex-1 bg-success hover:bg-success-hover text-success-foreground py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-success/20 active:scale-95 text-sm"
          >
            <Play size={16} fill="currentColor" /> Run Now
          </button>
        </footer>
      </div>
    </div>
  );
};
