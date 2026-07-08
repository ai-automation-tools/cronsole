import type { TimezoneMode } from '../hooks/useSettings';

/**
 * Format an ISO timestamp for display, honoring the user's timezone preference.
 * Schedules are stored in UTC (see CLAUDE.md §9); `local` converts to the
 * viewer's zone, `utc` keeps it in UTC with a trailing `UTC` marker.
 */
export function formatDateTime(iso: string | null | undefined, tz: TimezoneMode): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (tz === 'utc') {
    return `${d.toLocaleString(undefined, { timeZone: 'UTC' })} UTC`;
  }
  return d.toLocaleString();
}

/** Time-only variant (used in dense list rows). */
export function formatTime(iso: string | null | undefined, tz: TimezoneMode): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  if (tz === 'utc') {
    return `${d.toLocaleTimeString(undefined, { timeZone: 'UTC' })} UTC`;
  }
  return d.toLocaleTimeString();
}
