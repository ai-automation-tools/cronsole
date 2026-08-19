import { useCallback, useEffect, useState } from 'react';
import type { SavedView } from '../utils/savedViews';
import type { RailPin } from '../utils/railPins';

export type DashboardView = 'grid' | 'list' | 'kanban' | 'schedule';
export type TemplateView = 'grid' | 'list' | 'kanban';
/**
 * The zone schedules are read and written in.
 *
 * `'local'` follows the machine and `'utc'` is UTC; anything else is an IANA
 * zone id (`'America/Los_Angeles'`). The two keywords predate the zone ids and
 * are kept because they are already in users' `localStorage` — widening the
 * type rather than replacing it means an existing preference keeps working
 * instead of silently resetting.
 *
 * This affects **authoring and display only**. Storage stays 5-field cron in
 * UTC (CLAUDE.md §9); `utils/timezone.ts` converts at the edge.
 */
export type TimezoneMode = 'local' | 'utc' | (string & {});

/**
 * User preferences persisted client-side. Theme is intentionally NOT here — it
 * keeps its own `cronsole.theme` key (see useTheme) for backward compatibility.
 */
export interface Settings {
  // Dashboard defaults
  defaultView: DashboardView;
  defaultShowDisabled: boolean;
  defaultCategory: string;
  defaultPlatform: string;
  /**
   * Show OS-owned tasks (`\Microsoft\…`) on the dashboard.
   *
   * Off by default because on a real machine they are the overwhelming majority
   * — 257 of 352 on the box this was built against — so every headline number,
   * category chip and view is dominated by rows the user will never act on.
   * Persisted, unlike the old import-time exclusion, which fired once and then
   * left nothing distinguishing an OS task from one the user wrote.
   */
  showSystemTasks: boolean;
  // Templates tab: persisted view mode (the toggle writes here directly)
  templateView: TemplateView;
  // Behavior
  confirmBeforeRun: boolean;
  /**
   * The zone you read and write schedules in. Defaults to Pacific rather than
   * UTC: every cron field in the app used to be labelled UTC, so applying a
   * template whose schedule reads `0 8 * * *` quietly created a task that runs
   * at 1 AM — correct, stored honestly, and useless as a thing to reason about.
   */
  timezone: TimezoneMode;
  // Notifications
  toastOnSuccess: boolean;
  toastOnFailure: boolean;
  desktopNotifyOnFailure: boolean;
  // Onboarding: whether the first-run getting-started nudge has been dismissed
  onboardingSeen: boolean;
  /**
   * Categories ticked on the last successful import, or `null` if there has
   * never been one.
   *
   * The distinction is the whole point. A first run must default to "everything
   * that isn't system", because a user who imports nothing sees an empty product
   * and concludes it doesn't work. Every run *after* that usually means "one new
   * folder" — and inheriting the first run's answer is how a dashboard ends up
   * with 352 rows. `null` picks the generous default exactly once.
   */
  lastImportCategories: string[] | null;
  /**
   * The user's own named filter combinations. The five built-ins are code, not
   * data, so they are **not** stored here — that way a later fix to what
   * "Failures" means reaches everyone, instead of only users who had not opened
   * the dashboard before the change froze a copy into their localStorage.
   */
  savedViews: SavedView[];
  /**
   * Is the dashboard's source rail collapsed to icons?
   *
   * A preference, so it persists — someone who works in a narrow window and
   * collapses the rail should not re-collapse it on every visit. Deliberately
   * **not** in the URL: a bookmark reproduces *which tasks you are looking at*,
   * and a link that also folded someone else's sidebar would make two URLs mean
   * the same thing. Same reasoning as the rail's per-branch expansion state.
   */
  railCollapsed: boolean;
  /**
   * Folders and job types lifted out of the source tree and shown beside your
   * collections. See `utils/railPins.ts` — a pin is *derived* where a collection
   * is *declared*, which is why it lives here as a preference rather than in
   * `TaskCollection` as a row.
   */
  railPins: RailPin[];
  /**
   * Is the Collections band folded shut?
   *
   * Separate from `railCollapsed` because they answer different questions —
   * how wide the rail is, versus how much of your own stuff is on screen — and
   * someone with fifteen collections and three platforms wants opposite answers
   * to the two.
   */
  collectionsCollapsed: boolean;
  /**
   * Is the Pinned band folded shut? Separate from `collectionsCollapsed` for the
   * same reason that one is separate from `railCollapsed` — two sections that
   * fold independently need two flags, or each chevron misreports the other.
   */
  pinnedCollapsed: boolean;
  /** Is the Sources tree folded shut? Independent of the two bands above it. */
  sourcesCollapsed: boolean;
  /**
   * Which Tools-tab cards are open, by `ToolCard` id.
   *
   * Empty by default: the tab opens as a menu of ten named tools rather than ten
   * stacked panels, and a card that has never been opened has never run its
   * queries. Persisted for the same reason `railCollapsed` is — a tool you were
   * working in should still be open when you come back from the dashboard.
   */
  openTools: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  defaultView: 'grid',
  defaultShowDisabled: false,
  defaultCategory: 'All',
  defaultPlatform: 'All',
  showSystemTasks: false,
  templateView: 'grid',
  confirmBeforeRun: true,
  timezone: 'America/Los_Angeles',
  toastOnSuccess: true,
  toastOnFailure: true,
  desktopNotifyOnFailure: false,
  onboardingSeen: false,
  lastImportCategories: null,
  savedViews: [],
  railCollapsed: false,
  railPins: [],
  collectionsCollapsed: false,
  pinnedCollapsed: false,
  sourcesCollapsed: false,
  openTools: [],
};

const STORAGE_KEY = 'cronsole.settings';

function read(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // Merge over defaults so a stored blob missing newer keys stays valid.
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Module-level store so every consumer (dashboard, run handlers, settings page)
// stays in sync when a preference changes — mirrors the pub/sub in api.ts.
let current: Settings = read();
const listeners = new Set<() => void>();

function persist(next: Settings) {
  current = next;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  listeners.forEach(l => l());
}

/** Read the current settings without subscribing (for use outside React). */
export function getSettings(): Settings {
  return current;
}

/**
 * Reactive access to user preferences. All hook instances re-render together
 * when any of them mutates a value.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(current);

  useEffect(() => {
    const l = () => setSettings(current);
    listeners.add(l);
    // Sync in case the store changed between initial render and subscribe.
    l();
    return () => { listeners.delete(l); };
  }, []);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    persist({ ...current, [key]: value });
  }, []);

  const replaceAll = useCallback((next: Partial<Settings>) => {
    persist({ ...DEFAULT_SETTINGS, ...next });
  }, []);

  const reset = useCallback(() => {
    persist({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, update, replaceAll, reset };
}
