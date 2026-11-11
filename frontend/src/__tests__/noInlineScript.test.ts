import { describe, it, expect } from 'vitest';
import html from '../../index.html?raw';

// The proxy sends `script-src 'self'` (proxy/Caddyfile). An inline script added to
// index.html would run on :7373 and be silently dropped on the proxied page.
describe('index.html', () => {
  it('has no inline script', () => {
    const inline = [...html.matchAll(/<script\b([^>]*)>/gi)].filter(m => !/\bsrc=/i.test(m[1]));
    expect(inline).toEqual([]);
  });

  it('loads the pre-paint theme script as a file', () => {
    expect(html).toContain('<script src="/theme-boot.js"></script>');
  });
});
