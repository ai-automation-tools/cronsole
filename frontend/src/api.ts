import axios from 'axios';

const API_ORIGIN_STORAGE_KEY = 'cronsole.apiOrigin';

/**
 * Build-time sentinel for `VITE_API_URL` meaning "the API is served from the same
 * origin as this page" — the single-origin reverse-proxy deployment, where Caddy
 * serves the built frontend at `/` and forwards `/api` + `/socket.io` to the
 * backend (see docs/user-guides/guides/Remote_Access_Guide.md).
 *
 * It exists because the alternative is worse in a way that is easy to miss: with
 * an absolute origin baked in, one build can only ever be correct at one address,
 * so reaching Cronsole from a phone meant setting the per-device API-origin
 * override by hand on every device — localStorage state that is invisible, easy
 * to get wrong, and lost the moment site data is cleared. Resolving against
 * `window.location` instead makes ONE build correct at every address it is served
 * from: `https://cronsole.example.com` through the tunnel and `http://localhost:8080`
 * on the proxy locally, with nothing stored per device.
 *
 * Deliberately a build-time value only, not something `setApiOrigin` accepts. The
 * Settings override exists to point at a DIFFERENT origin than the page; "follow
 * the page" is already what `resetApiOrigin()` returns you to, and storing a
 * sentinel that resolves differently per address would make the saved value mean
 * something different depending on where it was read.
 */
const SAME_ORIGIN = 'same-origin';

export const DEFAULT_API_ORIGIN = normalizeApiOrigin(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');

function normalizeApiOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '');

  // An empty VITE_API_URL means the same thing as the sentinel: `??` above only
  // catches null/undefined, so `VITE_API_URL=` in an env file arrives as ''.
  if (trimmed === '' || trimmed === SAME_ORIGIN) {
    if (typeof window === 'undefined') {
      throw new Error('Same-origin API mode needs a browser window to resolve against.');
    }
    return window.location.origin;
  }

  const parsed = new URL(trimmed);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('API origin must start with http:// or https://');
  }
  return parsed.origin;
}

function readApiOrigin(): string {
  if (typeof window === 'undefined') return DEFAULT_API_ORIGIN;
  try {
    const stored = window.localStorage.getItem(API_ORIGIN_STORAGE_KEY);
    return normalizeApiOrigin(stored || DEFAULT_API_ORIGIN);
  } catch {
    return DEFAULT_API_ORIGIN;
  }
}

// --- API base (live binding so UI + sockets can react to Settings changes) ---
export let API_ORIGIN = readApiOrigin();

// --- API Client ---
export const api = axios.create({
  baseURL: `${API_ORIGIN}/api`
});

const originListeners = new Set<(origin: string) => void>();

export function subscribeApiOrigin(cb: (origin: string) => void): () => void {
  originListeners.add(cb);
  cb(API_ORIGIN);
  return () => { originListeners.delete(cb); };
}

export function setApiOrigin(origin: string): string {
  // The stored override must always be an explicit absolute origin. Blank and the
  // build-time `same-origin` sentinel both resolve against `window.location`, so
  // SAVING one would freeze today's address into a value whose whole point is to
  // follow the page — right on the machine you set it on, wrong through the tunnel.
  // "Follow the page" is what Reset already gives you (it returns to the build's
  // default, which IS same-origin on a proxied build).
  const raw = origin.trim().replace(/\/+$/, '');
  if (raw === '' || raw === SAME_ORIGIN) {
    throw new Error('Enter a full API origin (http:// or https://), or use Reset to follow this page.');
  }

  let next: string;
  try {
    next = normalizeApiOrigin(origin);
  } catch {
    throw new Error('API origin must start with http:// or https://');
  }
  if (next === API_ORIGIN) return API_ORIGIN;
  API_ORIGIN = next;
  if (typeof window !== 'undefined') window.localStorage.setItem(API_ORIGIN_STORAGE_KEY, next);
  api.defaults.baseURL = `${API_ORIGIN}/api`;
  setBackendStatus('ok');
  originListeners.forEach(l => l(API_ORIGIN));
  return API_ORIGIN;
}

export function resetApiOrigin(): string {
  if (typeof window !== 'undefined') window.localStorage.removeItem(API_ORIGIN_STORAGE_KEY);
  API_ORIGIN = normalizeApiOrigin(DEFAULT_API_ORIGIN);
  api.defaults.baseURL = `${API_ORIGIN}/api`;
  setBackendStatus('ok');
  originListeners.forEach(l => l(API_ORIGIN));
  return API_ORIGIN;
}

// --- Auth token store ---
// The bearer token is the one minted by the local login (stored per-browser),
// falling back to the dev/E2E token from the environment when no one has logged
// in. There is intentionally NO committed dev fallback — a hardcoded token is a
// leaked credential, and invalid once JWT_SECRET rotates. The dev token exists
// only to keep the E2E suite and local dev working without the login flow; a
// real login token always wins.
const AUTH_TOKEN_STORAGE_KEY = 'cronsole.token';

/**
 * The dev/E2E fallback token — and it is gated on `import.meta.env.DEV`, which is
 * the only thing that keeps the comment above true in a BUILD.
 *
 * The intent ("no committed dev fallback — a hardcoded token is a leaked
 * credential") was always right; the mechanism leaked anyway. Vite loads
 * `.env.local` in every mode, not just dev, and compiles each `VITE_*` reference
 * in as a literal — so `npm run build` inlined a real owner JWT straight into
 * `dist/assets/*.js`. Measured on this machine before the fix: a valid token for
 * the owner account, `exp` in 2036, readable in the served JavaScript by anyone
 * who could load the page. `getAuthToken()` returns it whenever no one has logged
 * in, so the login screen was not a gate at all — the bundle arrived already
 * authenticated.
 *
 * That was survivable while `dist/` only ever ran on localhost. It stops being
 * survivable the moment the single-origin proxy serves that same bundle through a
 * public tunnel, which is exactly what the remote-access work does.
 *
 * `import.meta.env.DEV` is statically `false` in any build, so this collapses to
 * `undefined` and the minifier drops the string entirely — the secret cannot
 * reach a bundle even if `VITE_DEV_TOKEN` is set in the environment that builds
 * it. Enforced by scripts/check-bundle-secrets.mjs, which fails the build if a
 * JWT-shaped literal ever reappears.
 */
const DEV_TOKEN = import.meta.env.DEV
  ? (import.meta.env.VITE_DEV_TOKEN as string | undefined)
  : undefined;

function readStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

let loginToken: string | null = readStoredToken();
const tokenListeners = new Set<(token: string | undefined) => void>();

/** The bearer token sent on REST + socket auth: the login token, else the dev fallback. */
export function getAuthToken(): string | undefined {
  return loginToken ?? DEV_TOKEN;
}

/** True when a real login token is present (ignores the dev fallback). */
export function hasLoginToken(): boolean {
  return loginToken !== null;
}

/** Subscribe to token changes (login / logout). Fires immediately with the current value. */
export function subscribeAuthToken(cb: (token: string | undefined) => void): () => void {
  tokenListeners.add(cb);
  cb(getAuthToken());
  return () => { tokenListeners.delete(cb); };
}

function notifyToken(): void {
  const token = getAuthToken();
  tokenListeners.forEach(l => l(token));
}

export function setAuthToken(token: string): void {
  loginToken = token;
  if (typeof window !== 'undefined') {
    try { window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token); } catch { /* private mode */ }
  }
  notifyToken();
}

export function clearAuthToken(): void {
  loginToken = null;
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY); } catch { /* private mode */ }
  }
  notifyToken();
}

api.interceptors.request.use(config => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// --- Session-expiry handling ---
// A 401/403 from a *protected* route means the token is missing/expired — bounce
// the user to login. Requests to /auth/* are excluded: a 401 from /login is
// "wrong password", not an expired session, and clearing the token there would
// fight the login screen it's about to show.
const authFailureListeners = new Set<() => void>();

/** Subscribe to session-expiry events (a protected request returned 401/403). */
export function subscribeAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb);
  return () => { authFailureListeners.delete(cb); };
}

function isAuthEndpoint(url: string | undefined): boolean {
  return typeof url === 'string' && url.includes('/auth/');
}

// --- Backend connectivity status (tiny pub/sub so the UI can surface outages) ---
export type BackendStatus = 'ok' | 'unreachable';

let currentStatus: BackendStatus = 'ok';
const listeners = new Set<(status: BackendStatus) => void>();

/** Subscribe to backend reachability changes. Fires immediately with the current value. */
export function subscribeBackendStatus(cb: (status: BackendStatus) => void): () => void {
  listeners.add(cb);
  cb(currentStatus);
  return () => { listeners.delete(cb); };
}

function setBackendStatus(status: BackendStatus): void {
  if (status === currentStatus) return;
  currentStatus = status;
  listeners.forEach(l => l(status));
}

// A successful response means the backend is reachable; an error with no `response`
// (connection refused, DNS, CORS/network) means we never reached it.
api.interceptors.response.use(
  response => { setBackendStatus('ok'); return response; },
  error => {
    if (!error?.response) {
      setBackendStatus('unreachable');
    } else {
      setBackendStatus('ok'); // reached the server, it just returned an error status
      const status = error.response.status;
      if ((status === 401 || status === 403) && !isAuthEndpoint(error.config?.url)) {
        // Session expired/invalid on a protected route → clear it and notify the
        // app so it shows login. Skip /auth/* (a 401 there is a bad password).
        clearAuthToken();
        authFailureListeners.forEach(l => l());
      }
    }
    return Promise.reject(error);
  }
);
