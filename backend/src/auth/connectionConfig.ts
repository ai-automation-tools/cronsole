import type { Prisma } from '@prisma/client';
import { encryptConfig, decryptConfig } from './encryption.js';

/**
 * PlatformConnection.config is stored **encrypted at rest** (AES-256-GCM).
 *
 * The Prisma column is `Json`. We store the encrypted payload as a JSON *string*
 * in the canonical `iv:tag:ciphertext` form produced by {@link encryptConfig}.
 * Because encrypted configs are always strings and legacy plaintext configs were
 * always objects, the stored JS type disambiguates the two without a migration:
 *   - `string`  → encrypted, decrypt it
 *   - anything else (object) → legacy plaintext, return as-is
 *
 * This lets pre-encryption rows keep working while every new write is encrypted.
 * Reads and writes MUST go through these helpers — never touch `connection.config`
 * directly (see docs/ROADMAP.md P0 "Encrypt PlatformConnection.config at rest").
 */

/**
 * Serialize a plaintext config object into the encrypted value stored in
 * `PlatformConnection.config`.
 */
export function serializeConfig(config: object): string {
  return encryptConfig(config);
}

/**
 * Read `PlatformConnection.config` back into a plaintext object.
 *
 * Handles legacy (pre-encryption) plaintext rows transparently. A string is
 * treated as an encrypted payload and decrypted — a decryption/auth failure
 * throws (a GCM auth failure is a real tamper/wrong-key signal, not something
 * to swallow silently).
 */
export function deserializeConfig(
  stored: Prisma.JsonValue | null | undefined
): Record<string, any> {
  if (stored == null) return {};

  // Encrypted form: a JSON string in `iv:tag:ciphertext` shape.
  if (typeof stored === 'string') {
    return decryptConfig(stored);
  }

  // Legacy plaintext object (written before encryption-at-rest landed).
  if (typeof stored === 'object') {
    return stored as Record<string, any>;
  }

  // Any other scalar is not a valid config shape.
  return {};
}
