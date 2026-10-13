import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_LINK_PLATFORMS,
  DEFAULT_QUICK_LINKS,
  LEGACY_QUICK_LINKS_KEY,
  NO_WEB_CONSOLE,
  normalizeLinkUrl,
  readLegacyQuickLinks,
  withNewDefaults
} from '../quickLinks';
import { SHIPPED_SOURCES } from '../../data/docs';

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

describe('default quick links', () => {
  it('still seeds the original three, first', () => {
    // withNewDefaults treats these as already offered to older accounts.
    expect(DEFAULT_QUICK_LINKS.slice(0, 3).map(l => l.id)).toEqual(['claude', 'chatgpt', 'gemini']);
  });

  it('gives every shipped source a link, or says why it has none', () => {
    // "Every source we have configured should have a quick link by default."
    // A source added without either fails here, not silently on the /links tab.
    const missing = SHIPPED_SOURCES.filter(p => !DEFAULT_LINK_PLATFORMS[p] && !NO_WEB_CONSOLE[p]);
    expect(missing).toEqual([]);
  });

  it('has unique ids and only https URLs', () => {
    // The Scout edits defaults.json unattended; a malformed edit fails CI.
    const ids = DEFAULT_QUICK_LINKS.map(l => l.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const l of DEFAULT_QUICK_LINKS) expect(l.url).toMatch(/^https:\/\/[^\s]+$/);
  });
});

describe('withNewDefaults', () => {
  const custom = { id: 'mine', name: 'Mine', url: 'https://example.com', iconType: 'custom' };

  it('appends defaults an older account was never offered', () => {
    // Stored before the field existed: it was offered the original three only.
    const original = DEFAULT_QUICK_LINKS.filter(l => ['claude', 'chatgpt', 'gemini'].includes(l.id));
    const { quickLinks, quickLinkDefaultsSeen } = withNewDefaults([...original, custom], undefined);
    expect(quickLinks.map(l => l.id)).toEqual([
      ...original.map(l => l.id), 'mine',
      ...DEFAULT_QUICK_LINKS.filter(l => !original.includes(l)).map(l => l.id)
    ]);
    expect(quickLinkDefaultsSeen).toEqual(expect.arrayContaining(DEFAULT_QUICK_LINKS.map(l => l.id)));
  });

  it('never brings back a default somebody deleted', () => {
    const seen = DEFAULT_QUICK_LINKS.map(l => l.id);
    expect(withNewDefaults([custom], seen).quickLinks).toEqual([custom]);
  });

  it('leaves a fresh install exactly at the defaults', () => {
    // Otherwise every new browser looks "changed" and seeds the account.
    expect(withNewDefaults(DEFAULT_QUICK_LINKS, undefined).quickLinks).toBe(DEFAULT_QUICK_LINKS);
  });
});
