import { useState, type FormEvent } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

type Mode = 'login' | 'setup';

/** Pull the backend's error message out of an axios error, with a sane fallback. */
function errorMessage(err: unknown, fallback: string): string {
  const anyErr = err as { response?: { data?: { error?: string } }; message?: string };
  return anyErr?.response?.data?.error || anyErr?.message || fallback;
}

/**
 * The full-page login / first-run setup screen. Rendered by AuthGate when there
 * is no valid session. `setup` mode is the single-user first-run flow (create
 * the one account); `login` mode is every visit after.
 */
export function AuthScreen({ mode }: { mode: Mode }) {
  const { login, setup } = useAuth();
  const isSetup = mode === 'setup';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters.');
        return;
      }
      if (password !== confirm) {
        setError('Passwords do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      if (isSetup) await setup(email.trim(), password);
      else await login(email.trim(), password);
      // On success the provider flips status → the gate unmounts this screen.
    } catch (err) {
      setError(errorMessage(err, isSetup ? 'Could not create the account.' : 'Could not sign in.'));
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="h-12 w-12 rounded-2xl bg-primary/15 border border-primary/30 flex items-center justify-center mb-4">
            <ShieldCheck className="text-primary" size={24} />
          </div>
          {/* One contiguous string on purpose. This read "Task<span>Hub</span>"
              through the whole 2026-07-31 rename because a brand split across a
              span is invisible to a grep for the brand — the login screen is the
              first thing a logged-out user sees, and nothing caught it. Matches
              the Sidebar's plain <h1>Cronsole</h1>. */}
          <h1 className="text-2xl font-black tracking-tight">Cronsole</h1>
          <p className="text-sm text-muted-foreground mt-1 text-center">
            {isSetup ? 'Create your account to get started' : 'Sign in to your dashboard'}
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-surface border border-border rounded-2xl p-6 space-y-4"
        >
          {isSetup && (
            <p className="text-xs text-muted-foreground bg-background border border-border rounded-lg p-3">
              This is a fresh Cronsole install. The first account you create becomes the owner of
              this instance — there's no public sign-up.
            </p>
          )}

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Email</span>
            <input
              type="email"
              required
              autoFocus
              autoComplete={isSetup ? 'email' : 'username'}
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
              placeholder="you@example.com"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Password</span>
            <input
              type="password"
              required
              autoComplete={isSetup ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
              placeholder={isSetup ? 'At least 8 characters' : 'Your password'}
            />
          </label>

          {isSetup && (
            <label className="block">
              <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Confirm password</span>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                className="mt-1 w-full bg-background border border-border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary transition-colors"
                placeholder="Re-enter your password"
              />
            </label>
          )}

          {error && (
            <p role="alert" className="text-sm text-red-400 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-primary hover:bg-primary-hover text-primary-foreground font-bold rounded-lg px-4 py-2.5 text-sm transition-colors active:scale-[0.99] flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {isSetup ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
