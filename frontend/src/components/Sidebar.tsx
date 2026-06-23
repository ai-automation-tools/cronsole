import {
  Activity,
  LayoutDashboard,
  Settings,
  Cpu,
  Library
} from 'lucide-react';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar = ({ activeTab, setActiveTab }: SidebarProps) => (
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
