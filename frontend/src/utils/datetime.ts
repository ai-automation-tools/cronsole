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

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago"). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
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
