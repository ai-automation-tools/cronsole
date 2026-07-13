import { useState, useEffect } from 'react';
import { Sparkles, X, Menu } from 'lucide-react';
import { CloneTaskModal } from './components/CloneTaskModal';
import { HelpModal } from './components/HelpModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task } from './types';
import { Sidebar } from './components/Sidebar';
import { TaskModal } from './components/TaskModal';
import { ImportModal } from './components/ImportModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { SettingsScreen } from './components/SettingsScreen';
import { PlatformsScreen } from './screens/PlatformsScreen';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { useSettings } from './hooks/useSettings';
import { useToast } from './hooks/useToast';
import { useConfirm } from './hooks/useConfirm';
import { useNavigate, useLocation } from 'react-router-dom';
import { useLiveTaskUpdates } from './hooks/useLiveTaskUpdates';



const Dashboard = () => {
  // Section + open task detail come from the URL (bookmarkable, back/forward):
  //   /                → dashboard      /templates → templates
  //   /platforms       → platforms      /settings  → settings
  //   /tasks/:id       → dashboard with the task detail modal open
  const navigate = useNavigate();
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);
  const section = segments[0] ?? '';
  const activeTab = ['templates', 'platforms', 'settings'].includes(section) ? section : 'dashboard';
  const setActiveTab = (tab: string) => navigate(tab === 'dashboard' ? '/' : `/${tab}`);
  const routeTaskId = section === 'tasks' ? segments[1] : undefined;

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [cloningTask, setCloningTask] = useState<Task | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCreateNative, setShowCreateNative] = useState(false);
  const queryClient = useQueryClient();
  const { settings, update } = useSettings();
  const { toast } = useToast();
  const confirm = useConfirm();

  // Push-based live updates: refresh the task list when the backend signals a
  // change (agent sync, scheduled run, another tab), instead of only polling.
  useLiveTaskUpdates();

  // Raise an OS notification for a task failure when the user has opted in.
  const notifyFailure = (title: string, body: string) => {
    if (settings.desktopNotifyOnFailure && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  };

  const { data: tasks, isLoading } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: async () => {
      const response = await api.get('/tasks');
      return response.data;
    }
  });

  const runMutation = useMutation({
    mutationFn: async (task: Task) => {
      if (settings.confirmBeforeRun) {
        const ok = await confirm({
          title: 'Run task now?',
          message: `Run "${task.name}" immediately?`,
          confirmText: 'Run'
        });
        if (!ok) throw new Error('Cancelled');
      }
      await api.post(`/tasks/${task.id}/run`);
      return { task };
    },
    onSuccess: ({ task }) => {
      if (settings.toastOnSuccess) {
        toast(`"${task.name}" triggered successfully.`, 'success');
      }
    },
    onError: (error: unknown, task) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      if (err.message === 'Cancelled') return;
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Failed to run "${task.name}": ${detail}`, 'error');
      notifyFailure('TaskHub — run failed', `${task.name}: ${detail}`);
    }
  });

  const syncMutation = useMutation({
    mutationFn: async (categories: string[]) => {
      // 1. Ensure we have an active connection for Windows
      await api.get('/tasks/health'); // This route is often used to probe/refresh connections, 
                                     // but let's be more explicit.
      
      return api.post('/tasks/sync', { categories });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setShowImport(false);
      if (settings.toastOnSuccess) toast('Tasks synced.', 'success');
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Sync error: ${detail}`, 'error');
      notifyFailure('TaskHub — sync failed', detail);
    }
  });

  // Effect to ensure at least one connection exists for MVP (Windows)
  useEffect(() => {
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
      return api.patch(`/tasks/${taskId}`, { category });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    }
  });

  const handleCategoryUpdate = (taskId: string, category: string) => {
    categoryMutation.mutate({ taskId, category });
  };

  return (
    <div className="flex h-screen bg-background text-foreground font-sans selection:bg-primary/30 overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="flex-1 p-4 md:p-10 overflow-y-auto">
        {/* Mobile top bar — the drawer toggle (the sidebar is off-canvas below md). */}
        <div className="flex items-center gap-3 mb-6 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg border border-border text-foreground hover:bg-surface transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 bg-primary rounded-lg flex items-center justify-center font-bold text-primary-foreground text-sm">T</div>
            <span className="font-bold">TaskHub</span>
          </div>
        </div>
        {!settings.onboardingSeen && (
          <div className="mb-6 flex items-center gap-4 flex-wrap bg-primary/10 border border-primary/30 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-500">
            <Sparkles size={20} className="text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">New to TaskHub?</p>
              <p className="text-xs text-muted-foreground">Take the 4-step getting-started tour — connect the agent, import tasks, and use templates.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => { setShowHelp(true); update('onboardingSeen', true); }}
                className="bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
              >
                Take the tour
              </button>
              <button
                onClick={() => update('onboardingSeen', true)}
                title="Dismiss"
                className="p-2 rounded-lg text-subtle-foreground hover:text-foreground hover:bg-background transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        {activeTab === 'dashboard' && (
          <DashboardScreen
            tasks={tasks}
            isLoading={isLoading}
            onImport={() => setShowImport(true)}
            onSyncNow={() => {
              const cats = Array.from(new Set((tasks ?? []).map(t => t.category || 'Uncategorized')));
              syncMutation.mutate(cats);
            }}
            isSyncing={syncMutation.isPending}
            onTaskSelect={(t) => navigate(`/tasks/${t.id}`)}
            onRun={runMutation.mutate}
            onCategoryUpdate={handleCategoryUpdate}
            onClone={setCloningTask}
            onShowHelp={() => setShowHelp(true)}
            onNewTask={() => setShowCreateNative(true)}
            settings={settings}
          />
        )}
        {activeTab === 'templates' && <TemplatesScreen />}
        {activeTab === 'platforms' && <PlatformsScreen />}
        {activeTab === 'settings' && <SettingsScreen tasks={tasks} />}
      </main>
      <TaskModal
        task={routeTaskId ? (tasks || []).find(t => t.id === routeTaskId) ?? null : null}
        onClose={() => navigate('/')}
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
