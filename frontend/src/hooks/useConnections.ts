import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { ConnectionHealth, HealthState } from '../types';

/**
 * Live platform connection health from GET /api/tasks/health. Polls while
 * mounted so the sidebar and Settings page stay current.
 */
export function useConnections() {
  return useQuery<ConnectionHealth[]>({
    queryKey: ['connections'],
    queryFn: async () => {
      const res = await api.get('/tasks/health');
      return res.data;
    },
    // 45s keeps status fresh without hammering. Note this does NOT ping the
    // agent — the server reports from evidence it already has (the last event
    // the agent sent, versus the last request that timed out), so polling
    // faster would not buy a fresher verdict, only more requests.
    refetchInterval: 45_000,
    staleTime: 30_000,
  });
}

/** Display metadata (label + colors) for a connection health state. */
export function healthMeta(state: HealthState | string): { label: string; dot: string; text: string } {
  switch (state) {
    case 'HEALTHY':
      return { label: 'Online', dot: 'bg-green-500', text: 'text-green-500' };
    case 'DEGRADED':
      return { label: 'Degraded', dot: 'bg-amber-500', text: 'text-amber-500' };
    case 'OFFLINE':
      return { label: 'Offline', dot: 'bg-red-500', text: 'text-red-500' };
    default:
      return { label: 'Unknown', dot: 'bg-muted', text: 'text-muted-foreground' };
  }
}
