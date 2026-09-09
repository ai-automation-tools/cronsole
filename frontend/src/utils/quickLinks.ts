import type { PlatformLink } from '../types';

/**
 * Bookmarks to schedulers Cronsole has no connector for.
 *
 * These are the honest shape for a platform with no public scheduled-task API:
 * a connector for one would render a row of `unsupported` cells that says
 * strictly less than the link already does. They live on the **Sources** tab
 * below the real sources — a bookmark sitting *among* connectors reads as a
 * broken connector.
 *
 * **Nothing here is read or written.** That sentence ships beside them in the
 * UI and in the Sources Guide, and it is the whole reason the section is
 * separate rather than a fourth kind of row in the matrix.
 */

/** Where they used to live: a bare `localStorage` key, per origin. */
export const LEGACY_QUICK_LINKS_KEY = 'cronsole_platform_links';

/**
 * The three seeded on a first run.
 *
 * A frozen literal shared with `DEFAULT_SETTINGS`, so a browser that has never
 * touched its links serializes identically to the defaults — which is what
 * keeps it from seeding an account whose links somebody actually curated.
 */
export const DEFAULT_QUICK_LINKS: PlatformLink[] = [
  { id: 'claude', name: 'Claude Routines', url: 'https://claude.ai/code/routines', iconType: 'claude' },
  { id: 'chatgpt', name: 'ChatGPT Schedules', url: 'https://chatgpt.com/schedules', iconType: 'chatgpt' },
  { id: 'gemini', name: 'Gemini Scheduled', url: 'https://gemini.google.com/scheduled', iconType: 'gemini' }
];

/**
 * The pre-`UserPreference` links from this browser, or `null` if there are none.
 *
 * Reads **and clears** the legacy key: leaving it would make it a second source
 * of truth that wins on any device where the settings document has not synced
 * yet, which is exactly the split-brain the move exists to end. Called once,
 * from `useSettings.read()`, and only when the settings blob has never carried
 * a `quickLinks` field — so a link deleted *after* the migration stays deleted.
 */
export function readLegacyQuickLinks(storage: Storage | undefined = safeStorage()): PlatformLink[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_QUICK_LINKS_KEY);
    if (!raw) return null;
    storage.removeItem(LEGACY_QUICK_LINKS_KEY);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const links = parsed.filter(isPlatformLink);
    // An empty array is a real answer — somebody deleted every link — so it is
    // returned rather than folded into `null`, which would restore the seeds.
    return links;
  } catch {
    // Private mode, quota, malformed JSON. Losing three bookmarks is recoverable
    // in seconds; failing to boot over them is not.
    return null;
  }
}

function isPlatformLink(value: unknown): value is PlatformLink {
  if (!value || typeof value !== 'object') return false;
  const link = value as Record<string, unknown>;
  return typeof link.id === 'string' && typeof link.name === 'string' && typeof link.url === 'string';
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

/** Normalize what someone typed into the Add-link form. */
export const normalizeLinkUrl = (url: string): string =>
  /^https?:\/\//i.test(url) ? url : `https://${url}`;
