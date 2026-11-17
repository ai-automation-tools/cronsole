import { parseFrameAncestors } from './frameAncestors';

/**
 * The suite embed contract, v1. Opened as `?embed=1` inside a frame (a Project Hub
 * tab, the suite shell), Cronsole hides the chrome the shell replaces (the brand
 * mark and the Light / Dark switch), tells the shell when it's ready and where it
 * is, and takes the shell's theme. Standalone, `?embed=1` does nothing.
 *
 * Messages carry `suite: 1` and `contract: 1`, and go only to the origins in
 * `VITE_FRAME_ANCESTORS`, the same list the dev server sends as CSP frame-ancestors.
 * Unset, the chrome still hides but nothing is posted or accepted: unlike the
 * header, an empty list here can't mean "anyone".
 */
export const SUITE_ORIGINS: readonly string[] = parseFrameAncestors(import.meta.env.VITE_FRAME_ANCESTORS);

export type ShellMessage =
  | { type: 'ready'; app: 'cronsole' }
  | { type: 'route'; path: string };

/** The window to talk to: the parent when framed with `?embed=1`, otherwise null. */
export function embedParent(win: Window = window): Window | null {
  return win.parent !== win && new URLSearchParams(win.location.search).get('embed') === '1' ? win.parent : null;
}

export function tellShell(parent: Window | null, msg: ShellMessage, origins: readonly string[] = SUITE_ORIGINS) {
  // A target origin the parent doesn't have drops the message, so each listed one is tried.
  for (const origin of origins) parent?.postMessage({ suite: 1, contract: 1, ...msg }, origin);
}

/** The theme in a shell's message, or null for anything else or from anyone else. */
export function shellTheme(e: MessageEvent, parent: Window | null, origins: readonly string[] = SUITE_ORIGINS): 'light' | 'dark' | null {
  if (!parent || e.source !== parent || !origins.includes(e.origin)) return null;
  const d = e.data as { suite?: unknown; type?: unknown; value?: unknown } | null;
  return d?.suite === 1 && d.type === 'theme' && (d.value === 'light' || d.value === 'dark') ? d.value : null;
}

export const EMBED_PARENT = embedParent();
export const EMBED = EMBED_PARENT !== null;
