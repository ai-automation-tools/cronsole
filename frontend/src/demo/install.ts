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

const REPO_URL = 'https://github.com/ai-automation-tools/cronsole';

const GH_MARK =
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true" '
  + 'style="flex:none"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 '
  + '0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63'
  + '-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87'
  + '.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 '
  + '1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29'
  + '.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8Z'
  + '"/></svg>';

const BAR_H = '34px';

/**
 * The way out of the demo: the shared source bar every ai-automation-tools site
 * carries in the same place — full width at the very top, note on the left, repo
 * link in the right corner.
 *
 * Injected straight into the document rather than added to the dashboard chrome:
 * it only ever exists in a demo build, and keeping it out of the component tree is
 * what keeps it out of a real install even if the mode guard were ever loosened.
 * Styled from the theme tokens, so it follows light/dark like everything else.
 *
 * z-45 sits above the app's own TopBar (z-30) and below modal overlays (z-50), so
 * a dialog dims it like everything else rather than having a strip float over it.
 *
 * The reserved height is taken off #root rather than <body>: BackendStatusBanner
 * writes `body.style.paddingTop` directly and would clobber it.
 *
 * ponytail: the viewport-height overrides below name the two Tailwind classes the
 * shell actually uses today (`h-screen` on the Dashboard, `h-[calc(100vh-3.5rem)]`
 * on its sidebar). Rename or restyle either and the demo build grows a 34px
 * overflow — the demo is the only build that reads this.
 */
function mountSourceBar(): void {
  const style = document.createElement('style');
  style.textContent = [
    ':root{--demo-bar-h:' + BAR_H + '}',
    '#root{padding-top:var(--demo-bar-h)}',
    '.h-screen{height:calc(100vh - var(--demo-bar-h))}',
    '.min-h-screen{min-height:calc(100vh - var(--demo-bar-h))}',
    // Attribute form, so the brackets and dots in the class name need no CSS escaping.
    '[class~="h-[calc(100vh-3.5rem)]"]{height:calc(100vh - 3.5rem - var(--demo-bar-h))}',
  ].join('');
  document.head.append(style);

  const bar = document.createElement('div');
  bar.style.cssText = [
    'position:fixed', 'z-index:45', 'top:0', 'left:0', 'right:0',
    'height:var(--demo-bar-h)', 'box-sizing:border-box',
    'display:flex', 'align-items:center', 'gap:16px', 'padding:0 16px',
    'border-bottom:1px solid hsl(var(--border))', 'background:hsl(var(--surface))',
    'font:12px/1.4 ui-sans-serif,system-ui,sans-serif',
  ].join(';');

  const note = document.createElement('p');
  note.style.cssText = 'margin:0;min-width:0;overflow:hidden;white-space:nowrap;'
    + 'text-overflow:ellipsis;color:hsl(var(--muted-foreground))';
  note.innerHTML = '<strong style="font-weight:600;color:hsl(var(--primary-text))">Read-only demo</strong>'
    + ' · fixtures only, nothing here can be changed.';

  const link = document.createElement('a');
  link.href = REPO_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.innerHTML = GH_MARK + '<span>View source</span>';
  link.style.cssText = 'margin-left:auto;flex:none;display:inline-flex;align-items:center;gap:6px;'
    + 'color:hsl(var(--muted-foreground));text-decoration:none;font-weight:500';
  link.onmouseenter = () => { link.style.color = 'hsl(var(--foreground))'; };
  link.onmouseleave = () => { link.style.color = 'hsl(var(--muted-foreground))'; };

  bar.append(note, link);
  document.body.append(bar);
}

/** Called from `main.tsx` before the first render, in demo builds only. */
export function installDemo(): void {
  api.defaults.adapter = demoAdapter;
  mountSourceBar();

  // AuthProvider trusts a stored login token and skips straight to `authed`, so
  // seeding one is what makes the demo open on the dashboard rather than a login
  // form nobody has a password for. The value is never sent anywhere: the adapter
  // above answers every request locally.
  setAuthToken('demo-mode-not-a-real-token');

  console.info('[cronsole] demo mode: serving fixtures, no backend. Writes are refused.');
}
