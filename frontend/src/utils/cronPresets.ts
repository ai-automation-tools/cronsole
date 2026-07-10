/** Shared quick-pick schedules for the New Task and Apply Template modals. */
export const CRON_PRESETS = [
  { label: 'Every 15 min', cron: '*/15 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 8am UTC', cron: '0 8 * * *' },
  { label: 'Weekdays 9am UTC', cron: '0 9 * * 1-5' },
  { label: 'Sunday 10pm UTC', cron: '0 22 * * 0' }
] as const;
