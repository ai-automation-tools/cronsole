import { createContext, useContext } from 'react';

export interface AuthUser {
  id: string;
  email: string;
  name?: string | null;
}

/**
 * loading    — deciding which screen to show (initial /auth/status probe)
 * needsSetup — fresh install, no account yet → the first-run "create account" screen
 * unauthed   — an account exists but no valid session → the login screen
 * authed     — a login token (or the dev fallback) is present → the app
 */
export type AuthStatus = 'loading' | 'needsSetup' | 'unauthed' | 'authed';

export interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  setup: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => void;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

// Shared by AuthProvider (the component) and the useAuth hook. Kept in this
// non-component module so the provider file satisfies react-refresh's
// "only export components" rule (mirrors useToast/useConfirm).
export const AuthContext = createContext<AuthContextValue | null>(null);

/** Auth state + actions. Must be used under an AuthProvider. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
