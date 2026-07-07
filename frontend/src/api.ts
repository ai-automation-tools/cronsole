import axios from 'axios';

// --- API base (exported so the UI can show the user which host it's targeting) ---
export const API_ORIGIN = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

// --- API Client ---
export const api = axios.create({
  baseURL: `${API_ORIGIN}/api`
});

// Auto-inject MVP dev token for testing Sprint 8 auth
api.interceptors.request.use(config => {
  const devToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsaV91c2VyX3BsYWNlaG9sZGVyIiwiZW1haWwiOiJtaWtlQGV4YW1wbGUuY29tIiwiaWF0IjoxNzgwNDk3NDYxLCJleHAiOjIwOTYwNzM0NjF9.2kXRHDUd4KVO3rkoedP1c6rHwH-nuF2IKnxvpHd_4_M';
  config.headers.Authorization = `Bearer ${devToken}`;
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
