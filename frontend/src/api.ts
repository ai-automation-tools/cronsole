import axios from 'axios';

// --- API Client ---
export const api = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL ?? 'http://localhost:3000'}/api`
});

// Auto-inject MVP dev token for testing Sprint 8 auth
api.interceptors.request.use(config => {
  const devToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImNsaV91c2VyX3BsYWNlaG9sZGVyIiwiZW1haWwiOiJtaWtlQGV4YW1wbGUuY29tIiwiaWF0IjoxNzgwNDk3NDYxLCJleHAiOjIwOTYwNzM0NjF9.2kXRHDUd4KVO3rkoedP1c6rHwH-nuF2IKnxvpHd_4_M';
  config.headers.Authorization = `Bearer ${devToken}`;
  return config;
});
