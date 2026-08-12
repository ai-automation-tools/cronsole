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
import {
  bulkToastMessage,
  hasBadNews,
  resolvedIds,
  type BulkReport
} from './utils/bulkReport';
import {
  downloadBlob,
  filenameFromDisposition,
  pickDirectory,
  supportsDirectoryPicker,
  writeFilesToDirectory,
  type ExportFilePayload
} from './utils/saveExport';



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
      next ? await api.post(`/tasks/${task.id}/favorite`) : await api.delete(`/tasks/${task.id}/favorite`);
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

  /**
   * Report a bulk result, with the tone following the *worst* outcome.
   *
   * Shared by all four bulk verbs so none of them can drift into announcing its
   * successes and swallowing its failures — a green "12 enabled" over three
   * silent refusals is the confident lie, and it is one careless `onSuccess`
   * away at any time.
   */
  const reportBulk = (report: BulkReport) => {
    if (hasBadNews(report)) {
      if (settings.toastOnFailure) toast(bulkToastMessage(report), 'error');
    } else if (settings.toastOnSuccess) {
      toast(report.summary, 'success');
    }
  };

  const reportBulkError = (error: unknown, prefix: string) => {
    const err = error as Error & { response?: { data?: { error?: string } } };
    if (err.message === 'Cancelled') return;
    const detail = err.response?.data?.error || err.message;
    if (settings.toastOnFailure) toast(`${prefix}: ${detail}`, 'error');
  };

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
      return res.data as BulkReport;
    },
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // A partial result is the normal case at this scale, so the toast reports
      // the whole summary and its tone follows the worst outcome.
      reportBulk(report);
    },
    onError: (error: unknown) => reportBulkError(error, 'Bulk update failed')
  });

  const handleBulkStatus = async (selected: Task[], status: 'ACTIVE' | 'DISABLED') => {
    try {
      const report = await bulkStatusMutation.mutateAsync({ tasks: selected, status });
      return resolvedIds(report);
    } catch {
      // Cancelled or failed — the mutation's own handlers have already reported
      // it; the selection stays intact so the user can retry.
      return [];
    }
  };

  /**
   * Move a whole selection into one category.
   *
   * The only bulk verb that touches nothing but Cronsole's database — no agent,
   * no signed command, nothing on the machine changes. The confirmation is the
   * modal that collected the category, so there is no second dialog here.
   */
  const bulkCategoryMutation = useMutation({
    mutationFn: async ({ tasks: selected, category }: { tasks: Task[]; category: string }) => {
      const res = await api.post('/tools/tasks/category', {
        taskIds: selected.map(t => t.id),
        category
      });
      return res.data as BulkReport & { detachedFromFolder: number };
    },
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      reportBulk(report);
    },
    onError: (error: unknown) => reportBulkError(error, 'Bulk categorize failed')
  });

  /**
   * Remove a whole selection from Cronsole, **leaving every scheduled task
   * running**.
   *
   * The undo for an over-import, which arrives in bulk because the Import modal
   * makes a whole folder one click away. It makes no platform call, so it works
   * with the agent offline — and the confirmation has to spend its words on the
   * distinction from Delete, since that is the mistake it exists to prevent.
   */
  const bulkUntrackMutation = useMutation({
    mutationFn: async (selected: Task[]) => {
      // Native tasks cannot be untracked at all, so the number in the dialog is
      // the number that will actually be removed — not the selection size.
      const removable = selected.filter(t => t.platform !== 'TASKHUB_NATIVE');
      const ok = await confirm({
        title: `Remove ${removable.length} task${removable.length === 1 ? '' : 's'} from Cronsole?`,
        message:
          // Plain text, not markdown: useConfirm renders the message as a text
          // node, so asterisks reach the screen as asterisks. Caught in a live
          // click-through, invisible to every test — the suites assert the
          // string that was passed in, which is exactly the string that was
          // wrong.
          `This removes Cronsole's records and their run history. Nothing on your machine is touched — ` +
          `these scheduled tasks keep running on their own schedules. Re-import their category to track them again.` +
          (removable.length < selected.length
            ? ` ${selected.length - removable.length} Cronsole-native task${selected.length - removable.length === 1 ? '' : 's'} cannot be untracked and will be left alone.`
            : ''),
        confirmText: `Remove ${removable.length} from Cronsole`
      });
      if (!ok) throw new Error('Cancelled');

      const res = await api.post('/tools/tasks/untrack', { taskIds: selected.map(t => t.id) });
      return res.data as BulkReport;
    },
    onSuccess: report => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      reportBulk(report);
    },
    onError: (error: unknown) => reportBulkError(error, 'Bulk untrack failed')
  });

  /**
   * Export a selection as native Task Scheduler XML.
   *
   * Same two delivery paths as the Tools tab's whole-machine backup, and for the
   * same reasons: the directory picker needs transient user activation so it
   * opens **before** the request, and the ZIP fallback carries its counts in a
   * header because a binary response has no body to put them in. What differs is
   * the scope — the server resolves these task ids to native paths itself, so a
   * caller cannot name an arbitrary path on the machine.
   */
  const bulkExportMutation = useMutation({
    mutationFn: async (selected: Task[]) => {
      const exportable = selected.filter(t => t.platform === 'WINDOWS_TASK_SCHEDULER');
      if (exportable.length === 0) {
        throw new Error('Only Windows Task Scheduler tasks export as native XML.');
      }
      const body = { scope: 'selection' as const, taskIds: exportable.map(t => t.id) };

      // Before the request, not after: an awaited network call spends the user
      // activation the picker needs, and cancelling then would throw away a
      // finished export (troubleshooting #24).
      let directory = null;
      if (supportsDirectoryPicker()) {
        directory = await pickDirectory();
        if (!directory) throw new Error('Cancelled');
      }

      if (directory) {
        const res = await api.post('/tools/export/tasks', { ...body, format: 'files' });
        const payload = res.data as {
          counts: { exported: number; failed: number; requestedMissing: number; unsupported: number };
          requestedMissing: string[];
          files: ExportFilePayload[];
        };
        await writeFilesToDirectory(directory, payload.files);
        return { counts: payload.counts, requestedMissing: payload.requestedMissing, destination: directory.name };
      }

      const res = await api.post('/tools/export/tasks', { ...body, format: 'zip' }, { responseType: 'blob' });
      const filename = filenameFromDisposition(
        res.headers['content-disposition'] as string | undefined,
        'cronsole-tasks.zip'
      );
      downloadBlob(res.data as Blob, filename);
      const counts = JSON.parse((res.headers['x-cronsole-export-counts'] as string) || 'null');
      return { counts, requestedMissing: [] as string[], destination: filename };
    },
    onSuccess: ({ counts, requestedMissing, destination }) => {
      const exported = counts?.exported ?? 0;
      // The gaps are named in the toast, not left to be inferred from a smaller
      // number than expected. A backup silently missing the one task that
      // mattered is the failure this whole feature exists to prevent.
      const gaps: string[] = [];
      if (counts?.failed) gaps.push(`${counts.failed} failed`);
      if (requestedMissing.length) gaps.push(`${requestedMissing.length} no longer on this machine`);
      else if (counts?.requestedMissing) gaps.push(`${counts.requestedMissing} no longer on this machine`);
      if (counts?.unsupported) gaps.push(`${counts.unsupported} not Windows tasks`);

      const message = `Exported ${exported} task${exported === 1 ? '' : 's'} to "${destination}"${gaps.length ? ` · ${gaps.join(' · ')}` : ''}.`;
      if (gaps.length > 0) {
        if (settings.toastOnFailure) toast(message, 'error');
      } else if (settings.toastOnSuccess) {
        toast(message, 'success');
      }
    },
    onError: async (error: unknown) => {
      const err = error as Error & { response?: { data?: unknown } };
      if (err.message === 'Cancelled') return;
      let detail = err.message;
      // With responseType 'blob' the error body is a Blob — read it back so the
      // server's real message ("The Windows agent is offline…") survives.
      const data = err.response?.data;
      if (data instanceof Blob) {
        try {
          detail = JSON.parse(await data.text())?.error ?? detail;
        } catch { /* keep the original */ }
      } else if (data && typeof data === 'object' && 'error' in data) {
        detail = String((data as { error: unknown }).error);
      }
      if (settings.toastOnFailure) toast(`Export failed: ${detail}`, 'error');
    }
  });

  const handleBulkCategory = async (selected: Task[], category: string) => {
    try {
      return resolvedIds(await bulkCategoryMutation.mutateAsync({ tasks: selected, category }));
    } catch {
      return [];
    }
  };

  const handleBulkUntrack = async (selected: Task[]) => {
    try {
      return resolvedIds(await bulkUntrackMutation.mutateAsync(selected));
    } catch {
      return [];
    }
  };

  const handleBulkExport = async (selected: Task[]) => {
    // Deliberately resolves to nothing: an export changes no task, so the
    // selection is exactly as relevant afterwards as it was before. Clearing it
    // would make a read-only action look like it consumed the rows.
    await bulkExportMutation.mutateAsync(selected).catch(() => undefined);
    return [];
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
            onToggleFavorite={favoriteMutation.mutate}
            statusTogglingId={statusMutation.isPending ? statusMutation.variables?.id ?? null : null}
            onShowHelp={() => setShowHelp(true)}
            onNewTask={() => setShowCreateNative(true)}
            onBulkStatus={handleBulkStatus}
            onBulkCategory={handleBulkCategory}
            onBulkUntrack={handleBulkUntrack}
            onBulkExport={handleBulkExport}
            isBulkPending={
              bulkStatusMutation.isPending ||
              bulkCategoryMutation.isPending ||
              bulkUntrackMutation.isPending ||
              bulkExportMutation.isPending
            }
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
