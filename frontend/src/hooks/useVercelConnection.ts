import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * The Vercel Cron connection — one account token, and the projects to watch.
 *
 * Shaped like `useGitHubConnection` rather than `useClaudeRoutines`, because
 * Vercel is shaped like GitHub: **one** token per account, so the secret is a
 * property of the connection and the project list holds none. Removing a project
 * can never cost you a credential, so nothing here needs Claude's separate edit
 * path.
 *
 * **The token never comes back.** The server returns `hasToken` and the last
 * four characters — enough to tell two tokens apart, not enough to be one — and
 * there is no reveal endpoint, because Vercel cannot re-display an access token
 * either.
 *
 * The one thing GitHub has no counterpart for is {@link useVercelDiscovery}.
 * GitHub cannot usefully list "your repositories" (a token reaches thousands),
 * so its panel asks you to paste one. Vercel's project list is small, is one
 * request, and already carries each project's crons — so the panel can offer a
 * picker that shows which projects actually have cron jobs, and typing a URL
 * becomes the fallback rather than the only path.
 */

export interface WatchedProject {
  /** `prj_…` — the stable address, unaffected by a rename. */
  id: string;
  /** The project's name, which is also its Cronsole category. */
  name: string;
  teamId?: string;
  /** Tracked cron jobs from this project: what unwatching it would remove. */
  taskCount: number;
}

export interface VercelConnection {
  connected: boolean;
  hasToken: boolean;
  /** Last four characters of the stored token, or null. Never the value. */
  tokenHint: string | null;
  projects: WatchedProject[];
}

export interface DiscoveredProject {
  id: string;
  name: string;
  teamId?: string;
  /** Which account or team this project lives under, for the picker's grouping. */
  scope: string;
  /** How many cron jobs it declares right now — exact, not an estimate. */
  cronCount: number;
  /**
   * Has this project ever had crons enabled?
   *
   * Distinct from `cronCount > 0`: a project that had crons and removed them is
   * `hasCrons: true, cronCount: 0`, which is a different thing from one that has
   * never deployed a cron. Watching either is legal — a cron added tomorrow
   * arrives on the next sync — so this only changes how the row reads.
   */
  hasCrons: boolean;
  /** Already in the watch list, so the picker offers nothing to click. */
  watched: boolean;
}

const CONNECTION_KEY = ['vercel-connection'];

/**
 * Invalidate everything a connection write changes.
 *
 * The matrix changes shape the moment a connection exists — `configured` flips
 * and health stops being null — so refetching only the panel leaves the card
 * above it saying "Not connected" beside the project just added. The same
 * omission was a real bug on the Claude panel.
 */
const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: CONNECTION_KEY });
  qc.invalidateQueries({ queryKey: ['vercel-discovery'] });
  qc.invalidateQueries({ queryKey: ['platform-matrix'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
};

export const useVercelConnection = () =>
  useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async (): Promise<VercelConnection> => {
      const { data } = await api.get('/tools/platforms/vercel/connection');
      return data;
    }
  });

/**
 * What this token can see — every project across the personal account and each
 * team, with its cron count.
 *
 * `enabled` is the caller's, because this is only worth asking once a token is
 * stored and only while the picker is open: it is several requests (one per
 * team) against a rate limit, and firing it on every render of a card that
 * happens to be expanded would be the "health probes the platform" mistake in a
 * new costume.
 *
 * `warnings` are **not** an error state. A team whose listing failed is named
 * rather than dropped, so an account whose team projects are missing says why
 * instead of looking empty — the same rule the sync's `SyncOutcome.warnings`
 * enforces one layer down.
 */
export const useVercelDiscovery = (enabled: boolean) =>
  useQuery({
    queryKey: ['vercel-discovery'],
    enabled,
    queryFn: async (): Promise<{ projects: DiscoveredProject[]; warnings: string[] }> => {
      const { data } = await api.get('/tools/platforms/vercel/discover');
      return data;
    }
  });

/**
 * Store or rotate the account token.
 *
 * The server verifies it against Vercel **before** storing, so a bad paste fails
 * at this click rather than inside a sync days later with a project name in the
 * error. A token that verifies but whose shape is unfamiliar is saved with a
 * warning — a token format is a fact about this year, not a contract.
 */
export const useSetVercelToken = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data } = await api.put('/tools/platforms/vercel/connection', { token });
      return data as { username: string; hasToken: boolean; tokenHint: string; warnings: string[] };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Watch a project. Takes a dashboard URL, a bare name, or a `prj_…` id — the
 * server normalizes, then reads it back from Vercel before storing.
 *
 * Idempotent: re-adding one already watched answers `already: true` rather than
 * an error, and **replaces** the stored row, which is how a stale name or a
 * project that moved under a team gets refreshed. Nothing here is a secret, so
 * nothing can be lost by it.
 */
export const useWatchProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { project: string; teamId?: string }) => {
      const { data } = await api.post('/tools/platforms/vercel/projects', input);
      return data as {
        project: WatchedProject;
        already: boolean;
        /** Exact, unlike GitHub's workflow count — a project hands over its crons. */
        cronCount: number;
        hasCrons: boolean;
      };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Stop watching a project, removing its tracked cron jobs in the same request.
 *
 * **Cronsole-side only** — the crons keep running on Vercel, which is why every
 * label for this says *Stop watching* and never *Delete*. The rows go with the
 * declaration for the reason the Claude and GitHub disconnects learned: a row
 * whose project is no longer watched cannot be synced or run, and would sit on
 * the dashboard flipping to MISSING.
 */
export const useUnwatchProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (project: WatchedProject) => {
      const { data } = await api.delete(`/tools/platforms/vercel/projects/${encodeURIComponent(project.id)}`);
      return data as { removed: string; tasksRemoved: number; watching: number };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/** Forget the token, the projects and the tracked rows together. */
export const useDisconnectVercel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete('/tools/platforms/vercel/connection');
      return data as { disconnected: boolean; tasksRemoved: number };
    },
    onSuccess: () => invalidateAll(qc)
  });
};
