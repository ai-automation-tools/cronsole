import { useState, useEffect } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Folder, Play, History, Info, Loader2, CheckCircle2, XOctagon, Clock, Trash2, CalendarClock, Terminal, SlidersHorizontal, Pencil, BookmarkPlus, EyeOff, Wrench, KeyRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Task, ExecutionLogEntry } from '../types';
import { PlatformRunHistory } from './PlatformRunHistory';
import { RotateCredentialsModal } from './RotateCredentialsModal';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useConfirm } from '../hooks/useConfirm';
import { Modal } from './ui/Modal';
import { useSettings, type TimezoneMode } from '../hooks/useSettings';
import { describeCron, taskCron } from '../utils/schedule';
import { hhmmInZone, resolveZone, zoneAbbrev, zoneLabel } from '../utils/timezone';
import { isRunnable, runButtonTitle } from '../utils/taskActions';
import { TaskExportMenu } from './TaskExportMenu';
import { useRemoveClaudeRoutine } from '../hooks/useClaudeRoutines';
import { TaskFavoriteStar } from './TaskFavoriteStar';
import { TaskCollectionMenu } from './TaskCollectionMenu';
import { EditTaskModal } from './EditTaskModal';
import { platformName } from '../utils/taskEditing';
import { usePlatformMatrix, usePlatformDeletability } from '../hooks/usePlatformMatrix';
import { platformSourceLabel } from '../platform';
import { HelpButton } from './HelpButton';

interface TaskModalProps {
  task: Task | null;
  onClose: () => void;
  onRun: (task: Task) => void;
  /** Optional so the modal stays renderable without the dashboard's mutations. */
  onToggleFavorite?: (task: Task) => void;
}

const statusStyle = (status: string) =>
  ({
    SUCCESS: 'bg-success/10 text-success-text border-success/30',
    FAILURE: 'bg-danger/10 text-danger-text border-danger/30',
    TIMEOUT: 'bg-warning/10 text-warning-text border-warning/30'
  }[status] ?? 'bg-muted/10 text-muted-foreground border-border/30');

const StatusIcon = ({ status }: { status: string }) => {
  if (status === 'SUCCESS') return <CheckCircle2 size={12} />;
  if (status === 'FAILURE') return <XOctagon size={12} />;
  return <Clock size={12} />;
};

// ---------------------------------------------------------------------------
// Metadata parsing — turn the platform's raw sync payload into readable rows.
// Windows tasks store the agent's AgentTaskInfo ({ path, name, state,
// lastRunTime, nextRunTime, trigger, and — from newer agents — actions/settings
// fields }); native tasks store { job }; imported/created tasks may store a
// plain { command } string. We render whatever is present and stay honest about
// what the agent didn't report rather than inventing values.
// ---------------------------------------------------------------------------
type Meta = Record<string, unknown>;

interface DetailRow {
  label: string;
  value: string;
  mono?: boolean;
}

const asText = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : undefined;

const asBool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);

const localTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
};

/** Turn an ISO-8601 duration (PT30M, PT1H, P1D) into words; falls back to raw. */
const humanizeIso = (iso: string): string => {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m) return iso;
  const [, d, h, min, s] = m;
  const parts: string[] = [];
  if (d) parts.push(`${d} day${d === '1' ? '' : 's'}`);
  if (h) parts.push(`${h} hour${h === '1' ? '' : 's'}`);
  if (min) parts.push(`${min} minute${min === '1' ? '' : 's'}`);
  if (s) parts.push(`${s} second${s === '1' ? '' : 's'}`);
  return parts.length ? parts.join(', ') : iso;
};

function scheduleInfo(task: Task, tz: TimezoneMode): { cron: string | null; human: string | null; rows: DetailRow[] } {
  const meta = (task.metadata ?? {}) as Meta;
  // Same lookup the card previews use, so the two can't disagree about whether
  // this task has a schedule at all.
  const cron = taskCron(task);
  const human = describeCron(cron, tz);
  const rows: DetailRow[] = [];
  const trig = meta.trigger as Meta | undefined;
  if (trig && typeof trig === 'object') {
    const type = asText(trig.type);
    if (type) rows.push({ label: 'Trigger', value: type });
    // The agent reports start boundaries in UTC (TriggerReader.ToUtcHhmm), so
    // show them in the same zone as everything else rather than leaving one raw
    // UTC clock reading among Pacific ones.
    const start = asText(trig.startBoundary);
    if (start) {
      const inZone = hhmmInZone(start, tz);
      rows.push({
        label: 'Start time',
        value: inZone ? `${inZone} ${zoneAbbrev(resolveZone(tz))}` : `${start} UTC`
      });
    }
    if (Array.isArray(trig.daysOfWeek) && trig.daysOfWeek.length) {
      rows.push({ label: 'Days', value: trig.daysOfWeek.join(', ') });
    }
    if (typeof trig.daysInterval === 'number' && trig.daysInterval > 1) {
      rows.push({ label: 'Repeats every', value: `${trig.daysInterval} days` });
    }
    const rep = trig.repetition as Meta | undefined;
    if (rep && typeof rep === 'object') {
      const interval = asText(rep.interval);
      if (interval) rows.push({ label: 'Repeat interval', value: humanizeIso(interval) });
      const duration = asText(rep.duration);
      if (duration) rows.push({ label: 'Repeat for', value: humanizeIso(duration) });
    }
  }
  return { cron, human, rows };
}

/**
 * The tools and domains a hosted agent may use, as the platform reported them.
 *
 * Read from metadata rather than re-derived: the connector already decided what
 * is safe to show, and — critically — what is not. An MCP server's `headers`
 * never reach this file because they never reach the parse, so nothing here has
 * to remember to filter a credential out.
 */
function reachInfo(task: Task): { tools: { type: string; name: string | null; url: string | null; restricted: boolean }[]; domains: string[] } {
  const meta = (task.metadata ?? {}) as Meta;
  const tools = Array.isArray(meta.tools) ? meta.tools as { type: string; name: string | null; url: string | null; restricted: boolean }[] : [];
  const domains = Array.isArray(meta.networkAllowlist) ? meta.networkAllowlist.filter((d): d is string => typeof d === 'string') : [];
  return { tools, domains };
}

function actionInfo(task: Task): { rows: DetailRow[]; reported: boolean } {
  const meta = (task.metadata ?? {}) as Meta;
  const rows: DetailRow[] = [];

  const job = meta.job as Meta | undefined;
  if (job && typeof job === 'object') {
    const url = asText(job.url);
    if (url) rows.push({ label: 'HTTP request', value: `${(asText(job.method) ?? 'GET').toUpperCase()} ${url}`, mono: true });
    const body = asText(job.body);
    if (body) rows.push({ label: 'Body', value: body, mono: true });
    return { rows, reported: rows.length > 0 };
  }

  if (Array.isArray(meta.actions) && meta.actions.length) {
    // Bind to a local so the array type survives inside the forEach closure
    // (property narrowing on meta.actions is lost across the callback boundary).
    const acts = meta.actions;
    acts.forEach((raw, i) => {
      const act = (raw ?? {}) as Meta;
      const exe = asText(act.path) ?? asText(act.executable);
      const args = asText(act.arguments);
      const cwd = asText(act.workingDirectory);
      if (exe) rows.push({ label: acts.length > 1 ? `Action ${i + 1}` : 'Runs', value: args ? `${exe} ${args}` : exe, mono: true });
      if (cwd) rows.push({ label: 'Working dir', value: cwd, mono: true });
    });
    return { rows, reported: rows.length > 0 };
  }

  const command = asText(meta.command);
  if (command) {
    rows.push({ label: 'Command', value: command, mono: true });
    return { rows, reported: true };
  }

  // **The unit of work is not always a command.** A Gemini trigger's action is a
  // prompt, and the connector writes it to `metadata.prompt` — so reading only
  // `command` left every synced trigger with an empty Action panel showing advice
  // about the Windows agent, a component that platform does not have. The same
  // wrong-platform blame as #77, one panel over.
  const prompt = asText(meta.prompt);
  if (prompt) {
    rows.push({ label: 'Prompt', value: prompt, mono: false });
    return { rows, reported: true };
  }

  return { rows, reported: false };
}

/*
 * The editor's prefill and gating rules used to live here as `actionEditInfo` /
 * `nativeJobEditInfo`. They moved to `utils/taskEditing.ts` when the four edit
 * buttons collapsed into one `EditTaskModal` — the same rules decide both what a
 * field is prefilled with and whether its section renders at all, and deriving
 * them in two places is how a section ends up editable in the UI and refused by
 * the route.
 */

/** Extra settings a newer agent reports; empty for older syncs (section hides). */
function settingsRows(task: Task): DetailRow[] {
  const meta = (task.metadata ?? {}) as Meta;
  const rows: DetailRow[] = [];
  const state = asText(meta.state);
  if (state) rows.push({ label: 'Scheduler state', value: state });
  const enabled = asBool(meta.enabled);
  if (enabled !== undefined) rows.push({ label: 'Enabled', value: enabled ? 'Yes' : 'No' });
  const user = asText(meta.userId) ?? asText(meta.runAs);
  if (user) rows.push({ label: 'Run as', value: user });
  const runLevel = asText(meta.runLevel);
  if (runLevel) rows.push({ label: 'Run level', value: runLevel });
  const logon = asText(meta.logonType);
  if (logon) rows.push({ label: 'Logon type', value: logon });
  const author = asText(meta.author);
  if (author) rows.push({ label: 'Author', value: author });
  const description = asText(meta.description);
  if (description) rows.push({ label: 'Description', value: description });
  return rows;
}

const DetailSection = ({ icon: Icon, title, children, action }: { icon: LucideIcon; title: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-2 text-xs font-bold text-subtle-foreground uppercase tracking-widest">
        <Icon size={13} /> {title}
      </h3>
      {action}
    </div>
    {children}
  </div>
);

const RowList = ({ rows }: { rows: DetailRow[] }) => (
  <div className="bg-background rounded-xl border border-border divide-y divide-border">
    {rows.map((r, i) => (
      <div key={i} className="flex items-start justify-between gap-4 px-4 py-2.5">
        <span className="text-xs text-subtle-foreground shrink-0 pt-0.5">{r.label}</span>
        <span className={`text-right break-all text-foreground ${r.mono ? 'font-mono text-xs' : 'text-sm font-medium'}`}>{r.value}</span>
      </div>
    ))}
  </div>
);

export const TaskModal = ({ task, onClose, onRun, onToggleFavorite }: TaskModalProps) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'runs'>('overview');
  /*
   * One editor, one flag. This was three — schedule, Windows action, native job —
   * reached from three different places on this screen, alongside an inline
   * rename form and an inline category input. `EditTaskModal` is now the single
   * entry point for everything editable about a task; this modal is a read-only
   * view of it plus the verbs (run, remove, delete, export).
   */
  const [showEditor, setShowEditor] = useState(false);

  // A native job runs wherever the BACKEND runs, which on a Dockerized stack is
  // inside the container — so an EXEC path is resolved against a filesystem that
  // is not the user's. The server decides which; the editor says so.
  const { data: platformMatrix } = usePlatformMatrix();
  // Which removals this platform actually supports — the server's answer, not a
  // list of platform names kept in this file.
  const { deletability } = usePlatformDeletability();
  const [rotating, setRotating] = useState(false);
  // Optional-chained through `platforms` as well as the response: this modal
  // renders whatever the matrix query happens to hold, including a half-loaded
  // or shape-surprising payload, and a task's details must not go blank because
  // an unrelated background query returned something unexpected.
  const nativeExecutionHost = platformMatrix?.platforms
    ?.find(p => p.platform === 'TASKHUB_NATIVE')?.executionHost?.summary;
  const [exporting, setExporting] = useState(false);

  /*
   * Keyed on the task **id**, not the task object.
   *
   * The dashboard passes `tasks.find(t => t.id === routeTaskId)`, so every
   * refetch — the 45s poll, any `task:updated` socket event, the invalidation the
   * editor itself fires — hands this component a new object for the same task.
   * Depending on the object meant this effect ran on all of them and slammed any
   * open editor shut mid-edit. The question it actually wants to ask is "is this
   * a different task than the one I was showing", and that is the id.
   */
  const taskId = task?.id;
  useEffect(() => {
    if (taskId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTab('overview');
      setShowEditor(false);
    }
  }, [taskId]);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const { settings: prefs } = useSettings();

  const statusMutation = useMutation({
    mutationFn: async (newStatus: 'ACTIVE' | 'DISABLED') => {
      return api.patch(`/tasks/${task!.id}/status`, { status: newStatus });
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(`Task "${task!.name}" is now ${res.data.status.toLowerCase()}.`, 'success');
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Failed to update status: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return api.delete(`/tasks/${task!.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(`Task "${task!.name}" deleted.`, 'success');
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Delete failed: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  // Untrack: stop tracking the task here, leave it running on the platform.
  //
  // Deliberately a separate mutation from deleteMutation rather than a flag on
  // it. These two operations differ only in blast radius and one of them is
  // irreversible, so the code path, the copy, and the styling are kept apart —
  // a shared handler with a boolean is how the wrong one eventually fires.
  const untrackMutation = useMutation({
    mutationFn: async () => api.post(`/tasks/${task!.id}/untrack`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(`"${task!.name}" removed from Cronsole. It still exists on its platform.`, 'success');
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Remove failed: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  /*
   * Rename and recategorize both live in `EditTaskModal` now, on the one route
   * that writes them (`PATCH /api/tasks/:id`). Both are **Cronsole labels, never
   * the machine**: a renamed Windows task still answers to its old Task
   * Scheduler path, and a recategorized one stays in its folder. That is not
   * hidden — the real `externalId` sits under the title here, the header says so
   * in words once the two diverge, and the editor says it again before the save.
   */

  // Disconnect a Claude routine — this platform's stand-in for untrack, and the
  // only thing that actually removes a Claude task (see the footer button).
  const disconnectRoutineMutation = useRemoveClaudeRoutine();

  // Save this task as a reusable catalog template. Invalidates ['templates'] so
  // the new template shows up on the Templates tab immediately.
  const saveTemplateMutation = useMutation({
    mutationFn: async () => api.post(`/tasks/${task!.id}/save-as-template`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      toast(`Saved "${res.data.template?.name ?? task!.name}" to the template library.`, 'success');
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Couldn't save as template: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  // Export the task's native definition: Windows → Task Scheduler XML (via the
  // agent), Cronsole-native → Cronsole JSON. Downloads through the api client so
  // the auth header rides along, using the server's Content-Disposition filename.
  const handleExport = async (format: 'native' | 'template' = 'native') => {
    setExporting(true);
    try {
      const res = await api.get(`/tasks/${task!.id}/export`, {
        responseType: 'blob',
        params: format === 'native' ? undefined : { format }
      });
      const cd = res.headers['content-disposition'] as string | undefined;
      // The server names the file, and it is the only thing that knows whether
      // this is XML, a task bundle or a template. The fallback only has to be
      // survivable, not clever.
      const filename = cd?.match(/filename="?([^"]+)"?/)?.[1]
        ?? `${task!.name}.${format === 'native' && task!.platform === 'WINDOWS_TASK_SCHEDULER' ? 'xml' : 'json'}`;
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast(`Exported "${task!.name}".`, 'success');
    } catch (error: unknown) {
      const err = error as Error & { response?: { data?: unknown } };
      // With responseType 'blob' the error body is a Blob — read it back to
      // surface the server's real message (e.g. "Agent offline").
      let msg = err.message;
      try {
        const data = err.response?.data;
        if (data instanceof Blob) {
          const parsed = JSON.parse(await data.text());
          if (parsed?.error) msg = parsed.error;
        }
      } catch { /* keep the generic message */ }
      toast(`Export failed: ${msg}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const { data: executions, isLoading: executionsLoading, isError: executionsError } = useQuery<ExecutionLogEntry[]>({
    queryKey: ['executions', task?.id],
    queryFn: async () => {
      const res = await api.get(`/tasks/${task!.id}/executions`);
      return res.data;
    },
    enabled: !!task && activeTab === 'runs',
    staleTime: 15_000
  });

  if (!task) return null;

  // What the machine calls this task, when the machine has an opinion — shared
  // with the editor so both can only ever say the same thing about it.
  const machineName = platformName(task);

  const meta = (task.metadata ?? {}) as Meta;
  const sched = scheduleInfo(task, prefs.timezone);
  const actions = actionInfo(task);
  const agentReach = reachInfo(task);
  const settings = settingsRows(task);
  const nextRun = asText(meta.nextRunTime);
  const lastRun = task.lastRunAt ?? asText(meta.lastRunTime) ?? null;

  return (
    <>
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="task-modal-title"
      panelClassName="bg-surface border border-border rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
        <header className="p-6 border-b border-border flex justify-between items-start gap-2">
          <div className="min-w-0">
            {/*
              Wraps, because this row holds a badge, a task name of unbounded
              length, and two controls — and the labeled collections button made
              it 471px wide on a 375px phone (caught by the mobile E2E check,
              which is what that check is for). `min-w-0` on the column is the
              other half: without it the flex parent refuses to shrink below the
              name's intrinsic width and wrapping never gets the chance to help.
            */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2">
              <span className="text-[10px] uppercase font-black px-2 py-0.5 rounded-full bg-primary/20 text-foreground border border-primary/30">
                {task.platform}
              </span>
              {/*
                Read-only. The rename pencil that used to sit here was one of four
                edit affordances on this screen; all four are now the single Edit
                button in the footer.
              */}
              <h2 id="task-modal-title" className="text-2xl font-bold min-w-0 break-words">{task.name}</h2>
              {onToggleFavorite && (
                <TaskFavoriteStar task={task} onToggle={onToggleFavorite} size={20} />
              )}
              {/*
                Beside the star, because they are the same kind of act — a
                Cronsole-side label on a task, touching no platform — and putting
                them together is what makes "in a collection" read as a peer of
                "starred" rather than as a filter that lives somewhere else.

                Labeled here and an icon on the rows. A star needs no caption —
                everyone already knows what one does — but a bookmark glyph next
                to it read as decoration, so the one surface with room to say
                "Add to collection" says it. That the same control is unlabeled
                on the rows is fine once it has been met once here; it is being
                unlabeled *and* nowhere else that hid the feature.
              */}
              <TaskCollectionMenu task={task} variant="labeled" />
            </div>
            <code className="text-xs text-subtle-foreground bg-background px-2 py-1 rounded">{task.externalId}</code>
            {/*
              Say it when the label and the machine have parted company. A rename
              is DB-only, so a Windows task keeps answering to its old path — and
              someone searching Task Scheduler for the new name would find
              nothing and reasonably conclude Cronsole had lost the task.
            */}
            {machineName && machineName !== task.name && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Renamed in Cronsole — Task Scheduler still calls it <span className="font-mono">{machineName}</span>.
              </p>
            )}
          </div>
          {/* Before Close — the buttons in this modal differ by source and two of
              them look alike and are not, which is exactly what the topic covers. */}
          <div className="flex items-center gap-1 shrink-0">
            <HelpButton topic="task-actions" size="md" />
            <button onClick={onClose} aria-label="Close task details" title="Close" className="p-2 hover:bg-muted rounded-full text-muted-foreground transition-colors">
              <XCircle size={24} />
            </button>
          </div>
        </header>
        <div className="px-6 pt-4 border-b border-border flex gap-1">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-4 py-2 rounded-t-lg text-xs font-bold transition-all border-b-2 ${activeTab === 'overview' ? 'text-foreground border-primary' : 'text-subtle-foreground border-transparent hover:text-foreground'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('runs')}
            className={`px-4 py-2 rounded-t-lg text-xs font-bold transition-all border-b-2 flex items-center gap-1.5 ${activeTab === 'runs' ? 'text-foreground border-primary' : 'text-subtle-foreground border-transparent hover:text-foreground'}`}
          >
            <History size={12} /> Run History
          </button>
        </div>

        {activeTab === 'runs' && (
          <div className="p-6 overflow-y-auto flex-1 text-foreground space-y-6">
            <section className="space-y-3">
              {/* Two groups, never one list. `ExecutionLog` is what Cronsole did;
                  the section below is what the platform did. Summing them would
                  mix populations in exactly the place the difference matters. */}
              <header className="flex items-center gap-2">
                <History size={13} className="text-subtle-foreground" />
                <h3 className="text-[11px] uppercase font-black tracking-widest text-foreground">Runs Cronsole performed</h3>
              </header>
              <div className="space-y-3">
            {executionsLoading ? (
              <div className="flex items-center justify-center py-16 text-subtle-foreground gap-2 text-sm">
                <Loader2 size={18} className="animate-spin" /> Loading run history…
              </div>
            ) : executionsError ? (
              <div className="text-xs text-danger-text bg-danger/5 border border-danger/30 rounded-xl px-4 py-3">
                Failed to load run history.
              </div>
            ) : !executions || executions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-subtle-foreground gap-2">
                <History size={32} className="opacity-30" />
                <p className="text-sm font-medium">No recorded runs yet</p>
                <p className="text-xs text-subtle-foreground">
                  Manual runs and Cronsole-scheduled fires appear here. A task running on its own
                  schedule elsewhere writes nothing to this list — look below for those.
                </p>
              </div>
            ) : (
              executions.map(run => (
                <div key={run.id} className="bg-background border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase font-black px-2 py-0.5 rounded-full border ${statusStyle(run.status)}`}>
                      <StatusIcon status={run.status} /> {run.status}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      {new Date(run.triggeredAt).toLocaleString()}
                      {run.durationMs != null && (
                        <span className="text-subtle-foreground"> · {run.durationMs >= 1000 ? `${(run.durationMs / 1000).toFixed(1)}s` : `${run.durationMs}ms`}</span>
                      )}
                    </span>
                  </div>
                  {run.log && (
                    <pre className="text-[10px] text-muted-foreground font-mono whitespace-pre-wrap break-all bg-surface/60 rounded-lg p-2.5 border border-border/60 max-h-28 overflow-y-auto">
                      {run.log}
                    </pre>
                  )}
                </div>
              ))
            )}
              </div>
            </section>

            {/* Renders nothing at all when the platform publishes no run history —
                the 400-by-absence convention, so five of six sources do not carry
                a permanent apology where their history would go. */}
            <PlatformRunHistory taskId={task.id} enabled={activeTab === 'runs'} />
          </div>
        )}

        {activeTab === 'overview' && (
        <div className="p-6 overflow-y-auto space-y-8 flex-1 text-foreground">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-background p-4 rounded-xl border border-border flex justify-between items-center">
              <div>
                <span className="text-xs text-subtle-foreground block mb-1">Status</span>
                <span className="font-semibold text-foreground uppercase tracking-tighter text-sm flex items-center gap-2">
                  <div className={`h-2.5 w-2.5 rounded-full ${task.status === 'ACTIVE' ? 'bg-success' : task.status === 'MISSING' ? 'bg-warning' : 'bg-muted-foreground'}`}></div>
                  {task.status}
                </span>
              </div>
              {task.status === 'MISSING' ? (
                // Nothing to enable/disable — the task is gone from the platform.
                // Honest note instead of a toggle that would 502 against a task
                // that isn't there. Re-sync heals it if the agent was just offline.
                <span className="text-[11px] text-subtle-foreground text-right max-w-[11rem] leading-snug">
                  Not found on the platform. Re-sync if the agent was offline, or delete to remove it.
                </span>
              ) : (
                <button
                  onClick={() => {
                    const nextStatus = task.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
                    statusMutation.mutate(nextStatus);
                  }}
                  disabled={statusMutation.isPending}
                  className="bg-muted hover:bg-muted/80 text-foreground px-3 py-1.5 rounded-lg text-xs font-bold transition-all border border-border active:scale-95 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {statusMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                  {task.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </button>
              )}
            </div>
            <div className="bg-background p-4 rounded-xl border border-border">
              <span className="text-xs text-subtle-foreground block mb-1">Last Result</span>
              {task.lastRunStatus ? (
                <span className={`inline-flex items-center gap-1.5 text-xs uppercase font-black px-2 py-0.5 rounded-full border ${statusStyle(task.lastRunStatus)}`}>
                  <StatusIcon status={task.lastRunStatus} /> {task.lastRunStatus}
                </span>
              ) : (
                <span className="font-semibold text-sm text-subtle-foreground">No runs recorded</span>
              )}
            </div>
            <div className="bg-background p-4 rounded-xl border border-border">
              <span className="text-xs text-subtle-foreground block mb-1">Next Run</span>
              <span className="font-semibold text-sm">{nextRun ? localTime(nextRun) : '—'}</span>
            </div>
            <div className="bg-background p-4 rounded-xl border border-border">
              <span className="text-xs text-subtle-foreground block mb-1">Last Run</span>
              <span className="font-semibold text-sm">{lastRun ? localTime(lastRun) : '—'}</span>
            </div>
          </div>

          {/* Schedule / Triggers */}
          <DetailSection icon={CalendarClock} title="Schedule">
            {sched.cron ? (
              <div className="bg-background rounded-xl border border-border p-4 space-y-2">
                {sched.human && <p className="text-sm font-semibold text-foreground">{sched.human}</p>}
                <code className="text-xs text-foreground/80 bg-surface px-2 py-1 rounded font-mono inline-block">{sched.cron}</code>
                <p className="text-[11px] text-subtle-foreground">
                  Stored as UTC cron (shown above) · read here in {zoneLabel(prefs.timezone)}.
                </p>
              </div>
            ) : (
              <div className="text-xs text-subtle-foreground bg-background border border-border rounded-xl px-4 py-3 flex items-start gap-2">
                <Info size={14} className="shrink-0 mt-0.5" />
                No direct schedule — this task runs on a trigger Cronsole can't express as cron (boot, logon, event, or on-demand only).
              </div>
            )}
            {sched.rows.length > 0 && <RowList rows={sched.rows} />}
          </DetailSection>

          {/* Actions — read-only here; the editor owns every field on this screen. */}
          <DetailSection icon={Terminal} title="Action">
            {actions.reported ? (
              <RowList rows={actions.rows} />
            ) : (
              <div className="text-xs text-subtle-foreground bg-background border border-border rounded-xl px-4 py-3 flex items-start gap-2">
                <Info size={14} className="shrink-0 mt-0.5" />
                {/* Advice, only where it applies. Republishing the Windows agent
                    is the fix on exactly one platform, and printing it on the
                    others blames a component they do not have — #77's shape. */}
                {task.platform === 'WINDOWS_TASK_SCHEDULER'
                  ? "The agent didn't report this task's action. Republish the Windows agent to surface the command it runs."
                  : `${platformSourceLabel(task.platform)} didn't report what this task runs.`}
              </div>
            )}
          </DetailSection>

          {/*
            **What this agent can reach.** Rendered only when the platform
            reports something, so the common case — including every trigger
            Cronsole creates, which declares no tools at all — shows nothing
            rather than a permanent "None" that the eye learns to skip.

            This is the most consequential fact about a scheduled autonomous
            task and it was invisible until now: a trigger with a shell and
            three MCP servers rendered identically to one that could only think.
            No credentials can appear here — the connector never parses an MCP
            server's `headers` in the first place.
          */}
          {(agentReach.tools.length > 0 || agentReach.domains.length > 0) && (
            <DetailSection icon={Wrench} title="What this agent can reach">
              <div className="space-y-3">
                {agentReach.tools.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {agentReach.tools.map((tool, i) => (
                      <span
                        key={`${tool.type}-${tool.name ?? i}`}
                        className="text-[11px] font-mono px-2 py-1 rounded-lg border border-border bg-background text-muted-foreground"
                        title={tool.url ?? undefined}
                      >
                        {tool.name ? `${tool.type}: ${tool.name}` : tool.type}
                        {tool.restricted && <span className="text-subtle-foreground"> (restricted)</span>}
                      </span>
                    ))}
                  </div>
                )}
                {agentReach.domains.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[10px] uppercase font-black tracking-widest text-subtle-foreground">
                      Network allowlist
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {agentReach.domains.map(domain => (
                        <span key={domain} className="text-[11px] font-mono px-2 py-1 rounded-lg border border-warning/30 bg-warning/5 text-warning-text">
                          {domain}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </DetailSection>
          )}

          {/* Settings (only when the agent reports them) */}
          {settings.length > 0 && (
            <DetailSection icon={SlidersHorizontal} title="Settings">
              <RowList rows={settings} />
            </DetailSection>
          )}

          <div className="bg-background p-4 rounded-xl border border-border">
            <span className="text-xs text-subtle-foreground block mb-2 uppercase font-bold tracking-widest">Local Category</span>
            <div className="flex items-center gap-2">
              <Folder size={14} className="text-foreground" />
              <span className="text-sm font-semibold">{task.category || 'Uncategorized'}</span>
            </div>
          </div>

          <details className="group">
            <summary className="text-xs font-bold text-subtle-foreground uppercase cursor-pointer select-none hover:text-foreground transition-colors list-none flex items-center gap-2">
              <span className="transition-transform group-open:rotate-90">▸</span> Raw platform metadata
            </summary>
            <pre className="mt-2 text-[10px] bg-background p-4 rounded-xl border border-border overflow-x-auto font-mono text-foreground/80">
              {JSON.stringify(task.metadata, null, 2)}
            </pre>
          </details>
        </div>
        )}
        <footer className="p-6 bg-background border-t border-border flex flex-wrap gap-3">
          {/*
            Two removals, and the entire design is in telling them apart.
            "Remove from Cronsole" keeps the scheduled task and forgets it here;
            "Delete from Windows" destroys the real thing. They differ only in
            blast radius and one is irreversible, so they get different verbs,
            different icons, different colours, and confirm copy that names what
            SURVIVES rather than what goes. A single "Delete" with a checkbox is
            the version of this that eventually erases someone's backup job.
          */}
          {/*
            Claude gets a third verb, because neither of the two above is true
            for it. A Claude task is tracked because the routine is **declared**
            in the connection config — that registry is the platform — so
            "Remove from Cronsole" would delete the row and leave the
            declaration, and the next sync would bring it straight back (the
            server refuses it for exactly that reason). There is no
            "Delete from the platform" either: Cronsole cannot delete a routine
            at claude.ai and never will.

            So the honest control is *disconnect the routine*, and its
            confirmation has to name the one thing that is actually spent — the
            API token, which claude.ai shows once and cannot re-display.
          */}
          {task.platform === 'CLAUDE_CODE' && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: 'Disconnect this routine?',
                  message:
                    `"${task.name}" will disappear from this dashboard along with its Cronsole run history, ` +
                    'and Cronsole will forget the routine id and its API token.\n\n' +
                    'The routine itself keeps running at claude.ai on its own schedule — Cronsole has no way ' +
                    'to pause or delete it there.\n\n' +
                    'Reconnecting later needs the token again, and claude.ai only shows it once, so you would ' +
                    'have to generate a new one.',
                  confirmText: 'Disconnect routine',
                  tone: 'default'
                });
                if (ok) {
                  disconnectRoutineMutation.mutate(task.externalId, {
                    onSuccess: () => {
                      toast(`"${task.name}" disconnected. The routine still runs at claude.ai.`, 'success');
                      onClose();
                    },
                    onError: (error: unknown) => {
                      const err = error as Error & { response?: { data?: { error?: string } } };
                      toast(`Disconnect failed: ${err.response?.data?.error || err.message}`, 'error');
                    }
                  });
                }
              }}
              disabled={disconnectRoutineMutation.isPending}
              className="bg-muted hover:bg-muted/80 text-foreground px-4 py-3 rounded-xl font-bold transition-all border border-border active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50"
              title="Forget this routine's id and token. The routine keeps running at claude.ai."
            >
              {disconnectRoutineMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <EyeOff size={16} />} Disconnect routine
            </button>
          )}
          {task.platform !== 'TASKHUB_NATIVE' && task.platform !== 'CLAUDE_CODE' && (
            <button
              onClick={async () => {
                const ok = await confirm({
                  title: 'Remove from Cronsole?',
                  message:
                    `"${task.name}" will disappear from this dashboard along with its Cronsole run history.\n\n` +
                    'The scheduled task itself is NOT deleted — it stays on the machine and keeps running ' +
                    'on its own schedule. Cronsole just stops tracking it, and will not re-import it on the ' +
                    'next sync. Import its category again to bring it back.',
                  confirmText: 'Remove from Cronsole',
                  tone: 'default'
                });
                if (ok) {
                  untrackMutation.mutate();
                }
              }}
              disabled={untrackMutation.isPending}
              className="bg-muted hover:bg-muted/80 text-foreground px-4 py-3 rounded-xl font-bold transition-all border border-border active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50"
              title="Stop tracking this task in Cronsole. The scheduled task stays on the machine and keeps running."
            >
              {untrackMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <EyeOff size={16} />} Remove from Cronsole
            </button>
          )}
          {/*
            Offered only where there is a credential to replace — a Gemini task
            carrying at least one tool. The verb recreates the trigger, so it is
            not a maintenance nicety to show on every task: it is a deliberate
            action with a new platform id at the end of it.
          */}
          {task.platform === 'GEMINI_TRIGGERS' && agentReach.tools.length > 0 && (
            <button
              onClick={() => setRotating(true)}
              className="bg-gemini/10 hover:bg-gemini/20 text-gemini-text px-4 py-3 rounded-xl font-bold transition-all border border-gemini/30 active:scale-95 text-sm flex items-center gap-2"
              title="Recreate this trigger with new agent credentials"
            >
              <KeyRound size={16} /> Replace credentials
            </button>
          )}
          {/*
            **Gated on the server's matrix, not on a list of platform literals.**
            The literals were `{TASKHUB_NATIVE, WINDOWS_TASK_SCHEDULER}`, so
            Gemini had no Delete control at all — although its connector
            implements `deleteTask`, `DELETE /api/tasks/:id` calls it, and its
            matrix cell reads `verified`. The only removal on screen was the one
            that leaves the trigger running on the platform.

            `!== 'no'` rather than `=== 'yes'`: while the matrix is in flight the
            answer is `unknown`, and hiding a destructive control someone is
            reaching for because a request has not landed yet is worse than
            showing one the route would refuse with a sentence. Claude is excluded
            by name — it has its own third verb above (disconnect), because
            neither removal is true for a routine Cronsole cannot delete.
          */}
          {deletability(task.platform) !== 'no' && task.platform !== 'CLAUDE_CODE' && (() => {
            const isWindowsTask = task.platform === 'WINDOWS_TASK_SCHEDULER';
            const isNativeTask = task.platform === 'TASKHUB_NATIVE';
            // "Windows" reads better than the full source label in a button, and
            // is the one platform whose short name everyone already uses.
            const where = isWindowsTask ? 'Windows' : platformSourceLabel(task.platform);
            return (
              <button
                onClick={async () => {
                  // Every message names what SURVIVES and points at the softer
                  // control by name. On a hosted source the platform's object *is*
                  // the task, so Delete and Remove from Cronsole sit one button
                  // apart and only one of them can be undone.
                  const scope = isNativeTask
                    ? `Delete "${task.name}" and its run history? This task exists only inside Cronsole, so this cannot be undone.`
                    : `"${task.name}" will be deleted from ${isWindowsTask ? 'Windows Task Scheduler' : where} itself, along with its Cronsole run history. It will stop existing there and will never run again.\n\nThis cannot be undone. To keep it running and only stop tracking it here, use "Remove from Cronsole" instead.`;
                  const ok = await confirm({
                    title: isNativeTask ? 'Delete task?' : `Delete from ${where}?`,
                    message: scope,
                    confirmText: isNativeTask ? 'Delete' : `Delete from ${where}`,
                    tone: 'danger'
                  });
                  if (ok) {
                    deleteMutation.mutate();
                  }
                }}
                disabled={deleteMutation.isPending}
                className="bg-danger/10 hover:bg-danger/20 text-danger-text px-4 py-3 rounded-xl font-bold transition-all border border-danger/30 active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50"
                title={isWindowsTask
                  ? 'Permanently delete this task from Windows Task Scheduler (via the agent)'
                  : isNativeTask
                    ? 'Delete this Cronsole-native task'
                    : `Permanently delete this task from ${where}`}
              >
                {deleteMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                {isNativeTask ? 'Delete' : `Delete from ${where}`}
              </button>
            );
          })()}
          {(task.platform === 'TASKHUB_NATIVE' || task.platform === 'WINDOWS_TASK_SCHEDULER') && (() => {
            // Save-as-template needs a cron-expressible schedule (the template's
            // required scheduleExpression); a boot/logon-only Windows task has none.
            const canSave = !!task.schedule && !saveTemplateMutation.isPending;
            return (
              <button
                onClick={() => canSave && saveTemplateMutation.mutate()}
                disabled={!canSave}
                title={task.schedule
                  ? 'Save this task as a reusable template in the library'
                  : "This task's trigger isn't cron-expressible, so it can't be saved as a template."}
                className="bg-primary/10 hover:bg-primary/20 text-primary px-4 py-3 rounded-xl font-bold transition-all border border-primary/30 active:scale-95 text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
              >
                {saveTemplateMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <BookmarkPlus size={16} />} Save as template
              </button>
            );
          })()}
          {/*
            No longer gated on the two platforms with a native definition: the
            portable template is built from the DB row and reaches no platform,
            so it works for a Claude routine too — where the native half is the
            one that cannot. The menu says which is which rather than the button
            vanishing and leaving no way to ask.
          */}
          <TaskExportMenu task={task} onExport={handleExport} exporting={exporting} />
          {/*
            The one edit control. Never disabled: name and category are editable
            on every platform, so there is no task for which "nothing can be
            changed" is true. The parts that *this* platform cannot change are
            stated inside the editor, in words — a disabled button with a tooltip
            explaining why cannot be read on a phone, which this app must work on.
          */}
          <button
            onClick={() => setShowEditor(true)}
            title="Edit this task’s name, category, schedule and what it runs"
            className="flex-1 bg-muted hover:bg-muted/80 py-3 rounded-xl font-bold transition-all border border-border active:scale-95 text-sm flex items-center justify-center gap-2"
          >
            <Pencil size={16} /> Edit
          </button>
          <button
            onClick={() => { if (isRunnable(task)) { onRun(task); onClose(); } }}
            disabled={!isRunnable(task)}
            title={isRunnable(task) ? undefined : runButtonTitle(task)}
            className="flex-1 bg-success hover:bg-success-hover text-success-foreground py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-success/20 active:scale-95 text-sm disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100 disabled:shadow-none"
          >
            <Play size={16} fill="currentColor" /> Run Now
          </button>
        </footer>
    </Modal>
      {showEditor && (
        <EditTaskModal
          task={task}
          executionHost={nativeExecutionHost}
          onClose={() => setShowEditor(false)}
        />
      )}
      {rotating && <RotateCredentialsModal task={task} onClose={() => setRotating(false)} />}
    </>
  );
};
