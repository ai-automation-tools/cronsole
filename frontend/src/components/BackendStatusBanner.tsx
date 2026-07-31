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
    <div
      role="alert"
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-3
                 bg-red-950/95 border-b border-red-500/40 text-red-100
                 px-4 py-2.5 text-sm backdrop-blur-sm shadow-lg"
    >
      <AlertTriangle size={18} className="shrink-0 text-red-400" />
      <span className="text-center">
        Can&apos;t reach the Cronsole backend at{' '}
        <code className="font-mono text-red-200">{apiOrigin}</code>. Is the server running?
      </span>
      <button
        onClick={handleRetry}
        disabled={retrying}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-md
                   border border-red-400/50 bg-red-500/20 hover:bg-red-500/30
                   px-2.5 py-1 font-medium text-red-100 transition
                   disabled:opacity-60"
      >
        <RefreshCw size={14} className={retrying ? 'animate-spin' : ''} />
        {retrying ? 'Retrying…' : 'Retry'}
      </button>
    </div>
  );
}
