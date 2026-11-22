import type { Task } from '../types';
import { isNativePlatform } from '../platform';

/** Slots on the strip — the backend's `RECENT_RUNS`. */
export const RUN_SLOTS = 7;

const TONE: Record<string, string> = {
  SUCCESS: 'bg-success',
  FAILURE: 'bg-danger',
  TIMEOUT: 'bg-danger',
  PENDING: 'bg-warning'
};

const WORD: Record<string, string> = {
  SUCCESS: 'succeeded',
  FAILURE: 'failed',
  TIMEOUT: 'timed out',
  PENDING: 'still running'
};

/**
 * The card's **last seven runs**: green succeeded, red failed or timed out,
 * amber still running — oldest on the left, newest on the right.
 *
 * Drawn from `ExecutionLog`, which records the runs Cronsole *performed* (§9),
 * not every run that happened. A Windows task firing on its own trigger writes
 * nothing there, so a slot with no run is an **empty outline**, never green —
 * absence of evidence is not success — and the tooltip says which population
 * this is. A task with **no** record at all draws no strip: seven empty
 * outlines on every task Cronsole never ran was noise, and the card already
 * says "Updated", not "Last run", when nothing is on record. Colour is never the only channel: the strip's accessible name counts
 * each outcome in words.
 */
export const RunStrip = ({ task }: { task: Task }) => {
  // Newest first on the wire; drawn oldest → newest so the latest sits nearest
  // the next-run text beside it.
  const runs = (task.recentRuns ?? []).slice(0, RUN_SLOTS).reverse();
  if (runs.length === 0) return null;
  const empty = RUN_SLOTS - runs.length;

  const counts = runs.reduce<Record<string, number>>((acc, r) => {
    const w = WORD[r.status] ?? r.status.toLowerCase();
    acc[w] = (acc[w] ?? 0) + 1;
    return acc;
  }, {});
  const summary = `Last ${runs.length} recorded run${runs.length === 1 ? '' : 's'}: ${Object.entries(counts)
    .map(([w, n]) => `${n} ${w}`)
    .join(', ')}`;
  const scope = isNativePlatform(task.platform)
    ? 'Every run of a Cronsole-native task is recorded.'
    : 'Only runs Cronsole started are recorded — runs on the platform’s own schedule are not.';

  return (
    <span role="img" aria-label={summary} title={`${summary}. ${scope}`} className="flex shrink-0 items-center gap-[3px]">
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} aria-hidden className="h-4 w-1.5 rounded-sm border border-border" />
      ))}
      {runs.map((r, i) => (
        <span
          key={i}
          aria-hidden
          title={`${new Date(r.triggeredAt).toLocaleString()} — ${WORD[r.status] ?? r.status.toLowerCase()}`}
          className={`h-4 w-1.5 rounded-sm ${TONE[r.status] ?? 'bg-muted'}`}
        />
      ))}
    </span>
  );
};
