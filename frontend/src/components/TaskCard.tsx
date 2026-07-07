import { useState } from 'react';
import { Folder, Plus, Play, CopyPlus, XOctagon } from 'lucide-react';
import type { Task } from '../types';
import { platformLabel, platformBadgeClass } from '../platform';

interface TaskCardProps {
  task: Task;
  onSelect: (task: Task) => void;
  onRun: (task: Task) => void;
  onCategoryUpdate: (taskId: string, category: string) => void;
  onClone: (task: Task) => void;
}

export const TaskCard = ({ task, onSelect, onRun, onCategoryUpdate, onClone }: TaskCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempCat, setTempCat] = useState(task.category || 'Uncategorized');

  return (
    <div 
      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-blue-500/50 cursor-pointer transition-all shadow-xl group hover:-translate-y-1 active:scale-[0.98]" 
      onClick={() => !isEditing && onSelect(task)}
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex flex-col gap-1">
          <span className={`text-[10px] w-fit uppercase font-black px-2.5 py-1 rounded-lg border ${platformBadgeClass(task.platform)}`}>
            {platformLabel(task.platform)}
          </span>
          
          {isEditing ? (
            <div className="flex items-center gap-1 mt-1" onClick={e => e.stopPropagation()}>
              <input 
                autoFocus
                className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-white w-24 outline-none focus:border-blue-500"
                value={tempCat}
                onChange={e => setTempCat(e.target.value)}
                onBlur={() => setIsEditing(false)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    onCategoryUpdate(task.id, tempCat);
                    setIsEditing(false);
                  }
                  if (e.key === 'Escape') setIsEditing(false);
                }}
              />
            </div>
          ) : (
            <div 
              className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 ml-1 hover:text-blue-400 transition-colors"
              onClick={e => { e.stopPropagation(); setIsEditing(true); }}
            >
              <Folder size={10} /> {task.category || 'Uncategorized'}
              <Plus size={8} className="opacity-0 group-hover:opacity-100" />
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
            <div className={`h-2 w-2 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-600'}`}></div>
            <span className="text-[10px] font-bold text-slate-400">{task.status}</span>
          </div>
          {task.lastRunStatus === 'FAILURE' && (
            <div className="flex items-center gap-1 bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/30" title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}>
              <XOctagon size={10} className="text-red-400" />
              <span className="text-[9px] font-black text-red-400 uppercase">Run failed</span>
            </div>
          )}
        </div>
      </div>
      <h3 className="font-bold text-lg mb-1 truncate">{task.name}</h3>
      <p className="text-xs text-slate-500 mb-6 italic truncate">{task.externalId}</p>
      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <div className="text-[10px] text-slate-400">
          Last updated: <span className="text-slate-200">{new Date(task.updatedAt).toLocaleTimeString()}</span>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={(e) => { e.stopPropagation(); onClone(task); }} 
            className="bg-slate-800 hover:bg-slate-700 hover:text-blue-400 p-2 rounded-lg text-slate-400 shadow-md transition-all active:scale-90"
            title="Clone Task"
          >
            <CopyPlus size={18} />
          </button>
          <button 
            onClick={(e) => { e.stopPropagation(); onRun(task); }} 
            className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg text-white shadow-lg shadow-blue-600/20 transition-all active:scale-90"
            title="Run Task"
          >
            <Play size={18} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
};
