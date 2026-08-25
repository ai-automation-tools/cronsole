import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Loader2, AlertTriangle } from 'lucide-react';
import { Modal } from './ui/Modal';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { AgentReachEditor } from './AgentReachEditor';
import { reachPayload, type AgentToolDraft } from '../utils/agentReach';
import type { Task } from '../types';
import { useGeminiToolPresets } from '../hooks/useGeminiConnection';

/**
 * **Replace the credentials a hosted agent uses — by recreating the trigger.**
 *
 * This exists because a token outlives nothing and Gemini's task definition is
 * immutable: `PATCH` takes a status and a display name, and an MCP bearer token
 * lives inside the interaction. Without this, the day a token expires the only
 * path is "delete the task and build it again from memory" — and the part of
 * that memory Cronsole could offer is precisely the part it deliberately never
 * stored.
 *
 * **It says recreate, not edit, everywhere.** The platform assigns a new trigger
 * id, so the dialog states that up front rather than presenting a save button
 * that quietly destroys and rebuilds. What survives is the Cronsole row — its
 * run history, favourite and collections — because the route rekeys it instead
 * of replacing it.
 *
 * **A hand-typed token must be retyped, and the dialog explains why rather than
 * apologising.** Cronsole never read the old one: an MCP server's `headers` are
 * not parsed off the platform at all, so there is nothing to prefill and nothing
 * that could have leaked. The tool list itself *is* prefilled, from what the
 * platform reports.
 *
 * **A saved server needs nothing retyped**, which is the point of saving one:
 * the credential is on the connection, the trigger carries a reference, and the
 * rebuild resolves it server-side. For a rotation across *every* trigger using
 * that server, this dialog is the wrong tool — *Push this credential* on the
 * Gemini source panel does the fan-out and reports per task.
 */
export function RotateCredentialsModal({
  task,
  onClose
}: {
  task: Task;
  onClose: () => void;
}) {
  const meta = (task.metadata ?? {}) as Record<string, unknown>;

  // Prefilled from what the platform reports — which is everything except the
  // credentials. A user rotating one token should not have to re-describe an
  // agent's whole reach from memory.
  const [tools, setTools] = useState<AgentToolDraft[]>(() =>
    (Array.isArray(meta.tools) ? meta.tools : []).map(raw => {
      const t = (raw ?? {}) as { type?: string; name?: string | null; url?: string | null };
      return {
        type: t.type ?? 'unknown',
        ...(t.name ? { name: t.name } : {}),
        ...(t.url ? { url: t.url } : {})
      };
    })
  );
  const [allowlist, setAllowlist] = useState<string[]>(() =>
    Array.isArray(meta.networkAllowlist)
      ? meta.networkAllowlist.filter((d): d is string => typeof d === 'string')
      : []
  );

  const { data: presets } = useGeminiToolPresets();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const rotate = useMutation({
    mutationFn: async () => {
      const payload = reachPayload(tools, allowlist);
      const res = await api.post(`/tasks/${task.id}/rotate-credentials`, {
        // Always sent, even when empty: this is a *replacement* of the whole
        // tool list, so an empty one legitimately means "take everything away".
        // That is the opposite of the create path, where absent means "defaults".
        agentTools: payload.agentTools ?? [],
        agentAllowlist: payload.agentAllowlist ?? []
      });
      return res.data as { oldRemoved: boolean; message?: string };
    },
    onSuccess: data => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      // **A surviving original is not a success story.** If the replacement was
      // created and the old trigger could not be deleted, this schedule now
      // fires twice — and the toast says so in the error register rather than
      // folding it into the happy path. There is no `warning` variant and this
      // one call site is not a reason to invent one: the consequence here is
      // closer to a failure than to a note.
      toast(data.message ?? 'Credentials replaced.', data.oldRemoved ? 'success' : 'error');
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Could not replace credentials: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  return (
    <Modal onClose={onClose} labelledBy="rotate-credentials-title">
      <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <KeyRound size={16} className="text-gemini-text" />
          <h2 id="rotate-credentials-title" className="text-sm font-black text-foreground">
            Replace credentials
          </h2>
        </div>

        <div className="text-xs text-warning-text bg-warning/5 border border-warning/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Gemini cannot change a trigger in place, so this <b>recreates</b> it — same schedule,
            prompt and agent, new credentials. The trigger gets a new id on Gemini; this task keeps
            its run history, favourite and collections.
          </span>
        </div>

        <p className="text-[11px] text-subtle-foreground">
          A <b>saved server</b> needs nothing retyped — its credential lives on the Gemini source and
          is resolved when the trigger is rebuilt. A hand-typed one is not prefilled, because Cronsole
          never read that token off the platform; retype any the agent needs.
        </p>

        <AgentReachEditor
          tools={tools}
          onToolsChange={setTools}
          allowlist={allowlist}
          onAllowlistChange={setAllowlist}
          presets={presets?.presets ?? []}
        />

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 bg-background border border-border text-foreground px-4 py-2.5 rounded-xl font-bold text-xs"
          >
            Cancel
          </button>
          <button
            onClick={() => rotate.mutate()}
            disabled={rotate.isPending}
            className="flex-1 bg-gemini/10 hover:bg-gemini/20 text-gemini-text border border-gemini/40 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {rotate.isPending ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Recreate with these credentials
          </button>
        </div>
      </div>
    </Modal>
  );
}
