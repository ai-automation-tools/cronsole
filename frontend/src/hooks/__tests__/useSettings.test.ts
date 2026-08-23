import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { DEFAULT_SETTINGS, isDefaultSettings, sameSettings, type Settings } from '../useSettings';

/**
 * Preference sync — one blob, following the account rather than the origin.
 *
 * The rules under test are all about **which copy wins**, because that is the
 * only place this feature can destroy something. `localStorage` is scoped per
 * origin, so the same person reaching the same install at `localhost:8080` and
 * over Tailscale is handed two different stores; the fix is worth having only if
 * a second browser adopting the account can never flatten the first browser's
 * preferences on the way in.
 *
 * The one invariant that makes that true — **hydrate before you ever push** — is
 * asserted from both sides: a failed read leaves the browser read-only, and a
 * fresh browser holding nothing but defaults does not seed.
 *
 * Every case re-imports the module under `vi.resetModules()`, because the store
 * reads `localStorage` once at import time. That means `api` is re-imported too
 * and the spies must be installed on **that** instance — a spy on the outer
 * import would watch a module nothing under test is using.
 */
describe('useSettings account sync', () => {
  const STORAGE_KEY = 'cronsole.settings';
  let stop: (() => void) | undefined;

  /** Settings that are recognisably somebody's choices rather than the defaults. */
  const CHOSEN: Partial<Settings> = {
    railCollapsed: true,
    railPins: [
      {
        id: 'pin-1',
        nodeKey: 'src:windows:AI-Maintenance',
        label: 'AI-Maintenance',
        patch: { source: 'windows', category: 'AI-Maintenance' }
      }
    ]
  };

  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    // Clear the dev/E2E token fallback. `getAuthToken()` returns it whenever no
    // one is logged in (api.ts), so a machine whose `.env.local` sets
    // VITE_DEV_TOKEN would never reach the logged-out state these tests assert —
    // and the suite would pass or fail depending on whose checkout it ran in.
    // It is `undefined` in any build, which is the state worth testing against.
    vi.stubEnv('VITE_DEV_TOKEN', '');
  });

  afterEach(() => {
    stop?.();
    stop = undefined;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /**
   * Boot a fresh store from a given local + account state.
   *
   * `remote` is the GET's answer: an object is the stored blob (`{ data: … }`),
   * and an Error makes the read fail.
   */
  async function boot(opts: {
    local?: Partial<Settings>;
    remote?: { data: Partial<Settings> | null } | Error;
  } = {}) {
    if (opts.local) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(opts.local));

    vi.resetModules();
    const apiMod = await import('../../api');

    const remote = opts.remote ?? { data: null };
    const get =
      remote instanceof Error
        ? vi.spyOn(apiMod.api, 'get').mockRejectedValue(remote)
        : vi.spyOn(apiMod.api, 'get').mockResolvedValue({ data: remote });
    const put = vi.spyOn(apiMod.api, 'put').mockResolvedValue({ data: {} });

    // A token has to exist before the sync starts, or there is no account to
    // follow and the store correctly stays local.
    apiMod.setAuthToken('test-session-token');

    const mod = await import('../useSettings');
    stop = mod.startSettingsSync();
    return { mod, apiMod, get, put };
  }

  describe('canonical comparison', () => {
    // Plain JSON.stringify would not do: key order alone would make every
    // hydrate look like a change and every page load push a redundant write.
    it('ignores key order', () => {
      expect(
        sameSettings(
          { railCollapsed: true, timezone: 'UTC' } as Partial<Settings>,
          { timezone: 'UTC', railCollapsed: true } as Partial<Settings>
        )
      ).toBe(true);
    });

    it('does not ignore array order', () => {
      expect(
        sameSettings(
          { openTools: ['restore', 'export'] } as Partial<Settings>,
          { openTools: ['export', 'restore'] } as Partial<Settings>
        )
      ).toBe(false);
    });

    it('recognises an untouched blob as the defaults', () => {
      expect(isDefaultSettings({ ...DEFAULT_SETTINGS })).toBe(true);
      expect(isDefaultSettings({ ...DEFAULT_SETTINGS, railCollapsed: true })).toBe(false);
    });
  });

  describe('hydrate', () => {
    it('adopts the account copy over whatever this browser had', async () => {
      const { mod, put } = await boot({ local: { railCollapsed: false }, remote: { data: CHOSEN } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));

      expect(mod.getSettings().railCollapsed).toBe(true);
      expect(mod.getSettings().railPins).toHaveLength(1);
      // Adopting is not a change to propagate — nothing was written back.
      expect(put).not.toHaveBeenCalled();
    });

    it('caches the adopted copy locally, so a reload does not wait on the network', async () => {
      const { mod } = await boot({ remote: { data: CHOSEN } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));

      const cached = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!) as Settings;
      expect(cached.railCollapsed).toBe(true);
      expect(cached.railPins).toHaveLength(1);
    });

    /**
     * The clobber this whole design exists to prevent. A browser opened once,
     * holding nothing but defaults, must not claim the account and flatten a
     * desktop that has months of pins in it.
     */
    it('does NOT seed the account from a browser that has chosen nothing', async () => {
      const { mod, put } = await boot({ remote: { data: null } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));

      expect(put).not.toHaveBeenCalled();
    });

    // The other half of the same rule: real local preferences on an account that
    // has never stored any is exactly the case worth keeping.
    it('seeds the account from a browser that HAS chosen something', async () => {
      const { mod, put } = await boot({ local: CHOSEN, remote: { data: null } });
      await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));

      expect(put.mock.calls[0]![0]).toBe('/preferences');
      expect(put.mock.calls[0]![1]).toMatchObject({
        data: expect.objectContaining({ railCollapsed: true })
      });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));
    });

    /**
     * `{}` is a stored answer; `null` is the absence of one. An account whose
     * preferences ARE the defaults must overwrite a local blob rather than be
     * overwritten by it.
     */
    it('treats a stored empty object as an answer, not as absence', async () => {
      const { mod, put } = await boot({ local: CHOSEN, remote: { data: {} } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));

      expect(mod.getSettings().railCollapsed).toBe(false);
      expect(mod.getSettings().railPins).toEqual([]);
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('push', () => {
    it('debounces a burst of edits into one write', async () => {
      const { mod, put } = await boot({ remote: { data: {} } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));

      vi.useFakeTimers();
      // Four changes in a row is one gesture, not four requests.
      mod.setSetting('railCollapsed', true);
      mod.setSetting('templateView', 'list');
      mod.setSetting('confirmBeforeRun', false);
      mod.setSetting('toastOnSuccess', false);

      expect(put).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(700);
      expect(put).toHaveBeenCalledTimes(1);

      expect((put.mock.calls[0]![1] as { data: Settings }).data).toMatchObject({
        railCollapsed: true,
        templateView: 'list',
        confirmBeforeRun: false,
        toastOnSuccess: false
      });
    });

    /**
     * The safety property, stated as a test: a browser whose read failed stays
     * **read-only to the account**. Losing an edit to a retry is recoverable;
     * overwriting an account's sidebar with an empty one is not.
     */
    it('never writes after a failed hydrate', async () => {
      const { mod, put } = await boot({ remote: new Error('backend down') });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('error'));

      vi.useFakeTimers();
      mod.setSetting('railCollapsed', true);
      await vi.advanceTimersByTimeAsync(2000);

      expect(put).not.toHaveBeenCalled();
      // Still honoured locally — read-only to the account, not to the user.
      expect(mod.getSettings().railCollapsed).toBe(true);
    });

    // And the retry is a READ, never the write we just declined to do.
    it('retries the read — not the write — on the next edit after a failure', async () => {
      const { mod, get, put } = await boot({ remote: new Error('backend down') });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('error'));
      expect(get).toHaveBeenCalledTimes(1);

      mod.setSetting('railCollapsed', true);

      await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(2));
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('session', () => {
    it('stops writing to the account on logout, and keeps the local copy', async () => {
      const { mod, apiMod, put } = await boot({ remote: { data: CHOSEN } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));

      apiMod.clearAuthToken();
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('local'));

      vi.useFakeTimers();
      mod.setSetting('railCollapsed', false);
      await vi.advanceTimersByTimeAsync(2000);

      expect(put).not.toHaveBeenCalled();
      expect(mod.getSettings().railCollapsed).toBe(false);
    });

    it('re-reads the account when a different session signs in', async () => {
      const { mod, apiMod, get } = await boot({ remote: { data: CHOSEN } });
      await vi.waitFor(() => expect(mod.getSettingsSyncStatus()).toBe('synced'));
      const first = get.mock.calls.length;

      apiMod.setAuthToken('a-different-session-token');
      await vi.waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(first));
    });
  });
});
