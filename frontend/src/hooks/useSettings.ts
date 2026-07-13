import { useCallback, useEffect, useState } from 'react';

export type DashboardView = 'grid' | 'list' | 'kanban' | 'schedule';
export type TemplateView = 'grid' | 'list' | 'kanban';
export type TimezoneMode = 'local' | 'utc';

/**
 * User preferences persisted client-side. Theme is intentionally NOT here — it
 * keeps its own `taskhub.theme` key (see useTheme) for backward compatibility.
 */
export interface Settings {
  // Dashboard defaults
  defaultView: DashboardView;
  defaultShowDisabled: boolean;
  defaultCategory: string;
  defaultPlatform: string;
  // Templates tab: persisted view mode (the toggle writes here directly)
  templateView: TemplateView;
  // Behavior
  confirmBeforeRun: boolean;
  timezone: TimezoneMode;
  // Notifications
  toastOnSuccess: boolean;
  toastOnFailure: boolean;
  desktopNotifyOnFailure: boolean;
  // Onboarding: whether the first-run getting-started nudge has been dismissed
  onboardingSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  defaultView: 'grid',
  defaultShowDisabled: false,
  defaultCategory: 'All',
  defaultPlatform: 'All',
  templateView: 'grid',
  confirmBeforeRun: true,
  timezone: 'local',
  toastOnSuccess: true,
  toastOnFailure: true,
  desktopNotifyOnFailure: false,
  onboardingSeen: false,
};

const STORAGE_KEY = 'taskhub.settings';

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
