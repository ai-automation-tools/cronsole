import { useState, type ReactNode } from 'react';
import { Clock } from 'lucide-react';
import {
  cronToShape,
  shapeToCron,
  withKind,
  toTimeValue,
  fromTimeValue,
  ordinalDay,
  KIND_LABELS,
  SCHEDULE_KINDS,
  WEEKDAYS,
  type ScheduleKind,
  type ScheduleShape
} from '../utils/scheduleBuilder';
import { CRON_PRESETS, presetLabel } from '../utils/cronPresets';

interface Props {
  /** The cron **as read and typed in the user's zone**; the parent converts once on submit. */
  value: string;
  onChange: (next: string) => void;
  /** How the zone is named beside the clock — "PDT", "UTC". */
  zoneLabel: string;
  /** Field label. The word "cron" is deliberately not in the default any more. */
  label?: string;
  /** Rendered beside the label — the surfaces that have a help topic pass one. */
  help?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  /** Cronsole-native surfaces accent in the native role; everything else in primary. */
  accent?: 'primary' | 'native';
  /** Id for the cron input, so an outer `<label>`/test can address it. */
  inputId?: string;
}

/**
 * One schedule control, in two registers: a picker, and the cron it compiles to.
 *
 * **Why both, rather than replacing cron.** Cron is the storage and the contract
 * (CLAUDE.md §9), and it is also the only register that can express what the
 * picker cannot — `0 9-17 * * 1-5` has no five-shape form and must stay
 * editable. But cron is a terrible *authoring* surface for the schedule almost
 * every task actually wants ("weekdays at 9"), which is what left this field a
 * bare monospace box for eleven months.
 *
 * **Simple is unavailable, never approximate.** When the current expression has
 * no picker form, the tab is disabled and says so. The alternative — snapping to
 * the nearest shape — would silently rewrite a schedule the user opened to read,
 * and the rewrite would look like something they did.
 *
 * **Nothing is emitted until something is clicked.** The round trip is not
 * byte-identical (`0 9 * * 1-5` reads back as `0 9 * * 1,2,3,4,5`), so
 * compiling on mount would mark every form dirty and rewrite the stored
 * expression of any task merely opened. The shape is derived for display only.
 *
 * The picker holds no opinion about how a shape converts to a Windows trigger —
 * that judgement is the server's (`POST /api/tasks/preview`), rendered by each
 * surface below this control. A monthly schedule has no Windows trigger today
 * and is replaced by an hourly one; the preview says so in the words that
 * already exist for it.
 */
export const ScheduleBuilder = ({
  value,
  onChange,
  zoneLabel,
  label = 'Schedule',
  help,
  required,
  disabled,
  accent = 'primary',
  inputId = 'schedule-cron'
}: Props) => {
  const shape = cronToShape(value);
  const [mode, setMode] = useState<'simple' | 'cron'>(shape ? 'simple' : 'cron');
  // A draft for the numeric interval so typing is not fought by the value that
  // has not been committed yet. Cleared on blur, which snaps back to the truth.
  const [everyDraft, setEveryDraft] = useState<string | null>(null);

  // Simple can be *selected* and still not be available — the value changes
  // under this component (a preset, a task switching, a parent reset), and a
  // stale mode must never render a picker over an expression it cannot hold.
  const simple = mode === 'simple' && shape ? shape : null;

  const emit = (next: ScheduleShape) => onChange(shapeToCron(next));

  const activeChip =
    accent === 'native'
      ? 'bg-native border-native text-white'
      : 'bg-primary border-primary text-primary-foreground';
  const idleChip =
    'bg-background border-border text-muted-foreground hover:border-foreground/30';
  const field =
    'bg-background border border-border rounded-xl px-3 py-2 text-sm text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50';

  const time = simple && simple.kind !== 'minutes' && simple.kind !== 'hours' ? simple : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <label
          htmlFor={inputId}
          className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5"
        >
          <Clock size={11} /> {label} · {zoneLabel}
          {required && <span className="text-danger-text">*</span>}
          {help}
        </label>
        <div className="flex items-center gap-0.5 bg-background border border-border rounded-lg p-0.5">
          <button
            type="button"
            disabled={disabled || !shape}
            onClick={() => setMode('simple')}
            title={shape ? undefined : 'This expression has no simple form — edit it as cron.'}
            className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              simple ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Simple
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setMode('cron')}
            className={`px-2 py-1 rounded-md text-[10px] font-bold transition-colors disabled:opacity-40 ${
              simple ? 'text-muted-foreground hover:text-foreground' : 'bg-muted text-foreground'
            }`}
          >
            Cron
          </button>
        </div>
      </div>

      {simple ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-subtle-foreground w-12 shrink-0">Repeat</span>
            <select
              aria-label="Repeat"
              disabled={disabled}
              value={simple.kind}
              onChange={e => emit(withKind(simple, e.target.value as ScheduleKind))}
              className={`${field} flex-1 min-w-[9rem]`}
            >
              {SCHEDULE_KINDS.map(k => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {(simple.kind === 'minutes' || simple.kind === 'hours') && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-subtle-foreground w-12 shrink-0">Every</span>
              <input
                type="number"
                aria-label={simple.kind === 'minutes' ? 'Minutes between runs' : 'Hours between runs'}
                min={1}
                max={simple.kind === 'minutes' ? 59 : 23}
                disabled={disabled}
                value={everyDraft ?? String(simple.every)}
                onChange={e => {
                  setEveryDraft(e.target.value);
                  const n = Number(e.target.value);
                  const max = simple.kind === 'minutes' ? 59 : 23;
                  if (Number.isInteger(n) && n >= 1 && n <= max) emit({ ...simple, every: n });
                }}
                onBlur={() => setEveryDraft(null)}
                className={`${field} w-20`}
              />
              <span className="text-[11px] text-muted-foreground">
                {simple.kind === 'minutes' ? 'minutes' : 'hours'}
              </span>
              {simple.kind === 'hours' && (
                <>
                  <span className="text-[11px] text-subtle-foreground">at minute</span>
                  <input
                    type="number"
                    aria-label="Minute past the hour"
                    min={0}
                    max={59}
                    disabled={disabled}
                    value={simple.minute}
                    onChange={e => {
                      const n = Number(e.target.value);
                      if (Number.isInteger(n) && n >= 0 && n <= 59) emit({ ...simple, minute: n });
                    }}
                    className={`${field} w-20`}
                  />
                </>
              )}
            </div>
          )}

          {simple.kind === 'monthly' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-subtle-foreground w-12 shrink-0">On the</span>
              <select
                aria-label="Day of the month"
                disabled={disabled}
                value={simple.day}
                onChange={e => emit({ ...simple, day: Number(e.target.value) })}
                className={`${field} w-24`}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={d}>
                    {ordinalDay(d)}
                  </option>
                ))}
              </select>
              {/*
                A month is not 31 days long, and cron does not clamp: a task set
                to the 31st simply does not run in February. Said here, because
                the picker is what makes it a one-click choice.
              */}
              {simple.day > 28 && (
                <span className="text-[10px] text-warning-text">
                  Months shorter than {simple.day} days are skipped, not clamped.
                </span>
              )}
            </div>
          )}

          {simple.kind === 'weekly' && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-subtle-foreground w-12 shrink-0">On</span>
              <div className="flex gap-1">
                {WEEKDAYS.map(d => {
                  const on = simple.days.includes(d.value);
                  return (
                    <button
                      key={d.value}
                      type="button"
                      disabled={disabled}
                      aria-pressed={on}
                      aria-label={d.label}
                      title={d.label}
                      onClick={() => {
                        // The last day cannot be unticked: a weekly schedule
                        // with no day is not a schedule, and the alternative is
                        // a cron the API rejects for a reason about syntax.
                        const next = on
                          ? simple.days.filter(v => v !== d.value)
                          : [...simple.days, d.value];
                        if (next.length) emit({ ...simple, days: next });
                      }}
                      className={`w-8 h-8 rounded-lg text-[11px] font-bold border transition-all disabled:opacity-50 ${
                        on ? activeChip : idleChip
                      }`}
                    >
                      {d.short}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {time && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-subtle-foreground w-12 shrink-0">At</span>
              <input
                type="time"
                aria-label="Time of day"
                disabled={disabled}
                value={toTimeValue(time.hour, time.minute)}
                onChange={e => {
                  // An empty or half-typed value is ignored rather than
                  // committed: there is no such thing as a daily schedule with
                  // no time, and blanking the field must not write one.
                  const parsed = fromTimeValue(e.target.value);
                  if (parsed) emit({ ...time, ...parsed });
                }}
                className={`${field} w-32`}
              />
              <span className="text-[11px] text-muted-foreground">{zoneLabel}</span>
            </div>
          )}

          <p className="text-[10px] text-subtle-foreground font-mono">{value}</p>
        </div>
      ) : (
        <div className="space-y-1">
          <input
            id={inputId}
            value={value}
            disabled={disabled}
            onChange={e => onChange(e.target.value)}
            spellCheck={false}
            // Capped: a full-width card makes a 5-field cron a 1,100px input,
            // where the value occupies the first inch and the caret is a long
            // way from the label. The field should look like what it holds.
            className={`w-full max-w-md ${field} font-mono ${
              accent === 'native' ? 'text-native-text' : ''
            }`}
          />
          {!shape && value.trim() && (
            <p className="text-[10px] text-subtle-foreground">
              This expression has no simple form — a range, a list, or a month — so it stays here.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        {CRON_PRESETS.map(p => (
          <button
            key={p.cron}
            type="button"
            disabled={disabled}
            onClick={() => onChange(p.cron)}
            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-all disabled:opacity-50 ${
              value.trim() === p.cron ? activeChip : idleChip
            }`}
          >
            {presetLabel(p, zoneLabel)}
          </button>
        ))}
      </div>
    </div>
  );
};

export default ScheduleBuilder;
