import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { ToolPreset } from '../utils/agentReach';

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

/**
 * **Saved MCP servers — the thing that made this source usable.**
 *
 * A preset is a name, a URL and a credential, stored once on the connection and
 * referenced by every trigger that needs it. Before them, an MCP server had to be
 * retyped — token included — for every new trigger, again on every prompt edit
 * (a Gemini trigger is immutable, so editing means recreating), and again for
 * every trigger that used a token you rotated.
 *
 * **The list never carries a credential.** `hasHeaders` says one is stored;
 * there is no reveal endpoint and no masked field pretending to be one, for the
 * same reason the API key has neither.
 *
 * `usedBy` is counted by URL, which is also why two presets may not share one: a
 * synced trigger reports its servers as `{type, name, url}` and nothing else, so
 * the URL is the only thing that can identify which stored credential a live
 * trigger is pointed at.
 */
const PRESETS_KEY = ['gemini-tool-presets'];

export const useGeminiToolPresets = (enabled = true) =>
  useQuery({
    queryKey: PRESETS_KEY,
    enabled,
    queryFn: async (): Promise<{ presets: ToolPreset[]; max: number }> => {
      const { data } = await api.get('/tools/platforms/gemini/tool-presets');
      return data;
    }
  });

/**
 * Save or update one server.
 *
 * **Omitting `headers` keeps the stored credential**, which is what makes fixing
 * a typo in a URL possible without retyping a token you may not have to hand.
 * Sending `{}` clears it explicitly, so both intents are expressible and neither
 * is the accident of leaving a field blank.
 */
export const useSaveGeminiToolPreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (preset: { name: string; url: string; headers?: Record<string, string> }) => {
      const { data } = await api.put('/tools/platforms/gemini/tool-presets', preset);
      return data as { preset: ToolPreset; created: boolean };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRESETS_KEY });
    }
  });
};

/**
 * Forget a server.
 *
 * Triggers already built from it keep running — Gemini holds their credentials
 * and nothing here can reach into a trigger that already exists. What is lost is
 * rotating them together, and the response says how many that is.
 */
export const useDeleteGeminiToolPreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.delete(`/tools/platforms/gemini/tool-presets/${encodeURIComponent(name)}`);
      return data as { removed: boolean; usedBy: number; message: string };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRESETS_KEY });
    }
  });
};

/**
 * **Push a saved credential out to every trigger that uses it.**
 *
 * The reason presets exist. Gemini cannot edit a trigger in place, so each
 * affected trigger is *recreated* — and because that is a fan-out over somebody
 * else's API, the result **reports per task and never per batch** (§9): partial
 * success is the normal case, and one verdict over the set would be a lie in one
 * direction or the other.
 *
 * `oldRemoved: false` on any row is the outcome that must not read as success —
 * the replacement is live and the original survived, so that schedule now fires
 * twice.
 */
export const useApplyGeminiToolPreset = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data } = await api.post(
        `/tools/platforms/gemini/tool-presets/${encodeURIComponent(name)}/apply`
      );
      return data as {
        applied: { taskId: string; name: string; ok: boolean; oldRemoved: boolean; message?: string }[];
        message: string;
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PRESETS_KEY });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    }
  });
};
