import { useEffect, useState } from 'react';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { XCircle, Clock, Loader2, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react';
import type { Task } from '../types';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useSettings } from '../hooks/useSettings';
import { CRON_PRESETS } from '../utils/cronPresets';
import { describeCron } from '../utils/schedule';
import { Modal } from './ui/Modal';

interface EditScheduleModalProps {
  task: Task;
  onClose: () => void;
}

/**
 * Edit the cron schedule of an existing Cronsole-native task or cron-expressible
 * Windows Task Scheduler task. Windows edits rebuild only the native trigger via
 * the agent; Cronsole-native edits update the backend scheduler directly.
 */
export const EditScheduleModal = ({ task, onClose }: EditScheduleModalProps) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { settings: prefs } = useSettings();
  const [schedule, setSchedule] = useState(task.schedule ?? '');
  const [preview, setPreview] = useState<{ score: number; warnings: string[] } | null>(null);

  const isWindows = task.platform === 'WINDOWS_TASK_SCHEDULER';

  // Live cron preview, debounced (mirrors the New Task / Apply modals).
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await api.post('/tasks/preview', {
          platform: task.platform,
          schedule
        });
        setPreview(res.data);
      } catch {
        setPreview(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [schedule, task.platform]);

  const mutation = useMutation({
    mutationFn: async () => api.patch(`/tasks/${task.id}/schedule`, { schedule }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      toast(`Schedule updated for "${task.name}".`, 'success');
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      const message = err.response?.data?.error || err.message;
      toast(
        isWindows && message === 'Agent offline'
          ? 'Update failed: the Windows agent is not connected. Check that the CronsoleAgent scheduled task is running.'
          : `Update failed: ${message}`,
        'error'
      );
    }
  });

  const human = describeCron(schedule, prefs.timezone);
  const changed = schedule.trim() !== (task.schedule ?? '').trim();
  const canSave = !!schedule.trim() && changed && !mutation.isPending;

  return (
    <Modal
      onClose={onClose}
      overlayClassName="z-[60]"
      closeOnBackdrop={false}
      labelledBy="edit-schedule-title"
      panelClassName="bg-surface border border-border rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
    >
        <header className="p-6 border-b border-border flex justify-between items-start bg-surface/50">
          <div>
            <p className="text-[10px] uppercase font-black tracking-widest mb-1 flex items-center gap-1.5 text-foreground">
              <CalendarClock size={11} /> {isWindows ? 'Windows Task Scheduler' : 'Cronsole-native'}
            </p>
            <h2 id="edit-schedule-title" className="text-xl font-bold">Edit Schedule</h2>
            <p className="text-xs text-subtle-foreground mt-1 leading-relaxed">
              {isWindows
                ? <>Changes only the trigger for <span className="font-semibold text-foreground">{task.name}</span> — its command and settings are preserved. Requires the Windows agent to be online.</>
                : <>Changes when <span className="font-semibold text-foreground">{task.name}</span> runs in the Cronsole backend scheduler.</>}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-muted rounded-full text-subtle-foreground transition-colors shrink-0">
            <XCircle size={20} />
          </button>
        </header>

        <div className="p-6 space-y-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <label className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Clock size={11} /> Schedule (cron · UTC) <span className="text-red-400">*</span>
            </label>
            <input
              value={schedule}
              onChange={e => setSchedule(e.target.value)}
              className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors"
            />
            <div className="flex flex-wrap gap-1.5">
              {CRON_PRESETS.map(p => (
                <button
                  key={p.cron}
                  onClick={() => setSchedule(p.cron)}
                  className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all ${
                    schedule === p.cron
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {human && (
              <p className="text-[11px] text-subtle-foreground">
                {human}{prefs.timezone === 'local' ? ' (your local time)' : ''}
              </p>
            )}
            {preview && (
              preview.warnings.length > 0 ? (
                <div className="text-[11px] text-amber-500 bg-amber-500/5 border border-amber-500/20 rounded-xl px-3 py-2 space-y-1">
                  {preview.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}</p>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-emerald-500 flex items-center gap-1.5">
                  <CheckCircle2 size={12} /> {isWindows ? 'Converts cleanly to a Windows trigger.' : 'Valid Cronsole-native cron schedule.'}
                </p>
              )
            )}
          </div>
        </div>

        <footer className="p-6 bg-background border-t border-border flex gap-4">
          <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-subtle-foreground hover:text-foreground transition-colors">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSave}
            className="flex-[2] py-3 rounded-2xl font-bold shadow-lg shadow-primary/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95 text-sm flex items-center justify-center gap-2 bg-primary hover:bg-primary-hover"
          >
            {mutation.isPending
              ? <><Loader2 size={16} className="animate-spin" /> Updating…</>
              : <><CalendarClock size={16} /> Update Schedule</>}
          </button>
        </footer>
    </Modal>
  );
};
export default EditScheduleModal;
