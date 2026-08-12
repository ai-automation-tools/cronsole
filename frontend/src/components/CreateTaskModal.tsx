import { useEffect, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, Zap, Info, Monitor, CheckCircle2, AlertTriangle, Terminal } from 'lucide-react';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { CRON_PRESETS, presetLabel } from '../utils/cronPresets';
import { Modal } from './ui/Modal';
import { ScheduleZoneHint } from './ScheduleZoneHint';

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

type CreatePlatform = 'TASKHUB_NATIVE' | 'WINDOWS_TASK_SCHEDULER';

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
  // Native (HTTP job) fields
  const [url, setUrl] = useState('');
  const [method, setMethod] = useState('GET');
  const [body, setBody] = useState('');
  // Windows fields
  const [command, setCommand] = useState('');
  const [preview, setPreview] = useState<{ score: number; warnings: string[] } | null>(null);

  const isWindows = platform === 'WINDOWS_TASK_SCHEDULER';
  // Full class names so Tailwind's compiler sees them (no template interpolation).
  const focusAccent = isWindows ? 'focus:border-primary' : 'focus:border-native';

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
        job: { jobType: 'HTTP', url, method, body: body || undefined }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
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

  const validUrl = /^https?:\/\//i.test(url.trim());
  const targetValid = isWindows ? !!command.trim() : validUrl;
  const canCreate =
    !!name.trim() && !!schedule.trim() && targetValid && !createMutation.isPending;

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
            <p className={`text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1.5 ${isWindows ? 'text-foreground' : 'text-native-text'}`}>
              {isWindows ? <Monitor size={11} /> : <Zap size={11} />}
              {isWindows ? 'Windows Task Scheduler' : 'Cronsole-native task'}
            </p>
            <h2 id="create-task-title" className="text-xl font-bold">New Task</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              {isWindows
                ? 'Registered as a real Windows scheduled task via the local agent — survives reboots, runs even when Cronsole is down.'
                : 'Scheduled and executed by Cronsole itself — nothing is created in Windows Task Scheduler.'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close new task" title="Close" className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Platform</label>
            <div className="flex gap-2">
              {platformButton('TASKHUB_NATIVE', 'Cronsole', Zap, 'bg-native/10 border-native/40 text-native-text')}
              {platformButton('WINDOWS_TASK_SCHEDULER', 'Windows', Monitor, 'bg-primary/10 border-primary/40 text-foreground')}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Name <span className="text-danger-text">*</span></label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={isWindows ? 'Nightly repo backup' : 'Ping n8n webhook'}
                className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none transition-colors ${focusAccent}`}
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Category</label>
              <input
                value={category}
                onChange={e => setCategory(e.target.value)}
                className={`w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none transition-colors ${focusAccent}`}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · {zone.label}) <span className="text-danger-text">*</span>
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

          {isWindows ? (
            <div className="space-y-2">
              <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Terminal size={11} /> Command <span className="text-danger-text">*</span>
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
              <div className="space-y-2">
                <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">HTTP request <span className="text-danger-text">*</span></label>
                <div className="flex gap-2">
                  <select
                    value={method}
                    onChange={e => setMethod(e.target.value)}
                    className="bg-background border border-border rounded-xl px-3 py-2.5 text-sm text-foreground outline-none focus:border-native transition-colors"
                  >
                    {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <input
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    placeholder="https://…"
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-native transition-colors"
                  />
                </div>
                {url.trim() && !validUrl && (
                  <p className="text-[10px] text-warning-text italic">URL must start with http:// or https://</p>
                )}
              </div>

              {method !== 'GET' && method !== 'HEAD' && (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider">Request body (optional)</label>
                  <textarea
                    value={body}
                    onChange={e => setBody(e.target.value)}
                    rows={3}
                    placeholder='{"message": "hello"}'
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs font-mono text-foreground outline-none focus:border-native transition-colors resize-y"
                  />
                </div>
              )}
            </>
          )}

          <div className="text-[11px] text-subtle-foreground bg-background border border-border rounded-xl px-3 py-2 flex items-start gap-2">
            <Info size={13} className={`shrink-0 mt-0.5 ${isWindows ? 'text-foreground' : 'text-native-text'}`} />
            <span>
              {isWindows
                ? 'Created under the \\Cronsole\\ folder in Task Scheduler, so Cronsole-made tasks stay identifiable. Requires the Windows agent to be online.'
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
                : 'bg-native hover:bg-native/85 shadow-native/20'
            }`}
          >
            {createMutation.isPending
              ? <><Loader2 size={16} className="animate-spin" /> Creating…</>
              : isWindows
                ? <><Monitor size={16} /> Create Windows Task</>
                : <><Zap size={16} /> Create Cronsole Task</>}
          </button>
        </footer>
    </Modal>
  );
};
export default CreateTaskModal;
