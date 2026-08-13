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
      return { label: 'Online', dot: 'bg-success', text: 'text-success-text' };
    case 'DEGRADED':
      return { label: 'Degraded', dot: 'bg-warning', text: 'text-warning-text' };
    case 'OFFLINE':
      return { label: 'Offline', dot: 'bg-danger', text: 'text-danger-text' };
    case 'UNKNOWN':
      // "Not checked" rather than "Unknown": it names why there is no verdict
      // instead of just reporting that there isn't one, and it points at the
      // fix (ask the platform something). Neutral colours on purpose — amber
      // would make an absence of information look like a problem to solve.
      return { label: 'Not checked', dot: 'bg-muted', text: 'text-muted-foreground' };
    default:
      return { label: 'Unknown', dot: 'bg-muted', text: 'text-muted-foreground' };
  }
}
