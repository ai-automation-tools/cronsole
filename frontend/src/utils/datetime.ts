import type { TimezoneMode } from '../hooks/useSettings';
import { machineZone, resolveZone, zoneAbbrev } from './timezone';

/**
 * Format an ISO timestamp for display in the user's chosen zone.
 *
 * Timestamps arrive from the API as UTC ISO strings (schedules are stored in
 * UTC — CLAUDE.md §9); this renders them wherever the Settings zone points.
 * The zone marker is appended whenever the reading is NOT the machine's own
 * zone, because a time in a zone other than the one on your taskbar is exactly
 * the case where an unlabelled clock reading is a lie.
 */
function withZone(
  iso: string | null | undefined,
  tz: TimezoneMode,
  render: (d: Date, opts: Intl.DateTimeFormatOptions) => string
): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const zone = resolveZone(tz);
  const text = render(d, { timeZone: zone });
  return zone === machineZone() ? text : `${text} ${zoneAbbrev(zone, d)}`;
}

export function formatDateTime(iso: string | null | undefined, tz: TimezoneMode): string {
  return withZone(iso, tz, (d, opts) => d.toLocaleString(undefined, opts));
}

/** Time-only variant (used in dense list rows). */
export function formatTime(iso: string | null | undefined, tz: TimezoneMode): string {
  return withZone(iso, tz, (d, opts) => d.toLocaleTimeString(undefined, opts));
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
