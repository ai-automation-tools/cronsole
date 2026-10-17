import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api';
import type { PlatformMatrixRow } from '../../hooks/usePlatformMatrix';
import { timeAgo } from '../../utils/datetime';

/** Mirrors `AUTO_SYNC_INTERVALS_MIN` on the server; the server validates, this only lists. */
const OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: 'Every 5 minutes' },
  { value: 15, label: 'Every 15 minutes' },
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Every hour' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Every day' }
];

/**
 * Periodic sync for one source. Off by default. It refreshes the folders you
 * already track and nothing else — it never adopts a new folder or restores an
 * untracked task — so the control says so, and shows the last attempt and why it
 * failed rather than a bare "on".
 */
export const AutoSyncControl = ({ row }: { row: PlatformMatrixRow }) => {
  const queryClient = useQueryClient();
  const { autoSync } = row;
  const mutation = useMutation({
    mutationFn: async (intervalMin: number | null) =>
      (await api.put(`/tools/platforms/${row.platform}/auto-sync`, { intervalMin })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-matrix'] })
  });

  return (
    <div className="border-t border-border p-5 space-y-2" data-testid={`auto-sync-${row.platform}`}>
      <label className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-subtle-foreground">
        Sync automatically
        <select
          className="bg-raised border border-border rounded-lg px-2 py-1 text-foreground"
          value={autoSync.intervalMin ?? ''}
          disabled={mutation.isPending}
          onChange={e => mutation.mutate(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Off</option>
          {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        Refreshes folders you already track. It never adds a new folder or brings back a task you removed.
        {autoSync.intervalMin && (
          autoSync.lastAttemptAt
            ? ` Last automatic run ${timeAgo(autoSync.lastAttemptAt)}.`
            : ' Has not run yet.'
        )}
      </p>
      {autoSync.lastError && (
        <p className="text-[11px] text-danger-text">Last automatic sync failed: {autoSync.lastError}</p>
      )}
      {mutation.isError && <p className="text-[11px] text-danger-text">Could not change the interval.</p>}
    </div>
  );
};
