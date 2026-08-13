import { useEffect, useState } from 'react';
import { Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../api';
import { useSettings } from '../../hooks/useSettings';
import { useScheduleZone } from '../../hooks/useScheduleZone';
import { CRON_PRESETS, presetLabel } from '../../utils/cronPresets';
import { describeCron } from '../../utils/schedule';
import { ScheduleZoneHint } from '../ScheduleZoneHint';
import { HelpButton } from '../HelpButton';

interface Props {
  /** The cron **as typed in the user's zone**. The parent converts once on save. */
  value: string;
  onChange: (next: string) => void;
  platform: string;
  disabled?: boolean;
}

/**
 * The cron field, its presets, the zone hint and the live conversion preview.
 *
 * State is lifted to `EditTaskModal` so one Save can decide whether this section
 * changed at all — the preview fetch stays here because it is a property of the
 * field, not of the save.
 */
export const ScheduleFields = ({ value, onChange, platform, disabled }: Props) => {
  const { settings: prefs } = useSettings();
  const zone = useScheduleZone();
  const [preview, setPreview] = useState<{ score: number; warnings: string[] } | null>(null);

  const isWindows = platform === 'WINDOWS_TASK_SCHEDULER';
  const storedSchedule = zone.toUtc(value);

  // Live preview, debounced (mirrors the New Task / Apply modals). Always the UTC
  // form — the backend's converter and the agent both assume it.
  useEffect(() => {
    const handle = setTimeout(async () => {
      try {
        const res = await api.post('/tasks/preview', { platform, schedule: storedSchedule.cron });
        setPreview(res.data);
      } catch {
        setPreview(null);
      }
    }, 400);
    return () => clearTimeout(handle);
  }, [storedSchedule.cron, platform]);

  const human = describeCron(storedSchedule.cron, prefs.timezone);

  return (
    <div className="space-y-2">
      <label htmlFor="edit-schedule-cron" className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5">
        <Clock size={11} /> Schedule (cron · {zone.label}) <span className="text-danger-text">*</span>
        <HelpButton topic="schedule" />
      </label>
      <input
        id="edit-schedule-cron"
        value={value}
        disabled={disabled}
        onChange={e => onChange(e.target.value)}
        spellCheck={false}
        className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50"
      />
      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map(p => (
          <button
            key={p.cron}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.cron)}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-50 ${
              value === p.cron
                ? 'bg-primary border-primary text-primary-foreground'
                : 'bg-background border-border text-muted-foreground hover:border-foreground/30'
            }`}
          >
            {presetLabel(p, zone.label)}
          </button>
        ))}
      </div>
      {human && <p className="text-[11px] text-subtle-foreground">{human}</p>}
      <ScheduleZoneHint
        typed={value}
        stored={storedSchedule}
        zoneLabel={zone.label}
        driftsWithDst={!isWindows}
      />
      {preview && (
        preview.warnings.length > 0 ? (
          <div className="text-[11px] text-warning-text bg-warning/5 border border-warning/20 rounded-xl px-3 py-2 space-y-1">
            {preview.warnings.map((w, i) => (
              <p key={i} className="flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}</p>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-success-text flex items-center gap-1.5">
            <CheckCircle2 size={12} /> {isWindows ? 'Converts cleanly to a Windows trigger.' : 'Valid Cronsole-native cron schedule.'}
          </p>
        )
      )}
    </div>
  );
};
