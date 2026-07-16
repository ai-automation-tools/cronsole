import { useState } from 'react';
import { Folder, Plus, Play, CopyPlus, XOctagon, Power, Loader2 } from 'lucide-react';
import type { Task } from '../types';
import { platformLabel, platformBadgeClass } from '../platform';
import { isRunnable, runButtonTitle, canToggleStatus, toggleStatusTitle } from '../utils/taskActions';

interface TaskCardProps {
  task: Task;
  onSelect: (task: Task) => void;
  onRun: (task: Task) => void;
  onCategoryUpdate: (taskId: string, category: string) => void;
  onClone: (task: Task) => void;
  onToggleStatus: (task: Task) => void;
  isTogglingStatus?: boolean;
}

export const TaskCard = ({ task, onSelect, onRun, onCategoryUpdate, onClone, onToggleStatus, isTogglingStatus }: TaskCardProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempCat, setTempCat] = useState(task.category || 'Uncategorized');

  return (
    <div 
      className="bg-surface border border-border rounded-2xl p-5 hover:border-primary/50 cursor-pointer transition-all shadow-xl group hover:-translate-y-1 active:scale-[0.98]" 
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
                className="bg-background border border-border rounded px-1.5 py-0.5 text-[10px] text-foreground w-24 outline-none focus:border-primary"
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
              className="flex items-center gap-1.5 text-[10px] font-bold text-subtle-foreground ml-1 hover:text-foreground transition-colors"
              onClick={e => { e.stopPropagation(); setIsEditing(true); }}
            >
              <Folder size={10} /> {task.category || 'Uncategorized'}
              <Plus size={8} className="opacity-0 group-hover:opacity-100" />
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 bg-background px-2 py-1 rounded-lg border border-border">
            <div className={`h-2 w-2 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-muted'}`}></div>
            <span className="text-[10px] font-bold text-muted-foreground">{task.status}</span>
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
      <p className="text-xs text-subtle-foreground mb-6 italic truncate">{task.externalId}</p>
      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="text-[10px] text-muted-foreground">
          Last updated: <span className="text-foreground">{new Date(task.updatedAt).toLocaleTimeString()}</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onClone(task); }}
            className="bg-muted hover:bg-muted hover:text-foreground p-2 rounded-lg text-muted-foreground shadow-md transition-all active:scale-90"
            title="Clone Task"
          >
            <CopyPlus size={18} />
          </button>
          {canToggleStatus(task) && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleStatus(task); }}
              disabled={isTogglingStatus}
              className="bg-muted hover:bg-muted hover:text-foreground p-2 rounded-lg text-muted-foreground shadow-md transition-all active:scale-90 disabled:opacity-50 disabled:cursor-not-allowed"
              title={toggleStatusTitle(task)}
            >
              {isTogglingStatus ? <Loader2 size={18} className="animate-spin" /> : <Power size={18} className={task.status === 'ACTIVE' ? 'text-green-400' : ''} />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); if (isRunnable(task)) onRun(task); }}
            disabled={!isRunnable(task)}
            className="bg-success hover:bg-success-hover p-2 rounded-lg text-success-foreground shadow-lg shadow-success/20 transition-all active:scale-90 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
            title={runButtonTitle(task)}
          >
            <Play size={18} fill="currentColor" />
          </button>
        </div>
      </div>
    </div>
  );
};
