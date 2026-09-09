import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('runtime API origin', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
  });

  it('uses the env default when no browser override is saved', async () => {
    const { API_ORIGIN, DEFAULT_API_ORIGIN, api } = await import('../api');

    expect(API_ORIGIN).toBe(DEFAULT_API_ORIGIN);
    expect(api.defaults.baseURL).toBe(`${DEFAULT_API_ORIGIN}/api`);
  });

  it('persists an override and updates the axios base URL', async () => {
    const mod = await import('../api');

    const next = mod.setApiOrigin('http://example.test:4000/');

    expect(next).toBe('http://example.test:4000');
    expect(mod.API_ORIGIN).toBe('http://example.test:4000');
    expect(mod.api.defaults.baseURL).toBe('http://example.test:4000/api');
    expect(window.localStorage.getItem('cronsole.apiOrigin')).toBe('http://example.test:4000');
  });

  it('normalizes pasted paths back to an origin', async () => {
    const mod = await import('../api');

    expect(mod.setApiOrigin('https://taskhub.example.com/api')).toBe('https://taskhub.example.com');
  });

  it('rejects non-http origins', async () => {
    const mod = await import('../api');

    expect(() => mod.setApiOrigin('ftp://example.test')).toThrow('API origin must start with http:// or https://');
  });
});
