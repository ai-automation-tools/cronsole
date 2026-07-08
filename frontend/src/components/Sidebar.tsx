import {
  Activity,
  LayoutDashboard,
  Settings,
  Cpu,
  Library
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { platformLabel } from '../platform';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Sidebar = ({ activeTab, setActiveTab }: SidebarProps) => {
  const { data: connections, isLoading } = useConnections();

  return (
  <aside className="w-64 border-r border-border flex flex-col gap-2 p-4">
    <div className="mb-8 px-2 flex items-center gap-2">
      <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center font-bold text-primary-foreground shadow-lg shadow-primary/20">T</div>
      <h1 className="text-xl font-bold tracking-tight">TaskHub</h1>
    </div>

    <nav className="space-y-1">
      <button 
        onClick={() => setActiveTab('dashboard')} 
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
      >
        <LayoutDashboard size={18} />
        <span className="font-semibold text-sm">Dashboard</span>
      </button>
      <button 
        onClick={() => setActiveTab('templates')} 
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'templates' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
      >
        <Library size={18} />
        <span className="font-semibold text-sm">Templates</span>
      </button>
      <button 
        onClick={() => setActiveTab('platforms')} 
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'platforms' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
      >
        <Cpu size={18} />
        <span className="font-semibold text-sm">Platforms</span>
      </button>
      <button 
        onClick={() => setActiveTab('settings')} 
        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === 'settings' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
      >
        <Settings size={18} />
        <span className="font-semibold text-sm">Settings</span>
      </button>
    </nav>

    <div className="mt-auto space-y-3">
    <div>
      <div className="px-2 mb-2 text-[10px] uppercase font-bold text-subtle-foreground">Appearance</div>
      <ThemeToggle />
    </div>

    <div className="p-4 bg-surface/40 rounded-2xl border border-border/50">
      <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-subtle-foreground mb-3">
        <Activity size={10} className="text-green-500" /> System Status
      </div>
      <div className="space-y-3">
        {isLoading ? (
          <div className="text-xs text-subtle-foreground italic">Checking…</div>
        ) : !connections || connections.length === 0 ? (
          <div className="text-xs text-subtle-foreground italic">No connections</div>
        ) : (
          connections.map(conn => {
            const meta = healthMeta(conn.state);
            return (
              <div key={conn.platform} className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground italic">{platformLabel(conn.platform)}</span>
                <span className={`font-bold flex items-center gap-1.5 ${meta.text}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                  {meta.label}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
    </div>
  </aside>
  );
};
