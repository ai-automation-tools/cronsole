import { useEffect, useRef, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, Zap, Info, Monitor, CheckCircle2, AlertTriangle, Terminal, Bot, Sparkles, Upload, KeyRound } from 'lucide-react';
import { importTaskFile, TaskFileImportError } from '../utils/importTaskFile';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { Modal } from './ui/Modal';
import { ScheduleZoneHint } from './ScheduleZoneHint';
import { ScheduleBuilder } from './ScheduleBuilder';
import { usePlatformMatrix } from '../hooks/usePlatformMatrix';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';
import { NativeJobFields } from './edit/NativeJobFields';
import { TaskSecretsFields, type PendingSecret } from './edit/TaskSecretsFields';
import { PromptPreflightNotes } from './PromptPreflightNotes';
import { usePromptPreflight } from '../hooks/usePromptPreflight';
import { AgentReachEditor } from './AgentReachEditor';
import { reachPayload, type AgentToolDraft } from '../utils/agentReach';
import {
  emptyNativeJobValues,
  nativeJobPayload,
  nativeJobIncomplete,
  type NativeJobValues
} from '../utils/taskEditing';
import { useGeminiToolPresets } from '../hooks/useGeminiConnection';

/**
 * The three things this modal can put on your dashboard — and one of them is
 * not like the others.
 *
 * Cronsole-native and Windows are **created**: Cronsole writes a task that did
 * not exist before. `CLAUDE_CODE` is **connected**: Anthropic exposes no create
 * endpoint, so the routine already exists at claude.ai and all Cronsole can do
 * is learn its id and token. The modal says so throughout — different title,
 * different verb on the button, no schedule field — because a "New Task" flow
 * that quietly means something else for one option is how a user ends up
 * believing Cronsole made a routine that it did not.
 */
type CreatePlatform =
  | 'TASKHUB_NATIVE'
  | 'WINDOWS_TASK_SCHEDULER'
  | 'CLAUDE_CODE'
  /**
   * The fourth option, added 2026-08-24, and the one that stretches this form's
   * vocabulary rather than reusing it.
   *
   * It belongs on the **created** side of the split above: Gemini is the first
   * *hosted* platform Cronsole can create on, so unlike Claude this really does
   * write a task that did not exist. What it does not share with Windows is the
   * shape of the thing being created — a trigger's unit of work is a
   * **prompt**, not a command line. So the target field is a prompt, with its
   * own state and its own label, rather than a command box wearing new help
   * text: the two are not the same kind of value, and a half-typed shell line
   * left behind by switching platforms is a worse default than an empty box.
   */
  | 'GEMINI_TRIGGERS';

interface CreateTaskModalProps {
  onClose: () => void;
  /**
   * Open the form already filled in — **Duplicate**, on a source whose tasks
   * cannot be edited in place.
   *
   * A Gemini trigger is immutable, so "change the prompt" is really "make
   * another one like this and delete the old". That was a retype of everything
   * including the credential; with saved servers it is a prefilled form and a
   * checkbox that is already ticked. There is no credential here — the tools
   * arrive as **preset references**, and a hand-typed server arrives without its
   * token, which is stated in the form rather than silently carried as blank.
   */
  initial?: {
    platform?: CreatePlatform;
    name?: string;
    schedule?: string;
    prompt?: string;
    category?: string;
    agentTools?: AgentToolDraft[];
    agentAllowlist?: string[];
  };
}

/**
 * Creates a task on a chosen platform:
 * - Cronsole-native — scheduled and executed by the backend itself, no OS entry
 *   (docs/resources/Native_Tasks.md).
 * - Windows — registered as a real Task Scheduler task under \Cronsole\ via the
 *   agent, with the cron converted to a native trigger (same path as templates).
 */
export const CreateTaskModal = ({ onClose, initial }: CreateTaskModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [platform, setPlatform] = useState<CreatePlatform>(initial?.platform ?? 'TASKHUB_NATIVE');
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState(initial?.category ?? 'Cronsole');
  const zone = useScheduleZone();
  // Held in the user's zone; converted to UTC once, on submit. "0 8" now means
  // 8am where you are rather than 8am UTC.
  const [schedule, setSchedule] = useState(initial?.schedule ?? '0 8 * * *');
  const storedSchedule = zone.toUtc(schedule);
  // The native job spec, in the **same shape the edit modal uses**. It was six
  // separate `useState`s covering only HTTP and EXEC, which is how a create form
  // and an edit form end up accepting different jobs — the four job types would
  // each have had two field sets, two validations and two payload builders.
  // `NativeJobFields` renders it and `nativeJobPayload` serializes it, so the
  // wire format has one definition.
  const [job, setJob] = useState<NativeJobValues>(emptyNativeJobValues);
  /*
   * Collected locally and sent WITH the create (ADR 0003). There is no task to
   * PUT to yet, and doing it as a second request afterwards would mean a task
   * could exist holding a reference to a credential that failed to store — the
   * half-created state the atomic form exists to avoid.
   */
  const [secrets, setSecrets] = useState<PendingSecret[]>([]);

  // Where a native task will actually run. Read from the platform matrix rather
  // than assumed: the same spec means "your machine" on a host-run backend and
  // "inside the container" on the Dockerized one, and only the server knows which.
  const { data: matrix } = usePlatformMatrix();
  const executionHost = matrix?.platforms.find(p => p.platform === 'TASKHUB_NATIVE')?.executionHost ?? null;
  // Windows fields
  const [command, setCommand] = useState('');
  // Gemini's target: the instruction its agent runs on the schedule. Deliberately
  // its own state rather than sharing `command` — see `CreatePlatform`.
  const [prompt, setPrompt] = useState(initial?.prompt ?? '');
  // What the agent may use and reach. Both start empty, which is the standing
  // rule: Cronsole never guesses an agent's reach, so a create that ignores this
  // section produces the plainest environment the API accepts.
  const [agentTools, setAgentTools] = useState<AgentToolDraft[]>(initial?.agentTools ?? []);
  const [agentAllowlist, setAgentAllowlist] = useState<string[]>(initial?.agentAllowlist ?? []);
  // Saved MCP servers, fetched only when the Gemini arm is showing: every other
  // platform has nothing to do with them, and a query on every New Task click
  // would ask the server about a source the user is not using.
  const { data: presets } = useGeminiToolPresets(platform === 'GEMINI_TRIGGERS');

  /** See `reachPayload`: omitted entirely when nothing was granted. */
  const cleanReachForSubmit = () => reachPayload(agentTools, agentAllowlist);
  const [preview, setPreview] = useState<{ score: number; warnings: string[] } | null>(null);
  // Claude fields. There is no schedule here on purpose — a routine's cadence
  // lives at claude.ai and is not readable through the one endpoint Anthropic
  // exposes, so offering a cron box would invite the user to set something
  // Cronsole cannot send anywhere.
  const [routineId, setRoutineId] = useState('');
  const [routineToken, setRoutineToken] = useState('');

  // Importing an exported task file — the same POST the Tools card makes.
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const task = await importTaskFile(file);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(
        task.nextRunTime
          ? `Imported "${task.name}" — first run ${new Date(task.nextRunTime).toLocaleString()}.`
          : `Imported "${task.name}".`,
        'success'
      );
      // The modal's job is done: the task exists. Leaving it open would sit a
      // half-filled create form over a task that has already been created.
      onClose();
    } catch (err) {
      // Shown in the form rather than only toasted — a refusal here is a
      // sentence naming another screen, which is too long-lived for a toast.
      setImportError(err instanceof TaskFileImportError ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  };

  const isWindows = platform === 'WINDOWS_TASK_SCHEDULER';
  const isClaude = platform === 'CLAUDE_CODE';
  const isGemini = platform === 'GEMINI_TRIGGERS';
  // Preflight the prompt as it is typed, on the two platforms whose action IS a
  // prompt. Warnings only — nothing below reads this when deciding whether the
  // form can be submitted.
  const promptWarnings = usePromptPreflight(prompt, isGemini || isClaude);
  // Native is what is left over, so a new platform has to be named above or it
  // silently inherits the native job form — four job-type tabs over a platform
  // that has none.
  const isNative = !isWindows && !isClaude && !isGemini;
  /**
   * Which job types actually touch the backend's own filesystem, and so need the
   * execution-host disclosure below. `CHECK` is conditional on its probe: an
   * endpoint check reaches out over the network and does not care where it runs,
   * while a file or disk probe measures *this* machine — and a check that passes
   * against the wrong filesystem is worse than no check at all.
   */
  const usesLocalFilesystem =
    isNative &&
    (job.jobType === 'EXEC' ||
      job.jobType === 'SCRIPT' ||
      (job.jobType === 'CHECK' && (job.checkKind === 'fileFresh' || job.checkKind === 'diskFree')));
  // Full class names so Tailwind's compiler sees them (no template interpolation).
  const focusAccent = isWindows
    ? 'focus:border-primary'
    : isClaude
      ? 'focus:border-claude'
      : isGemini
        ? 'focus:border-gemini'
        : 'focus:border-native';

  const selectPlatform = (p: CreatePlatform) => {
    setPlatform(p);
    setPreview(null);
  };

  // Live cron→Windows-trigger conversion warnings, debounced (mirrors the
  // Apply modal's preview behavior).
  useEffect(() => {
    if (!isWindows) return;
    const handle = setTimeout(async () => {
      try {
        // UTC on the wire — the backend converts to a trigger and the agent
        // converts that back to local; sending zone-local would double-shift.
        const res = await api.post('/tasks/preview', { platform, schedule: storedSchedule.cron });
        setPreview(res.data);
      } catch {
        setPreview(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [isWindows, platform, storedSchedule.cron]);

  const createMutation = useMutation({
    mutationFn: async () => {
      if (isClaude) {
        // Two calls, because connecting is genuinely two things: store the
        // credential, then let the normal import path turn the declared routine
        // into a task row. The alternative — having the routines endpoint write
        // a Task itself — would give Claude a second, private way to create
        // tasks that no other platform uses.
        const res = await api.post('/tools/platforms/claude/routines', {
          id: routineId.trim(),
          token: routineToken.trim(),
          ...(name.trim() ? { name: name.trim() } : {})
        });
        // Scoped to the Claude category, so this cannot pull in Windows folders
        // the user never asked for. The config holds only routines they declared,
        // so "import Claude" imports exactly their own list.
        await api.post('/tasks/sync', { categories: ['Claude'] });
        return res;
      }
      if (isWindows) {
        return api.post('/tasks', {
          name,
          platform,
          category: category.trim() || undefined,
          schedule: storedSchedule.cron,
          command
        });
      }
      if (isGemini) {
        // The same generic create route Windows uses, and `command` is the wire
        // field every connector's `createTask` receives — this platform reads it
        // as the prompt. **No category is sent**: every trigger is filed under
        // "Gemini" server-side (TaskService.extractCategory), for the reason
        // Claude's routines are, so a typed one would be a field the next sync
        // corrects.
        return api.post('/tasks', {
          name,
          platform,
          schedule: storedSchedule.cron,
          command: prompt,
          // Sent only when something was granted, so a create that touched none
          // of this is byte-identical to one made before the section existed.
          ...cleanReachForSubmit()
        });
      }
      return api.post('/tasks/native', {
        name,
        category,
        schedule: storedSchedule.cron,
        // The same builder the edit modal posts to `PATCH /tasks/:id/job`. An
        // EXEC job still goes as a command *line* — the server tokenizes it with
        // the parser the Windows path uses, so a security-relevant parse has one
        // definition and the browser never holds a copy of it.
        job: nativeJobPayload(job),
        // Omitted entirely when empty, so a create that uses no secrets sends
        // the same body it always did.
        ...(secrets.length
          ? { secrets: Object.fromEntries(secrets.map(sec => [sec.name, sec.value])) }
          : {})
      });
    },
    onSuccess: (res: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      if (isClaude) {
        // The matrix changes shape once a connection exists, and the routines
        // list backs the Platforms panel — both would otherwise still show the
        // pre-connect state.
        queryClient.invalidateQueries({ queryKey: ['platform-matrix'] });
        queryClient.invalidateQueries({ queryKey: ['claude-routines'] });

        // Shape advice from the server (an id or token that doesn't match what
        // claude.ai issues). Surfaced rather than swallowed: it saved anyway, so
        // silence would leave a likely-wrong paste to fail at the first run.
        const warnings = (res as { data?: { warnings?: string[] } })?.data?.warnings ?? [];
        if (warnings.length) {
          toast(`Routine connected, but: ${warnings.join(' ')}`, 'error');
        } else {
          toast(
            `Routine "${name.trim() || routineId.trim()}" connected. It still runs on its own schedule at claude.ai — Cronsole can trigger it.`,
            'success'
          );
        }
        onClose();
        return;
      }
      // The server's own answer to "does this task have what it needs to run",
      // not a re-derivation of it. It is reported even on success because a task
      // that was created and cannot start is exactly the state a success toast
      // would otherwise paper over until its first scheduled run.
      const missing = (res as { data?: { missingSecrets?: string[] } })?.data?.missingSecrets ?? [];
      if (missing.length) {
        toast(
          `Cronsole task "${name}" created, but it refers to ${missing.length === 1 ? 'a secret that is not set' : 'secrets that are not set'}: ` +
          `${missing.join(', ')}. Open the task → Edit → Secrets to store ${missing.length === 1 ? 'it' : 'them'}; ` +
          'until then it will refuse to start rather than run with a blank credential.',
          'error'
        );
        onClose();
        return;
      }
      toast(
        isWindows
          ? `Windows task "${name}" created under the \\Cronsole\\ scheduler folder.`
          : isGemini
            // The allowlist is set HERE, under Tools and network access — the
            // sentence used to send people to Google AI Studio, which is neither
            // where Cronsole writes it nor where they are standing.
            ? `Gemini trigger "${name}" created${agentAllowlist.length === 0 ? ' with no network allowlist — its agent reaches nothing outside its own sandbox. Add domains under Tools and network access if the prompt needs them (a trigger asked to email a report will quietly write a file instead).' : '.'}`
            : `Cronsole task "${name}" created. It runs on the backend scheduler — no Windows entry.`,
        'success'
      );
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const message = err.response?.data?.error || err.message;
      toast(
        message === 'Agent offline'
          ? 'Create failed: the Windows agent is not connected. Check that the CronsoleAgent scheduled task is running.'
          : `Create failed: ${message}`,
        'error'
      );
    }
  });

  // Native completeness is `nativeJobIncomplete` — the same check the edit form
  // uses — so a job cannot be submittable in one form and refused in the other.
  const targetValid = isWindows
    ? !!command.trim()
    : isGemini
      ? // The prompt is the whole action here, so it is required for the reason
        // a command is on Windows: a trigger with nothing to do is refused by
        // the connector anyway, and refusing at the button is the cheaper place.
        !!prompt.trim()
      : !nativeJobIncomplete(job);
  // Claude asks for different things and fewer of them: the id and token are
  // required, the name is optional (it falls back to the id), and there is no
  // schedule to require because Cronsole does not set one.
  const canCreate = isClaude
    ? !!routineId.trim() && !!routineToken.trim() && !createMutation.isPending
    : !!name.trim() && !!schedule.trim() && targetValid && !createMutation.isPending;

  const platformButton = (p: CreatePlatform, label: string, Icon: typeof Zap, active: string) => (
    <button
      onClick={() => selectPlatform(p)}
      className={`flex-1 min-w-[7.5rem] flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${
        platform === p ? active : 'bg-background border-border text-subtle-foreground hover:border-foreground/30'
      }`}
    >
      <Icon size={15} /> {label}
    </button>
  );

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-50"
      closeOnBackdrop={false}
      labelledBy="create-task-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <p className={`text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1.5 ${isWindows ? 'text-foreground' : isClaude ? 'text-claude-text' : isGemini ? 'text-gemini-text' : 'text-native-text'}`}>
              {isWindows ? <Monitor size={11} /> : isClaude ? <Bot size={11} /> : isGemini ? <Sparkles size={11} /> : <Zap size={11} />}
              {isWindows ? 'Windows Task Scheduler' : isClaude ? 'Claude Code routine' : isGemini ? 'Gemini API trigger' : 'Cronsole-native task'}
            </p>
            {/*
              The title changes for Claude because the action does. Cronsole
              cannot create a routine — there is no endpoint — so calling this
              "New Task" for that option would be the one thing this whole
              connector is built to avoid saying.
            */}
            <h2 id="create-task-title" className="text-xl font-bold">
              {isClaude ? 'Connect a routine' : 'New Task'}
            </h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              {isWindows
                ? 'Registered as a real Windows scheduled task via the local agent — survives reboots, runs even when Cronsole is down.'
                : isClaude
                  ? 'Adds a routine that already exists at claude.ai so you can trigger it from here. Cronsole cannot create, schedule or pause a routine — Anthropic exposes no API for any of those.'
                  : isGemini
                    ? 'Created for real on the Gemini API — a managed agent runs your prompt on this schedule, in the cloud, whether or not Cronsole is up.'
                    : 'Scheduled and executed by Cronsole itself — nothing is created in Windows Task Scheduler.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close new task" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            {/*
              The help follows the selection rather than sitting on each button:
              three `?`s inside three platform chips would be buttons inside
              buttons (invalid, and each steals its chip's click target), and the
              question a user has here is about the option they just picked.
            */}
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1">
              Platform
              <HelpButton topic={sourceTopicId(platform)} />
            </label>
            {/*
              `flex-wrap` and a min width, because this went from three chips to
              four: at the modal's width four equal chips are under 90px each, and
              the labels truncate rather than wrapping. Every page here passes a
              <375px check, so the row wraps to two-up instead of shrinking.
            */}
            <div className="flex flex-wrap gap-2">
              {platformButton('TASKHUB_NATIVE', 'Cronsole', Zap, 'bg-native/10 border-native/40 text-native-text')}
              {platformButton('WINDOWS_TASK_SCHEDULER', 'Windows', Monitor, 'bg-primary/10 border-primary/40 text-foreground')}
              {platformButton('CLAUDE_CODE', 'Claude', Bot, 'bg-claude/10 border-claude/40 text-claude-text')}
              {platformButton('GEMINI_TRIGGERS', 'Gemini', Sparkles, 'bg-gemini/10 border-gemini/40 text-gemini-text')}
            </div>
          </div>

          {/*
            The file path to the same outcome, offered where someone is already
            trying to reach it. It shows only for Cronsole-native because that is
            the only platform whose definition round-trips through a file — a
            Windows task's is Task Scheduler XML and restores through Tools, and
            offering the button under a Windows selection would promise an import
            that every such file is refused by.

            The gesture itself lives in `utils/importTaskFile.ts`, shared with the
            Tools card, so the two entry points cannot start reporting a bad file
            differently.
          */}
          {isNative && (
            <div className="flex items-center gap-2 text-[11px] text-subtle-foreground">
              <input
                ref={importInput}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={e => {
                  void onImportFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <span>Already have an exported task?</span>
              <button
                type="button"
                onClick={() => importInput.current?.click()}
                disabled={importing}
                className="inline-flex items-center gap-1.5 font-bold text-native-text hover:underline disabled:opacity-50"
              >
                {importing ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                Import a .json file
              </button>
            </div>
          )}

          {importError && (
            <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 leading-relaxed">
              {importError}
            </p>
          )}

          {isClaude && (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
                  Routine id or fire URL <span className="text-danger-text">*</span>
                </label>
                <input
                  value={routineId}
                  onChange={e => setRoutineId(e.target.value)}
                  aria-label="Routine id or fire URL"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="trig_01…"
                  className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none transition-colors ${focusAccent}`}
                />
                <p className="text-[10px] text-subtle-foreground">
                  From the routine's page URL, or the whole Fire URL in its API trigger dialog — both carry the same id.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
                  API token <span className="text-danger-text">*</span>
                </label>
                {/*
                  Masked: the one field in Cronsole holding a live third-party
                  credential, typed on a tab someone may be screen-sharing.
                */}
                <input
                  type="password"
                  value={routineToken}
                  onChange={e => setRoutineToken(e.target.value)}
                  aria-label="API token"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-ant-oat01-…"
                  className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none transition-colors ${focusAccent}`}
                />
                <p className="text-[10px] text-subtle-foreground">
                  claude.ai → routine → Edit → Add another trigger → API → Generate token. Shown once, and generating a new one revokes the previous.
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">
                Name {isClaude ? <span className="text-subtle-foreground normal-case font-bold">(optional)</span> : <span className="text-danger-text">*</span>}
              </label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                aria-label="Name"
                placeholder={isWindows ? 'Nightly repo backup' : isClaude ? 'Defaults to the routine id' : 'Ping n8n webhook'}
                className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none transition-colors ${focusAccent}`}
              />
            </div>
            {/*
              No category picker for Claude: routines are filed under "Claude"
              server-side (TaskService.extractCategory) so Import can offer them
              as a group. Letting it be typed here would make the field a lie the
              next sync corrects.
            */}
            {!isClaude && !isGemini && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Category</label>
                <input
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                  className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none transition-colors ${focusAccent}`}
                />
              </div>
            )}
          </div>

          {/*
            Claude gets a statement instead of a cron box. The routine's cadence
            lives at claude.ai and is not readable through the single endpoint
            Anthropic exposes, so an editable field here could only ever set a
            value Cronsole has nowhere to send — and the card would then show a
            schedule the routine does not actually follow.
          */}
          {isClaude ? (
            <div className="text-[11px] text-subtle-foreground bg-background border border-border rounded-xl px-3 py-2 flex items-start gap-2">
              <Clock size={13} className="shrink-0 mt-0.5 text-claude-text" />
              <span>
                <span className="font-bold text-foreground">The schedule stays at claude.ai.</span> Cronsole can't read or
                change it, so the card will show no cron — it shows what Cronsole knows, not a guess. Run now works either way.
              </span>
            </div>
          ) : (
          <div className="space-y-2">
            <ScheduleBuilder
              inputId="create-schedule-cron"
              value={schedule}
              onChange={setSchedule}
              zoneLabel={zone.label}
              accent={isWindows ? 'primary' : 'native'}
              required
              help={<HelpButton topic="schedule" />}
            />
            <ScheduleZoneHint
              typed={schedule}
              stored={storedSchedule}
              zoneLabel={zone.label}
              driftsWithDst={!isWindows}
            />
            {isWindows && preview && (
              preview.warnings.length > 0 ? (
                <div className="text-[11px] text-warning-text bg-warning/5 border border-warning/20 rounded-xl px-3 py-2 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-success-text flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> Converts cleanly to a Windows trigger.
                </p>
              )
            )}
          </div>
          )}

          {/* Claude has no target field: the routine's prompt, repos and
              connectors are all defined at claude.ai and unreadable from here. */}
          {isClaude ? null : isGemini ? (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles size={11} /> Prompt <span className="text-danger-text">*</span>
                <HelpButton topic={sourceTopicId('GEMINI_TRIGGERS')} />
              </label>
              {/*
                Deliberately a prompt box rather than the command box above with
                different help text. The unit of work on this platform is a
                sentence for an agent, and typing a shell line into a field
                labelled Command would produce a trigger that dutifully asks an
                LLM to think about `powershell -File ...`.
              */}
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                rows={4}
                aria-label="Prompt"
                placeholder={'Check the open PRs in my-org/my-app and summarise anything that has been waiting more than three days.'}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs text-foreground outline-none focus:border-gemini transition-colors resize-y leading-relaxed"
              />
              <p className="text-[10px] text-subtle-foreground italic">
                Runs on the managed agent set in the Sources tab.
              </p>
              {/* Before the trigger exists is the only cheap moment: this agent
                  fails at 03:00 to an empty room, and each of these rules was
                  paid for by a run that did. */}
              <PromptPreflightNotes warnings={promptWarnings} />

              {/*
                Reach is part of creating an autonomous task, not an advanced
                afterthought — but it is collapsed by default so the common case
                (a prompt on a schedule, plain sandbox) is still two fields.
              */}
              <details className="group border border-border rounded-xl bg-background/40">
                <summary className="cursor-pointer list-none px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-subtle-foreground flex items-center gap-1.5">
                  <span className="transition-transform group-open:rotate-90">▸</span>
                  Tools and network access
                  {(agentTools.length > 0 || agentAllowlist.length > 0) && (
                    <span className="ml-1 text-gemini-text normal-case tracking-normal font-bold">
                      {agentTools.length} tool{agentTools.length === 1 ? '' : 's'}
                      {agentAllowlist.length > 0 && `, ${agentAllowlist.length} domain${agentAllowlist.length === 1 ? '' : 's'}`}
                    </span>
                  )}
                </summary>
                <div className="px-3 pb-3">
                  <AgentReachEditor
                    tools={agentTools}
                    onToolsChange={setAgentTools}
                    allowlist={agentAllowlist}
                    onAllowlistChange={setAgentAllowlist}
                    presets={presets?.presets ?? []}
                  />
                </div>
              </details>
            </div>
          ) : isWindows ? (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Terminal size={11} /> Command <span className="text-danger-text">*</span>
                <HelpButton topic="command" />
              </label>
              <textarea
                value={command}
                onChange={e => setCommand(e.target.value)}
                rows={2}
                placeholder='powershell -File "D:\scripts\backup.ps1"'
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground outline-none focus:border-primary transition-colors resize-y"
              />
              <p className="text-[10px] text-subtle-foreground italic">Runs the program directly as your user — no hidden shell wrapper. Name <span className="font-mono">cmd.exe /c</span> explicitly if you need shell features like redirection.</p>
            </div>
          ) : (
            <>
              {/*
                The same job form the task modal edits with. Its own
                execution-host line is suppressed (no `executionHost` prop) in
                favour of the richer disclosure below, which has the server's
                evidence and can shout when the answer is "a container".
              */}
              <NativeJobFields
                value={job}
                onChange={setJob}
                storedJobType={job.jobType}
              />

              {/*
                Where this will actually run — the one thing that makes a job
                touching the filesystem ambiguous. On a host-run backend the path
                means what the user thinks; inside a container the identical task
                runs against a filesystem that is not theirs and fails as
                "executable not found" for a file they can see in Explorer. The
                server decides which, and it is stated before the click rather
                than discovered after.
              */}
              {usesLocalFilesystem && executionHost && (
                <div className={`text-[11px] rounded-xl px-3 py-2 flex items-start gap-2 border ${
                  executionHost.kind === 'container'
                    ? 'text-warning-text bg-warning/10 border-warning/30'
                    : 'text-subtle-foreground bg-background border-border'
                }`}>
                  {executionHost.kind === 'container'
                    ? <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    : <Info size={13} className="shrink-0 mt-0.5 text-native-text" />}
                  <span>
                    {executionHost.summary}
                    <span className="opacity-70"> ({executionHost.evidence})</span>
                  </span>
                </div>
              )}

              {/*
                Secrets, collected here and sent WITH the create (ADR 0003).
                Always rendered rather than gated on the job containing a
                reference: the point is to be able to write `${secret.TOKEN}`
                into a header in the first place, and a section that only appears
                once you have already typed the syntax teaches nobody the syntax.
              */}
              <div className="space-y-2 pt-2 border-t border-border">
                <span className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound size={11} /> Secrets<HelpButton topic="task-secrets" />
                </span>
                <TaskSecretsFields
                  job={job}
                  mode="pending"
                  pending={secrets}
                  onPendingChange={setSecrets}
                />
              </div>
            </>
          )}

          <div className="text-[11px] text-subtle-foreground bg-background border border-border rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={13} className={`shrink-0 mt-0.5 ${isWindows ? 'text-foreground' : isClaude ? 'text-claude-text' : isGemini ? 'text-gemini-text' : 'text-native-text'}`} />
            <span>
              {isWindows
                ? 'Created under the \\Cronsole\\ folder in Task Scheduler, so Cronsole-made tasks stay identifiable. Requires the Windows agent to be online.'
                : isClaude
                  ? 'The token is stored encrypted and never shown again. Running a routine from here starts a real Claude Code session that can use its repos and connectors — exactly as if it had fired on schedule.'
                  : isGemini
                    ? 'Written to Gemini as UTC, so this schedule round-trips exactly. Gemini pauses a trigger itself after repeated failures — Cronsole shows that as its own warning rather than as an ordinary disabled task.'
                    : 'Runs only while the Cronsole backend is up. Use a Windows task instead for jobs that must survive Cronsole being offline.'}
            </span>
          </div>

        </div>

        <footer className="p-6 bg-background border-t border-border flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Cancel</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={!canCreate}
            className={`flex-[2] py-3 rounded-2xl font-bold shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2 ${
              isWindows
                ? 'bg-primary hover:bg-primary-hover shadow-primary/20'
                : isClaude
                  ? 'bg-claude hover:bg-claude/85 shadow-claude/20 text-white'
                  : isGemini
                    ? 'bg-gemini hover:bg-gemini/85 shadow-gemini/20 text-white'
                    : 'bg-native hover:bg-native/85 shadow-native/20'
            }`}
          >
            {/* "Connect", never "Create" — Cronsole did not make this routine
                and cannot. The verb is the honest part of the button. */}
            {createMutation.isPending
              ? <><Loader2 size={16} className="animate-spin" /> {isClaude ? 'Connecting…' : 'Creating…'}</>
              : isWindows
                ? <><Monitor size={16} /> Create Windows Task</>
                : isClaude
                  ? <><Bot size={16} /> Connect Routine</>
                  : isGemini
                    ? // "Create", not "Connect" — this one really does write a
                      // trigger that did not exist, which is the whole reason
                      // Gemini sits on the other side of the split from Claude.
                      <><Sparkles size={16} /> Create Gemini Trigger</>
                    : <><Zap size={16} /> Create Cronsole Task</>}
          </button>
        </footer>
    </Modal>
  );
};
export default CreateTaskModal;
