import type { PlatformLink } from '../types';
import defaults from '../data/quickLinks/defaults.json';

/**
 * Bookmarks: to schedulers Cronsole has no connector for, and to the web
 * console of each source it does have.
 *
 * For a platform with no public scheduled-task API this is the honest shape:
 * a connector for one would render a row of `unsupported` cells that says
 * strictly less than the link already does. They live in their own section
 * (the top bar's Quick Links, or the Sources tab's third view) — a bookmark
 * sitting *among* connectors reads as a broken connector.
 *
 * **Nothing here is read or written.** That sentence ships beside them in the
 * UI and in the Sources Guide, and it is the whole reason the section is
 * separate rather than a fourth kind of row in the matrix.
 */

/** Where they used to live: a bare `localStorage` key, per origin. */
export const LEGACY_QUICK_LINKS_KEY = 'cronsole_platform_links';

/**
 * The links seeded on a first run, read from `data/quickLinks/defaults.json`.
 *
 * Data, not code, because the biweekly Cronsole Source Scout keeps the URLs
 * current and adds AI tools that schedule work — and that job may edit the
 * JSON and nothing else under `frontend/`. **Every shipped source has a link
 * here or a reason in `NO_WEB_CONSOLE`** (`quickLinks.test.ts` pins it).
 *
 * One array shared with `DEFAULT_SETTINGS`, so a browser that has never touched
 * its links serializes identically to the defaults — which is what keeps it
 * from seeding an account whose links somebody actually curated.
 */
export const DEFAULT_QUICK_LINKS: PlatformLink[] = defaults.links.map(
  ({ id, name, url, iconType }) => ({ id, name, url, iconType })
);

/** Default link ids, keyed by the `PlatformType` they open — for the coverage test. */
export const DEFAULT_LINK_PLATFORMS: Record<string, string> = Object.fromEntries(
  defaults.links.flatMap(l => (l.platform ? [[l.platform, l.id]] : []))
);

/** Shipped sources with no web page to link to, and why. */
export const NO_WEB_CONSOLE: Record<string, string> = defaults.noWebConsole;

/**
 * The defaults every install already had before new ones could arrive on their
 * own. An account stored before `quickLinkDefaultsSeen` existed was offered
 * exactly these, so anything else in `DEFAULT_QUICK_LINKS` is new to it.
 */
const ORIGINAL_DEFAULT_IDS = ['claude', 'chatgpt', 'gemini'];

/**
 * Add any default this account has **never been offered**, once.
 *
 * `seen` is every default id ever offered. A default the person deleted is in
 * `seen` and stays deleted; one added to the JSON later is not, so it is
 * appended and recorded. Deterministic, so every device reaches the same list
 * from the same stored document.
 */
export function withNewDefaults(
  links: PlatformLink[],
  seen: string[] | undefined
): { quickLinks: PlatformLink[]; quickLinkDefaultsSeen: string[] } {
  const offered = new Set(seen ?? ORIGINAL_DEFAULT_IDS);
  const have = new Set(links.map(l => l.id));
  const fresh = DEFAULT_QUICK_LINKS.filter(l => !offered.has(l.id) && !have.has(l.id));
  return {
    quickLinks: fresh.length ? [...links, ...fresh] : links,
    quickLinkDefaultsSeen: [...new Set([...offered, ...DEFAULT_QUICK_LINKS.map(l => l.id)])]
  };
}

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
