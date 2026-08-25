import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * The Gemini API Triggers connection — one API key, and the agent to create with.
 *
 * **The smallest of the four connection hooks, and the platform is the reason.**
 * `useClaudeRoutines` manages a list of `(routine, token)` pairs;
 * `useGitHubConnection` and `useVercelConnection` each manage a token plus a list
 * of repositories or projects to watch, with add and remove mutations for the
 * list. A Gemini API key is scoped to one Google Cloud project and sees **every**
 * trigger in it — so there is no list, no add, no remove, and no discovery read.
 *
 * What is left is a key and one setting, and the setting is the interesting half:
 * `agent` is the managed-agent id a Cronsole-created trigger runs, and it is
 * stored rather than compiled in because `antigravity-preview-05-2026` is a
 * preview string with a date in it. Compiled in, it would mean creates that start
 * failing months later with nothing in the product to change.
 *
 * **The key never comes back.** The server returns `hasKey` and the last four
 * characters — enough to tell two keys apart, not enough to be one — and there is
 * no reveal endpoint, because Google's own console is the right place to look at
 * a key and a better one than this.
 */

export interface GeminiConnection {
  connected: boolean;
  hasKey: boolean;
  /** Last four characters of the stored key, or null. Never the value. */
  keyHint: string | null;
  /** The stored agent id, or null when the connection has never set one. */
  agent: string | null;
  /** What a create uses when none is stored — shown as the field's placeholder. */
  defaultAgent: string;
  /**
   * Tracked triggers: what disconnecting would take off the dashboard.
   *
   * A single number rather than the per-repository breakdown the GitHub and
   * Vercel panels carry, because there is nothing here to break it down by. It
   * exists for the same reason theirs does — the UI has to be able to say how
   * many rows a disconnect strands **before** the click, not report it after.
   */
  taskCount: number;
}

const CONNECTION_KEY = ['gemini-connection'];

/**
 * Invalidate everything a connection write changes.
 *
 * The matrix changes shape the moment a connection exists — `configured` flips
 * and health stops being null — so refetching only the panel leaves the card
 * above it saying "Not connected" over a key that plainly works. The same
 * omission was a real bug on the Claude panel.
 */
const invalidateAll = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: CONNECTION_KEY });
  qc.invalidateQueries({ queryKey: ['platform-matrix'] });
  qc.invalidateQueries({ queryKey: ['tasks'] });
};

export const useGeminiConnection = () =>
  useQuery({
    queryKey: CONNECTION_KEY,
    queryFn: async (): Promise<GeminiConnection> => {
      const { data } = await api.get('/tools/platforms/gemini/connection');
      return data;
    }
  });

/**
 * Store or rotate the API key.
 *
 * The server verifies it **before** storing, by listing triggers — which is the
 * same request this source exists to make, so there is no separate identity
 * endpoint and no second failure mode to explain. A bad paste fails at this
 * click rather than inside a sync days later.
 *
 * `triggerCount` comes back from that verification and is worth showing: a key
 * that works over a project with no triggers reads as suspicious unless the
 * number says otherwise, which is the same "found nothing versus looked at
 * nothing" ambiguity the sync's coverage note closes one layer down.
 */
export const useSetGeminiKey = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (apiKey: string) => {
      const { data } = await api.put('/tools/platforms/gemini/connection', { apiKey });
      return data as {
        hasKey: boolean;
        keyHint: string;
        agent: string;
        defaultAgent: string;
        triggerCount: number;
        warnings: string[];
      };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Set which managed agent a Cronsole-created trigger runs.
 *
 * **Not verified against the platform**, deliberately: there is no endpoint that
 * lists valid agent ids, so the only way to check one would be to create a
 * trigger with it — a write, with a side effect, from a settings field. Cronsole
 * stores what was typed and lets the create report Google's own rejection.
 *
 * Sending an empty string is how you get back to the shipped default, which is
 * why the field is not required.
 */
export const useSetGeminiAgent = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (agent: string) => {
      const { data } = await api.put('/tools/platforms/gemini/agent', { agent });
      return data as { agent: string; defaultAgent: string };
    },
    onSuccess: () => invalidateAll(qc)
  });
};

/**
 * Forget the key and the tracked rows together.
 *
 * **Cronsole-side only** — every trigger keeps running on Gemini exactly as
 * before, which is why this says *Disconnect* and never *Delete*. Deleting a
 * trigger for real is the Delete button on the task, and this source is the
 * first hosted one where that button does something.
 */
export const useDisconnectGemini = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete('/tools/platforms/gemini/connection');
      return data as { disconnected: boolean; tasksRemoved: number };
    },
    onSuccess: () => invalidateAll(qc)
  });
};
