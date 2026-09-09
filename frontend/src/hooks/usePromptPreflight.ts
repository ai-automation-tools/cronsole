import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/**
 * Preflight a prompt that is about to run **unattended**, as it is typed.
 *
 * The judgement is the server's and there is exactly one of it
 * (`services/promptPreflight.ts`, `POST /api/tools/prompt-preflight`) — a copy
 * in the browser would be free to disagree with the one an MCP-created trigger
 * is judged by, which is the [#20a] shape. The round trip is the same pattern
 * the schedule preview beside it already uses.
 *
 * **Warnings, never a block.** Every caller renders these and none of them gates
 * a submit: not one rule is certainly right, and a task manager that refuses a
 * prompt it merely dislikes is worse than one that mentions it.
 */
export interface PromptWarning {
  code: 'question' | 'gutter' | 'unaddressed-email';
  message: string;
}

interface PreflightResponse {
  warnings: PromptWarning[];
  /** The rules that ran — an empty `warnings` with a full `checked` means they looked. */
  checked: string[];
}

export function usePromptPreflight(prompt: string, enabled: boolean): PromptWarning[] {
  // Debounced so the panel settles rather than flickering per keystroke, and so
  // a long prompt is not re-posted thirty times while it is being pasted.
  const [debounced, setDebounced] = useState(prompt);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(prompt), 400);
    return () => clearTimeout(t);
  }, [prompt]);

  const { data } = useQuery<PreflightResponse | null>({
    queryKey: ['prompt-preflight', debounced],
    queryFn: async () => {
      const res = await api.post('/tools/prompt-preflight', { prompt: debounced });
      return res.data;
    },
    enabled: enabled && debounced.trim().length > 0,
    staleTime: 5 * 60_000,
    // A failed preflight must not look like a clean one, and it must not look
    // like an error either: the field keeps working and the panel simply says
    // nothing. Retrying a lint as you type would be noise.
    retry: false
  });

  return data?.warnings ?? [];
}
