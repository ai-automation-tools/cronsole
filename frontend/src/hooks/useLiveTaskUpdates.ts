import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, type Socket } from 'socket.io-client';
import { API_ORIGIN, subscribeApiOrigin, getAuthToken } from '../api';

/**
 * Subscribe to the backend's live task-update channel over Socket.IO and refresh
 * the task/connection queries whenever the server pushes `task:updated` — so the
 * dashboard reflects agent syncs, scheduled native runs, and changes from other
 * tabs immediately instead of waiting for a poll or a window-focus refetch.
 *
 * This is lighter than polling: one idle WebSocket that only carries a message
 * when something actually changed. No-op when no auth token is configured.
 */
export interface PushedRunFailure { taskId: string; name: string; message: string }

/**
 * `onRunFailed` is called for a run the backend performed by itself and that
 * failed (a scheduled or chained Cronsole-native job). Runs started from a tab
 * are reported by that tab and are not pushed.
 */
export function useLiveTaskUpdates(onRunFailed?: (failure: PushedRunFailure) => void): void {
  const queryClient = useQueryClient();
  // Held in a ref so a new callback each render does not reconnect the socket.
  const onRunFailedRef = useRef(onRunFailed);
  useEffect(() => { onRunFailedRef.current = onRunFailed; });
  const [apiOrigin, setApiOriginState] = useState(API_ORIGIN);

  useEffect(() => subscribeApiOrigin(setApiOriginState), []);

  useEffect(() => {
    // A demo build serves fixtures from an axios adapter and has no backend to
    // dial. Without this the page would open a websocket to its own static host
    // and retry on a backoff forever, which costs nothing visible and is exactly
    // the kind of thing that later reads as "the demo is broken".
    if (import.meta.env.MODE === 'demo') return;

    const token = getAuthToken();
    if (!token) return;

    const socket: Socket = io(`${apiOrigin}/ui`, {
      auth: { token },
      transports: ['websocket'], // skip the HTTP long-poll handshake
      reconnectionDelayMax: 30_000, // gentle backoff if the backend is down
    });

    const refresh = () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['connections'] });
    };

    socket.on('task:updated', refresh);
    const failed = (failure: PushedRunFailure) => onRunFailedRef.current?.(failure);
    socket.on('run:failed', failed);

    return () => {
      socket.off('task:updated', refresh);
      socket.off('run:failed', failed);
      socket.disconnect();
    };
  }, [apiOrigin, queryClient]);
}
