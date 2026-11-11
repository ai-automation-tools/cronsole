import { describe, it, expect } from 'vitest';
import { sameOrigin } from '../sameOrigin.js';

describe('sameOrigin', () => {
  it('is true only for the same scheme, host and port', () => {
    expect(sameOrigin('https://hooks.example.com/a', 'https://hooks.example.com/b?x=1')).toBe(true);
    expect(sameOrigin('https://hooks.example.com/a', 'https://evil.example.net/a')).toBe(false);
    expect(sameOrigin('https://hooks.example.com/a', 'http://hooks.example.com/a')).toBe(false);
    expect(sameOrigin('https://hooks.example.com/a', 'https://hooks.example.com:8443/a')).toBe(false);
  });

  it('treats missing or unparseable input as different, so the credential is dropped', () => {
    expect(sameOrigin(undefined, 'https://a.example')).toBe(false);
    expect(sameOrigin('not a url', 'not a url')).toBe(false);
  });
});
