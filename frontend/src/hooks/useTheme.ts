import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark' | 'system' | 'dracula' | 'nord' | 'solarized' | 'tokyo-night';

const STORAGE_KEY = 'cronsole.theme';

/** Named palettes: a fixed theme, not resolved against the OS like `dark`/`light`/`system` are. */
const NAMED_THEMES = ['dracula', 'nord', 'solarized', 'tokyo-night'] as const;

/** Every class `applyTheme` ever stamps on `<html>` — kept mutually exclusive. */
const ALL_THEME_CLASSES = ['dark', 'light', ...NAMED_THEMES] as const;

const VALID_MODES: readonly ThemeMode[] = ['light', 'dark', 'system', ...NAMED_THEMES];

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
  return v && (VALID_MODES as readonly string[]).includes(v) ? (v as ThemeMode) : DEFAULT_MODE;
}

/** Resolve a mode to a concrete theme and stamp it on <html>. */
function applyTheme(mode: ThemeMode) {
  const root = document.documentElement;
  const resolved = (NAMED_THEMES as readonly string[]).includes(mode)
    ? mode
    : mode === 'dark' || (mode === 'system' && systemPrefersDark())
      ? 'dark'
      : 'light';
  for (const cls of ALL_THEME_CLASSES) root.classList.toggle(cls, cls === resolved);
}

/**
 * Standard light / dark / system theme control. Persists the chosen mode to
 * localStorage (`cronsole.theme`) and follows OS changes while in `system` mode.
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
