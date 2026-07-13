import axios from 'axios';

const API_ORIGIN_STORAGE_KEY = 'taskhub.apiOrigin';
export const DEFAULT_API_ORIGIN = normalizeApiOrigin(import.meta.env.VITE_API_URL ?? 'http://localhost:3000');

function normalizeApiOrigin(origin: string): string {
  const trimmed = origin.trim().replace(/\/+$/, '');
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

// Dev/MVP auth token, injected from the environment (see frontend/.env.example).
// There is intentionally NO committed fallback: a hardcoded token is a leaked
// credential, and it's invalid anyway once JWT_SECRET is rotated. A real
// login/account flow replaces this before the app is hosted (ROADMAP Go-public
// › "Real account system").
const DEV_TOKEN = import.meta.env.VITE_DEV_TOKEN as string | undefined;
api.interceptors.request.use(config => {
  if (DEV_TOKEN) {
    config.headers.Authorization = `Bearer ${DEV_TOKEN}`;
  }
  return config;
});

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
    if (!error?.response) setBackendStatus('unreachable');
    else setBackendStatus('ok'); // reached the server, it just returned an error status
    return Promise.reject(error);
  }
);
