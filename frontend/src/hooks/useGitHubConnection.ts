import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * The GitHub Actions connection — one account token, and the repositories to
 * watch.
 *
 * Shaped unlike `useClaudeRoutines` because the platforms are shaped unlike each
 * other. Anthropic mints a bearer token **per routine**, so Claude's registry is
 * a list of `(id, token)` pairs and every write touches a secret. GitHub issues
 * **one** token per account, so the secret is a property of the connection and
 * the repository list holds none.
 *
 * The visible consequence, and it is the right one: **removing a repository here
 * can never cost you a credential.** Claude's panel needs a separate edit path
 * so that fixing a typo does not discard a token claude.ai shows once; nothing
 * of the sort is needed here.
 *
 * **The token never comes back.** The server returns `hasToken` and the last
 * four characters — enough to tell two tokens apart, not enough to be one — and
 * there is no reveal endpoint, because GitHub cannot re-display a PAT either.
 */

export interface WatchedRepository {
  owner: string;
  repo: string;
  /** `owner/repo` — also the Cronsole category these workflows land under. */
  fullName: string;
  /** Tracked workflows from this repository: what unwatching it would remove. */
  taskCount: number;
}

export interface GitHubConnection {
  connected: boolean;
  hasToken: boolean;
  /** Last four characters of the stored token, or null. Never the value. */
  tokenHint: string | null;
  repositories: WatchedRepository[];
}

const CONNECTION_KEY = ['github-connection'];

/**
 * Invalidate everything a connection write changes.
 *
 * The matrix changes shape the moment a connection exists — `configured` flips
 * and health stops being null — so refetching only the panel leaves the card
 * above it saying "Not connected" beside the repository just added. The same
 * omission was a real bug on the Claude panel.
 */
const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: CONNECTION_KEY });
  qc.invalidateQueries({ queryKey: ['platform-matrix'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
};

export const useGitHubConnection = () =>
  useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async (): Promise<GitHubConnection> => {
      const { data } = await api.get('/tools/platforms/github/connection');
      return data;
    }
  });

/**
 * Store or rotate the account token.
 *
 * The server verifies it against GitHub **before** storing, so a bad paste fails
 * at this click rather than inside a sync days later with a repository name in
 * the error. A token that verifies but whose shape is unfamiliar is saved with a
 * warning — GitHub has shipped four token formats and will ship more.
 */
export const useSetGitHubToken = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (token: string) => {
      const { data } = await api.put('/tools/platforms/github/connection', { token });
      return data as {
        login: string;
        hasToken: boolean;
        tokenHint: string;
        warnings: string[];
      };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Watch a repository. Takes the URL, the `owner/repo`, or the SSH remote — the
 * server normalizes, then verifies it against GitHub before storing.
 *
 * Idempotent: re-adding one already watched answers `already: true` rather than
 * an error, because a duplicate add is someone checking and nothing here rotates.
 */
export const useWatchRepository = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (repository: string) => {
      const { data } = await api.post('/tools/platforms/github/repositories', { repository });
      return data as {
        repository: WatchedRepository;
        already: boolean;
        /** Every workflow in the repository — not every *scheduled* one. */
        workflowCount: number;
      };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Stop watching a repository, removing its tracked workflows in the same
 * request.
 *
 * **Cronsole-side only** — the workflows keep running on GitHub, which is why
 * every label for this says *Stop watching* and never *Delete*. The rows go with
 * the declaration for the reason the Claude disconnect learned: a row whose
 * repository is no longer watched cannot be synced or run, and would sit on the
 * dashboard flipping to MISSING.
 */
export const useUnwatchRepository = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (repo: WatchedRepository) => {
      const { data } = await api.delete(
        `/tools/platforms/github/repositories/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}`
      );
      return data as { removed: string; tasksRemoved: number; watching: number };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/** Forget the token, the repositories and the tracked rows together. */
export const useDisconnectGitHub = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete('/tools/platforms/github/connection');
      return data as { disconnected: boolean; tasksRemoved: number };
    },
    onSuccess: () => invalidateAll(qc)
  });
};
