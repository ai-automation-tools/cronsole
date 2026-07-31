/**
 * Carry browser state across the 2026-07-31 TaskHub → Cronsole rename.
 *
 * `localStorage` keys are invisible until they aren't: these five hold the login
 * token, the theme, the settings, and the runtime API-origin override. Renaming
 * them without moving the values would log the user out, reset their theme, and
 * silently drop an override that exists precisely for the case where the default
 * backend origin is wrong — i.e. it would break the setup least able to recover
 * on its own.
 *
 * Runs once at startup, before anything reads a key. Copy-then-delete rather
 * than copy-and-leave, so the old keys don't linger as a second source of truth.
 */

/** The pre-rename prefix, assembled so a future rename pass can't rewrite it into `cronsole` and make this a no-op that still looks right. */
const LEGACY_PREFIX = ['task', 'hub'].join('');

/** Every key the app persists. Adding one here is what makes it migrate. */
export const STORAGE_KEYS = ['token', 'user', 'theme', 'settings', 'apiOrigin'] as const;

export function migrateLegacyStorageKeys(storage: Storage = localStorage): string[] {
  const moved: string[] = [];

  for (const name of STORAGE_KEYS) {
    const current = `cronsole.${name}`;
    const legacy = `${LEGACY_PREFIX}.${name}`;

    try {
      // Never overwrite a value under the new name — if both exist, the new one
      // is what the app has been using and the legacy one is stale.
      if (storage.getItem(current) !== null) {
        storage.removeItem(legacy);
        continue;
      }

      const value = storage.getItem(legacy);
      if (value === null) continue;

      storage.setItem(current, value);
      storage.removeItem(legacy);
      moved.push(name);
    } catch {
      // A storage exception (private mode, quota, a disabled store) must not
      // stop the app from booting — the cost is re-logging in, not a blank page.
    }
  }

  return moved;
}
