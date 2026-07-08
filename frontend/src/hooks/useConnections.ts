import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { ConnectionHealth, HealthState } from '../types';

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true';

// Demo connections mirror the platforms present in the demo task set so the
// Settings > Connections section and sidebar have something meaningful to show
// without a backend.
const DEMO_CONNECTIONS: ConnectionHealth[] = [
  { platform: 'WINDOWS_TASK_SCHEDULER', state: 'HEALTHY', reason: 'Agent connected (demo)', lastSync: '2026-06-01T09:00:00Z' },
  { platform: 'CLAUDE_CODE', state: 'HEALTHY', reason: 'API reachable (demo)', lastSync: '2026-06-01T07:00:00Z' },
  { platform: 'TASKHUB_NATIVE', state: 'HEALTHY', reason: 'Scheduler running (demo)', lastSync: '2026-06-01T08:00:00Z' },
];

/**
 * Live platform connection health from GET /api/tasks/health. Polls while
 * mounted so the sidebar and Settings page stay current. Falls back to demo
 * data when VITE_DEMO_MODE is set.
 */
export function useConnections() {
  return useQuery<ConnectionHealth[]>({
    queryKey: ['connections'],
    queryFn: async () => {
      if (DEMO_MODE) return DEMO_CONNECTIONS;
      const res = await api.get('/tasks/health');
      return res.data;
    },
    initialData: DEMO_MODE ? DEMO_CONNECTIONS : undefined,
    // getHealth pings each connector; 45s keeps status fresh without hammering.
    refetchInterval: DEMO_MODE ? false : 45_000,
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
