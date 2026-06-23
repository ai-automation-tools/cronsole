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
  Trash2
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, Template, PlatformLink } from './types';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { ImportModal } from './components/ImportModal';
import { TaskCard } from './components/TaskCard';
import { ApplyTemplateModal } from './components/ApplyTemplateModal';

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

  const isEmpty = !tasks || tasks.length === 0;

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
          {!isEmpty && (
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
          {/* Category Tabs */}
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
  const [showImport, setShowImport] = useState(false);
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
      {showImport && (
        <ImportModal 
          onClose={() => setShowImport(false)} 
          onImport={syncMutation.mutate} 
        />
      )}
    </div>
  );
};

export default Dashboard;
