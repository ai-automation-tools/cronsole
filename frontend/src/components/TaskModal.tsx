import { useState, useEffect } from 'react';
import { XCircle, Folder, Play } from 'lucide-react';
import type { Task } from '../types';

interface TaskModalProps {
  task: Task | null;
  onClose: () => void;
  onRun: (task: Task) => void;
  onCategoryUpdate: (taskId: string, category: string) => void;
}

export const TaskModal = ({ task, onClose, onRun, onCategoryUpdate }: TaskModalProps) => {
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState('');

  useEffect(() => {
    if (task) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewCategory(task.category || '');
      setIsEditingCategory(false);
    }
  }, [task]);

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-slate-800 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30">
                {task.platform}
              </span>
              <h2 className="text-2xl font-bold">{task.name}</h2>
            </div>
            <code className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded">{task.externalId}</code>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors">
            <XCircle size={24} />
          </button>
        </header>
        <div className="p-6 overflow-y-auto space-y-8 flex-1 text-slate-300">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">Status</span>
              <span className="font-semibold text-blue-400 uppercase tracking-tighter text-sm">{task.status}</span>
            </div>
            <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
              <span className="text-xs text-slate-500 block mb-1">Last Updated</span>
              <span className="font-semibold text-sm">{new Date(task.updatedAt).toLocaleString()}</span>
            </div>
          </div>

          <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
            <span className="text-xs text-slate-500 block mb-2 uppercase font-bold tracking-widest">Local Category</span>
            {isEditingCategory ? (
              <div className="flex gap-2">
                <input 
                  type="text" 
                  autoFocus
                  value={newCategory} 
                  onChange={(e) => setNewCategory(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (onCategoryUpdate(task.id, newCategory), setIsEditingCategory(false))}
                  className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-1 text-sm flex-1 outline-none focus:border-blue-500"
                  placeholder="Enter category name..."
                />
                <button 
                  onClick={() => { onCategoryUpdate(task.id, newCategory); setIsEditingCategory(false); }}
                  className="bg-blue-600 hover:bg-blue-500 px-3 py-1 rounded-lg text-xs font-bold"
                >
                  Save
                </button>
                <button 
                  onClick={() => setIsEditingCategory(false)}
                  className="bg-slate-800 hover:bg-slate-700 px-3 py-1 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Folder size={14} className="text-blue-400" />
                  <span className="text-sm font-semibold">{task.category || 'Uncategorized'}</span>
                </div>
                <button 
                  onClick={() => { setNewCategory(task.category); setIsEditingCategory(true); }}
                  className="text-xs text-blue-400 hover:text-blue-300 font-bold"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-bold text-slate-500 uppercase">Platform Metadata</h3>
            <pre className="text-[10px] bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto font-mono text-blue-400/80">
              {JSON.stringify(task.metadata, null, 2)}
            </pre>
          </div>
        </div>
        <footer className="p-6 bg-slate-950 border-t border-slate-800 flex gap-4">
          <button className="flex-1 bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold transition-all border border-slate-700 active:scale-95 text-sm">
            Edit Schedule
          </button>
          <button 
            onClick={() => { onRun(task); onClose(); }} 
            className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95 text-sm"
          >
            <Play size={16} fill="currentColor" /> Run Now
          </button>
        </footer>
      </div>
    </div>
  );
};
