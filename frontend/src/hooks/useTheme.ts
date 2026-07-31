import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'taskhub.theme';

/**
 * Dark is Cronsole's default, not an opt-in (CLAUDE.md §9) — the token set, the
 * design system, and both public sites are built dark-first, so "follow the OS"
 * would ship a first paint the product was never designed in. `system` stays
 * available, but only as a mode the user picks on purpose.
 *
 * The pre-paint script in `index.html` hard-codes the same fallback; if this
 * changes, change that too or the first frame disagrees with the app.
 */
const DEFAULT_MODE: ThemeMode = 'dark';

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

function readStored(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : DEFAULT_MODE;
}

/** Resolve a mode to a concrete theme and stamp it on <html>. */
function applyTheme(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.classList.toggle('light', !dark);
}

/**
 * Standard light / dark / system theme control. Persists the chosen mode to
 * localStorage (`taskhub.theme`) and follows OS changes while in `system` mode.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(readStored);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    window.localStorage.setItem(STORAGE_KEY, mode);
    setThemeState(mode);
  }, []);

  return { theme, setTheme };
}
