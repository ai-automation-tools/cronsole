/**
 * Shared quick-pick schedules for the New Task, Apply Template, Edit Schedule
 * and Schedule Tester surfaces.
 *
 * The crons here are expressed **in the user's schedule zone**, not UTC — every
 * one of those surfaces holds its cron in that zone and converts once on submit
 * (`useScheduleZone`). That is why the labels no longer say UTC: "Daily 8am UTC"
 * inserted `0 8 * * *` and produced a task that ran at 1 AM Pacific, which is
 * the defect this whole layer exists to remove. The label carries the zone at
 * render time instead of being baked into the constant.
 */
export interface CronPreset {
  /** Label without a zone — the caller appends the live one. */
  label: string;
  cron: string;
  /** True when the schedule has an absolute clock time, so the zone matters. */
  zoned: boolean;
}

export const CRON_PRESETS: readonly CronPreset[] = [
  { label: 'Every 15 min', cron: '*/15 * * * *', zoned: false },
  { label: 'Hourly', cron: '0 * * * *', zoned: false },
  { label: 'Daily 8am', cron: '0 8 * * *', zoned: true },
  { label: 'Weekdays 9am', cron: '0 9 * * 1-5', zoned: true },
  { label: 'Sunday 10pm', cron: '0 22 * * 0', zoned: true }
] as const;

/** Preset label with the live zone appended where it changes the meaning. */
export const presetLabel = (preset: CronPreset, zoneLabel: string): string =>
  preset.zoned ? `${preset.label} ${zoneLabel}` : preset.label;
