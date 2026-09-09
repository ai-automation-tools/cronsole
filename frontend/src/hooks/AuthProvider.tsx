import { useEffect, useState, useCallback, useRef, type ReactNode } from 'react';
import { api, setAuthToken, clearAuthToken, hasLoginToken, getAuthToken, subscribeAuthFailure } from '../api';
import { AuthContext, type AuthUser } from './useAuth';

const USER_STORAGE_KEY = 'cronsole.user';

function readStoredUser(): AuthUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(USER_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function storeUser(user: AuthUser | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) window.localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    /* private mode — the token still drives auth; the cached identity is cosmetic */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'needsSetup' | 'unauthed' | 'authed'>('loading');
  const [user, setUser] = useState<AuthUser | null>(readStoredUser());

  // Decide the initial screen once. A stored login token is trusted here — if
  // it's actually expired, the first protected request 401s and the auth-failure
  // subscription below bounces us to login, so we don't block startup on a probe.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (hasLoginToken()) {
        if (!cancelled) setStatus('authed');
        return;
      }
      try {
        const { data } = await api.get<{ needsSetup: boolean }>('/auth/status');
        if (cancelled) return;
        if (data.needsSetup) setStatus('needsSetup');
        else setStatus(getAuthToken() ? 'authed' : 'unauthed'); // dev token = bypass
      } catch {
        // Backend unreachable: we can't tell setup-vs-login. With a dev token the
        // app is still usable; without one, login is the honest screen.
        if (!cancelled) setStatus(getAuthToken() ? 'authed' : 'unauthed');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A protected request returned 401/403 anywhere in the app → session expired.
  //
  // The interceptor has already called `clearAuthToken()` by the time we run, so
  // `getAuthToken()` now reports the dev/E2E fallback if one exists. That fallback
  // is worth a turn: a stale *stored* login shouldn't strand a dev on a login
  // screen when the token that actually works is sitting right there.
  //
  // It gets exactly one turn, though. Re-arming 'authed' on every failure would
  // park the app on a dashboard retrying a token that will never work — and a dev
  // token outliving its JWT_SECRET is the documented case, not a hypothetical
  // (see frontend/.env.local). Silently retrying forever and "no problem here"
  // would be the same code path, which §9 forbids; the second failure is
  // evidence, so the login screen is the honest answer.
  const fallbackSpent = useRef(false);
  useEffect(() => subscribeAuthFailure(() => {
    storeUser(null);
    setUser(null);
    if (getAuthToken() && !fallbackSpent.current) {
      fallbackSpent.current = true;
      setStatus('authed');
      return;
    }
    setStatus('unauthed');
  }), []);

  const applyAuth = useCallback((token: string, u: AuthUser) => {
    // A real login re-arms the fallback: the next expiry is a fresh question.
    fallbackSpent.current = false;
    setAuthToken(token);
    storeUser(u);
    setUser(u);
    setStatus('authed');
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    applyAuth(data.token, data.user);
  }, [applyAuth]);

  const setup = useCallback(async (email: string, password: string, name?: string) => {
    const { data } = await api.post<{ token: string; user: AuthUser }>('/auth/setup', {
      email,
      password,
      ...(name ? { name } : {})
    });
    applyAuth(data.token, data.user);
  }, [applyAuth]);

  const logout = useCallback(() => {
    clearAuthToken();
    storeUser(null);
    setUser(null);
    setStatus('unauthed');
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    await api.patch('/auth/password', { currentPassword, newPassword });
  }, []);

  return (
    <AuthContext.Provider value={{ status, user, login, setup, logout, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}
