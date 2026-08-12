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

export const useRemoveClaudeRoutine = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ removed: string; orphanedTasks: number }> => {
      const { data } = await api.delete(`/tools/platforms/claude/routines/${encodeURIComponent(id)}`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ROUTINES_KEY });
      qc.invalidateQueries({ queryKey: ['platform-matrix'] });
    }
  });
};
