import { useState, useMemo } from 'react';
import {
  Activity,
  LayoutDashboard,
  Settings,
  Play,
  RefreshCw,
  XCircle,
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
  Link as LinkIcon,
  Search
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

// --- API Client ---
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`
});

// --- Types ---
interface Task {
  id: string;
  name: string;
  category: string;
  platform: string;
  status: string;
  externalId: string;
  updatedAt: string;
  metadata?: any;
}

interface Template {
  id: string;
  name: string;
  description: string;
  sourcePlatform: string;
  targetPlatforms: string[];
  scheduleExpression: string;
  command: string;
  upvotes: number;
}

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
];

const DEMO_TEMPLATES: Template[] = [
  {
    id: 'tpl_daily_backup',
    name: 'Daily Database Backup',
    description: 'Backs up a PostgreSQL database every night at 3 AM.',
    sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
    targetPlatforms: ['WINDOWS_TASK_SCHEDULER', 'CLAUDE_CODE'],
    scheduleExpression: '0 3 * * *',
    command: 'pg_dump -U postgres my_db > backup.sql',
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
    upvotes: 89
  }
];

// --- Components ---

const Sidebar = ({ activeTab, setActiveTab }: { activeTab: string; setActiveTab: (tab: string) => void }) => (
  <aside className="w-64 border-r border-slate-800 flex flex-col gap-2 p-4">
    <div className="mb-8 px-2 flex items-center gap-2">
      <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-600/20">T</div>
      <h1 className="text-xl font-bold tracking-tight">TaskHub</h1>
    </div>

    <nav className="space-y-1">
      <button onClick={() => setActiveTab('dashboard')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}><LayoutDashboard size={18} /><span className="font-semibold text-sm">Dashboard</span></button>
      <button onClick={() => setActiveTab('templates')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'templates' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}><Library size={18} /><span className="font-semibold text-sm">Templates</span></button>
      <button onClick={() => setActiveTab('platforms')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'platforms' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}><Cpu size={18} /><span className="font-semibold text-sm">Platforms</span></button>
      <button onClick={() => setActiveTab('settings')} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}><Settings size={18} /><span className="font-semibold text-sm">Settings</span></button>
    </nav>

    <div className="mt-auto p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-500 mb-3"><Activity size={10} className="text-green-500" /> System Status</div>
      <div className="space-y-3">
        <div className="flex justify-between items-center text-xs"><span className="text-slate-400 italic">Windows Agent</span><span className="text-green-500 font-bold">Online</span></div>
        <div className="flex justify-between items-center text-xs"><span className="text-slate-400 italic">Claude API</span><span className="text-green-500 font-bold">Healthy</span></div>
      </div>
    </div>
  </aside>
);

const TaskModal = ({ task, onClose, onRun, onCategoryUpdate }: { task: Task | null; onClose: () => void; onRun: (task: Task) => void; onCategoryUpdate: (taskId: string, category: string) => void }) => {
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState(task?.category || '');

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        <header className="p-6 border-b border-slate-800 flex justify-between items-start">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/30">{task.platform}</span>
              <h2 className="text-2xl font-bold">{task.name}</h2>
            </div>
            <code className="text-xs text-slate-500 bg-slate-950 px-2 py-1 rounded">{task.externalId}</code>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 transition-colors"><XCircle size={24} /></button>
        </header>
        <div className="p-6 overflow-y-auto space-y-8 flex-1 text-slate-300">
           <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800"><span className="text-xs text-slate-500 block mb-1">Status</span><span className="font-semibold text-blue-400 uppercase tracking-tighter text-sm">{task.status}</span></div>
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800"><span className="text-xs text-slate-500 block mb-1">Last Updated</span><span className="font-semibold text-sm">{new Date(task.updatedAt).toLocaleString()}</span></div>
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
              <pre className="text-[10px] bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto font-mono text-blue-400/80">{JSON.stringify(task.metadata, null, 2)}</pre>
           </div>
        </div>
        <footer className="p-6 bg-slate-950 border-t border-slate-800 flex gap-4">
          <button className="flex-1 bg-slate-800 hover:bg-slate-700 py-3 rounded-xl font-bold transition-all border border-slate-700 active:scale-95 text-sm">Edit Schedule</button>
          <button onClick={() => { onRun(task); onClose(); }} className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95 text-sm"><Play size={16} fill="currentColor" /> Run Now</button>
        </footer>
      </div>
    </div>
  );
};

const TaskCard = ({ task, onSelect, onRun, onCategoryUpdate }: { task: Task; onSelect: (task: Task) => void; onRun: (task: Task) => void; onCategoryUpdate: (taskId: string, category: string) => void }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [tempCat, setTempCat] = useState(task.category || 'Uncategorized');

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-blue-500/50 cursor-pointer transition-all shadow-xl group hover:-translate-y-1 active:scale-[0.98]" onClick={() => !isEditing && onSelect(task)}>
      <div className="flex justify-between items-start mb-4">
        <div className="flex flex-col gap-1">
          <span className={`text-[10px] w-fit uppercase font-black px-2.5 py-1 rounded-lg border ${task.platform === 'WINDOWS_TASK_SCHEDULER' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}`}>{task.platform === 'WINDOWS_TASK_SCHEDULER' ? 'Windows' : 'Claude'}</span>
          
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
        <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800"><div className={`h-2 w-2 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-600'}`}></div><span className="text-[10px] font-bold text-slate-400">{task.status}</span></div>
      </div>
      <h3 className="font-bold text-lg mb-1 truncate">{task.name}</h3>
      <p className="text-xs text-slate-500 mb-6 italic truncate">{task.externalId}</p>
      <div className="flex items-center justify-between border-t border-slate-800 pt-4">
        <div className="text-[10px] text-slate-400">Last updated: <span className="text-slate-200">{new Date(task.updatedAt).toLocaleTimeString()}</span></div>
        <div className="flex gap-2"><button onClick={(e) => { e.stopPropagation(); onRun(task); }} className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg text-white shadow-lg shadow-blue-600/20 transition-all active:scale-90"><Play size={18} fill="currentColor" /></button></div>
      </div>
    </div>
  );
};

const DashboardScreen = ({ onTaskSelect, onRun, tasks, isLoading, refetch, onCategoryUpdate }: { onTaskSelect: (task: Task) => void; onRun: (task: Task) => void, tasks: Task[] | undefined, isLoading: boolean, refetch: () => void, onCategoryUpdate: (taskId: string, category: string) => void }) => {
  const [selectedCategory, setSelectedTaskCategory] = useState<string>('All');
  const [showDisabled, setShowDisabled] = useState(false);

  const categories = useMemo(() => {
    if (!tasks) return ['All'];
    const unique = Array.from(new Set(tasks.map(t => t.category || 'Uncategorized')));
    return ['All', ...unique.sort()];
  }, [tasks]);

  const filteredTasks = useMemo(() => {
    if (!tasks) return [];
    
    // First apply the active/disabled filter
    let result = showDisabled ? tasks : tasks.filter(t => t.status === 'ACTIVE');
    
    // Then apply category filter
    if (selectedCategory !== 'All') {
      result = result.filter(t => (t.category || 'Uncategorized') === selectedCategory);
    }
    
    return result;
  }, [tasks, selectedCategory, showDisabled]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-slate-500 font-medium animate-pulse">Fetching live tasks from agent...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {DEMO_MODE && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-500/30 bg-blue-600/10 p-4 text-sm">
          <Info size={18} className="mt-0.5 flex-shrink-0 text-blue-400" />
          <p className="text-slate-300"><span className="font-semibold text-blue-300">Demo data.</span> You're viewing a live demo. <a href="https://github.com/michaelschecht/taskhub" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline underline-offset-2 hover:text-blue-300">Run it locally</a> with the backend.</p>
        </div>
      )}
      
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold mb-1">Unified Task Dashboard</h2>
          <p className="text-slate-400">Manage {tasks?.length || 0} tasks across your ecosystem.</p>
        </div>
        <div className="flex gap-3">
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
          <button onClick={() => refetch()} className="bg-slate-900 border border-slate-800 hover:border-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-xl active:scale-95">
            <RefreshCw size={16} /> Sync All
          </button>
        </div>
      </div>

      {/* Category Tabs - Now with flex-wrap and better spacing */}
      <div className="flex flex-wrap items-center gap-2 pb-4 border-b border-slate-900">
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
            />
          ))
        )}
      </div>
    </div>
  );
};

const TemplatesScreen = () => {
  const { data: templates, isLoading } = useQuery<Template[]>({
    queryKey: ['templates'],
    queryFn: async () => {
      if (DEMO_MODE) return DEMO_TASKS as any; // Fallback for type safety
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
                  <div className="flex gap-2">
                     {template.targetPlatforms.map(p => (
                       <span key={p} className="text-[9px] uppercase font-black px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                         {p.split('_')[0]}
                       </span>
                     ))}
                  </div>
                  <div className="flex items-center gap-1 text-blue-400 bg-blue-600/10 px-2 py-0.5 rounded-full border border-blue-500/20 text-[10px] font-bold">
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

              <button className="w-full bg-slate-800 hover:bg-blue-600 text-slate-200 hover:text-white py-4 font-bold flex items-center justify-center gap-2 transition-all border-t border-slate-800 group-hover:border-blue-500/20">
                Apply Template <ArrowRight size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

interface PlatformLink {
  id: string;
  name: string;
  url: string;
  iconType: 'claude' | 'chatgpt' | 'gemini' | 'custom';
}

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

  const getIcon = (type: string) => {
    switch (type) {
      case 'claude': return <Bot size={20} />;
      case 'chatgpt': return <Cpu size={20} />;
      case 'gemini': return <Sparkles size={20} />;
      default: return <Globe size={20} />;
    }
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
  const queryClient = useQueryClient();

  const { data: tasks, isLoading, refetch } = useQuery<Task[]>({
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
    onError: (error: any) => {
      if (error.message !== 'Cancelled') alert(`Error: ${error.response?.data?.error || error.message}`);
    }
  });

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
    <div className="flex min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-blue-500/30 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 p-10 overflow-y-auto">
        {activeTab === 'dashboard' && (
          <DashboardScreen 
            tasks={tasks} 
            isLoading={isLoading} 
            refetch={refetch} 
            onTaskSelect={setSelectedTask} 
            onRun={runMutation.mutate}
            onCategoryUpdate={handleCategoryUpdate}
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
    </div>
  );
};

export default Dashboard;
