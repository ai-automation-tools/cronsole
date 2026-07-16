import { useEffect } from 'react';
import {
  Activity,
  LayoutDashboard,
  Settings,
  Cpu,
  Library,
  LogOut,
  X
} from 'lucide-react';
import { ThemeToggle } from './ThemeToggle';
import { useConnections, healthMeta } from '../hooks/useConnections';
import { useAuth } from '../hooks/useAuth';
import { platformLabel } from '../platform';

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  /**
   * Mobile drawer open state. Ignored at `md` and up, where the sidebar is a
   * static column; below `md` the sidebar is an off-canvas drawer.
   */
  open?: boolean;
  onClose?: () => void;
}

const NAV = [
  { id: 'dashboard', label: 'Dashboard', Icon: LayoutDashboard },
  { id: 'templates', label: 'Templates', Icon: Library },
  { id: 'platforms', label: 'Platforms', Icon: Cpu },
  { id: 'settings', label: 'Settings', Icon: Settings }
] as const;

export const Sidebar = ({ activeTab, setActiveTab, open = false, onClose }: SidebarProps) => {
  const { data: connections, isLoading } = useConnections();
  const { user, logout } = useAuth();

  // Escape closes the mobile drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Choosing a tab also closes the drawer (a no-op on desktop).
  const selectTab = (tab: string) => {
    setActiveTab(tab);
    onClose?.();
  };

  return (
    <>
      {/* Mobile backdrop — sits below modals (z-50+) and above page content. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={`fixed md:static inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-border bg-background flex flex-col gap-2 p-4 transition-transform duration-200 md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="mb-8 px-2 flex items-center gap-2">
          <div className="h-8 w-8 bg-primary rounded-lg flex items-center justify-center font-bold text-primary-foreground shadow-lg shadow-primary/20">T</div>
          <h1 className="text-xl font-bold tracking-tight">TaskHub</h1>
          <button
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-subtle-foreground hover:text-foreground hover:bg-surface transition-colors md:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="space-y-1">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => selectTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${activeTab === id ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-surface hover:text-foreground'}`}
            >
              <Icon size={18} />
              <span className="font-semibold text-sm">{label}</span>
            </button>
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <div>
            <div className="px-2 mb-2 text-[10px] uppercase font-bold text-subtle-foreground">Appearance</div>
            <ThemeToggle />
          </div>

          <div className="flex items-center gap-2 px-2">
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase font-bold text-subtle-foreground">Signed in</div>
              <div className="text-xs text-muted-foreground truncate" title={user?.email ?? undefined}>
                {user?.email ?? 'this device'}
              </div>
            </div>
            <button
              onClick={logout}
              className="p-2 rounded-lg text-subtle-foreground hover:text-foreground hover:bg-surface transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
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
    </>
  );
};
