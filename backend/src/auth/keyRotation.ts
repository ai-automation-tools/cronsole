import { decryptWith, encryptWith } from './encryption.js';

/** One stored ciphertext, wherever it lives. */
export interface StoredCiphertext {
  store: 'PlatformConnection' | 'NotificationChannel' | 'TaskSecret';
  id: string;
  value: string;
}

/**
 * Re-encrypt every row under a new key. Pure, and all or nothing: one row the old
 * key cannot read throws before anything is returned, so a caller can never write
 * half a rotation. Each new value is read back before it is trusted.
 */
export function reencryptAll(rows: StoredCiphertext[], oldKey: string, newKey: string): StoredCiphertext[] {
  return rows.map(row => {
    let plain: string;
    try {
      plain = decryptWith(oldKey, row.value);
    } catch {
      throw new Error(`${row.store} ${row.id} cannot be read with the current key. Nothing was changed.`);
    }
    const value = encryptWith(newKey, plain);
    if (decryptWith(newKey, value) !== plain) {
      throw new Error(`${row.store} ${row.id} did not survive re-encryption. Nothing was changed.`);
    }
    return { ...row, value };
  });
}

/** True when `key` reads every row. */
export function keyReadsAll(rows: StoredCiphertext[], key: string): boolean {
  return rows.every(row => {
    try {
      decryptWith(key, row.value);
      return true;
    } catch {
      return false;
    }
  });
}
