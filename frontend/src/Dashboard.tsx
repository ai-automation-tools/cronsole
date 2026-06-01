import React, { useState } from 'react';
import { 
  Activity, 
  LayoutDashboard, 
  Settings, 
  Plus, 
  Play, 
  FileText, 
  ExternalLink, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Clock,
  Shield,
  Monitor,
  Cpu,
  Library,
  ArrowRightLeft,
  Search,
  ChevronRight,
  Zap,
  Copy,
  Loader2
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

// --- API Client ---
const api = axios.create({
  baseURL: 'http://localhost:3000/api'
});

// --- Mock Data (Fallbacks) ---
const MOCK_PLATFORMS = [
  { id: 'p1', name: 'Windows', type: 'WINDOWS_TASK_SCHEDULER', status: 'Online', machine: 'MIKE-DESKTOP', version: '1.0.4' },
  { id: 'p2', name: 'Claude', type: 'CLAUDE_CODE', status: 'Connected', api_usage: '2.4k tokens' },
  { id: 'p3', name: 'ChatGPT', type: 'CHATGPT', status: 'Quick Links Only' },
];

// --- Components ---

const Sidebar = ({ activeTab, setActiveTab }) => (
  <aside className="w-64 border-r border-slate-800 flex flex-col gap-2 p-4">
    <div className="mb-8 px-2 flex items-center gap-2">
      <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center font-bold text-white shadow-lg shadow-blue-600/20">T</div>
      <h1 className="text-xl font-bold tracking-tight">TaskHub</h1>
    </div>
    
    <nav className="space-y-1">
      <button 
        onClick={() => setActiveTab('dashboard')}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}
      >
        <LayoutDashboard size={18} />
        <span className="font-semibold text-sm">Dashboard</span>
      </button>
      
      <button 
        onClick={() => setActiveTab('templates')}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'templates' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}
      >
        <Library size={18} />
        <span className="font-semibold text-sm">Templates</span>
      </button>

      <button 
        onClick={() => setActiveTab('platforms')}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'platforms' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}
      >
        <Cpu size={18} />
        <span className="font-semibold text-sm">Platforms</span>
      </button>
      
      <button 
        onClick={() => setActiveTab('settings')}
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-blue-600/10 text-blue-400' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'}`}
      >
        <Settings size={18} />
        <span className="font-semibold text-sm">Settings</span>
      </button>
    </nav>

    <div className="mt-auto p-4 bg-slate-900/40 rounded-2xl border border-slate-800/50">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-slate-500 mb-3">
        <Activity size={10} className="text-green-500" /> System Status
      </div>
      <div className="space-y-3">
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 italic">Windows Agent</span>
          <span className="text-green-500 font-bold">Online</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="text-slate-400 italic">Claude API</span>
          <span className="text-green-500 font-bold">Healthy</span>
        </div>
      </div>
    </div>
  </aside>
);

const TaskModal = ({ task, onClose, onRun }) => {
  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh] animate-in slide-in-from-bottom-4 duration-300">
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
            onClick={() => { onRun(task.id); onClose(); }}
            className="flex-1 bg-blue-600 hover:bg-blue-500 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 active:scale-95 text-sm"
          >
            <Play size={16} fill="currentColor" /> Run Now
          </button>
        </footer>
      </div>
    </div>
  );
};

const DashboardScreen = ({ onTaskSelect, onRun }) => {
  const { data: tasks, isLoading, refetch } = useQuery({
    queryKey: ['tasks'],
    queryFn: async () => {
      const response = await api.get('/tasks');
      return response.data;
    }
  });

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
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold mb-1">Unified Task Dashboard</h2>
          <p className="text-slate-400">Showing {tasks?.length || 0} tasks from your environment</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => refetch()}
            className="bg-slate-900 border border-slate-800 hover:border-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 shadow-xl active:scale-95"
          >
            <RefreshCw size={16} /> Sync All
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-20">
        {tasks?.map(task => (
          <div 
            key={task.id} 
            onClick={() => onTaskSelect(task)}
            className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-blue-500/50 cursor-pointer transition-all shadow-xl group hover:-translate-y-1 active:scale-[0.98]"
          >
            <div className="flex justify-between items-start mb-4">
              <span className={`text-[10px] uppercase font-black px-2.5 py-1 rounded-lg border ${
                task.platform === 'WINDOWS_TASK_SCHEDULER' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
              }`}>
                {task.platform === 'WINDOWS_TASK_SCHEDULER' ? 'Windows' : 'Claude'}
              </span>
              <div className="flex items-center gap-1.5 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800">
                <div className={`h-2 w-2 rounded-full ${task.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-600'}`}></div>
                <span className="text-[10px] font-bold text-slate-400">{task.status}</span>
              </div>
            </div>
            
            <h3 className="font-bold text-lg mb-1 truncate">{task.name}</h3>
            <p className="text-xs text-slate-500 mb-6 italic truncate">
               {task.externalId}
            </p>
            
            <div className="flex items-center justify-between border-t border-slate-800 pt-4">
              <div className="text-[10px] text-slate-400">
                Last updated: <span className="text-slate-200">{new Date(task.updatedAt).toLocaleTimeString()}</span>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); onRun(task.id); }}
                  className="bg-blue-600 hover:bg-blue-500 p-2 rounded-lg text-white shadow-lg shadow-blue-600/20 transition-all active:scale-90"
                >
                  <Play size={18} fill="currentColor" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedTask, setSelectedTask] = useState(null);

  const runMutation = useMutation({
    mutationFn: (taskId) => api.post(`/tasks/${taskId}/run`),
    onSuccess: () => {
      alert('Task triggered successfully!');
    }
  });

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-50 font-sans selection:bg-blue-500/30 overflow-hidden">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <main className="flex-1 p-10 overflow-y-auto">
        {activeTab === 'dashboard' && <DashboardScreen onTaskSelect={setSelectedTask} onRun={runMutation.mutate} />}
        {activeTab === 'templates' && <div className="text-slate-500 italic">Template module coming next...</div>}
        {activeTab === 'platforms' && <div className="text-slate-500 italic">Platform management coming next...</div>}
        {activeTab === 'settings' && (
           <div className="flex items-center justify-center h-full text-slate-500 italic animate-pulse">
             Settings module coming soon in Sprint 2...
           </div>
        )}
      </main>

      <TaskModal 
        task={selectedTask} 
        onClose={() => setSelectedTask(null)} 
        onRun={runMutation.mutate} 
      />
    </div>
  );
};

export default Dashboard;
