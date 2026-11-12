import { describe, it, expect } from 'vitest';
import { encryptWith, decryptWith } from '../encryption.js';
import { keyReadsAll, reencryptAll, type StoredCiphertext } from '../keyRotation.js';

const OLD = 'a'.repeat(32);
const NEW = 'b'.repeat(32);
const row = (id: string, plain: string, key = OLD): StoredCiphertext =>
  ({ store: 'TaskSecret', id, value: encryptWith(key, plain) });

describe('key rotation', () => {
  it('moves every row to the new key and the old key stops reading them', () => {
    const rows = [row('1', '{"token":"x"}'), row('2', '{"k":"v"}')];
    const next = reencryptAll(rows, OLD, NEW);
    expect(next.map(r => decryptWith(NEW, r.value))).toEqual(['{"token":"x"}', '{"k":"v"}']);
    expect(keyReadsAll(next, NEW)).toBe(true);
    expect(keyReadsAll(next, OLD)).toBe(false);
  });

  it('refuses the whole batch when one row is unreadable, and names it', () => {
    const rows = [row('1', 'fine'), row('2', 'written under another key', 'c'.repeat(32))];
    expect(() => reencryptAll(rows, OLD, NEW)).toThrow(/TaskSecret 2 cannot be read.*Nothing was changed/);
  });
});
