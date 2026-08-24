import { useState, useEffect } from 'react';
import { Sparkles, X } from 'lucide-react';
import { CloneTaskModal } from './components/CloneTaskModal';
import { HelpModal } from './components/HelpModal';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task } from './types';
import { TopBar } from './components/TopBar';
import { TaskModal } from './components/TaskModal';
import { ImportFileModal } from './components/ImportFileModal';
import { SyncSourcesModal } from './components/SyncSourcesModal';
import { CreateTaskModal } from './components/CreateTaskModal';
import { SettingsScreen } from './components/SettingsScreen';
import { SourcesScreen } from './screens/SourcesScreen';
import { TemplatesScreen } from './screens/TemplatesScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { useSettings } from './hooks/useSettings';
import { useToast } from './hooks/useToast';
import { useConfirm } from './hooks/useConfirm';
import { useNavigate, useLocation } from 'react-router';
import { useLiveTaskUpdates } from './hooks/useLiveTaskUpdates';
import { describeUntracked, describeCoverage, type SyncResponse } from './utils/syncSummary';
import { stageRestore } from './utils/restoreHandoff';
import { taskDetailRoute, taskDetailReturn } from './utils/taskRoute';



const Dashboard = () => {
  // Section + open task detail come from the URL (bookmarkable, back/forward):
  //   /                → dashboard      /templates → templates
  //   /sources         → sources        /settings  → settings
  //   /tools           → tools
  //
  // `/platforms` is the tab's old address and still resolves here: it was a
  // bookmarkable route and the docs shipped links to it, so it redirects rather
  // than falling through to the dashboard, which would look like the tab was
  // removed.
  //   /tasks/:id       → dashboard with the task detail modal open
  //
  // `/tasks/:id` keeps the query it was opened with, because the dashboard's
  // slice — filters, saved view, and every source-rail dimension — is the URL.
  // Dropping it would reset the list *behind* the modal and land the close on
  // All sources. See `utils/taskRoute.ts`; open and close are one contract.
  const navigate = useNavigate();
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);
  const section = segments[0] ?? '';
  const activeTab = section === 'platforms'
    ? 'sources'
    : ['templates', 'sources', 'tools', 'settings'].includes(section) ? section : 'dashboard';
  const setActiveTab = (tab: string) => navigate(tab === 'dashboard' ? '/' : `/${tab}`);
  const routeTaskId = section === 'tasks' ? segments[1] : undefined;

  const [cloningTask, setCloningTask] = useState<Task | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // Two controls, two states. Import takes a file; adopting what is already on
  // the machine is the second gesture under Sync.
  const [showImportFile, setShowImportFile] = useState(false);
  const [showSyncSources, setShowSyncSources] = useState(false);
  const [showCreateNative, setShowCreateNative] = useState(false);
  const queryClient = useQueryClient();
  const { settings, update } = useSettings();
  const { toast } = useToast();
  const confirm = useConfirm();

  // The tab moved from /platforms to /sources. Rewrite the address rather than
  // only rendering the right screen at the old one: `replace`, so Back does not
  // bounce between the two, and the query survives because the rail's deep
  // links (`?focus=available`) are legal on either spelling.
  useEffect(() => {
    if (section === 'platforms') navigate({ pathname: '/sources', search: location.search }, { replace: true });
  }, [section, location.search, navigate]);

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
      const response = await api.post(`/tasks/${task.id}/run`);
      return { task, result: response.data as { success?: boolean; ran?: boolean; message?: string } };
    },
    // A 2xx no longer means the task is fine. A Cronsole-native run happens
    // inside the request, so the route answers 200 with `success: false` when
    // the job executed and reported failure — a failing CHECK is the check
    // working, not a transport error. Reading only the HTTP status would toast
    // "triggered successfully" over "your disk is full".
    onSuccess: ({ task, result }) => {
      if (result?.success === false) {
        const detail = result.message || 'the run reported failure';
        if (settings.toastOnFailure) toast(`"${task.name}" ran and failed: ${detail}`, 'error');
        notifyFailure('Cronsole — run failed', `${task.name}: ${detail}`);
        return;
      }
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

  // Star / un-star a task. Wired here for the same reason as the status toggle:
  // every view shows the star, and one mutation means one cache update.
  //
  // Optimistic — the star flips in the ['tasks'] cache on click rather than after
  // the round trip. A star is a pure preference with no platform round trip, so
  // waiting would put a visible delay on the cheapest thing the dashboard does.
  // On failure the cache is rolled back to exactly what it was, because a star
  // that stays lit after the write failed is a lie the next reload silently
  // corrects — the kind of drift nobody connects to the click that caused it.
  const favoriteMutation = useMutation({
    mutationFn: async (task: Task) => {
      const next = !task.isFavorite;
      const url = `/tasks/${task.id}/favorite`;
      if (next) {
        await api.post(url);
      } else {
        await api.delete(url);
      }
      return { task, next };
    },
    onMutate: async (task: Task) => {
      await queryClient.cancelQueries({ queryKey: ['tasks'] });
      const previous = queryClient.getQueryData<Task[]>(['tasks']);
      queryClient.setQueryData<Task[]>(['tasks'], old =>
        (old ?? []).map(t => (t.id === task.id ? { ...t, isFavorite: !task.isFavorite } : t))
      );
      return { previous };
    },
    onError: (_error, task, context) => {
      if (context?.previous) queryClient.setQueryData(['tasks'], context.previous);
      if (settings.toastOnFailure) toast(`Couldn't update the star on "${task.name}".`, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
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

  /*
   * The dashboard's four bulk mutations were removed on 2026-08-12 along with
   * row selection. Bulk work is the Mass actions console on the Tools tab,
   * which calls the same `/api/tools/tasks/*` routes directly — so this was a
   * second caller of one API, not a second capability.
   */

  /**
   * A Windows backup picked in the Import modal.
   *
   * It is handed to **Tools → Restore** rather than imported here, because
   * putting a Windows task back is a restore: the definition lives on the
   * machine, so it needs a dry run, a plan on screen, and the folder/overwrite
   * decisions that ride inside the agent's signature. That flow has one
   * definition and this must not become a second one.
   *
   * The card is opened on the way, so the user lands on their file with a plan
   * running — not on a Tools tab where they have to find the right card and pick
   * the file again. The toast says where they went; a screen that changes under
   * you without a reason is the same defect as a refusal with no explanation.
   */
  const handleWindowsBackup = (file: File) => {
    stageRestore([file]);
    if (!settings.openTools.includes('restore')) {
      update('openTools', [...settings.openTools, 'restore']);
    }
    setShowImportFile(false);
    navigate('/tools');
    toast(`${file.name} is a Windows backup — opened in Tools › Restore.`, 'info');
  };

  // Two callers, two shapes. Import sends the categories the user ticked in the
  // picker (path-derived names, straight from /discover). The plain Sync sends
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
      setShowSyncSources(false);

      // Say what the sync left behind. A plain Sync can only refresh folders you
      // already track — it cannot discover a new one — so tasks can sit one
      // fence away indefinitely while every sync cheerfully reports success.
      // That silence cost a full debugging session (troubleshooting #20).
      const untracked = describeUntracked(data);
      // What the sync *covered*. Success information — it is true on a perfectly
      // healthy run — so it obeys `toastOnSuccess`, unlike the sentence below.
      // Without it, "imported nothing because nothing here is scheduled" and
      // "imported nothing because something is broken" are the same empty screen
      // (troubleshooting #75).
      const coverage = describeCoverage(data);
      if (untracked) {
        // Deliberately NOT gated behind `toastOnSuccess`: that setting suppresses
        // routine "it worked" noise, and this is the opposite — the one thing the
        // sync did NOT do, and the only prompt the user gets that Import exists.
        // The message names a control, so it carries that control. This toast is
        // the only prompt that adopting new folders is possible at all, and
        // making the reader go and find the menu it names is how a prompt
        // becomes a dead end.
        // Coverage rides along when there is already a toast to carry it, even
        // with success toasts off: the reader is being shown this message
        // anyway, and the numbers are what make its "N aren't imported" legible.
        toast([coverage, untracked].filter(Boolean).join(' '), 'info', {
          label: 'Add tasks from this machine',
          onClick: () => setShowSyncSources(true)
        });
      } else if (settings.toastOnSuccess) {
        toast(coverage ? `Synced. ${coverage}` : 'Tasks synced.', 'success');
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
    /*
      Column, not row. Navigation moved from a 256px left rail to a top toolbar
      (see TopBar), which frees the left column on the dashboard for the source
      and folder tree — the thing that actually changes, and the thing you
      navigate 350 tasks by. Every other tab gets the full width.
    */
    <div className="flex flex-col h-screen bg-background text-foreground font-sans selection:bg-primary/30 overflow-hidden">
      <TopBar activeTab={activeTab} setActiveTab={setActiveTab} />
      {/*
        No padding here — each screen owns its own.

        The dashboard needs that: its source rail is a full-height *panel* with
        its own surface and a border against the content, and a padded `main`
        would inset it, leaving a strip of page background down the left and
        making the panel read as a floating column instead of part of the chrome.
        Every other screen wraps itself in the padding this used to apply.
      */}
      <main className="flex-1 overflow-y-auto">
        {!settings.onboardingSeen && (
          <div className="mx-4 md:mx-8 mt-5 md:mt-7 flex items-center gap-4 flex-wrap bg-primary/10 border border-primary/30 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-500">
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
            onImportFile={() => setShowImportFile(true)}
            onAddSources={() => setShowSyncSources(true)}
            onSyncNow={() => syncMutation.mutate({ scope: 'tracked' })}
            onClearMissing={(count) => clearMissingMutation.mutate(count)}
            isClearingMissing={clearMissingMutation.isPending}
            isSyncing={syncMutation.isPending}
            onTaskSelect={(t) => { const r = taskDetailRoute(t.id, location); navigate(r.to, r.options); }}
            onRun={runMutation.mutate}
            onCategoryUpdate={handleCategoryUpdate}
            onClone={setCloningTask}
            onToggleStatus={statusMutation.mutate}
            onToggleFavorite={favoriteMutation.mutate}
            statusTogglingId={statusMutation.isPending ? statusMutation.variables?.id ?? null : null}
            onShowHelp={() => setShowHelp(true)}
            onNewTask={() => setShowCreateNative(true)}
            settings={settings}
          />
        )}
        {activeTab !== 'dashboard' && (
          <div className="px-4 py-5 md:px-8 md:py-7">
            {activeTab === 'templates' && <TemplatesScreen />}
            {activeTab === 'sources' && <SourcesScreen />}
            {activeTab === 'tools' && <ToolsScreen />}
            {activeTab === 'settings' && <SettingsScreen tasks={tasks} />}
          </div>
        )}
      </main>
      {/*
        Closing puts you back where you opened from — the collection or folder
        you were reading, or the Tools card that linked here — never on a bare
        dashboard you never chose.
      */}
      <TaskModal
        task={routeTaskId ? (tasks || []).find(t => t.id === routeTaskId) ?? null : null}
        onClose={() => navigate(taskDetailReturn(location))}
        onRun={runMutation.mutate}
        onToggleFavorite={favoriteMutation.mutate}
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
      {showImportFile && (
        <ImportFileModal
          onClose={() => setShowImportFile(false)}
          onWindowsBackup={handleWindowsBackup}
        />
      )}
      {showSyncSources && (
        <SyncSourcesModal
          onClose={() => setShowSyncSources(false)}
          onAdd={(categories) => syncMutation.mutate({ categories })}
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
