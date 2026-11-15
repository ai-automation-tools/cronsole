import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { AuthScreen } from './AuthScreen';

/**
 * Renders the app only when there's a valid session; otherwise the first-run
 * setup screen (fresh install) or the login screen. Keeps every authenticated
 * screen behind one guard instead of threading auth checks through the tree.
 */
/** Portalled to <body> so the app can be made `inert` (no focus, no a11y tree) without a wrapper
 *  element that would remount it on expiry and on resume. */
function ExpiredOverlay() {
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    root.inert = true;
    return () => { root.inert = false; };
  }, []);
  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-auto bg-background">
      <AuthScreen mode="login" />
    </div>,
    document.body
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { status, sessionExpired } = useAuth();

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background text-muted-foreground flex items-center justify-center">
        <Loader2 className="animate-spin" size={24} />
      </div>
    );
  }
  if (status === 'needsSetup') return <AuthScreen mode="setup" />;
  if (status === 'unauthed' && sessionExpired) {
    // The session ended mid-use: keep the app mounted (an open form keeps what was typed) and
    // draw login over it. The overlay is opaque, so nothing of the app is readable while signed out.
    return (
      <>
        {children}
        <ExpiredOverlay />
      </>
    );
  }
  if (status === 'unauthed') return <AuthScreen mode="login" />;
  return <>{children}</>;
}
