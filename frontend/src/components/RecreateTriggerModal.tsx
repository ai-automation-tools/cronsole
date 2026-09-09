import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Loader2, AlertTriangle, Sparkles } from 'lucide-react';
import { Modal } from './ui/Modal';
import { api } from '../api';
import { useToast } from '../hooks/useToast';
import { useScheduleZone } from '../hooks/useScheduleZone';
import { ScheduleBuilder } from './ScheduleBuilder';
import { PromptPreflightNotes } from './PromptPreflightNotes';
import { usePromptPreflight } from '../hooks/usePromptPreflight';
import { ScheduleZoneHint } from './ScheduleZoneHint';
import { AgentReachEditor } from './AgentReachEditor';
import { reachPayload, type AgentToolDraft } from '../utils/agentReach';
import type { Task } from '../types';
import { useGeminiToolPresets } from '../hooks/useGeminiConnection';

/**
 * **Rebuild a hosted agent's trigger — new prompt, schedule or credentials.**
 *
 * This exists because Gemini's task definition is immutable: `PATCH` takes a
 * status and a display name, and everything worth changing — the prompt, the
 * cadence, an MCP bearer token — lives inside the interaction. Without this, the
 * day a token expires or a prompt needs one more sentence the only path is
 * "delete the task and build it again from memory" — and the part of that memory
 * Cronsole could offer is precisely the part it deliberately never stored.
 *
 * **It started as *Replace credentials* and grew, because the machinery was
 * already the whole answer.** Reading the platform's own copy, building a
 * replacement, inheriting a paused status, retiring the original and rekeying
 * the row is the same work whether the changed thing is a token or a sentence,
 * and restricting it to tokens left prompt iteration — the ordinary case — as a
 * full retype in the Duplicate form followed by deleting the original by hand.
 *
 * **It says recreate, not save, everywhere.** The platform assigns a new trigger
 * id, so the dialog states that up front rather than presenting a save button
 * that quietly destroys and rebuilds. What survives is the Cronsole row — its
 * run history, favourite and collections — because the route rekeys it instead
 * of replacing it.
 *
 * **Only what changed is sent, and untouched fields are read off the platform**
 * rather than resent from this screen. That is not an optimization: the row's
 * copy of a prompt or schedule can be a sync behind a trigger edited in Google's
 * console, and resending it would quietly revert somebody's edit as a side
 * effect of rotating a token.
 *
 * **A hand-typed token must be retyped, and the dialog explains why rather than
 * apologising.** Cronsole never read the old one: an MCP server's `headers` are
 * not parsed off the platform at all, so there is nothing to prefill and nothing
 * that could have leaked. The tool list itself *is* prefilled, from what the
 * platform reports. **A saved server needs nothing retyped**, which is the point
 * of saving one. For a rotation across *every* trigger using that server, this
 * dialog is the wrong tool — *Push this credential* on the Gemini source panel
 * does the fan-out and reports per task.
 */
export function RecreateTriggerModal({
  task,
  onClose
}: {
  task: Task;
  onClose: () => void;
}) {
  const meta = (task.metadata ?? {}) as Record<string, unknown>;
  const zone = useScheduleZone();

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

  /*
   * The prompt and the schedule keep their **initial** values beside them, and
   * only a field that differs is sent.
   *
   * Cheaper than it looks and load-bearing twice over. The zone round trip
   * (`toZone` on the way in, `toUtc` on the way out) is not guaranteed
   * byte-identical, so resending an untouched schedule could rewrite a trigger
   * nobody meant to reschedule. And an omitted field means "keep the
   * platform's", which is the only way this dialog can rotate a credential
   * without also reverting a prompt edited in Google's console since the last
   * sync.
   */
  const initialPrompt = typeof meta.prompt === 'string' ? meta.prompt : '';
  const [prompt, setPrompt] = useState(initialPrompt);

  // Empty when the platform reported no schedule Cronsole could normalize — the
  // field then reads as "set one", which a recreate can now honour.
  const initialSchedule = (task.schedule ? zone.toZone(task.schedule).cron : '') ?? '';
  const [schedule, setSchedule] = useState(initialSchedule);
  const storedSchedule = zone.toUtc(schedule);

  const promptChanged = prompt.trim() !== initialPrompt.trim() && prompt.trim().length > 0;
  const promptWarnings = usePromptPreflight(prompt, true);
  const scheduleChanged = schedule.trim() !== initialSchedule.trim() && schedule.trim().length > 0;
  // A cron the browser cannot convert has no honest UTC form to send, and the
  // hint below already says why — so the button refuses rather than posting a
  // guess. §9: a refusal to convert states its reason.
  const scheduleBroken = scheduleChanged && !storedSchedule.cron;

  const { data: presets } = useGeminiToolPresets();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const recreate = useMutation({
    mutationFn: async () => {
      const payload = reachPayload(tools, allowlist);
      const res = await api.post(`/tasks/${task.id}/rotate-credentials`, {
        // Always sent, even when empty: this is a *replacement* of the whole
        // tool list, so an empty one legitimately means "take everything away".
        // That is the opposite of the create path, where absent means "defaults".
        agentTools: payload.agentTools ?? [],
        agentAllowlist: payload.agentAllowlist ?? [],
        // Absent means keep — see the dirty-tracking note above.
        ...(promptChanged ? { prompt: prompt.trim() } : {}),
        ...(scheduleChanged && storedSchedule.cron ? { schedule: storedSchedule.cron } : {})
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
      toast(data.message ?? 'Trigger recreated.', data.oldRemoved ? 'success' : 'error');
      onClose();
    },
    onError: (error: unknown) => {
      const err = error as Error & { response?: { data?: { error?: string } } };
      toast(`Could not recreate this trigger: ${err.response?.data?.error || err.message}`, 'error');
    }
  });

  return (
    <Modal onClose={onClose} labelledBy="recreate-trigger-title">
      <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <RefreshCw size={16} className="text-gemini-text" />
          <h2 id="recreate-trigger-title" className="text-sm font-black text-foreground">
            Recreate with changes
          </h2>
        </div>

        <div className="text-xs text-warning-text bg-warning/5 border border-warning/30 rounded-xl px-3 py-2.5 flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            Gemini cannot change a trigger in place, so this <b>recreates</b> it. Anything you leave
            alone is copied from the trigger as it stands on Gemini right now. The trigger gets a new
            id there; this task keeps its run history, favourite and collections.
          </span>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="recreate-prompt"
            className="text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5"
          >
            <Sparkles size={11} /> Prompt
          </label>
          <textarea
            id="recreate-prompt"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={4}
            placeholder={
              initialPrompt
                ? undefined
                : "Gemini didn't report this trigger's prompt. Type one to replace it, or leave it blank to keep whatever is there."
            }
            className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-xs text-foreground outline-none focus:border-gemini transition-colors resize-y leading-relaxed"
          />
          {/* The same panel as the create form, because **this** is where a
              Gemini prompt is normally written: the platform's definition is
              immutable, so every prompt edit after the first arrives here. A
              preflight that only ran at create would miss most of them. */}
          <PromptPreflightNotes warnings={promptWarnings} />
        </div>

        <div className="space-y-2">
          <ScheduleBuilder
            inputId="recreate-schedule-cron"
            value={schedule}
            onChange={setSchedule}
            zoneLabel={zone.label}
          />
          <ScheduleZoneHint
            typed={schedule}
            stored={storedSchedule}
            zoneLabel={zone.label}
            driftsWithDst
          />
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
            onClick={() => recreate.mutate()}
            disabled={recreate.isPending || scheduleBroken}
            className="flex-1 bg-gemini/10 hover:bg-gemini/20 text-gemini-text border border-gemini/40 px-4 py-2.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {recreate.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {/*
              Names what will actually happen to this trigger, because the same
              button does three different-sized things. "Recreate" alone over an
              untouched form reads as a no-op and is not one — the tool list is
              always resent, which is how a retyped token gets there.
            */}
            {promptChanged && scheduleChanged
              ? 'Recreate with new prompt and schedule'
              : promptChanged
                ? 'Recreate with the new prompt'
                : scheduleChanged
                  ? 'Recreate on the new schedule'
                  : 'Recreate with these credentials'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
