import { type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AuthScreen } from './AuthScreen';

/**
 * Renders the app only when there's a valid session; otherwise the first-run
 * setup screen (fresh install) or the login screen. Keeps every authenticated
 * screen behind one guard instead of threading auth checks through the tree.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background text-muted-foreground flex items-center justify-center">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }
  if (status === 'needsSetup') return <AuthScreen mode="setup" />;
  if (status === 'unauthed') return <AuthScreen mode="login" />;
  return <>{children}</>;
}
