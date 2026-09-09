import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_QUICK_LINKS,
  LEGACY_QUICK_LINKS_KEY,
  normalizeLinkUrl,
  readLegacyQuickLinks
} from '../quickLinks';

describe('readLegacyQuickLinks', () => {
  beforeEach(() => localStorage.clear());

  it('returns null when this browser never had any', () => {
    expect(readLegacyQuickLinks(localStorage)).toBeNull();
  });

  it('adopts the links and clears the old key', () => {
    // Leaving the key would make it a second source of truth that wins wherever
    // the settings document has not synced yet — the split-brain the move ends.
    localStorage.setItem(
      LEGACY_QUICK_LINKS_KEY,
      JSON.stringify([{ id: 'n8n', name: 'n8n', url: 'https://n8n.local', iconType: 'custom' }])
    );

    expect(readLegacyQuickLinks(localStorage)).toEqual([
      { id: 'n8n', name: 'n8n', url: 'https://n8n.local', iconType: 'custom' }
    ]);
    expect(localStorage.getItem(LEGACY_QUICK_LINKS_KEY)).toBeNull();
  });

  it('keeps an empty list empty rather than restoring the seeds', () => {
    // "I deleted every link" is a real answer. Folding it into null would hand
    // back the three defaults and look like the deletion never happened.
    localStorage.setItem(LEGACY_QUICK_LINKS_KEY, '[]');
    expect(readLegacyQuickLinks(localStorage)).toEqual([]);
  });

  it('drops entries that are not links, and survives malformed JSON', () => {
    localStorage.setItem(LEGACY_QUICK_LINKS_KEY, JSON.stringify([{ id: 'x' }, 42]));
    expect(readLegacyQuickLinks(localStorage)).toEqual([]);

    localStorage.setItem(LEGACY_QUICK_LINKS_KEY, '{not json');
    expect(readLegacyQuickLinks(localStorage)).toBeNull();
  });
});

describe('normalizeLinkUrl', () => {
  it('leaves an absolute URL alone and assumes https otherwise', () => {
    expect(normalizeLinkUrl('https://example.com')).toBe('https://example.com');
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com');
    expect(normalizeLinkUrl('example.com')).toBe('https://example.com');
  });

  it('is case-insensitive about the scheme', () => {
    // `HTTPS://` is a legal URL; prefixing it would produce `https://HTTPS://…`.
    expect(normalizeLinkUrl('HTTPS://example.com')).toBe('HTTPS://example.com');
  });
});

describe('DEFAULT_QUICK_LINKS', () => {
  it('seeds the three schedulers Cronsole cannot reach', () => {
    expect(DEFAULT_QUICK_LINKS.map(l => l.id)).toEqual(['claude', 'chatgpt', 'gemini']);
  });
});
