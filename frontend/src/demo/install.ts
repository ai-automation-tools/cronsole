/**
 * **Demo mode.** Serves the real dashboard from canned fixtures, with no backend,
 * no database, no agent and no credentials anywhere.
 *
 * This module is only ever reached from a `vite build --mode demo`, through a
 * dynamic `import()` in `main.tsx` guarded by `import.meta.env.MODE === 'demo'`.
 * That guard folds to `false` in every other build, so Rollup drops both the
 * branch and this chunk — the fixtures never ship to a real install. It is a
 * fold, not a convention, for the same reason `FALLBACK_API_ORIGIN` is one:
 * correctness must not depend on anyone remembering which script to run.
 *
 * **Why an axios adapter rather than a mock server.** `api` is a single axios
 * instance and every call in the app goes through it, so replacing its adapter
 * intercepts the whole surface at one seam. MSW would do the same job with a
 * service worker, a dependency, and a second thing that can fail to register on
 * a static host.
 *
 * **Writes are refused, and the status code matters.** The response interceptor
 * in `api.ts` treats 401/403 on a non-auth route as a dead session: it clears the
 * token and bounces to the login screen. A demo that refused writes with 403
 * would therefore log the visitor out of a demo that has no login. `409` says
 * "this conflicts with the state of the resource" — which is exactly true of a
 * read-only demo — and leaves the session alone.
 */
import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';
import { api, setAuthToken } from '../api';
import fixtures from './fixtures.json';
import templates from './templates.json';

const DEMO_REFUSAL =
  'This is a read-only demo — nothing is connected, so there is nothing to change. ' +
  'Run Cronsole on your own machine to use this for real.';

/** Everything the demo answers. Anything not listed falls through to `fallback`. */
const ROUTES: { method: string; pattern: RegExp; body: unknown }[] = [
  { method: 'GET', pattern: /^\/auth\/status$/, body: { needsSetup: false } },
  { method: 'GET', pattern: /^\/tasks$/, body: fixtures.tasks },
  { method: 'GET', pattern: /^\/tasks\/health$/, body: fixtures.health },
  { method: 'GET', pattern: /^\/tools\/platforms$/, body: { platforms: fixtures.platforms } },
  { method: 'GET', pattern: /^\/collections$/, body: fixtures.collections },
  { method: 'GET', pattern: /^\/tasks\/missing\/summary$/, body: { count: 0, platforms: [] } },
  { method: 'GET', pattern: /^\/tasks\/missing$/, body: [] },
  { method: 'GET', pattern: /^\/tasks\/folders$/, body: [] },
  { method: 'GET', pattern: /^\/auth\/tokens$/, body: [] },
  // `/templates` returns a FLAT ARRAY, not { templates, packs }. The first version
  // of this stub returned the object and the Templates tab rendered nothing, which
  // is the whole reason a demo has to be opened rather than merely built.
  //
  // These are the REAL 97 templates, normalised from registry/ through the backend's
  // own normalizeTemplate() rather than a second copy of that mapping -- a demo that
  // showed a catalog the product disagreed with would be worse than an empty one.
  { method: 'GET', pattern: /^\/templates$/, body: templates },
  { method: 'GET', pattern: /^\/tools\/history$/, body: { entries: [], total: 0 } },
  { method: 'GET', pattern: /^\/tools\/downloads$/, body: [] },
  { method: 'GET', pattern: /^\/tasks\/[^/]+\/executions$/, body: [] },
  { method: 'GET', pattern: /^\/tasks\/[^/]+\/platform-runs$/, body: { runs: [], supported: false } },
  { method: 'GET', pattern: /^\/tasks\/[^/]+\/secrets$/, body: [] }
];

/**
 * The shape an unmatched GET gets. A demo that 404s half its reads would render
 * error states everywhere and teach a visitor nothing about the product, so the
 * default is "valid and empty" rather than "missing" — an empty list is a real
 * state the UI is built to render, and a 404 is not.
 */
function fallback(url: string): unknown {
  if (/\/(tasks|collections|executions|runs|tokens|downloads|repositories|projects|routines|presets|tool-presets)$/.test(url)) {
    return [];
  }
  return {};
}

function respond(config: AxiosRequestConfig, status: number, data: unknown): AxiosResponse {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Conflict',
    headers: {},
    config: config as AxiosResponse['config']
  };
}

const demoAdapter: AxiosAdapter = async (config) => {
  const method = (config.method ?? 'get').toUpperCase();
  // baseURL is `${origin}/api`; axios hands the adapter the relative url.
  const url = (config.url ?? '').split('?')[0].replace(/\/+$/, '') || '/';

  if (method !== 'GET') {
    const err = Object.assign(new Error(DEMO_REFUSAL), {
      isAxiosError: true,
      config,
      response: respond(config, 409, { error: DEMO_REFUSAL, message: DEMO_REFUSAL })
    });
    throw err;
  }

  const hit = ROUTES.find((r) => r.method === method && r.pattern.test(url));
  const body = hit ? hit.body : fallback(url);

  // A tick of latency so loading states are exercised rather than skipped, which
  // is part of what a demo is for. Short enough not to feel broken.
  await new Promise((r) => setTimeout(r, 60));
  return respond(config, 200, body);
};

/** Called from `main.tsx` before the first render, in demo builds only. */
export function installDemo(): void {
  api.defaults.adapter = demoAdapter;

  // AuthProvider trusts a stored login token and skips straight to `authed`, so
  // seeding one is what makes the demo open on the dashboard rather than a login
  // form nobody has a password for. The value is never sent anywhere: the adapter
  // above answers every request locally.
  setAuthToken('demo-mode-not-a-real-token');

  console.info('[cronsole] demo mode: serving fixtures, no backend. Writes are refused.');
}
