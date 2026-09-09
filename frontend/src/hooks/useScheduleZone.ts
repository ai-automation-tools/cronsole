import { useMemo } from 'react';
import { useSettings } from './useSettings';
import {
  resolveZone,
  zoneLabel,
  zoneOffsetMinutes,
  utcCronToZone,
  zoneCronToUtc,
  type CronShift
} from '../utils/timezone';

export interface ScheduleZone {
  /** IANA zone id currently in effect. */
  zone: string;
  /** How it's named in labels — "PDT", "UTC", "Kolkata (GMT+5:30)". */
  label: string;
  /** True when authoring is already in UTC, so no conversion is shown at all. */
  isUtc: boolean;
  /** A stored UTC cron, as it reads in this zone. */
  toZone: (cron: string) => CronShift;
  /** A cron typed in this zone, as the UTC that gets stored. */
  toUtc: (cron: string) => CronShift;
}

/**
 * The one place every cron input gets its zone from.
 *
 * Each authoring surface holds its cron string **in the user's zone** and calls
 * `toUtc` exactly once, on submit. That keeps the conversion at a single, late,
 * observable point rather than round-tripping the value on every keystroke,
 * where an unshiftable expression would fight the cursor.
 *
 * The offset is pinned per render (`Date.now()` at mount of the memo) so a
 * modal open across a DST boundary can't convert its display and its submit
 * with two different offsets — an hour of skew nobody would ever reproduce.
 */
export function useScheduleZone(): ScheduleZone {
  const { settings } = useSettings();
  const mode = settings.timezone;

  return useMemo(() => {
    const at = new Date();
    const zone = resolveZone(mode);
    const isUtc = zoneOffsetMinutes(zone, at) === 0 && zone === 'UTC';
    return {
      zone,
      label: zoneLabel(mode, at),
      isUtc,
      toZone: (cron: string) => utcCronToZone(cron, mode, at),
      toUtc: (cron: string) => zoneCronToUtc(cron, mode, at)
    };
    // `mode` is the only input; the anchor instant is deliberately captured once.
  }, [mode]);
}
