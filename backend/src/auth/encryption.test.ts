import { describe, it, expect, beforeEach } from 'vitest';
import { encrypt, decrypt, encryptConfig, decryptConfig } from './encryption.js';

describe('Encryption Helpers', () => {
  const testConfig = { apiKey: 'sk-12345', secret: 'abcde' };

  it('should encrypt and decrypt a string', () => {
    const text = 'hello world';
    const encrypted = encrypt(text);
    expect(encrypted).not.toBe(text);
    expect(encrypted.split(':')).toHaveLength(3); // iv:tag:data
    
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(text);
  });

  it('should encrypt and decrypt a JSON object', () => {
    const encrypted = encryptConfig(testConfig);
    const decrypted = decryptConfig(encrypted);
    expect(decrypted).toEqual(testConfig);
  });

  it('should throw error for invalid format', () => {
    expect(() => decrypt('invalidformat')).toThrow('Invalid encrypted text format');
  });

  it('should generate unique IVs for same input', () => {
    const text = 'same text';
    const enc1 = encrypt(text);
    const enc2 = encrypt(text);
    expect(enc1).not.toBe(enc2);
    expect(decrypt(enc1)).toBe(text);
    expect(decrypt(enc2)).toBe(text);
  });
});
