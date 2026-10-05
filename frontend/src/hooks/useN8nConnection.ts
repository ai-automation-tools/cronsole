import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * The n8n connection — an instance URL, an API key, and the instance time zone.
 *
 * Gemini's shape (one key sees one instance, nothing to list) plus one field no
 * other connection has: n8n schedules run in the instance's time zone, which
 * its API does not report, so the user declares it. The key never comes back —
 * `hasKey` and the last four characters only.
 */
export interface N8nConnection {
  connected: boolean;
  baseUrl: string | null;
  hasKey: boolean;
  keyHint: string | null;
  timeZone: string | null;
  /** A read-only database URL is stored for reading folders. The URL itself never comes back. */
  hasFolderDb: boolean;
  /** `host:port/db` of that database — never the credentials. */
  folderDbHint: string | null;
  /** Workflows with no schedule are tracked as on-demand tasks. On unless turned off. */
  includeOnDemand: boolean;
  /** Sidebar grouping when no folder database is connected. Real folders always win. */
  groupBy: 'trigger' | 'none';
  /** Tracked workflows — what disconnecting removes from the dashboard. */
  taskCount: number;
}

const CONNECTION_KEY = ['n8n-connection'];

/** The matrix changes shape when a connection appears, so refetch it with the panel. */
const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: CONNECTION_KEY });
  qc.invalidateQueries({ queryKey: ['platform-matrix'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
};

export const useN8nConnection = () =>
  useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async (): Promise<N8nConnection> => {
      const { data } = await api.get('/tools/platforms/n8n/connection');
      return data;
    }
  });

/** Store or rotate the URL and key — verified by the server before it stores them. */
export const useSetN8nConnection = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { baseUrl: string; apiKey: string; timeZone?: string }) => {
      const { data } = await api.put('/tools/platforms/n8n/connection', input);
      return data as Omit<N8nConnection, 'connected' | 'taskCount'>;
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/** Set the instance time zone. An empty string clears it. */
export const useSetN8nTimeZone = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (timeZone: string) => {
      const { data } = await api.put('/tools/platforms/n8n/timezone', { timeZone });
      return data as { timeZone: string | null; message: string };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Change either option; a field left out keeps its stored value. Turning
 * `includeOnDemand` off removes those rows (nothing changes in n8n).
 */
export const useSetN8nOptions = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { includeOnDemand?: boolean; groupBy?: N8nConnection['groupBy'] }) => {
      const { data } = await api.put('/tools/platforms/n8n/options', input);
      return data as { removed: number; message: string };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/** Set the folder database URL — verified by the server. An empty string stops reading folders. */
export const useSetN8nFolderDb = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => {
      const { data } = await api.put('/tools/platforms/n8n/folder-db', { url });
      return data as { message: string };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/** Forget the connection and its tracked rows. Nothing changes in n8n. */
export const useDisconnectN8n = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete('/tools/platforms/n8n/connection');
      return data as { disconnected: boolean; tasksRemoved: number };
    },
    onSuccess: () => invalidateAll(qc)
  });
};
