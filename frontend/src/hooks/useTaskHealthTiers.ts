import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import type { HealthTier } from '../utils/taskFilters';

interface HealthResponse {
  evaluatedAt: string;
  tasks: { taskId: string; tier: HealthTier }[];
}

/**
 * Per-task health tiers, for the dashboard's run-outcome filter.
 *
 * The verdict is the **server's** — `GET /api/tools/task-health` already knows
 * that a Windows task's outcome lives in Windows' own `lastTaskResult` rather
 * than in `ExecutionLog`, and that Task Scheduler's informational codes are not
 * exit codes. This hook carries that answer to the dashboard; it does not form
 * one. See `matchesOutcome`.
 *
 * Shares `['task-health']` with the Tools tab's health panel on purpose: two
 * cache keys over one route would mean the dashboard and the panel could show
 * different verdicts for the same task at the same moment.
 *
 * `enabled` is passed rather than always fetching, because this is a scan of
 * every task and its executions — a cost worth paying when a view asks about
 * run outcome, and pure waste on the default dashboard, which does not.
 */
export function useTaskHealthTiers(enabled: boolean) {
  const { data, isLoading, error } = useQuery<HealthResponse>({
    queryKey: ['task-health'],
    queryFn: async () => (await api.get('/tools/task-health')).data,
    enabled
  });

  const tiers = useMemo(() => {
    if (!data) return undefined;
    return new Map(data.tasks.map(t => [t.taskId, t.tier] as const));
  }, [data]);

  return {
    tiers,
    /**
     * True while the filter needs tiers and does not have them. The caller must
     * say so out loud: with no map every task reads `unknown`, so a "Failures"
     * view would render an empty list — and an empty list means "nothing is
     * failing", which is a different and much more reassuring claim than "the
     * health data has not arrived".
     */
    isPending: enabled && isLoading,
    error: enabled ? error : null
  };
}
