import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export interface TaskOccurrences {
  taskId: string;
  /** ISO instants, ascending. */
  occurrences: string[];
  /** The instant the server stopped enumerating at, or null when complete. */
  truncatedAfter: string | null;
}

export interface UnplaceableTask {
  taskId: string;
  reason: string;
}

export interface OccurrencesResponse {
  range: { from: string; to: string };
  scope: { includeSystem: boolean; systemExcluded: number; maxPerTask: number };
  tasks: TaskOccurrences[];
  unplaceable: UnplaceableTask[];
  /** How many tasks hit the cap. Zero means every list is complete. */
  truncated: number;
}

/**
 * When each task fires across a window — the calendar view's data.
 *
 * The **server** walks the cron, for the reason `useTaskHealthTiers` carries the
 * server's tier rather than computing one: the stored expression is UTC 5-field
 * cron (CLAUDE.md §9) and there is one definition of what it means. What comes
 * back is instants; which calendar *day* each lands on is this side's
 * arithmetic, and stays at the browser's edge with every other zone conversion.
 *
 * **Keyed on the range and the lens, not on the filters.** Paging to the next
 * month is a new key and a new fetch; narrowing to a collection is neither,
 * because the calendar filters the tasks it already has. A key that included the
 * filters would re-fetch identical data every time a chip moved.
 *
 * `enabled` is passed rather than always fetching: this expands every task's
 * schedule across six weeks, which is a cost worth paying on the calendar and
 * pure waste on the four views that do not draw one.
 */
export function useOccurrences(
  range: { from: Date; to: Date },
  options: { enabled: boolean; includeSystem: boolean }
) {
  const from = range.from.toISOString();
  const to = range.to.toISOString();

  const { data, isLoading, error } = useQuery<OccurrencesResponse>({
    queryKey: ['occurrences', from, to, options.includeSystem],
    queryFn: async () =>
      (
        await api.get('/tools/occurrences', {
          params: { from, to, includeSystem: String(options.includeSystem) }
        })
      ).data,
    enabled: options.enabled,
    /**
     * A cron expansion of a fixed window does not change while you look at it —
     * only editing a schedule changes it, and that invalidates the task list.
     * Keeping the previous month's answer while the next one loads is what makes
     * paging feel like paging rather than like reloading.
     */
    staleTime: 5 * 60_000,
    placeholderData: previous => previous
  });

  return {
    data,
    /**
     * True while the calendar has asked and has nothing. The caller must say so
     * out loud rather than drawing an empty month: a grid with no chips reads as
     * "nothing runs this month", which is a claim, and a much more surprising
     * one than "still loading".
     */
    isPending: options.enabled && isLoading,
    error: options.enabled ? error : null
  };
}
