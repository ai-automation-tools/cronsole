import type { PlatformMatrixRow } from '../hooks/usePlatformMatrix';

/**
 * Which sources this install shows, and which it is only *offering*.
 *
 * One definition, because three surfaces ask it — the rail (which rows to draw),
 * the Sources tab (*Your sources* versus *Available*), and the show/hide switch
 * (whether it may be turned off at all). Three copies of a union is three places
 * for "connected but hidden" to mean something different.
 *
 * **Shown is a union of three facts, and only one of them is a preference:**
 *
 * - it is in `shownSources` — you asked for it;
 * - it holds tasks — hiding it would hide tasks;
 * - it has a connection — you connected it, which is the same gesture as asking
 *   for it, so Cronsole never makes you do both.
 *
 * The union is what makes the preference safe to be a *show* list. Opting in is
 * additive, opting out only ever removes an empty, unconnected row, and a
 * platform Cronsole adds later is absent from everyone's list — so it arrives
 * opt-in without a migration.
 */

export interface SourceVisibility {
  /** Drawn in the rail and listed under *Your sources*. */
  shown: boolean;
  /**
   * May the switch be turned off?
   *
   * `false` when tasks or a connection are holding it visible — the switch is
   * rendered disabled and says which, rather than vanishing. A control that
   * disappears when you look for it reads as a bug; one that explains itself
   * reads as a rule.
   */
  canHide: boolean;
  /** Why it cannot be hidden, for the switch's title. `null` when it can. */
  heldBy: 'tasks' | 'connection' | null;
}

export function sourceVisibility(row: PlatformMatrixRow, shownSources: readonly string[]): SourceVisibility {
  const held: SourceVisibility['heldBy'] =
    row.taskCount > 0 ? 'tasks' : row.configured ? 'connection' : null;

  return {
    shown: held !== null || shownSources.includes(row.platform),
    canHide: held === null,
    heldBy: held
  };
}

/** The platforms the rail must list even with no tasks of their own. */
export function railListedPlatforms(
  rows: readonly PlatformMatrixRow[] | undefined,
  connectedPlatforms: readonly string[],
  shownSources: readonly string[]
): string[] {
  // The matrix is the authority on task counts and connections, but it arrives
  // over the network — so while it is in flight the rail falls back to the two
  // facts it already has locally. An empty rail for one paint is worse than a
  // rail that gains a row a moment later.
  const listed = new Set<string>([...connectedPlatforms, ...shownSources]);
  for (const row of rows ?? []) {
    if (sourceVisibility(row, shownSources).shown) listed.add(row.platform);
  }
  return [...listed];
}

/** Add or remove a source from the shown list, returning a new array. */
export function toggleShownSource(shownSources: readonly string[], platform: string): string[] {
  return shownSources.includes(platform)
    ? shownSources.filter(p => p !== platform)
    : [...shownSources, platform];
}
