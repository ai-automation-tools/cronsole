import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { subscribeApiOrigin, subscribeBackendStatus, API_ORIGIN, type BackendStatus } from '../api';

/**
 * Fixed banner shown whenever the frontend cannot reach the Cronsole backend
 * (connection refused / network error). Clears automatically on the next
 * successful API response. Retry re-runs all queries without a full reload.
 */
export default function BackendStatusBanner() {
  const [status, setStatus] = useState<BackendStatus>('ok');
  const [retrying, setRetrying] = useState(false);
  const [apiOrigin, setApiOriginState] = useState(API_ORIGIN);
  const queryClient = useQueryClient();

  useEffect(() => subscribeBackendStatus(setStatus), []);
  useEffect(() => subscribeApiOrigin(setApiOriginState), []);

  // While the fixed banner is visible, offset page content so it isn't covered.
  useEffect(() => {
    document.body.style.paddingTop = status === 'unreachable' ? '44px' : '';
    return () => { document.body.style.paddingTop = ''; };
  }, [status]);

  if (status === 'ok') return null;

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await queryClient.refetchQueries();
    } finally {
      setRetrying(false);
    }
  };

  return (
    // Uses the `danger-surface` pair rather than the `danger` role. That pair is
    // deliberately the SAME in both themes: this is an alarm, and an alarm that
    // politely turns into a pale pink strip on a white page has stopped doing its
    // job. Everything else in the token set inverts; this is the exception, and
    // it is one on purpose.
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3
                 bg-danger-surface/95 border-b border-danger/40 text-danger-surface-text
                 px-4 py-2.5 text-sm backdrop-blur-sm shadow-lg"
    >
      <AlertTriangle size={18} className="shrink-0 text-danger-text" />
      <span className="text-center">
        Can&apos;t reach the Cronsole backend at{' '}
        <code className="font-mono text-danger-surface-text/80">{apiOrigin}</code>. Is the server running?
      </span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md
                   border border-danger/50 bg-danger/20 hover:bg-danger/30
                   px-2.5 py-1 font-medium text-danger-surface-text transition
                   disabled:opacity-60"
      >
        <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
