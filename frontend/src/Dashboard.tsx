import { useState, useMemo, useEffect } from 'react';
import {
  Activity,
  LayoutDashboard,
  RefreshCw,
  Cpu,
  Library,
  Loader2,
  Info,
  Clock,
  ExternalLink,
  ArrowRight,
  Folder,
  Tag,
  Plus,
  Eye,
  EyeOff,
  Bot,
  Sparkles,
  Globe,
  Trash2,
  Grid,
  List,
  Columns,
  Calendar,
  HelpCircle,
  CopyPlus,
  Play,
  Zap
} from 'lucide-react';
import { CloneTaskModal } from './components/CloneTaskModal';
import { HelpModal } from './components/HelpModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, Template, PlatformLink } from './types';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { ImportModal } from './components/ImportModal';
import { TaskCard } from './components/TaskCard';
import { ApplyTemplateModal } from './components/ApplyTemplateModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { platformLabel, platformBadgeClass } from './platform';

// Loose shape for the untyped platform-metadata JSON blob on tasks.
type TaskMeta = { nextRunTime?: string; nextRun?: string; schedule?: string } | null | undefined;

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const DEMO_TASKS: Task[] = [
  {
    id: 'demo-1',
    name: 'Edge-Radar Daily Calibration',
    category: 'Monitoring',
    platform: 'WINDOWS_TASK_SCHEDULER',
    status: 'ACTIVE',
    externalId: '\\Mikes\\EdgeRadar\\DailyCalibration',
    updatedAt: '2026-06-01T09:00:00Z',
    metadata: { schedule: '0 9 * * *', state: 'Ready', machine: 'MIKE-DESKTOP' },
  },
  {
    id: 'demo-2',
    name: 'Morning News Digest',
    category: 'Intelligence',
    platform: 'CLAUDE_CODE',
    status: 'ACTIVE',
    externalId: 'routine_news_digest_0700',
    updatedAt: '2026-06-01T07:00:00Z',
    metadata: { schedule: '0 7 * * *', model: 'claude-opus-4-8' },
  },
  {
    id: 'demo-3',
    name: 'System Cleanup',
    category: 'Maintenance',
    platform: 'WINDOWS_TASK_SCHEDULER',
    status: 'DISABLED',
    externalId: '\\Mikes\\Cleanup',
    updatedAt: '2026-06-01T00:00:00Z',
    metadata: { schedule: '0 0 * * 0', state: 'Disabled' },
  },
  {
    id: 'demo-4',
    name: 'Uptime Webhook Ping',
    category: 'TaskHub',
    platform: 'TASKHUB_NATIVE',
    status: 'ACTIVE',
    externalId: 'native_demo1',
    updatedAt: '2026-06-01T08:00:00Z',
    schedule: '*/15 * * * *',
    metadata: { job: { jobType: 'HTTP', url: 'https://hc-ping.com/demo', method: 'GET' } },
  },
];

// Mirrors the seeded catalog (backend/src/seed.ts) so the demo showcases the same
// Tier B patterns + Tier A starters — including parameterized starters that drive the Apply modal.
const DEMO_TEMPLATES: Template[] = [
  // --- Tier B: use-case patterns ---
  {
    id: 'tpl_daily_backup',
    name: 'Daily Database Backup',
    description: 'Backs up a PostgreSQL database every night at 3 AM.',
    sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
    targetPlatforms: ['WINDOWS_TASK_SCHEDULER', 'CLAUDE_CODE'],
    scheduleExpression: '0 3 * * *',
    command: 'pg_dump -U postgres my_db > backup.sql',
    scriptType: 'EXECUTABLE',
    os: 'WINDOWS',
    category: 'BACKUP',
    icon: 'Database',
    upvotes: 42
  },
  {
    id: 'tpl_news_digest',
    name: 'Morning News Digest',
    description: 'Summarizes top news stories from specified RSS feeds.',
    sourcePlatform: 'CLAUDE_CODE',
    targetPlatforms: ['CLAUDE_CODE', 'CHATGPT'],
    scheduleExpression: '0 7 * * *',
    command: 'Fetch and summarize news',
    scriptType: 'AI_PROMPT',
    os: 'CROSS_PLATFORM',
    category: 'AI_AGENT',
    icon: 'Newspaper',
    upvotes: 128
  },
  {
    id: 'tpl_system_cleanup',
    name: 'Weekly System Cleanup',
    description: 'Cleans up temporary files and logs every Sunday.',
    sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
    targetPlatforms: ['WINDOWS_TASK_SCHEDULER'],
    scheduleExpression: '0 0 * * 0',
    command: 'del /q /s %temp%\\*',
    scriptType: 'BATCH',
    os: 'WINDOWS',
    category: 'CLEANUP',
    icon: 'Trash2',
    upvotes: 15
  },
  {
    id: 'tpl_pr_triage',
    name: 'GitHub PR Triage',
    description: 'Triage new pull requests and label them based on content.',
    sourcePlatform: 'CLAUDE_CODE',
    targetPlatforms: ['CLAUDE_CODE'],
    scheduleExpression: '*/30 * * * *',
    command: 'Triage PRs',
    scriptType: 'AI_PROMPT',
    os: 'CROSS_PLATFORM',
    category: 'DEV_WORKFLOW',
    icon: 'GitPullRequest',
    upvotes: 89
  },
  // --- Tier A: script starters (parameterized — drive the Apply modal) ---
  {
    id: 'tpl_starter_powershell_script',
    name: 'PowerShell Script',
    description: 'Run a .ps1 PowerShell script file on a schedule.',
    sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
    targetPlatforms: ['WINDOWS_TASK_SCHEDULER'],
    scheduleExpression: '0 9 * * *',
    command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"',
    commandTemplate: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{scriptPath}}"',
    parameters: [
      { key: 'scriptPath', label: 'Script file path', type: 'path', default: '', required: true, help: 'Absolute path to the script on the target machine.' }
    ],
    scriptType: 'POWERSHELL',
    os: 'WINDOWS',
    category: 'OTHER',
    icon: 'Terminal',
    isStarter: true,
    upvotes: 0
  },
  {
    id: 'tpl_starter_python_cross',
    name: 'Python Script (cross-platform)',
    description: 'Run a Python script on Windows or macOS.',
    sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
    targetPlatforms: ['WINDOWS_TASK_SCHEDULER', 'MACOS_LAUNCHD'],
    scheduleExpression: '0 8 * * *',
    command: 'python "{{scriptPath}}" {{args}}',
    commandTemplate: 'python "{{scriptPath}}" {{args}}',
    parameters: [
      { key: 'scriptPath', label: 'Script file path', type: 'path', default: '', required: true, help: 'Absolute path to the script on the target machine.' },
      { key: 'args', label: 'Arguments', type: 'text', default: '', required: false, help: 'Optional command-line arguments.' }
    ],
    scriptType: 'PYTHON',
    os: 'CROSS_PLATFORM',
    category: 'OTHER',
    icon: 'FileCode',
    isStarter: true,
    upvotes: 0
  },
  {
    id: 'tpl_starter_zsh_script',
    name: 'Shell Script (zsh)',
    description: 'Run a shell script with zsh, the macOS default shell.',
    sourcePlatform: 'MACOS_LAUNCHD',
    targetPlatforms: ['MACOS_LAUNCHD'],
    scheduleExpression: '0 9 * * *',
    command: '/bin/zsh "{{scriptPath}}" {{args}}',
    commandTemplate: '/bin/zsh "{{scriptPath}}" {{args}}',
    parameters: [
      { key: 'scriptPath', label: 'Script file path', type: 'path', default: '', required: true, help: 'Absolute path to the script on the target machine.' },
      { key: 'args', label: 'Arguments', type: 'text', default: '', required: false, help: 'Optional command-line arguments.' }
    ],
    scriptType: 'ZSH',
    os: 'MACOS',
    category: 'OTHER',
    icon: 'Terminal',
    isStarter: true,
    upvotes: 0
  },
  {
    id: 'tpl_starter_webhook_windows',
    name: 'Webhook / HTTP Ping (Windows)',
    description: 'Call a URL on a schedule using Invoke-WebRequest.',
    sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
    targetPlatforms: ['WINDOWS_TASK_SCHEDULER'],
    scheduleExpression: '*/15 * * * *',
    command: 'powershell.exe -Command "Invoke-WebRequest -Uri \'{{url}}\' -Method {{method}}"',
    commandTemplate: 'powershell.exe -Command "Invoke-WebRequest -Uri \'{{url}}\' -Method {{method}}"',
    parameters: [
      { key: 'url', label: 'URL', type: 'url', default: '', required: true, help: 'The endpoint to call.' },
      { key: 'method', label: 'HTTP method', type: 'select', options: ['GET', 'POST'], default: 'GET', required: true, help: 'HTTP verb for the request.' }
    ],
    scriptType: 'HTTP',
    os: 'WINDOWS',
    category: 'MONITORING',
    icon: 'Globe',
    isStarter: true,
    upvotes: 0
  }
];

const DashboardScreen = ({ 
  onTaskSelect, 
  onRun, 
  tasks, 
  isLoading, 
  refetch, 
  onCategoryUpdate,
  onClone,
  onShowHelp,
  onNewTask
}: {
  onTaskSelect: (task: Task) => void;
  onRun: (task: Task) => void;
  tasks: Task[] | undefined;
  isLoading: boolean;
  refetch: () => void;
  onCategoryUpdate: (taskId: string, category: string) => void;
  onClone: (task: Task) => void;
  onShowHelp: () => void;
  onNewTask: () => void;
}) => {
  const [selectedCategory, setSelectedTaskCategory] = useState<string>('All');
  const [selectedPlatform, setSelectedPlatform] = useState<string>('All');
  const [showDisabled, setShowDisabled] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'kanban' | 'schedule'>('grid');

  const categories = useMemo(() => {
    if (!tasks) return ['All'];
    const unique = Array.from(new Set(tasks.map(t => t.category || 'Uncategorized')));
    return ['All', ...unique.sort()];
  }, [tasks]);

  const platforms = useMemo(() => {
    if (!tasks) return [];
    return Array.from(new Set(tasks.map(t => t.platform))).sort();
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];

    // First apply the active/disabled filter (except for kanban view where we show both columns)
    let result = tasks;
    if (viewMode !== 'kanban') {
      result = showDisabled ? tasks : tasks.filter(t => t.status === 'ACTIVE');
    }

    // Platform isolation (e.g. only TaskHub-native, only Windows)
    if (selectedPlatform !== 'All') {
      result = result.filter(t => t.platform === selectedPlatform);
    }

    // Then apply category filter
    if (selectedCategory !== 'All') {
      result = result.filter(t => (t.category || 'Uncategorized') === selectedCategory);
    }

    return result;
  }, [tasks, selectedCategory, selectedPlatform, showDisabled, viewMode]);

  const scheduledTasks = useMemo(() => {
    return [...filteredTasks].sort((a, b) => {
      const aTime = (a.metadata as TaskMeta)?.nextRunTime || (a.metadata as TaskMeta)?.nextRun || a.updatedAt;
      const bTime = (b.metadata as TaskMeta)?.nextRunTime || (b.metadata as TaskMeta)?.nextRun || b.updatedAt;
      return new Date(aTime).getTime() - new Date(bTime).getTime();
    });
  }, [filteredTasks]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-slate-500 font-medium animate-pulse">Fetching live tasks from agent...</p>
      </div>
    );
  }

  const isEmpty = !tasks || tasks.length === 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {DEMO_MODE && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-500/30 bg-blue-600/10 p-4 text-sm">
          <Info size={18} className="mt-0.5 flex-shrink-0 text-blue-400" />
          <p className="text-slate-300"><span className="font-semibold text-blue-300">Demo data.</span> You're viewing a live demo. <a href="https://github.com/michaelschecht/taskhub" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline underline-offset-2 hover:text-blue-300">Run it locally</a> with the backend.</p>
        </div>
      )}
      
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold mb-1">Unified Task Dashboard</h2>
          <p className="text-slate-400">Manage {tasks?.length || 0} tasks across your ecosystem.</p>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button 
            onClick={onShowHelp}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-900 border border-slate-800 text-slate-400 hover:border-slate-700 hover:text-white transition-all flex items-center gap-2 active:scale-95 shadow-md font-bold"
          >
            <HelpCircle size={16} /> Help Center
          </button>
          
          {!isEmpty && viewMode !== 'kanban' && (
            <button 
              onClick={() => setShowDisabled(!showDisabled)} 
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 border ${
                showDisabled 
                  ? 'bg-blue-600/10 border-blue-500/50 text-blue-400' 
                  : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              {showDisabled ? <Eye size={16} /> : <EyeOff size={16} />}
              {showDisabled ? 'Showing All' : 'Active Only'}
            </button>
          )}
          
          <button
            onClick={onNewTask}
            className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-violet-600/20 active:scale-95"
            title="Create a task that runs on TaskHub itself — no Windows entry"
          >
            <Zap size={16} /> New Task
          </button>

          <button onClick={() => refetch()} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95">
            <RefreshCw size={16} /> Sync Now
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-[50vh] border-2 border-dashed border-slate-800 rounded-3xl p-10 text-center">
           <Activity size={48} className="text-slate-700 mb-4 animate-pulse" />
           <h3 className="text-xl font-bold text-slate-300">Dashboard is empty</h3>
           <p className="text-slate-500 max-w-sm mt-2 mb-6">
              Connect systems and perform your first sync to discover and monitor scheduled tasks.
           </p>
           <button 
             onClick={() => refetch()}
             className="bg-blue-600 hover:bg-blue-500 px-6 py-3 rounded-2xl text-sm font-bold shadow-lg shadow-blue-600/20 transition-all active:scale-95"
           >
             Sync Tasks Now
           </button>
        </div>
      ) : (
        <>
          {/* Category Tabs & Views */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-900">
            <div className="flex flex-wrap items-center gap-2">
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setSelectedTaskCategory(cat)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                    selectedCategory === cat 
                      ? 'bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-600/20' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                  }`}
                >
                  {cat === 'All' ? <LayoutDashboard size={12} className="inline mr-2" /> : <Folder size={12} className="inline mr-2" />}
                  {cat}
                  <span className={`ml-2 px-1.5 py-0.5 rounded-md text-[10px] ${selectedCategory === cat ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-500'}`}>
                    {cat === 'All' ? tasks?.length : tasks?.filter(t => (t.category || 'Uncategorized') === cat).length}
                  </span>
                </button>
              ))}
            </div>
            
            <div className="flex items-center gap-3 self-start sm:self-auto shrink-0">
            {/* Platform Isolation Filter */}
            {platforms.length > 1 && (
              <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl items-center shadow-md">
                <button
                  onClick={() => setSelectedPlatform('All')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${selectedPlatform === 'All' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                >
                  All
                </button>
                {platforms.map(p => (
                  <button
                    key={p}
                    onClick={() => setSelectedPlatform(p)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                      selectedPlatform === p
                        ? p === 'TASKHUB_NATIVE' ? 'bg-violet-600 text-white' : 'bg-blue-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {p === 'TASKHUB_NATIVE' && <Zap size={11} />}
                    {platformLabel(p)}
                    <span className={`px-1 py-0.5 rounded text-[9px] ${selectedPlatform === p ? 'bg-black/20' : 'bg-slate-800 text-slate-500'}`}>
                      {tasks?.filter(t => t.platform === p).length}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {/* View Mode Toggle */}
            <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl items-center shadow-md shrink-0">
              <button 
                onClick={() => setViewMode('grid')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Grid size={12} /> Grid
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <List size={12} /> List
              </button>
              <button 
                onClick={() => setViewMode('kanban')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'kanban' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Columns size={12} /> Kanban
              </button>
              <button
                onClick={() => setViewMode('schedule')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${viewMode === 'schedule' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
              >
                <Calendar size={12} /> Schedule
              </button>
            </div>
            </div>
          </div>

          {/* Grid View */}
          {viewMode === 'grid' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
              {filteredTasks.length === 0 ? (
                <div className="col-span-full py-20 flex flex-col items-center justify-center border-2 border-dashed border-slate-800 rounded-3xl text-slate-500">
                   <Tag size={48} className="mb-4 opacity-20" />
                   <p className="font-bold">No tasks found</p>
                   {!showDisabled && tasks?.some(t => t.status !== 'ACTIVE' && (selectedCategory === 'All' || t.category === selectedCategory)) && (
                     <button 
                       onClick={() => setShowDisabled(true)}
                       className="mt-4 text-blue-400 hover:text-blue-300 text-sm font-bold underline underline-offset-4"
                     >
                       Show disabled tasks in this category
                     </button>
                   )}
                </div>
              ) : (
                filteredTasks.map(task => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    onSelect={onTaskSelect} 
                    onRun={onRun} 
                    onCategoryUpdate={onCategoryUpdate} 
                    onClone={onClone}
                  />
                ))
              )}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl pb-4">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-800/80 text-[10px] uppercase font-black text-slate-500 tracking-wider bg-slate-950/20">
                      <th className="py-4 px-6">Name</th>
                      <th className="py-4 px-4">Platform</th>
                      <th className="py-4 px-4">Category</th>
                      <th className="py-4 px-4">Status</th>
                      <th className="py-4 px-4">Last Sync</th>
                      <th className="py-4 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/50 text-sm">
                    {filteredTasks.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-12 text-slate-500 font-medium italic">
                          No tasks match the active filters.
                        </td>
                      </tr>
                    ) : (
                      filteredTasks.map(task => (
                        <tr 
                          key={task.id} 
                          className="hover:bg-slate-900/50 transition-colors group cursor-pointer"
                          onClick={() => onTaskSelect(task)}
                        >
                          <td className="py-4 px-6 font-bold text-slate-200 group-hover:text-blue-400 transition-colors">
                            <div>
                              <span className="block truncate max-w-[240px]">{task.name}</span>
                              <span className="block text-[10px] text-slate-500 font-mono font-normal truncate max-w-[240px] mt-0.5">{task.externalId}</span>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <span className={`text-[9px] uppercase font-black px-2.5 py-1 rounded-lg border ${platformBadgeClass(task.platform)}`}>
                              {platformLabel(task.platform)}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                              <Folder size={12} className="text-slate-500" /> {task.category || 'Uncategorized'}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-[10px] font-bold text-slate-400">
                                <span className={`h-1.5 w-1.5 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-600'}`}></span>
                                {task.status}
                              </span>
                              {task.lastRunStatus === 'FAILURE' && (
                                <span className="inline-flex items-center bg-red-500/10 px-2 py-1 rounded-lg border border-red-500/30 text-[9px] font-black text-red-400 uppercase" title={task.lastRunAt ? `Failed ${new Date(task.lastRunAt).toLocaleString()}` : 'Last run failed'}>
                                  Run failed
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-4 text-xs text-slate-400 font-mono">
                            {new Date(task.updatedAt).toLocaleTimeString()}
                          </td>
                          <td className="py-4 px-4" onClick={e => e.stopPropagation()}>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => onClone(task)} 
                                className="bg-slate-855 hover:bg-slate-800 hover:text-blue-400 p-2 rounded-lg text-slate-450 border border-slate-800 transition-all active:scale-90"
                                title="Clone Task"
                              >
                                <CopyPlus size={16} />
                              </button>
                              <button 
                                onClick={() => onRun(task)} 
                                className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg text-white shadow-lg shadow-blue-600/20 transition-all active:scale-90"
                                title="Run Task"
                              >
                                <Play size={16} fill="currentColor" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Kanban Board View */}
          {viewMode === 'kanban' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">
              {/* Active Column */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-5 flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-slate-850 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500"></div>
                    <h3 className="font-bold text-sm tracking-wide text-slate-200 uppercase">Active Tasks</h3>
                  </div>
                  <span className="bg-slate-950 px-2 py-0.5 rounded-md border border-slate-850 text-xs font-bold text-slate-400">
                    {filteredTasks.filter(t => t.status === 'ACTIVE').length}
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar pr-1">
                  {filteredTasks.filter(t => t.status === 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-slate-500 italic text-center py-10">No active tasks in this category.</p>
                  ) : (
                    filteredTasks.filter(t => t.status === 'ACTIVE').map(task => (
                      <div 
                        key={task.id} 
                        onClick={() => onTaskSelect(task)}
                        className="bg-slate-955 border border-slate-850 hover:border-blue-500/40 p-4 rounded-2xl cursor-pointer hover:-translate-y-0.5 active:translate-y-0 transition-all flex flex-col gap-2 shadow-lg"
                      >
                        <div className="flex justify-between items-start">
                          <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                            {platformLabel(task.platform)}
                          </span>
                          <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                            <Folder size={10} /> {task.category || 'Uncategorized'}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-200 text-sm truncate">{task.name}</h4>
                        <div className="flex items-center justify-between border-t border-slate-900 pt-2 mt-1">
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(task.updatedAt).toLocaleTimeString()}
                          </span>
                          <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                            <button 
                              onClick={() => onClone(task)} 
                              className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all"
                              title="Clone Task"
                            >
                              <CopyPlus size={12} />
                            </button>
                            <button 
                              onClick={() => onRun(task)} 
                              className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-600/10"
                              title="Run Task"
                            >
                              <Play size={12} fill="currentColor" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Disabled Column */}
              <div className="bg-slate-900/40 border border-slate-800/80 rounded-3xl p-5 flex flex-col space-y-4">
                <div className="flex items-center justify-between border-b border-slate-850 pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-slate-500"></div>
                    <h3 className="font-bold text-sm tracking-wide text-slate-400 uppercase">Disabled Tasks</h3>
                  </div>
                  <span className="bg-slate-950 px-2 py-0.5 rounded-md border border-slate-850 text-xs font-bold text-slate-450">
                    {filteredTasks.filter(t => t.status !== 'ACTIVE').length}
                  </span>
                </div>
                
                <div className="flex-1 space-y-3 overflow-y-auto max-h-[70vh] custom-scrollbar pr-1">
                  {filteredTasks.filter(t => t.status !== 'ACTIVE').length === 0 ? (
                    <p className="text-xs text-slate-500 italic text-center py-10">No disabled tasks in this category.</p>
                  ) : (
                    filteredTasks.filter(t => t.status !== 'ACTIVE').map(task => (
                      <div 
                        key={task.id} 
                        onClick={() => onTaskSelect(task)}
                        className="bg-slate-955 border border-slate-850 hover:border-blue-500/40 p-4 rounded-2xl cursor-pointer hover:-translate-y-0.5 active:translate-y-0 transition-all flex flex-col gap-2 shadow-lg opacity-60 hover:opacity-100"
                      >
                        <div className="flex justify-between items-start">
                          <span className={`text-[9px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                            {platformLabel(task.platform)}
                          </span>
                          <span className="text-[9px] font-bold text-slate-500 flex items-center gap-1">
                            <Folder size={10} /> {task.category || 'Uncategorized'}
                          </span>
                        </div>
                        <h4 className="font-bold text-slate-350 text-sm truncate">{task.name}</h4>
                        <div className="flex items-center justify-between border-t border-slate-900 pt-2 mt-1">
                          <span className="text-[9px] text-slate-500 font-mono">
                            {new Date(task.updatedAt).toLocaleTimeString()}
                          </span>
                          <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                            <button 
                              onClick={() => onClone(task)} 
                              className="p-1.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all"
                              title="Clone Task"
                            >
                              <CopyPlus size={12} />
                            </button>
                            <button 
                              onClick={() => onRun(task)} 
                              className="p-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-600/10"
                              title="Run Task"
                            >
                              <Play size={12} fill="currentColor" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Schedule View */}
          {viewMode === 'schedule' && (
            <div className="space-y-4 pb-20">
              <div className="bg-slate-900/30 border border-slate-800 p-4 rounded-2xl text-xs text-slate-400 flex items-center gap-2 max-w-xl">
                <Info size={16} className="text-blue-400 shrink-0" />
                This view orders tasks chronologically based on their next scheduled run or last update time.
              </div>
              
              <div className="relative border-l border-slate-800 ml-4 pl-6 space-y-6">
                {scheduledTasks.length === 0 ? (
                  <p className="text-sm text-slate-500 italic">No scheduled tasks found in this category.</p>
                ) : (
                  scheduledTasks.map(task => {
                    const nextRun = (task.metadata as TaskMeta)?.nextRunTime || (task.metadata as TaskMeta)?.nextRun || null;
                    const scheduleStr = task.schedule || (task.metadata as TaskMeta)?.schedule || 'No direct schedule';
                    return (
                      <div key={task.id} className="relative group">
                        {/* Timeline node */}
                        <div className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full bg-slate-850 border-2 border-slate-950 group-hover:bg-blue-500 transition-colors"></div>
                        
                        <div 
                          onClick={() => onTaskSelect(task)}
                          className="bg-slate-900 border border-slate-800 hover:border-blue-500/30 p-5 rounded-2xl max-w-3xl cursor-pointer shadow-xl transition-all hover:bg-slate-900/80"
                        >
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <h4 className="font-bold text-slate-200 text-base">{task.name}</h4>
                                <span className={`text-[8px] uppercase font-black px-1.5 py-0.5 rounded border ${platformBadgeClass(task.platform)}`}>
                                  {platformLabel(task.platform)}
                                </span>
                              </div>
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                                <span className="flex items-center gap-1"><Folder size={12} /> {task.category || 'Uncategorized'}</span>
                                <span className="flex items-center gap-1 font-mono text-blue-400/80"><Clock size={12} /> {scheduleStr}</span>
                              </div>
                            </div>
                            
                            <div className="flex items-center gap-4 shrink-0 justify-between md:justify-end border-t md:border-t-0 border-slate-800/50 pt-2 md:pt-0">
                              <div className="text-right">
                                <span className="text-[10px] text-slate-500 block uppercase font-bold tracking-wider">Next Run Time</span>
                                <span className="text-xs text-blue-400 font-mono font-bold">
                                  {nextRun ? new Date(nextRun).toLocaleString() : 'Not set / Manual'}
                                </span>
                              </div>
                              <div className="flex gap-1.5" onClick={e => e.stopPropagation()}>
                                <button 
                                  onClick={() => onClone(task)} 
                                  className="p-2 rounded bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-white border border-slate-800 transition-all active:scale-95"
                                  title="Clone Task"
                                >
                                  <CopyPlus size={14} />
                                </button>
                                <button 
                                  onClick={() => onRun(task)} 
                                  className="p-2 rounded bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-600/10 active:scale-95"
                                  title="Run Task"
                                >
                                  <Play size={14} fill="currentColor" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const TemplatesScreen = () => {
  const [applyTarget, setApplyTarget] = useState<Template | null>(null);
  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      if (DEMO_MODE) return DEMO_TEMPLATES;
      try {
        const response = await api.get('/templates');
        return response.data;
      } catch (err) {
        console.error('Failed to fetch templates:', err);
        return [];
      }
    },
    initialData: DEMO_MODE ? DEMO_TEMPLATES : undefined
  });

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-slate-500 font-medium">Loading templates...</p>
      </div>
    );
  }

  const hasTemplates = templates && templates.length > 0;

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold mb-1">Schedule Template Library</h2>
          <p className="text-slate-400">Prebuilt automation patterns for any platform.</p>
        </div>
      </div>

      {!hasTemplates ? (
        <div className="flex flex-col items-center justify-center h-[40vh] border-2 border-dashed border-slate-800 rounded-3xl p-10 text-center">
          <Library size={48} className="text-slate-700 mb-4" />
          <h3 className="text-xl font-bold text-slate-300">No templates found</h3>
          <p className="text-slate-500 max-w-sm mt-2">
            The template library is currently empty. Run <code className="bg-slate-900 px-2 py-1 rounded text-blue-400">npm run seed</code> in backend.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-20">
          {templates.map(template => (
            <div key={template.id} className="bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden flex flex-col shadow-2xl transition-all hover:border-blue-500/30 group">
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex flex-wrap gap-2">
                     {template.targetPlatforms.map(p => (
                       <span key={p} className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                         {platformLabel(p)}
                       </span>
                     ))}
                     {template.scriptType && (
                       <span className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">
                         {template.scriptType.replace(/_/g, ' ')}
                       </span>
                     )}
                  </div>
                  <div className="flex items-center gap-1 text-blue-400 bg-blue-600/10 px-2 py-0.5 rounded-full border border-blue-500/20 text-[10px] font-bold shrink-0">
                     <Activity size={10} /> {template.upvotes}
                  </div>
                </div>

                <h3 className="text-xl font-bold mb-2 group-hover:text-blue-400 transition-colors">{template.name}</h3>
                <p className="text-sm text-slate-400 mb-6 leading-relaxed">{template.description}</p>

                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-xs bg-slate-950 p-3 rounded-2xl border border-slate-800/50">
                     <Clock size={14} className="text-blue-500" />
                     <code className="text-blue-300 font-mono">{template.scheduleExpression}</code>
                     <span className="text-slate-500 italic ml-auto">UTC</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs bg-slate-950 p-3 rounded-2xl border border-slate-800/50">
                     <ExternalLink size={14} className="text-purple-500" />
                     <span className="truncate text-slate-300 italic">{template.command}</span>
                  </div>
                </div>
              </div>

              <button onClick={() => setApplyTarget(template)} className="w-full bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white py-4 font-bold flex items-center justify-center gap-2 transition-all border-t border-slate-800 group-hover:border-blue-500/20">
                Apply Template <ArrowRight size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {applyTarget && (
        <ApplyTemplateModal template={applyTarget} onClose={() => setApplyTarget(null)} />
      )}
    </div>
  );
};

const PlatformsScreen = () => {
  const [links, setLinks] = useState<PlatformLink[]>(() => {
    const saved = localStorage.getItem('taskhub_platform_links');
    if (saved) return JSON.parse(saved);
    return [
      { id: 'claude', name: 'Claude Routines', url: 'https://claude.ai/code/routines', iconType: 'claude' },
      { id: 'chatgpt', name: 'ChatGPT Schedules', url: 'https://chatgpt.com/schedules', iconType: 'chatgpt' },
      { id: 'gemini', name: 'Gemini Scheduled', url: 'https://gemini.google.com/scheduled', iconType: 'gemini' },
    ];
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const saveLinks = (newLinks: PlatformLink[]) => {
    setLinks(newLinks);
    localStorage.setItem('taskhub_platform_links', JSON.stringify(newLinks));
  };

  const addLink = () => {
    if (!newName || !newUrl) return;
    const newLink: PlatformLink = {
      id: Date.now().toString(),
      name: newName,
      url: newUrl.startsWith('http') ? newUrl : `https://${newUrl}`,
      iconType: 'custom'
    };
    saveLinks([...links, newLink]);
    setNewName('');
    setNewUrl('');
    setShowAdd(false);
  };

  const deleteLink = (id: string) => {
    saveLinks(links.filter(l => l.id !== id));
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500 pb-20">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold mb-1">Platform Schedulers</h2>
          <p className="text-slate-400">Quick access to 3rd party task management interfaces.</p>
        </div>
        <button 
          onClick={() => setShowAdd(!showAdd)}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 shadow-lg shadow-blue-600/20 transition-all active:scale-95"
        >
          <Plus size={16} /> Add Custom Link
        </button>
      </div>

      {showAdd && (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-2xl space-y-4 animate-in slide-in-from-top-2 max-w-4xl">
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">New Platform Link</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 ml-1">PLATFORM NAME</label>
              <input 
                type="text" 
                placeholder="e.g. N8N, OpenClaw"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-500"
                value={newName}
                onChange={e => setNewName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-500 ml-1">URL</label>
              <input 
                type="text" 
                placeholder="https://..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-blue-500"
                value={newUrl}
                onChange={e => setNewUrl(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-bold text-slate-400 hover:text-slate-200">Cancel</button>
            <button onClick={addLink} className="bg-blue-600 hover:bg-blue-500 px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-blue-600/20">Save Platform</button>
          </div>
        </div>
      )}

      <div className="space-y-10">
        {/* Default Platforms Section */}
        <section className="space-y-4">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">Official Schedulers</h3>
          <div className="flex flex-col gap-3 max-w-4xl">
            {links.filter(l => l.iconType !== 'custom').map(link => (
              <PlatformRow key={link.id} link={link} onDelete={deleteLink} />
            ))}
          </div>
        </section>

        {/* Custom Links Section */}
        {links.some(l => l.iconType === 'custom') && (
          <section className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em] ml-1">User Defined</h3>
            <div className="flex flex-col gap-3 max-w-4xl">
              {links.filter(l => l.iconType === 'custom').map(link => (
                <PlatformRow key={link.id} link={link} onDelete={deleteLink} />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

const PlatformRow = ({ link, onDelete }: { link: PlatformLink; onDelete: (id: string) => void }) => {
  const getIcon = (type: string) => {
    switch (type) {
      case 'claude': return <Bot size={20} />;
      case 'chatgpt': return <Cpu size={20} />;
      case 'gemini': return <Sparkles size={20} />;
      default: return <Globe size={20} />;
    }
  };

  return (
    <div className="relative group">
      <a 
        href={link.url} 
        target="_blank" 
        rel="noopener noreferrer"
        className="bg-slate-900 border border-slate-800 p-4 rounded-2xl flex items-center gap-6 hover:border-blue-500/50 hover:bg-slate-900/50 transition-all shadow-xl group/card"
      >
        <div className={`p-3 rounded-xl flex-shrink-0 ${
          link.iconType === 'claude' ? 'bg-purple-500/10 text-purple-400' : 
          link.iconType === 'chatgpt' ? 'bg-green-500/10 text-green-400' :
          link.iconType === 'gemini' ? 'bg-blue-500/10 text-blue-400' :
          'bg-slate-500/10 text-slate-400'
        }`}>
          {getIcon(link.iconType)}
        </div>
        
        <div className="flex-1 flex items-center justify-between min-w-0">
          <div className="min-w-0">
            <h3 className="font-bold text-lg text-slate-100 truncate group-hover/card:text-blue-400 transition-colors">{link.name}</h3>
            <p className="text-xs text-slate-500 truncate font-mono mt-0.5">{link.url}</p>
          </div>
          
          <div className="flex items-center gap-4 text-slate-600 group-hover/card:text-blue-500 transition-all">
            <span className="text-[10px] font-bold uppercase tracking-widest opacity-0 group-hover/card:opacity-100 transition-opacity">Open Dashboard</span>
            <ExternalLink size={18} />
          </div>
        </div>
      </a>
      
      {link.iconType === 'custom' && (
        <button 
          onClick={(e) => { e.preventDefault(); onDelete(link.id); }}
          className="absolute -right-3 top-1/2 -translate-y-1/2 p-2 bg-slate-950 border border-slate-800 rounded-full text-slate-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all shadow-lg z-10"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [cloningTask, setCloningTask] = useState<Task | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCreateNative, setShowCreateNative] = useState(false);
  const queryClient = useQueryClient();

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: async () => {
      if (DEMO_MODE) return DEMO_TASKS;
      const response = await api.get('/tasks');
      return response.data;
    },
    initialData: DEMO_MODE ? DEMO_TASKS : undefined
  });

  const runMutation = useMutation({
    mutationFn: async (task: Task) => {
      if (DEMO_MODE) return;
      if (!confirm(`Are you sure you want to run task "${task.name}"?`)) {
        throw new Error('Cancelled');
      }
      return api.post(`/tasks/${task.id}/run`);
    },
    onSuccess: () => {
      alert(DEMO_MODE ? 'Demo mode — Triggered!' : 'Task triggered successfully!');
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      if (err.message !== 'Cancelled') alert(`Error: ${err.response?.data?.error || err.message}`);
    }
  });

  const syncMutation = useMutation({
    mutationFn: async (categories: string[]) => {
      if (DEMO_MODE) return;
      
      // 1. Ensure we have an active connection for Windows
      await api.get('/tasks/health'); // This route is often used to probe/refresh connections, 
                                     // but let's be more explicit.
      
      return api.post('/tasks/sync', { categories });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowImport(false);
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      alert(`Sync Error: ${err.response?.data?.error || err.message}`);
    }
  });

  // Effect to ensure at least one connection exists for MVP (Windows)
  useEffect(() => {
    if (DEMO_MODE) return;
    const checkConnection = async () => {
      try {
        const res = await api.get('/tasks/health');
        if (res.data.length === 0) {
          console.log('No connections found. Creating default Windows connection...');
          // This is a bit of a hack for MVP, ideally we have a proper onboarding flow
          // but for now, we'll trigger a 'health' check which we'll update in backend 
          // to auto-create if missing for the placeholder user.
        }
      } catch (e) {
        console.error('Failed to check connections', e);
      }
    };
    checkConnection();
  }, []);

  const categoryMutation = useMutation({
    mutationFn: async ({ taskId, category }: { taskId: string; category: string }) => {
      if (DEMO_MODE) {
        queryClient.setQueryData(['tasks'], (prev: Task[] | undefined) => {
          if (!prev) return prev;
          return prev.map(t => t.id === taskId ? { ...t, category } : t);
        });
        return;
      }
      return api.patch(`/tasks/${taskId}`, { category });
    },
    onSuccess: () => {
      if (!DEMO_MODE) queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const handleCategoryUpdate = (taskId: string, category: string) => {
    categoryMutation.mutate({ taskId, category });
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-50 font-sans selection:bg-blue-500/30 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 p-10 overflow-y-auto">
        {activeTab === 'dashboard' && (
          <DashboardScreen 
            tasks={tasks} 
            isLoading={isLoading} 
            refetch={() => setShowImport(true)} 
            onTaskSelect={setSelectedTask} 
            onRun={runMutation.mutate}
            onCategoryUpdate={handleCategoryUpdate}
            onClone={setCloningTask}
            onShowHelp={() => setShowHelp(true)}
            onNewTask={() => setShowCreateNative(true)}
          />
        )}
        {activeTab === 'templates' && <TemplatesScreen />}
        {activeTab === 'platforms' && <PlatformsScreen />}
        {activeTab === 'settings' && <div className="flex items-center justify-center h-full text-slate-500 italic animate-pulse">Settings module coming soon in Sprint 2...</div>}
      </main>
      <TaskModal 
        task={selectedTask} 
        onClose={() => setSelectedTask(null)} 
        onRun={runMutation.mutate} 
        onCategoryUpdate={handleCategoryUpdate}
      />
      {cloningTask && (
        <CloneTaskModal 
          task={cloningTask} 
          onClose={() => setCloningTask(null)} 
        />
      )}
      {showHelp && (
        <HelpModal 
          onClose={() => setShowHelp(false)} 
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImport={syncMutation.mutate}
        />
      )}
      {showCreateNative && (
        <CreateTaskModal
          onClose={() => setShowCreateNative(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;
