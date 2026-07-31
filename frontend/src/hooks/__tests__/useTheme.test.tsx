// Vite's `?raw` rather than node:fs — this file is compiled by tsconfig.app.json,
// whose `types` is `["vite/client"]`, so node builtins are not available here
// (and shouldn't be: it's the browser project).
import indexHtml from '../../../index.html?raw';
import { renderHook, act } from '@testing-library/react';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { useTheme } from '../useTheme';

/** Point matchMedia('(prefers-color-scheme: dark)') at a fixed answer. */
function setSystemPrefersDark(dark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('prefers-color-scheme: dark') ? dark : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

describe('useTheme', () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove('dark', 'light');
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('defaults to dark on a fresh install, not to the OS preference', () => {
    // The OS says light. Dark is Cronsole's default (CLAUDE.md §9), so a fresh
    // install must still render dark — following the OS here is what made the
    // docs a lie for every user whose machine is set to light.
    setSystemPrefersDark(false);

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
  });

  it('falls back to dark when the stored value is unrecognized', () => {
    setSystemPrefersDark(false);
    window.localStorage.setItem('taskhub.theme', 'neon');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('honors an explicitly chosen light theme', () => {
    window.localStorage.setItem('taskhub.theme', 'light');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('still follows the OS when the user picks system on purpose', () => {
    setSystemPrefersDark(false);
    window.localStorage.setItem('taskhub.theme', 'system');

    const { result } = renderHook(() => useTheme());

    expect(result.current.theme).toBe('system');
    expect(document.documentElement.classList.contains('light')).toBe(true);

    // …and the other way round.
    setSystemPrefersDark(true);
    window.localStorage.setItem('taskhub.theme', 'system');
    const second = renderHook(() => useTheme());
    expect(second.result.current.theme).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('persists an explicit choice', () => {
    const { result } = renderHook(() => useTheme());

    act(() => result.current.setTheme('light'));

    expect(window.localStorage.getItem('taskhub.theme')).toBe('light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it("index.html's pre-paint fallback matches the hook's default", () => {
    // The boot script in index.html stamps the theme before React exists. If the
    // two defaults drift, a fresh install renders one theme for a frame and the
    // other after hydration — the flash the script exists to prevent.
    expect(indexHtml).toContain("localStorage.getItem('taskhub.theme') || 'dark'");
  });
});
