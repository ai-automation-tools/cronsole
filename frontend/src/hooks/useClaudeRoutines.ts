import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

/**
 * The Claude connection's routine registry.
 *
 * Claude Code mints a **bearer token per routine** in its web UI and exposes no
 * API to list or manage them, so Cronsole cannot discover a routine — the user
 * declares each one. This hook is that registry's client side.
 *
 * **The token never comes back.** The server returns `hasToken`, never the value,
 * and there is no reveal endpoint by design: claude.ai shows a token once and
 * cannot re-display it either, so regenerating is the only real recovery and a
 * second copy here would be a secret with a longer life than it needs.
 */

export interface ClaudeRoutine {
  id: string;
  name?: string;
  hasToken: boolean;
  /** Tracked tasks pointing at this routine — what removing it would strand. */
  taskCount: number;
}

export interface AddRoutineResult {
  routine: ClaudeRoutine;
  /** True when this rotated the token on a routine already stored. */
  replaced: boolean;
  /** Shape advice, never a refusal — the routines API is experimental. */
  warnings: string[];
}

const ROUTINES_KEY = ['claude-routines'];

export const useClaudeRoutines = () =>
  useQuery({
    queryKey: ROUTINES_KEY,
    queryFn: async (): Promise<ClaudeRoutine[]> => {
      const { data } = await api.get('/tools/platforms/claude/routines');
      return data.routines ?? [];
    }
  });

export const useAddClaudeRoutine = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; token: string; name?: string }): Promise<AddRoutineResult> => {
      const { data } = await api.post('/tools/platforms/claude/routines', input);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      // The matrix changes shape the moment a connection exists — `configured`
      // flips and health stops being null — so it has to be refetched with it,
      // or the card keeps saying "Not connected" beside the routine you added.
      qc.invalidateQueries({ queryKey: ['platform-matrix'] });
    }
  });
};

/**
 * Correct a routine's id or name **without re-entering the token**.
 *
 * Deliberately separate from the add mutation, and deliberately without a token
 * field: disconnect-then-reconnect would discard the stored credential, and
 * claude.ai shows a token once — so a typo would cost a regeneration (which also
 * revokes the old token wherever else it is used). To *rotate* a token, re-add
 * the same id through `useAddClaudeRoutine`, which replaces it.
 */
export const useEditClaudeRoutine = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { routineId: string; id?: string; name?: string }) => {
      const { routineId, ...body } = input;
      const { data } = await api.patch(
        `/tools/platforms/claude/routines/${encodeURIComponent(routineId)}`,
        body
      );
      return data as {
        routine: ClaudeRoutine;
        idChanged: boolean;
        previousId: string;
        tasksRepointed: number;
        warnings: string[];
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      // The task row moves with the id, so the dashboard is stale too.
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['platform-matrix'] });
    }
  });
};

/**
 * Remove a routine — **the only way to stop tracking a Claude task.**
 *
 * A Claude task exists because the routine is declared here, so the declaration
 * is the thing to remove: `POST /tasks/:id/untrack` refuses for this platform
 * precisely because deleting the row alone leaves the routine in the config and
 * the next sync brings it back. The server therefore deletes the tracked rows in
 * the same request and reports `tasksRemoved`.
 */
export const useRemoveClaudeRoutine = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ removed: string; tasksRemoved: number; connectionRemoved: boolean }> => {
      const { data } = await api.delete(`/tools/platforms/claude/routines/${encodeURIComponent(id)}`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      // The task rows went with it, so the dashboard is stale — this was the
      // half that made a removed routine linger on screen as a MISSING task.
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['platform-matrix'] });
    }
  });
};
