import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  XCircle, Loader2, CheckCircle2, AlertTriangle, Lock,
  Tag, CalendarClock, Terminal, Save, KeyRound
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useConfirm } from '../hooks/useConfirm';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { errorMessage } from '../utils/errorMessage';
import { Modal } from './ui/Modal';
import { ScheduleFields } from './edit/ScheduleFields';
import { WindowsActionFields } from './edit/WindowsActionFields';
import { NativeJobFields } from './edit/NativeJobFields';
import { TaskSecretsFields, type StoredSecretsState } from './edit/TaskSecretsFields';
import { HelpButton } from './HelpButton';
import {
  labelValues, platformName, runsEdit, scheduleEdit,
  nativeJobPayload, nativeJobUnreadable, nativeJobIncomplete, windowsActionPayload, emptyNativeJobValues,
  type LabelValues, type NativeJobValues, type WindowsActionValues
} from '../utils/taskEditing';

/**
 * The **one** editor for a task.
 *
 * This replaced four separate edit affordances scattered across the task modal —
 * a rename pencil in the title, a "Change" link on the category card, an "Edit"
 * in the Action section header, and an "Edit Schedule" button in the footer —
 * each opening something with a different shape. One entry point, one form.
 *
 * ## One button, still three routes
 *
 * The thing this must not paper over: a task's editable parts are written by
 * **three different routes**, and they do not fail alike.
 *
 *   - `PATCH /tasks/:id`          — name + category. Cronsole labels; a DB write
 *                                   this process owns. Cannot be refused.
 *   - `PATCH /tasks/:id/schedule` — rebuilds the trigger. On Windows that is an
 *                                   elevated agent round trip that can time out.
 *   - `PATCH /tasks/:id/actions`  — Windows: the agent rewrites the task on the
 *     `PATCH /tasks/:id/job`        machine. Native: the DB row *is* the task.
 *
 * That is deliberate and stays that way (see CLAUDE.md §9 — "Editing what a task
 * runs is two routes, because it is two different operations"). What changes here
 * is only the *gesture*: the user makes one, and the modal fans it out.
 *
 * So the save is **per section, reported per section** — the same rule the bulk
 * verbs follow, for the same reason: at this scale partial success is the normal
 * case, not an exception. Only changed sections are sent; each records its own
 * outcome; a section that succeeded is re-baselined so it goes clean and a retry
 * sends only what is still outstanding. An all-or-nothing promise was rejected
 * because its rollback runs through the same offline agent that just failed —
 * it would produce exactly the half-edited task it claims to prevent.
 *
 * Two smaller consequences worth keeping. A section the platform cannot edit
 * renders as a **stated reason**, not as a disabled control with a tooltip — a
 * tooltip is unreachable on the phone this app is required to work on. And form
 * state deliberately survives a background refetch of `task`: the query
 * invalidating underneath an open editor must never discard what someone typed.
 */

type SectionKey = 'labels' | 'schedule' | 'runs';
type SectionStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved' }
  | { state: 'failed'; message: string };

interface SectionPlan {
  key: SectionKey;
  title: string;
  icon: LucideIcon;
  /** Differs from what is stored, so this section is part of the next Save. */
  dirty: boolean;
  /** Blocks Save while dirty; the sentence is shown under the section. */
  problem?: string;
  save: () => Promise<void>;
  /** Re-read the saved values as the new baseline, so the section goes clean. */
  settle: () => void;
}

interface Props {
  task: Task;
  /** Where a Cronsole-native task actually executes, for the EXEC warning. */
  executionHost?: string;
  onClose: () => void;
}

const EMPTY_WINDOWS: WindowsActionValues = { command: '', workingDirectory: '', description: '', runLevel: 'least' };
// From the shared factory rather than a literal: a literal here is a second
// definition of the form's shape, and adding a job type would leave it missing
// fields that the prefill path sets — the drift `emptyNativeJobValues` removes.
const EMPTY_NATIVE: NativeJobValues = emptyNativeJobValues();

/** The backend's own sentence, with the one error worth translating translated.
 *  "Agent offline" is technically accurate and tells a user nothing about what to
 *  go and do. */
const saveError = (err: unknown, platform: string): string => {
  const msg = errorMessage(err, 'Save failed.');
  return msg === 'Agent offline' && platform === 'WINDOWS_TASK_SCHEDULER'
    ? 'The Windows agent is not connected. Check that the CronsoleAgent scheduled task is running.'
    : msg;
};

export const EditTaskModal = ({ task, executionHost, onClose }: Props) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const confirm = useConfirm();
  const zone = useScheduleZone();

  const schedule = scheduleEdit(task);
  const runs = runsEdit(task);

  /*
   * A task's secrets are a **separate resource with their own routes** (ADR
   * 0003), so they are read and written here rather than folded into the Save
   * fan-out below. That is not tidiness: `PATCH /:id/job` replaces the job, so a
   * secret carried inside it would be destroyed by every unrelated job edit —
   * which is the whole reason the values do not live there.
   *
   * The query is the only source of `referenced`/`stored`/`missing`. The browser
   * does not re-derive them for a task that exists; the server owns that
   * judgement and reports all three.
   */
  const isNative = task.platform === 'TASKHUB_NATIVE';
  const secretsQuery = useQuery<StoredSecretsState>({
    queryKey: ['task-secrets', task.id],
    queryFn: async () => (await api.get(`/tasks/${task.id}/secrets`)).data,
    enabled: isNative
  });

  const refreshSecrets = () =>
    queryClient.invalidateQueries({ queryKey: ['task-secrets', task.id] });

  const setSecret = async (name: string, value: string) => {
    try {
      await api.put(`/tasks/${task.id}/secrets/${encodeURIComponent(name)}`, { value });
    } catch (err) {
      // The server's own sentence — every refusal here states its reason, and
      // replacing it with a generic one throws that away.
      throw new Error(errorMessage(err, 'Could not save that secret.'), { cause: err });
    }
    await refreshSecrets();
  };

  const removeSecret = async (name: string) => {
    try {
      await api.delete(`/tasks/${task.id}/secrets/${encodeURIComponent(name)}`);
    } catch (err) {
      throw new Error(errorMessage(err, 'Could not remove that secret.'), { cause: err });
    }
    await refreshSecrets();
  };

  // ---- Values, and the baseline each is compared against -------------------
  // The baseline is state rather than derived from `task` so a section that
  // saved can go clean without waiting for a refetch — and so a refetch landing
  // mid-edit cannot silently redefine "unchanged" underneath the user.
  const [labels, setLabels] = useState<LabelValues>(() => labelValues(task));
  const [labelBase, setLabelBase] = useState<LabelValues>(() => labelValues(task));

  // Held in the user's zone; converted to UTC exactly once, on save.
  const [cron, setCron] = useState(() => (schedule.editable ? zone.toZone(schedule.initial).cron : ''));
  const [cronBase, setCronBase] = useState(() => (schedule.editable ? schedule.initial : ''));

  const [winAction, setWinAction] = useState<WindowsActionValues>(() => (runs.kind === 'windows' ? runs.initial : EMPTY_WINDOWS));
  const [winBase, setWinBase] = useState<WindowsActionValues>(() => (runs.kind === 'windows' ? runs.initial : EMPTY_WINDOWS));

  const [nativeJob, setNativeJob] = useState<NativeJobValues>(() => (runs.kind === 'native' ? runs.initial : EMPTY_NATIVE));
  const [nativeBase, setNativeBase] = useState<NativeJobValues>(() => (runs.kind === 'native' ? runs.initial : EMPTY_NATIVE));

  const [status, setStatus] = useState<Record<SectionKey, SectionStatus>>({
    labels: { state: 'idle' },
    schedule: { state: 'idle' },
    runs: { state: 'idle' }
  });
  const [saving, setSaving] = useState(false);
  /** Set once a Save has run and left something behind, so the summary line is
   *  shown only after an attempt — not over a form nobody has submitted yet. */
  const [attempted, setAttempted] = useState(false);

  const mark = (key: SectionKey, next: SectionStatus) =>
    setStatus(prev => ({ ...prev, [key]: next }));

  // ---- Sections ------------------------------------------------------------
  // Built as one list so the count on the Save button, the per-section report and
  // the save loop cannot disagree about what is being written.
  const plans: SectionPlan[] = [];

  const labelDirty =
    labels.name.trim() !== labelBase.name.trim() ||
    labels.category.trim() !== labelBase.category.trim();

  plans.push({
    key: 'labels',
    title: 'Name & category',
    icon: Tag,
    dirty: labelDirty,
    problem: labels.name.trim() ? undefined : 'A task needs a name.',
    save: async () => {
      await api.patch(`/tasks/${task.id}`, {
        name: labels.name.trim(),
        category: labels.category.trim()
      });
    },
    settle: () => setLabelBase({ name: labels.name.trim(), category: labels.category.trim() })
  });

  if (schedule.editable) {
    const storedCron = zone.toUtc(cron).cron.trim();
    plans.push({
      key: 'schedule',
      title: 'Schedule',
      icon: CalendarClock,
      // Compare what would be SAVED, not what is typed. The field is zone-local,
      // so comparing it against the stored UTC cron would report every schedule
      // as changed the moment the modal opened.
      dirty: storedCron !== cronBase.trim(),
      problem: cron.trim() ? undefined : 'A schedule needs a cron expression.',
      save: async () => { await api.patch(`/tasks/${task.id}/schedule`, { schedule: storedCron }); },
      settle: () => setCronBase(storedCron)
    });
  }

  if (runs.kind === 'windows') {
    const payload = windowsActionPayload(winAction);
    plans.push({
      key: 'runs',
      title: 'What it runs',
      icon: Terminal,
      dirty: JSON.stringify(payload) !== JSON.stringify(windowsActionPayload(winBase)),
      problem: winAction.command.trim() ? undefined : 'A command is required.',
      save: async () => { await api.patch(`/tasks/${task.id}/actions`, payload); },
      settle: () => setWinBase(winAction)
    });
  } else if (runs.kind === 'native') {
    const payload = nativeJobPayload(nativeJob);
    const basePayload = nativeJobPayload(nativeBase);
    /*
     * `nativeJobIncomplete` rather than a check written here — the same one the
     * New Task modal gates on, which is what its doc comment always claimed and
     * this file did not honour. The local version knew two job types: anything
     * not HTTP had to have a `command`, so editing a **script** or a **check**
     * was blocked by "A command is required." over a field that type does not
     * have. It also names the unreadable field (headers on HTTP, environment on
     * EXEC and SCRIPT) instead of reporting every null payload as a headers
     * problem, on a type that may have no headers at all.
     */
    const problem = nativeJobIncomplete(nativeJob) ?? undefined;
    plans.push({
      key: 'runs',
      title: 'What it runs',
      icon: Terminal,
      // A null payload means a field cannot be read. That counts as dirty on
      // purpose: it must block Save rather than be quietly treated as unchanged.
      dirty: payload === null || JSON.stringify(payload) !== JSON.stringify(basePayload),
      problem,
      save: async () => {
        if (!payload) throw new Error(nativeJobUnreadable(nativeJob) ?? 'This job cannot be read.');
        await api.patch(`/tasks/${task.id}/job`, { job: payload });
      },
      settle: () => setNativeBase(nativeJob)
    });
  }

  const dirtyPlans = plans.filter(p => p.dirty);
  /*
   * A validation problem in *any* dirty section blocks the whole Save, which is
   * deliberately not how a platform *failure* is treated. The line between them:
   * a validation problem is knowable before anything is sent and the fix is right
   * there on screen, so sending around it would mean choosing to submit a form
   * that is visibly wrong. A platform failure cannot be known in advance, so
   * refusing to attempt the other sections because of it would withhold work for
   * a reason that had nothing to do with them.
   */
  const blocked = dirtyPlans.find(p => p.problem);
  const canSave = dirtyPlans.length > 0 && !blocked && !saving;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setAttempted(true);
    // Clear only the sections about to be attempted — a section that succeeded on
    // a previous press and is now clean keeps its ✓ rather than blinking back to
    // neutral, so "2 of 3 saved" stays legible across a retry.
    dirtyPlans.forEach(p => mark(p.key, { state: 'saving' }));

    const failures: string[] = [];
    // Sequential, in the order the sections appear on screen. Two agent round
    // trips at once would race for one socket, and a report ordered differently
    // from the form is its own small lie.
    for (const plan of dirtyPlans) {
      try {
        await plan.save();
        plan.settle();
        mark(plan.key, { state: 'saved' });
      } catch (err) {
        const message = saveError(err, task.platform);
        mark(plan.key, { state: 'failed', message });
        failures.push(`${plan.title}: ${message}`);
      }
    }

    queryClient.invalidateQueries({ queryKey: ['tasks'] });
    setSaving(false);

    if (failures.length === 0) {
      toast(`Updated "${labels.name.trim()}".`, 'success');
      onClose();
      return;
    }
    toast(
      failures.length === dirtyPlans.length
        ? `Nothing was saved. ${failures[0]}`
        : `Saved ${dirtyPlans.length - failures.length} of ${dirtyPlans.length} changes — the rest is unchanged.`,
      'error'
    );
  };

  const handleClose = async () => {
    if (dirtyPlans.length > 0) {
      const ok = await confirm({
        title: 'Discard unsaved changes?',
        message: `${dirtyPlans.length} change${dirtyPlans.length === 1 ? '' : 's'} to "${task.name}" ${dirtyPlans.length === 1 ? 'has' : 'have'} not been saved. Closing now leaves the task exactly as it is.`,
        confirmText: 'Discard changes',
        tone: 'default'
      });
      if (!ok) return;
    }
    onClose();
  };

  const savedCount = plans.filter(p => status[p.key].state === 'saved').length;
  const failedCount = plans.filter(p => status[p.key].state === 'failed').length;

  const platformLabelName = platformName(task);

  return (
    <Modal
      onClose={handleClose}
      overlayClassName="z-[60]"
      closeOnBackdrop={false}
      labelledBy="edit-task-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
      <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
        <div className="min-w-0">
          <p className="text-[10px] uppercase font-black tracking-widest mb-1 text-foreground">{task.platform}</p>
          <h2 id="edit-task-title" className="text-xl font-bold">Edit task</h2>
          <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
            Everything editable about <span className="font-semibold text-foreground">{task.name}</span> in one place.
            Only what you change is sent, and each part reports its own result.
          </p>
        </div>
        <button onClick={handleClose} aria-label="Close editor" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
          <XCircle size={20} />
        </button>
      </header>

      <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
        {/* ---------------------------------------------------------------- */}
        <Section title="Name & category" icon={Tag} status={status.labels}>
          <div className="space-y-2">
            <label htmlFor="edit-task-name" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              Name <span className="text-danger-text">*</span>
            </label>
            <input
              id="edit-task-name"
              value={labels.name}
              maxLength={200}
              onChange={e => setLabels({ ...labels, name: e.target.value })}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
            {/*
              A rename is DB-only. A Windows task keeps answering to its Task
              Scheduler path, so someone who renames one here and then searches
              Task Scheduler for the new name finds nothing and reasonably
              concludes Cronsole lost the task. Said here, before the save.
            */}
            {platformLabelName && (
              <p className="text-[11px] text-subtle-foreground">
                Renames in Cronsole only — Task Scheduler keeps calling it{' '}
                <span className="font-mono text-foreground">{platformLabelName}</span>.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="edit-task-category" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
              Category
            </label>
            <input
              id="edit-task-category"
              value={labels.category}
              onChange={e => setLabels({ ...labels, category: e.target.value })}
              placeholder="Uncategorized"
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary transition-colors"
            />
            {task.platform === 'WINDOWS_TASK_SCHEDULER' && (
              <p className="text-[11px] text-subtle-foreground">
                A Cronsole label. The task stays in its Task Scheduler folder — changing this here does not move it.
              </p>
            )}
          </div>
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="Schedule" icon={CalendarClock} status={status.schedule}>
          {schedule.editable ? (
            <ScheduleFields value={cron} onChange={setCron} platform={task.platform} disabled={saving} />
          ) : (
            <Refusal reason={schedule.reason} />
          )}
        </Section>

        {/* ---------------------------------------------------------------- */}
        <Section title="What it runs" icon={Terminal} status={status.runs}>
          {runs.kind === 'windows' ? (
            <WindowsActionFields value={winAction} onChange={setWinAction} disabled={saving} />
          ) : runs.kind === 'native' ? (
            <NativeJobFields
              value={nativeJob}
              onChange={setNativeJob}
              storedJobType={nativeBase.jobType}
              executionHost={executionHost}
              disabled={saving}
            />
          ) : (
            <Refusal reason={runs.reason} />
          )}
        </Section>

        {/* ----------------------------------------------------------------
            Secrets. Native only, and it renders even when the task has none —
            an empty destination is still where you go to add the first one,
            and hiding the section until a secret exists makes the feature
            undiscoverable from the only screen that can create it.

            Deliberately NOT a `Section` with a StatusChip: these writes are not
            part of Save changes, so a chip reporting "Saved" beside them would
            be describing a different button.
        ---------------------------------------------------------------- */}
        {isNative && runs.kind === 'native' && (
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-xs font-bold text-subtle-foreground uppercase tracking-widest">
              <KeyRound size={13} /> Secrets<HelpButton topic="task-secrets" />
            </h3>
            {secretsQuery.isLoading ? (
              <p className="text-[11px] text-subtle-foreground flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Reading this task's secrets…
              </p>
            ) : secretsQuery.isError ? (
              /* Never rendered as "no secrets": not knowing and knowing there
                 are none are different facts, and only one of them is safe to
                 act on. */
              <p className="text-[11px] text-danger-text flex items-start gap-1.5">
                <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                Cronsole could not read which secrets this task has. Nothing is shown rather than an
                empty list, because those are different answers.
              </p>
            ) : (
              <TaskSecretsFields
                job={nativeJob}
                mode="live"
                state={secretsQuery.data}
                onSet={setSecret}
                onRemove={removeSecret}
                busy={saving}
              />
            )}
          </section>
        )}
      </div>

      <footer className="p-6 bg-background border-t border-border space-y-3">
        {/* The summary the whole per-section design exists to be able to write. */}
        {attempted && failedCount > 0 && (
          <p className="text-[11px] text-warning-text flex items-start gap-1.5">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            {savedCount > 0
              ? `${savedCount} of ${savedCount + failedCount} parts saved. The rest is unchanged — fix what failed and press Save again.`
              : 'Nothing was saved. The task is exactly as it was.'}
          </p>
        )}
        {blocked?.problem && (
          <p className="text-[11px] text-danger-text flex items-start gap-1.5">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {blocked.title}: {blocked.problem}
          </p>
        )}
        <div className="flex gap-4">
          <button onClick={handleClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">
            {dirtyPlans.length > 0 ? 'Cancel' : 'Close'}
          </button>
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="flex-[2] py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover"
          >
            {saving
              ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
              : <><Save size={16} /> Save changes{dirtyPlans.length > 0 ? ` (${dirtyPlans.length})` : ''}</>}
          </button>
        </div>
      </footer>
    </Modal>
  );
};

// ---------------------------------------------------------------------------

/** One editable part, with the outcome of its own write beside its title. */
const Section = ({ title, icon: Icon, status, children }: {
  title: string;
  icon: LucideIcon;
  status: SectionStatus;
  children: React.ReactNode;
}) => (
  <section className="space-y-4">
    <div className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-xs font-bold text-subtle-foreground uppercase tracking-widest">
        <Icon size={13} /> {title}
      </h3>
      <StatusChip status={status} />
    </div>
    {children}
  </section>
);

const StatusChip = ({ status }: { status: SectionStatus }) => {
  if (status.state === 'idle') return null;
  if (status.state === 'saving') {
    return (
      <span className="text-[10px] font-bold text-subtle-foreground flex items-center gap-1">
        <Loader2 size={11} className="animate-spin" /> Saving…
      </span>
    );
  }
  if (status.state === 'saved') {
    return (
      <span className="text-[10px] font-bold text-success-text flex items-center gap-1">
        <CheckCircle2 size={11} /> Saved
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold text-danger-text flex items-start gap-1 text-right max-w-[16rem]">
      <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {status.message}
    </span>
  );
};

/**
 * A part this platform will not let Cronsole change, stated in words.
 *
 * Deliberately not a disabled control with a `title=` — the reason is the useful
 * half, and a tooltip cannot be read on the phone this app is required to work on.
 */
const Refusal = ({ reason }: { reason: string }) => (
  <div className="text-xs text-subtle-foreground bg-background border border-border rounded-xl px-4 py-3 flex items-start gap-2">
    <Lock size={14} className="shrink-0 mt-0.5" />
    <span>{reason}</span>
  </div>
);

export default EditTaskModal;
