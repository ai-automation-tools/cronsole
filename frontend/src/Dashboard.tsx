import { useState } from 'react';
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
  Info
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';

// --- API Client ---
const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`
});

// --- Types ---
interface Task {
  id: string;
  name: string;
  platform: string;
  status: string;
  externalId: string;
  updatedAt: string;
  metadata?: any;
}

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

const DEMO_TASKS: Task[] = [
  {
    id: 'demo-1',
    name: 'Edge-Radar Daily Calibration',
    platform: 'WINDOWS_TASK_SCHEDULER',
    status: 'ACTIVE',
    externalId: '\\Mikes\\EdgeRadar\\DailyCalibration',
    updatedAt: '2026-06-01T09:00:00Z',
    metadata: { schedule: '0 9 * * *', state: 'Ready', machine: 'MIKE-DESKTOP' },
  },
  {
    id: 'demo-2',
    name: 'Morning News Digest',
    platform: 'CLAUDE_CODE',
    status: 'ACTIVE',
    externalId: 'routine_news_digest_0700',
    updatedAt: '2026-06-01T07:00:00Z',
    metadata: { schedule: '0 7 * * *', model: 'claude-opus-4-8' },
  },
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

const TaskModal = ({ task, onClose, onRun }: { task: Task | null; onClose: () => void; onRun: (task: Task) => void }) => {
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

const DashboardScreen = ({ onTaskSelect, onRun, tasks, isLoading, refetch }: { onTaskSelect: (task: Task) => void; onRun: (task: Task) => void, tasks: Task[] | undefined, isLoading: boolean, refetch: () => void }) => {
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
        <div><h2 className="text-2xl font-bold mb-1">Unified Task Dashboard</h2><p className="text-slate-400">Showing {tasks?.length || 0} {DEMO_MODE ? 'sample tasks' : 'tasks from your environment'}</p></div>
        <div className="flex gap-3"><button onClick={() => refetch()} className="bg-slate-900 border border-slate-800 hover:border-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-xl active:scale-95"><RefreshCw size={16} /> Sync All</button></div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
        {tasks?.map(task => (
          <div key={task.id} onClick={() => onTaskSelect(task)} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-blue-500/50 cursor-pointer transition-all shadow-xl group hover:-translate-y-1 active:scale-[0.98]">
            <div className="flex justify-between items-start mb-4">
              <span className={`text-[10px] uppercase font-black px-2.5 py-1 rounded-lg border ${task.platform === 'WINDOWS_TASK_SCHEDULER' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'}`}>{task.platform === 'WINDOWS_TASK_SCHEDULER' ? 'Windows' : 'Claude'}</span>
              <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800"><div className={`h-2 w-2 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-600'}`}></div><span className="text-[10px] font-bold text-slate-400">{task.status}</span></div>
            </div>
            <h3 className="font-bold text-lg mb-1 truncate">{task.name}</h3>
            <p className="text-xs text-slate-500 mb-6 italic truncate">{task.externalId}</p>
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <div className="text-[10px] text-slate-400">Last updated: <span className="text-slate-200">{new Date(task.updatedAt).toLocaleTimeString()}</span></div>
              <div className="flex gap-2"><button onClick={(e) => { e.stopPropagation(); onRun(task); }} className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg text-white shadow-lg shadow-blue-600/20 transition-all active:scale-90"><Play size={18} fill="currentColor" /></button></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

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

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-blue-500/30 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <main className="flex-1 p-10 overflow-y-auto">
        {activeTab === 'dashboard' && <DashboardScreen tasks={tasks} isLoading={isLoading} refetch={refetch} onTaskSelect={setSelectedTask} onRun={runMutation.mutate} />}
        {activeTab === 'templates' && <div className="text-slate-500 italic">Template module coming next...</div>}
        {activeTab === 'platforms' && <div className="text-slate-500 italic">Platform management coming next...</div>}
        {activeTab === 'settings' && <div className="flex items-center justify-center h-full text-slate-500 italic animate-pulse">Settings module coming soon in Sprint 2...</div>}
      </main>
      <TaskModal task={selectedTask} onClose={() => setSelectedTask(null)} onRun={runMutation.mutate} />
    </div>
  );
};

export default Dashboard;
