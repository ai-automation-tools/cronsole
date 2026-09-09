/**
 * Same-origin API mode — the single-origin reverse-proxy deployment
 * (docs/user-guides/guides/Remote_Access_Guide.md): Caddy serves the built
 * frontend at `/` and forwards `/api` + `/socket.io` to the backend, so ONE
 * build is correct at every address it is served from, with nothing stored
 * per device.
 *
 * This lives in its own file for one reason, and it is load-bearing: vitest's
 * default jsdom URL is `http://localhost:3000`, which is EXACTLY the fallback
 * `DEFAULT_API_ORIGIN` uses when `VITE_API_URL` is unset. Asserting
 * `DEFAULT_API_ORIGIN === window.location.origin` under that URL therefore
 * passes whether the sentinel resolved against the page or the code ignored it
 * and returned the hardcoded fallback — a test that cannot tell the two apart
 * is not testing the thing it names. Overriding the URL here makes the page
 * origin distinct from the fallback, so the assertion has one way to pass.
 *
 * @vitest-environment jsdom
 * @vitest-environment-options { "url": "https://cronsole.example.test/tasks" }
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const PAGE_ORIGIN = 'https://cronsole.example.test';
const FALLBACK_ORIGIN = 'http://localhost:3000';

describe('same-origin API mode', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('resolves the "same-origin" sentinel against the page, not the fallback', async () => {
    vi.stubEnv('VITE_API_URL', 'same-origin');
    const { API_ORIGIN, DEFAULT_API_ORIGIN, api } = await import('../api');

    expect(PAGE_ORIGIN).not.toBe(FALLBACK_ORIGIN); // guards the premise above
    expect(DEFAULT_API_ORIGIN).toBe(PAGE_ORIGIN);
    expect(API_ORIGIN).toBe(PAGE_ORIGIN);
    expect(api.defaults.baseURL).toBe(`${PAGE_ORIGIN}/api`);
  });

  // The page is at /tasks, but the API base must be the ORIGIN — a deep link must
  // not turn into `https://host/tasks/api`.
  it('uses the origin, not the current path', async () => {
    vi.stubEnv('VITE_API_URL', 'same-origin');
    const { api } = await import('../api');

    expect(api.defaults.baseURL).toBe('https://cronsole.example.test/api');
  });

  // `?? FALLBACK` only catches null/undefined, so `VITE_API_URL=` in an env file
  // arrives as '' — if that fell through to the fallback, a blank line in
  // .env.remote would silently build a localhost-only bundle that works on the
  // machine that built it and fails on every phone.
  it('treats an empty VITE_API_URL as same-origin', async () => {
    vi.stubEnv('VITE_API_URL', '');
    const { DEFAULT_API_ORIGIN } = await import('../api');

    expect(DEFAULT_API_ORIGIN).toBe(PAGE_ORIGIN);
  });

  /**
   * The unset default is different in a dev server and in a build, and both
   * halves are asserted — the pair IS the feature.
   *
   * Vitest runs with `import.meta.env.DEV` true, so the first case is the dev
   * branch taken for real rather than simulated. The second stubs DEV false,
   * which is what `vite build` folds in.
   */
  it('defaults to localhost:3000 under the dev server, where the API is on another port', async () => {
    const { DEFAULT_API_ORIGIN } = await import('../api');

    expect(import.meta.env.DEV).toBe(true); // guards the premise
    expect(DEFAULT_API_ORIGIN).toBe(FALLBACK_ORIGIN);
  });

  it('defaults to SAME-ORIGIN in a build, so `npm run build` cannot break remote access', async () => {
    // The regression this exists for: a build carrying the literal
    // `http://localhost:3000` loads fine on a phone and reaches nothing, because
    // there localhost is the phone. It happened twice while the default was that
    // literal and correctness depended on typing `build:remote`.
    vi.stubEnv('DEV', false);
    const { DEFAULT_API_ORIGIN, API_ORIGIN, api } = await import('../api');

    expect(DEFAULT_API_ORIGIN).toBe(PAGE_ORIGIN);
    expect(DEFAULT_API_ORIGIN).not.toBe(FALLBACK_ORIGIN);
    expect(API_ORIGIN).toBe(PAGE_ORIGIN);
    expect(api.defaults.baseURL).toBe(`${PAGE_ORIGIN}/api`);
  });

  it('lets VITE_API_URL override the build default, for a deployment on another host', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_API_URL', 'https://cronsole.internal.example:8443');
    const { DEFAULT_API_ORIGIN } = await import('../api');

    expect(DEFAULT_API_ORIGIN).toBe('https://cronsole.internal.example:8443');
  });

  // Storing a value that resolves against window.location would freeze the address
  // it was saved at — right on the machine you set it on, wrong through the tunnel.
  it('refuses to STORE the sentinel or a blank origin as an override', async () => {
    const mod = await import('../api');

    expect(() => mod.setApiOrigin('same-origin')).toThrow('use Reset to follow this page');
    expect(() => mod.setApiOrigin('   ')).toThrow('use Reset to follow this page');
    expect(window.localStorage.getItem('cronsole.apiOrigin')).toBeNull();
  });

  // A proxied build's default IS same-origin, so Reset must land on the page
  // origin rather than a baked-in localhost.
  it('resets to the page origin on a same-origin build', async () => {
    vi.stubEnv('VITE_API_URL', 'same-origin');
    const mod = await import('../api');

    mod.setApiOrigin('http://elsewhere.test:3000');
    expect(mod.API_ORIGIN).toBe('http://elsewhere.test:3000');

    expect(mod.resetApiOrigin()).toBe(PAGE_ORIGIN);
    expect(window.localStorage.getItem('cronsole.apiOrigin')).toBeNull();
  });
});
