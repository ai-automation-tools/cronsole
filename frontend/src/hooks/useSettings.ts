import { useCallback, useEffect, useState } from 'react';
import { api, subscribeAuthToken } from '../api';
import type { SavedView } from '../utils/savedViews';
import type { RailPin } from '../utils/railPins';
import type { PlatformLink } from '../types';
import { DEFAULT_QUICK_LINKS, readLegacyQuickLinks } from '../utils/quickLinks';

export type DashboardView = 'grid' | 'list' | 'kanban' | 'schedule' | 'calendar';
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
   * Platform keys in the order the rail draws them, when the user has dragged
   * one. Empty means alphabetical, which is the order it always had.
   *
   * A *show* list's sibling and the same shape for the same reason: it names
   * only what was arranged, so a source shipped later is absent from every
   * existing preference and arrives at the bottom rather than reshuffling a
   * rail somebody arranged. Pins keep their order in `railPins` and collections
   * in their own `position` column — three stores, because the order of a row
   * belongs with the row, not in a fourth record free to disagree.
   */
  sourceOrder: string[];
  /**
   * Sources listed in the rail even when they hold nothing and are not connected.
   *
   * **The opt-in half of a three-way union.** A source is shown when it is in
   * here, **or** it holds tasks, **or** it has a connection — so this list is
   * additive and can never hide a source you would then be unable to find. That
   * is also why it lists what to *show* rather than what to hide: a platform
   * added to Cronsole later (Vercel, Supabase, the POSIX agent) is absent from
   * every existing user's list, so it arrives opt-in for free. A hide-list would
   * have made each new source appear unasked in every install.
   *
   * Defaults to Windows plus native — the two a fresh install can actually use.
   * Listing four platforms of which two are real is how a first run teaches
   * someone that half the product is broken.
   */
  shownSources: string[];
  /**
   * Bookmarks to schedulers Cronsole has no connector for.
   *
   * Here rather than in `localStorage` under `cronsole_platform_links`, where
   * they used to live, because `localStorage` is scoped to an *origin*: the same
   * install at `localhost:8080` and at a Tailscale name kept two different link
   * lists while drawing one dashboard. A link is a preference, not a fact about
   * the device.
   */
  quickLinks: PlatformLink[];
}

/**
 * The sources a fresh install lists: Windows Task Scheduler and Cronsole-native.
 *
 * Native is named here rather than assumed, so "which sources am I showing" has
 * exactly one answer to read. Every other source is added from **Explore
 * sources** — they are all real, and they all need a credential nobody has on a
 * first run, so a row for each is a sidebar that looks mostly broken on day one.
 *
 * Deliberately phrased as the rule rather than a tally: this comment used to say
 * "four platforms of which two work", which stopped being true the moment a
 * fifth source shipped.
 */
export const DEFAULT_SHOWN_SOURCES: string[] = ['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE'];

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
  sourceOrder: [],
  shownSources: DEFAULT_SHOWN_SOURCES,
  quickLinks: DEFAULT_QUICK_LINKS,
};


const STORAGE_KEY = 'cronsole.settings';

/** Where the account's copy lives. One blob, opaque to the server. */
const SYNC_PATH = '/preferences';

/**
 * How long a burst of changes is allowed to settle before it reaches the server.
 *
 * Long enough that dragging a slider or ticking four boxes in a row is one
 * request, short enough that closing the tab a moment later still catches it —
 * and `flushPush()` on `pagehide` covers the case where it doesn't.
 */
const PUSH_DEBOUNCE_MS = 600;

function read(): Settings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    // Merge over defaults so a stored blob missing newer keys stays valid.
    const merged: Settings = { ...DEFAULT_SETTINGS, ...stored };
    // Quick links predate this document and had their own key. Adopt them
    // **only** when the blob has never carried them, so a link deleted after the
    // move cannot be resurrected by the leftover key on the next boot.
    if (stored.quickLinks === undefined) {
      const legacy = readLegacyQuickLinks();
      if (legacy) merged.quickLinks = legacy;
    }
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeLocal(next: Settings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private mode, quota, a disabled store. The account copy is the durable
    // one now, so losing the local cache costs a round trip, not a preference.
  }
}

// Module-level store so every consumer (dashboard, run handlers, settings page)
// stays in sync when a preference changes — mirrors the pub/sub in api.ts.
let current: Settings = read();
const listeners = new Set<() => void>();

/**
 * Whether this browser's preferences are following the account.
 *
 * `'local'` is the honest word for "not synced and not trying" — logged out, or
 * the sync never started. It is deliberately not called `'offline'`, which would
 * claim a failure where there is only an absence.
 */
export type SettingsSyncStatus = 'local' | 'syncing' | 'synced' | 'error';

let syncStatus: SettingsSyncStatus = 'local';

/**
 * Set only after a **successful** hydrate, and this flag is the whole safety
 * property of the design.
 *
 * The clobber to avoid is a browser that has never read the account pushing its
 * own defaults over preferences another device spent months accumulating. That
 * cannot happen while a write is gated on having first completed a read: if the
 * GET failed, this stays false and a later edit re-hydrates instead of pushing.
 * Losing a preference to a retry is recoverable; overwriting an account's
 * sidebar with an empty one is not.
 */
let pushEnabled = false;

/** The token the current hydrate belongs to, so a re-login re-reads. */
let syncedToken: string | undefined;
let pushTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  listeners.forEach(l => l());
}

function setStatus(next: SettingsSyncStatus): void {
  if (syncStatus === next) return;
  syncStatus = next;
  notify();
}

/**
 * Structural comparison with a stable key order.
 *
 * `JSON.stringify` alone would not do: a blob read back from the server has
 * whatever key order it was written in, and one merged over `DEFAULT_SETTINGS`
 * has the literal's — so two identical settings objects routinely serialize
 * differently. Getting this wrong would make every hydrate look like a change
 * and every load push a redundant write.
 */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
    .join(',')}}`;
}

export function sameSettings(a: Partial<Settings>, b: Partial<Settings>): boolean {
  return canonical(a) === canonical(b);
}

/**
 * Has anyone actually chosen anything in this browser?
 *
 * This is what decides whether a browser may **seed** an account that has never
 * stored preferences. A blob equal to the defaults asserts nothing, so pushing
 * it would let a phone opened once claim the account's preferences and flatten
 * the desktop that has real ones. A blob that differs is a set of decisions
 * somebody made, and is worth keeping.
 */
export function isDefaultSettings(value: Settings): boolean {
  return sameSettings(value, DEFAULT_SETTINGS);
}

/** Adopt the account's copy, replacing whatever this browser had. */
function applyRemote(remote: Partial<Settings>): void {
  const next = { ...DEFAULT_SETTINGS, ...remote };
  if (sameSettings(next, current)) return;
  current = next;
  writeLocal(next);
  notify();
}

async function push(value: Settings): Promise<void> {
  await api.put(SYNC_PATH, { data: value });
}

/**
 * Read the account's preferences and decide which copy wins — **before this
 * browser is allowed to write one.**
 *
 * Three outcomes, and the middle one is the one worth stating: a stored blob is
 * adopted wholesale; *no* stored blob with local changes seeds the account; and
 * no stored blob with untouched defaults does nothing at all, leaving the
 * account never-stored so the next device with real preferences can seed it.
 *
 * **A local edit made while this read is in flight must win, never be silently
 * discarded.** `persist()` can run at any time — including in the gap between
 * page load and the first successful hydrate, or right after `schedulePush`
 * retries a read instead of a declined write. Without the check below, that
 * edit sits in `current` until this GET resolves and then `applyRemote`
 * overwrites it with the answer to a question asked *before* the edit
 * happened — a toggle that visibly worked, then reverted itself a moment
 * later with nothing on screen to explain why. `current` is reassigned by
 * reference on every `persist()`, so comparing the reference is enough to
 * detect this without a timestamp.
 */
async function hydrate(): Promise<void> {
  setStatus('syncing');
  const before = current;
  try {
    const { data } = await api.get<{ data: Partial<Settings> | null }>(SYNC_PATH);
    if (current !== before) {
      // The local edit is strictly newer than what this read answered — push
      // it rather than adopt a now-stale remote copy over it.
      pushEnabled = true;
      schedulePush();
      setStatus('synced');
      return;
    }
    if (data?.data) {
      applyRemote(data.data);
    } else if (!isDefaultSettings(current)) {
      await push(current);
    }
    pushEnabled = true;
    setStatus('synced');
  } catch {
    // Keep serving the local copy and stay read-only until a hydrate succeeds.
    pushEnabled = false;
    setStatus('error');
  }
}

function schedulePush(): void {
  if (!pushEnabled) {
    // An edit made while unsynced is the natural moment to retry the read that
    // failed — and it must be a read, never the write we are declining to do.
    if (syncStatus === 'error' && syncedToken) void hydrate();
    return;
  }
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    push(current).then(
      () => setStatus('synced'),
      () => setStatus('error')
    );
  }, PUSH_DEBOUNCE_MS);
}

/** Send a pending debounced write now — used when the page is going away. */
function flushPush(): void {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = null;
  // Best effort: an in-flight request usually survives `pagehide`. `sendBeacon`
  // would be the durable form and cannot be used here — it carries no
  // Authorization header, and this route is authenticated.
  void push(current).catch(() => { /* the local copy is still correct */ });
}

function persist(next: Settings) {
  current = next;
  writeLocal(next);
  notify();
  schedulePush();
}

/**
 * Begin following the account. Called once from `main.tsx`, after the storage
 * migration and before anything renders.
 *
 * Deliberately explicit rather than a module-level side effect: importing a
 * preferences hook must not fire a network request, or every unit test that
 * touches settings acquires one.
 */
export function startSettingsSync(): () => void {
  const stop = subscribeAuthToken(token => {
    if (token === syncedToken) return;
    syncedToken = token;
    pushEnabled = false;
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (!token) {
      // Logged out: keep the local copy on screen, stop writing to an account
      // that is no longer ours.
      setStatus('local');
      return;
    }
    void hydrate();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPush);
  }

  return () => {
    stop();
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', flushPush);
  };
}

/** Read the current settings without subscribing (for use outside React). */
export function getSettings(): Settings {
  return current;
}

/** Where this browser's preferences stand relative to the account. */
export function getSettingsSyncStatus(): SettingsSyncStatus {
  return syncStatus;
}

/**
 * Change one preference from outside React — the write counterpart to
 * `getSettings()`, and the same store the hook mutates.
 *
 * Exported because the store is the real thing here and the hook is a wrapper
 * over it: a caller that is not a component (and a test of the sync rules, which
 * are not rendering rules) should not have to stand up a renderer to set a flag.
 */
export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  persist({ ...current, [key]: value });
}

/**
 * Reactive access to user preferences. All hook instances re-render together
 * when any of them mutates a value.
 */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(current);
  const [sync, setSync] = useState<SettingsSyncStatus>(syncStatus);

  useEffect(() => {
    const l = () => { setSettings(current); setSync(syncStatus); };
    listeners.add(l);
    // Sync in case the store changed between initial render and subscribe.
    l();
    return () => { listeners.delete(l); };
  }, []);

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSetting(key, value);
  }, []);

  const replaceAll = useCallback((next: Partial<Settings>) => {
    persist({ ...DEFAULT_SETTINGS, ...next });
  }, []);

  const reset = useCallback(() => {
    persist({ ...DEFAULT_SETTINGS });
  }, []);

  return { settings, syncStatus: sync, update, replaceAll, reset };
}
