import { useEffect, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, Zap, Info, Monitor, CheckCircle2, AlertTriangle, Terminal, Bot } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { CRON_PRESETS, presetLabel } from '../utils/cronPresets';
import { Modal } from './ui/Modal';
import { ScheduleZoneHint } from './ScheduleZoneHint';
import { usePlatformMatrix } from '../hooks/usePlatformMatrix';
import { HelpButton } from './HelpButton';
import { sourceTopicId } from '../data/help';
import { NativeJobFields } from './edit/NativeJobFields';
import {
  emptyNativeJobValues,
  nativeJobPayload,
  nativeJobIncomplete,
  type NativeJobValues
} from '../utils/taskEditing';

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
type CreatePlatform = 'TASKHUB_NATIVE' | 'WINDOWS_TASK_SCHEDULER' | 'CLAUDE_CODE';

interface CreateTaskModalProps {
  onClose: () => void;
}

/**
 * Creates a task on a chosen platform:
 * - Cronsole-native — scheduled and executed by the backend itself, no OS entry
 *   (docs/resources/Native_Tasks.md).
 * - Windows — registered as a real Task Scheduler task under \Cronsole\ via the
 *   agent, with the cron converted to a native trigger (same path as templates).
 */
export const CreateTaskModal = ({ onClose }: CreateTaskModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [platform, setPlatform] = useState<CreatePlatform>('TASKHUB_NATIVE');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Cronsole');
  const zone = useScheduleZone();
  // Held in the user's zone; converted to UTC once, on submit. "0 8" now means
  // 8am where you are rather than 8am UTC.
  const [schedule, setSchedule] = useState('0 8 * * *');
  const storedSchedule = zone.toUtc(schedule);
  // The native job spec, in the **same shape the edit modal uses**. It was six
  // separate `useState`s covering only HTTP and EXEC, which is how a create form
  // and an edit form end up accepting different jobs — the four job types would
  // each have had two field sets, two validations and two payload builders.
  // `NativeJobFields` renders it and `nativeJobPayload` serializes it, so the
  // wire format has one definition.
  const [job, setJob] = useState<NativeJobValues>(emptyNativeJobValues);

  // Where a native task will actually run. Read from the platform matrix rather
  // than assumed: the same spec means "your machine" on a host-run backend and
  // "inside the container" on the Dockerized one, and only the server knows which.
  const { data: matrix } = usePlatformMatrix();
  const executionHost = matrix?.platforms.find(p => p.platform === 'TASKHUB_NATIVE')?.executionHost ?? null;
  // Windows fields
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState<{ score: number; warnings: string[] } | null>(null);
  // Claude fields. There is no schedule here on purpose — a routine's cadence
  // lives at claude.ai and is not readable through the one endpoint Anthropic
  // exposes, so offering a cron box would invite the user to set something
  // Cronsole cannot send anywhere.
  const [routineId, setRoutineId] = useState('');
  const [routineToken, setRoutineToken] = useState('');

  const isWindows = platform === 'WINDOWS_TASK_SCHEDULER';
  const isClaude = platform === 'CLAUDE_CODE';
  const isNative = !isWindows && !isClaude;
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
      return api.post('/tasks/native', {
        name,
        category,
        schedule: storedSchedule.cron,
        // The same builder the edit modal posts to `PATCH /tasks/:id/job`. An
        // EXEC job still goes as a command *line* — the server tokenizes it with
        // the parser the Windows path uses, so a security-relevant parse has one
        // definition and the browser never holds a copy of it.
        job: nativeJobPayload(job)
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
      toast(
        isWindows
          ? `Windows task "${name}" created under the \\Cronsole\\ scheduler folder.`
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
  const targetValid = isWindows ? !!command.trim() : !nativeJobIncomplete(job);
  // Claude asks for different things and fewer of them: the id and token are
  // required, the name is optional (it falls back to the id), and there is no
  // schedule to require because Cronsole does not set one.
  const canCreate = isClaude
    ? !!routineId.trim() && !!routineToken.trim() && !createMutation.isPending
    : !!name.trim() && !!schedule.trim() && targetValid && !createMutation.isPending;

  const platformButton = (p: CreatePlatform, label: string, Icon: typeof Zap, active: string) => (
    <button
      onClick={() => selectPlatform(p)}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-sm font-bold border transition-all ${
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
            <p className={`text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1.5 ${isWindows ? 'text-foreground' : isClaude ? 'text-claude-text' : 'text-native-text'}`}>
              {isWindows ? <Monitor size={11} /> : isClaude ? <Bot size={11} /> : <Zap size={11} />}
              {isWindows ? 'Windows Task Scheduler' : isClaude ? 'Claude Code routine' : 'Cronsole-native task'}
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
            <div className="flex gap-2">
              {platformButton('TASKHUB_NATIVE', 'Cronsole', Zap, 'bg-native/10 border-native/40 text-native-text')}
              {platformButton('WINDOWS_TASK_SCHEDULER', 'Windows', Monitor, 'bg-primary/10 border-primary/40 text-foreground')}
              {platformButton('CLAUDE_CODE', 'Claude', Bot, 'bg-claude/10 border-claude/40 text-claude-text')}
            </div>
          </div>

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
            {!isClaude && (
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
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · {zone.label}) <span className="text-danger-text">*</span>
              <HelpButton topic="schedule" />
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono outline-none transition-colors ${isWindows ? 'text-foreground focus:border-primary' : 'text-native-text focus:border-native'}`}
            />
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.cron}
                  onClick={() => setSchedule(p.cron)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                    schedule === p.cron
                      ? isWindows
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'bg-native border-native text-white'
                      : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {presetLabel(p, zone.label)}
                </button>
              ))}
            </div>
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
          {isClaude ? null : isWindows ? (
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
            </>
          )}

          <div className="text-[11px] text-subtle-foreground bg-background border border-border rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={13} className={`shrink-0 mt-0.5 ${isWindows ? 'text-foreground' : isClaude ? 'text-claude-text' : 'text-native-text'}`} />
            <span>
              {isWindows
                ? 'Created under the \\Cronsole\\ folder in Task Scheduler, so Cronsole-made tasks stay identifiable. Requires the Windows agent to be online.'
                : isClaude
                  ? 'The token is stored encrypted and never shown again. Running a routine from here starts a real Claude Code session that can use its repos and connectors — exactly as if it had fired on schedule.'
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
                  : <><Zap size={16} /> Create Cronsole Task</>}
          </button>
        </footer>
    </Modal>
  );
};
export default CreateTaskModal;
