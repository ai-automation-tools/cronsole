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
import { ToolsScreen } from './screens/ToolsScreen';
import { useSettings } from './hooks/useSettings';
import { useToast } from './hooks/useToast';
import { useConfirm } from './hooks/useConfirm';
import { useNavigate, useLocation } from 'react-router';
import { useLiveTaskUpdates } from './hooks/useLiveTaskUpdates';
import { describeUntracked, type SyncResponse } from './utils/syncSummary';



const Dashboard = () => {
  // Section + open task detail come from the URL (bookmarkable, back/forward):
  //   /                → dashboard      /templates → templates
  //   /platforms       → platforms      /settings  → settings
  //   /tools           → tools
  //   /tasks/:id       → dashboard with the task detail modal open
  const navigate = useNavigate();
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);
  const section = segments[0] ?? '';
  const activeTab = ['templates', 'platforms', 'tools', 'settings'].includes(section) ? section : 'dashboard';
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
      notifyFailure('Cronsole — run failed', `${task.name}: ${detail}`);
    }
  });

  // Enable/disable a task. Wired here (not in each card) so every dashboard view
  // — grid, list, kanban, schedule — shares one mutation and one pending state.
  // For Windows tasks this drives the agent's task:set_status; native tasks are
  // toggled by the connector directly.
  const statusMutation = useMutation({
    mutationFn: async (task: Task) => {
      const nextStatus = task.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
      const res = await api.patch(`/tasks/${task.id}/status`, { status: nextStatus });
      return { task, status: (res.data?.status ?? nextStatus) as string };
    },
    onSuccess: ({ task, status }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (settings.toastOnSuccess) toast(`"${task.name}" is now ${status.toLowerCase()}.`, 'success');
    },
    onError: (error: unknown, task) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Couldn't update "${task.name}": ${detail}`, 'error');
    }
  });

  // Clear every task the last sync found absent from its platform. Bulk because
  // the mess arrives in bulk — deleting a Task Scheduler folder flags all of its
  // tasks MISSING at once, and clearing them one modal at a time doesn't scale.
  // Safe without a per-task platform round-trip: MISSING means the platform
  // already reported them gone, so there's nothing left to delete out there.
  const clearMissingMutation = useMutation({
    mutationFn: async (count: number) => {
      const ok = await confirm({
        title: `Clear ${count} missing task${count === 1 ? '' : 's'}?`,
        message:
          `These are tracked in Cronsole but were not found on their platform at the last sync — ` +
          `usually because you deleted them natively. This removes Cronsole's records and their run ` +
          `history. Nothing on your machine is touched. If one still exists, the next sync re-imports it.`,
        confirmText: `Clear ${count}`,
        tone: 'danger'
      });
      if (!ok) throw new Error('Cancelled');
      const res = await api.delete('/tasks/missing');
      return res.data as { deleted: number };
    },
    onSuccess: ({ deleted }) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (settings.toastOnSuccess) {
        toast(`Cleared ${deleted} missing task${deleted === 1 ? '' : 's'}.`, 'success');
      }
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      if (err.message === 'Cancelled') return;
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Couldn't clear missing tasks: ${detail}`, 'error');
    }
  });

  /**
   * Enable or disable a whole selection in one request.
   *
   * Goes through `POST /api/tools/tasks/status` rather than N calls to the
   * per-task route: cross-task routes live on `/api/tools` (CLAUDE.md §9), and
   * more importantly the server is the only place that can report a partially
   * successful batch coherently — an ACL'd task refuses, a MISSING one is
   * refused before the platform is asked, and if the agent disappears the run
   * stops instead of collecting the same error fifty times.
   *
   * Returns the ids that actually changed so the caller can prune exactly those
   * from its selection, leaving failures selected for a retry.
   */
  const bulkStatusMutation = useMutation({
    mutationFn: async ({ tasks: selected, status }: { tasks: Task[]; status: 'ACTIVE' | 'DISABLED' }) => {
      const verb = status === 'ACTIVE' ? 'Enable' : 'Disable';
      // Only the tasks the request will actually change are worth confirming —
      // and naming that number rather than the selection size keeps the dialog
      // honest about the blast radius.
      const changing = selected.filter(t => t.status !== status && t.status !== 'MISSING');
      const ok = await confirm({
        title: `${verb} ${changing.length} task${changing.length === 1 ? '' : 's'}?`,
        message:
          status === 'ACTIVE'
            ? `${changing.length} of the ${selected.length} selected task${selected.length === 1 ? ' is' : 's are'} disabled and will start running on their schedules again. Each Windows task is applied through the local agent.`
            : `${changing.length} of the ${selected.length} selected task${selected.length === 1 ? ' is' : 's are'} active and will stop running on their schedules. Nothing is deleted — re-enable them any time.`,
        confirmText: `${verb} ${changing.length}`
      });
      if (!ok) throw new Error('Cancelled');

      const res = await api.post('/tools/tasks/status', {
        taskIds: selected.map(t => t.id),
        status
      });
      return res.data as {
        summary: string;
        updated: number;
        failed: number;
        skipped: number;
        haltedReason?: string;
        items: { taskId: string; name: string; outcome: string; message?: string }[];
      };
    },
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // A partial result is the normal case at this scale, so the toast reports
      // the whole summary and its tone follows the worst outcome — a green
      // "12 enabled" over three silent failures is the confident lie again.
      const bad = report.failed + report.skipped;
      if (bad > 0) {
        if (settings.toastOnFailure) {
          toast(`${report.summary}${report.haltedReason ? ` — ${report.haltedReason}` : ''}`, 'error');
        }
      } else if (settings.toastOnSuccess) {
        toast(report.summary, 'success');
      }
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      if (err.message === 'Cancelled') return;
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Bulk update failed: ${detail}`, 'error');
    }
  });

  const handleBulkStatus = async (selected: Task[], status: 'ACTIVE' | 'DISABLED') => {
    try {
      const report = await bulkStatusMutation.mutateAsync({ tasks: selected, status });
      return report.items
        .filter(i => i.outcome === 'updated' || i.outcome === 'unchanged')
        .map(i => i.taskId);
    } catch {
      // Cancelled or failed — the mutation's own handlers have already reported
      // it; the selection stays intact so the user can retry.
      return [];
    }
  };

  // Two callers, two shapes. Import sends the categories the user ticked in the
  // modal (path-derived names, straight from /discover). Sync Now sends
  // `scope: 'tracked'` and lets the server work out which folders that means —
  // it must NOT send `task.category`, which is a renameable label and would no
  // longer match any folder, silently dropping it from the sync.
  const syncMutation = useMutation({
    mutationFn: async (payload: { categories: string[] } | { scope: 'tracked' }) => {
      // 1. Ensure we have an active connection for Windows
      await api.get('/tasks/health'); // This route is often used to probe/refresh connections,
                                     // but let's be more explicit.

      const res = await api.post('/tasks/sync', payload);
      return res.data as SyncResponse;
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
      setShowImport(false);

      // Say what the sync left behind. Sync Now can only refresh folders you
      // already track — it cannot discover a new one — so tasks can sit one
      // fence away indefinitely while every sync cheerfully reports success.
      // That silence cost a full debugging session (troubleshooting #20).
      const untracked = describeUntracked(data);
      if (untracked) {
        // Deliberately NOT gated behind `toastOnSuccess`: that setting suppresses
        // routine "it worked" noise, and this is the opposite — the one thing the
        // sync did NOT do, and the only prompt the user gets that Import exists.
        toast(untracked, 'info');
      } else if (settings.toastOnSuccess) {
        toast('Tasks synced.', 'success');
      }
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const detail = err.response?.data?.error || err.message;
      if (settings.toastOnFailure) toast(`Sync error: ${detail}`, 'error');
      notifyFailure('Cronsole — sync failed', detail);
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
            <span className="font-bold">Cronsole</span>
          </div>
        </div>
        {!settings.onboardingSeen && (
          <div className="mb-6 flex items-center gap-4 flex-wrap bg-primary/10 border border-primary/30 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-500">
            <Sparkles size={20} className="text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-foreground">New to Cronsole?</p>
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
            onSyncNow={() => syncMutation.mutate({ scope: 'tracked' })}
            onClearMissing={(count) => clearMissingMutation.mutate(count)}
            isClearingMissing={clearMissingMutation.isPending}
            isSyncing={syncMutation.isPending}
            onTaskSelect={(t) => navigate(`/tasks/${t.id}`)}
            onRun={runMutation.mutate}
            onCategoryUpdate={handleCategoryUpdate}
            onClone={setCloningTask}
            onToggleStatus={statusMutation.mutate}
            statusTogglingId={statusMutation.isPending ? statusMutation.variables?.id ?? null : null}
            onShowHelp={() => setShowHelp(true)}
            onNewTask={() => setShowCreateNative(true)}
            onBulkStatus={handleBulkStatus}
            isBulkPending={bulkStatusMutation.isPending}
            settings={settings}
          />
        )}
        {activeTab === 'templates' && <TemplatesScreen />}
        {activeTab === 'platforms' && <PlatformsScreen />}
        {activeTab === 'tools' && <ToolsScreen />}
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
          onImport={(categories) => syncMutation.mutate({ categories })}
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
