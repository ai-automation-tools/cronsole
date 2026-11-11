import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The proxy sends `script-src 'self'` (proxy/Caddyfile). An inline script added to
// index.html would run on :7373 and be silently dropped on the proxied page.
describe('index.html', () => {
  it('has no inline script', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>/g)].filter(m => !/\bsrc=/.test(m[1]));
    expect(inline).toEqual([]);
  });
});
