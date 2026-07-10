import axios from 'axios';

// --- API base (exported so the UI can show the user which host it's targeting) ---
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// --- API Client ---
export const api = axios.create({
  baseURL: `${API_ORIGIN}/api`
});

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
