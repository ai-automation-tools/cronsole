import { useEffect, useState } from 'react';
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
export function useLiveTaskUpdates(): void {
  const queryClient = useQueryClient();
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

    return () => {
      socket.off('task:updated', refresh);
      socket.disconnect();
    };
  }, [apiOrigin, queryClient]);
}
