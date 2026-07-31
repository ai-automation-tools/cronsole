import { describe, it, expect, beforeEach } from 'vitest';
import { migrateLegacyStorageKeys, STORAGE_KEYS } from '../storageMigration';

// Built from parts for the same reason the module does it: a literal here is
// what a rename pass rewrites, and a test asserting `cronsole.token` migrates to
// `cronsole.token` passes while proving nothing.
const LEGACY = ['task', 'hub'].join('');

describe('migrateLegacyStorageKeys', () => {
  beforeEach(() => localStorage.clear());

  it('moves a legacy value to the new key and removes the old one', () => {
    localStorage.setItem(`${LEGACY}.token`, 'jwt-value');

    const moved = migrateLegacyStorageKeys();

    expect(localStorage.getItem('cronsole.token')).toBe('jwt-value');
    expect(localStorage.getItem(`${LEGACY}.token`)).toBeNull();
    expect(moved).toContain('token');
  });

  it('migrates every persisted key, not just the token', () => {
    // The token is the obvious one; losing the API-origin override is the
    // expensive one, because it exists for the case where the default backend
    // origin is wrong — exactly the setup least able to recover on its own.
    for (const name of STORAGE_KEYS) localStorage.setItem(`${LEGACY}.${name}`, `v-${name}`);

    migrateLegacyStorageKeys();

    for (const name of STORAGE_KEYS) {
      expect(localStorage.getItem(`cronsole.${name}`)).toBe(`v-${name}`);
      expect(localStorage.getItem(`${LEGACY}.${name}`)).toBeNull();
    }
  });

  it('never overwrites a value already under the new key', () => {
    localStorage.setItem('cronsole.theme', 'light');
    localStorage.setItem(`${LEGACY}.theme`, 'dark');

    migrateLegacyStorageKeys();

    // The new key is what the app has been using; the legacy one is stale.
    expect(localStorage.getItem('cronsole.theme')).toBe('light');
    expect(localStorage.getItem(`${LEGACY}.theme`)).toBeNull();
  });

  it('is a no-op on a fresh install, and safe to run twice', () => {
    expect(migrateLegacyStorageKeys()).toEqual([]);

    localStorage.setItem(`${LEGACY}.user`, 'u');
    expect(migrateLegacyStorageKeys()).toEqual(['user']);
    expect(migrateLegacyStorageKeys()).toEqual([]);
    expect(localStorage.getItem('cronsole.user')).toBe('u');
  });

  it('does not throw when storage itself fails', () => {
    // Private mode, a full quota, or a disabled store must cost a re-login, not
    // a blank page — this runs before the app renders.
    const hostile = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); }
    } as unknown as Storage;

    expect(() => migrateLegacyStorageKeys(hostile)).not.toThrow();
  });
});
