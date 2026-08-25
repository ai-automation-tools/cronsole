import { useEffect, useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Loader2, X } from 'lucide-react';
import {
  useDisconnectGemini,
  useGeminiConnection,
  useSetGeminiAgent,
  useSetGeminiKey
} from '../hooks/useGeminiConnection';
import { errorMessage } from '../utils/errorMessage';
import { ConnectionField as Field } from './sources/ConnectionField';

/**
 * **Connect Gemini so Cronsole can read and act on its scheduled triggers.**
 *
 * The fourth connection composed by hand, and by some distance the shortest —
 * because the platform gives it nothing to be long about. The Claude panel
 * manages a list of routines with a token each; the GitHub and Vercel panels
 * each manage a token plus a list of repositories or projects, with an add path,
 * a remove path and (on Vercel) a picker. **A Gemini API key is scoped to one
 * Google Cloud project and sees every trigger in it**, so there is no list, and
 * nothing to add to it.
 *
 * That leaves two controls, and the second is the one worth explaining.
 *
 * **The key.** Verified before it is stored, by listing triggers — the same
 * request this source exists to make, so there is no separate identity endpoint
 * and no second thing that can be wrong. The count comes back and is shown,
 * because a working key over a project with no triggers otherwise reads as a
 * failure.
 *
 * **The agent.** `antigravity-preview-05-2026` is a preview id with a date
 * inside it, which is the platform announcing it will be replaced. Compiled into
 * Cronsole it would mean creates that begin failing months after this shipped,
 * with nothing in the product to change; stored and shown here, the fix is a text
 * field. It is deliberately **not** verified — no endpoint lists valid agent ids,
 * so the only way to check one would be to create a trigger with it, and a
 * settings field that writes is worse than an error that names Google's own
 * reason.
 *
 * One rule this panel does not share with the other three: **this source can
 * act.** So the disconnect warning has to be more careful than theirs, not less
 * — "nothing changes on Gemini" is true of *disconnecting* and false of the
 * Delete button on a task, and those two are one click apart.
 */
export const GeminiTriggersPanel = () => {
  const { data, isLoading } = useGeminiConnection();
  const setKey = useSetGeminiKey();
  const setAgent = useSetGeminiAgent();
  const disconnect = useDisconnectGemini();

  const [keyOpen, setKeyOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [agent, setAgent_] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const hasKey = data?.hasKey ?? false;
  const storedAgent = data?.agent ?? '';
  const defaultAgent = data?.defaultAgent ?? '';

  // Seed the field from the server once it arrives, and never again — retyping
  // over what someone is editing because a background refetch landed is the
  // failure mode this effect exists to avoid, which is why it keys on the stored
  // value rather than on the query object.
  useEffect(() => {
    setAgent_(storedAgent);
  }, [storedAgent]);

  const clear = () => {
    setError(null);
    setWarnings([]);
    setNote(null);
  };

  const submitKey = async () => {
    clear();
    try {
      const result = await setKey.mutateAsync(apiKey.trim());
      setWarnings(result.warnings ?? []);
      // The number, said now. "0 triggers" from a key that verified is a working
      // connection over an empty project, and it reads as a broken one unless
      // the count is stated — the same ambiguity the sync's coverage note closes.
      setNote(
        result.triggerCount === 0
          ? 'Key saved. This project has no triggers yet — anything created here or in Google AI Studio will arrive on the next sync.'
          : `Key saved. ${result.triggerCount} trigger${result.triggerCount === 1 ? '' : 's'} found — sync to bring them in.`
      );
      setApiKey('');
      setKeyOpen(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not save that key.'));
    }
  };

  const submitAgent = async () => {
    clear();
    try {
      const result = await setAgent.mutateAsync(agent.trim());
      setNote(
        agent.trim()
          ? `New triggers will run ${result.agent}.`
          : `Back to the default — new triggers will run ${result.agent}.`
      );
    } catch (e) {
      setError(errorMessage(e, 'Could not save that agent id.'));
    }
  };

  const onDisconnect = async () => {
    const tracked = data?.taskCount ?? 0;
    const ok = window.confirm(
      'Disconnect Gemini?\n\n' +
        'Cronsole forgets the API key. Nothing changes on Gemini — every trigger keeps running on ' +
        'its schedule. (Deleting a trigger for real is the Delete button on the task, not this.)' +
        (tracked > 0
          ? `\n\n${tracked} tracked trigger${tracked === 1 ? '' : 's'} will be removed from the dashboard.`
          : '')
    );
    if (!ok) return;
    clear();
    try {
      await disconnect.mutateAsync();
      setNote('Disconnected.');
    } catch (e) {
      setError(errorMessage(e, 'Could not disconnect.'));
    }
  };

  return (
    <div className="border-t border-border px-5 py-4 space-y-3" data-testid="gemini-triggers-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h5 className="text-xs font-black uppercase tracking-widest text-subtle-foreground">
            Gemini connection
          </h5>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-prose">
            One API key, and nothing to pick — a key sees every trigger in{' '}
            <span className="font-bold text-foreground">its own Google Cloud project</span>. Unlike
            the other hosted sources, Cronsole can{' '}
            <span className="font-bold text-foreground">act</span> here: run, pause, reschedule,
            create and delete.
          </p>
        </div>
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-gemini-text hover:underline"
        >
          Google AI Studio <ExternalLink size={11} />
        </a>
      </div>

      {/*
        The key's own row. It gates everything — nothing can be listed, run or
        created without one — so it is stated as a state rather than left to be
        inferred from a failing action.
      */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-muted/40 border border-border rounded-xl px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-bold">
            {hasKey ? 'Key stored' : 'No key yet'}
            {hasKey && data?.keyHint && (
              <span className="ml-2 text-[10px] font-mono text-subtle-foreground">…{data.keyHint}</span>
            )}
          </p>
          <p className="text-[10px] text-subtle-foreground">
            {hasKey
              ? `Never shown again — look it up in Google AI Studio. Paste a new one to rotate.${
                  (data?.taskCount ?? 0) > 0
                    ? ` ${data!.taskCount} trigger${data!.taskCount === 1 ? '' : 's'} tracked.`
                    : ''
                }`
              : 'A Gemini API key. Cronsole verifies it by listing your triggers before saving.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setKeyOpen(!keyOpen); setError(null); }}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95"
          >
            {hasKey ? 'Replace key' : 'Add key'}
          </button>
          {data?.connected && (
            <button
              onClick={onDisconnect}
              disabled={disconnect.isPending}
              className="px-3 py-1.5 rounded-xl text-[11px] font-bold text-muted-foreground hover:text-danger-text transition-colors disabled:opacity-40"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {keyOpen && (
        <div className="bg-background border border-border rounded-xl p-3 space-y-2">
          <Field
            label="API key"
            hint="Create one in Google AI Studio. Triggers are part of the Managed Agents preview, so the key's project needs the Generative Language API enabled."
            value={apiKey}
            onChange={setApiKey}
            placeholder="Paste your Gemini API key"
            secret
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setKeyOpen(false); setApiKey(''); }}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={submitKey}
              disabled={!apiKey.trim() || setKey.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-primary-foreground transition-all active:scale-95"
            >
              {setKey.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Verify and save
            </button>
          </div>
        </div>
      )}

      {/*
        The agent, shown only once a key exists — it configures creates, and
        there is nothing to create against without one. Offering it earlier would
        be a setting for a connection that does not exist yet.
      */}
      {hasKey && (
        <div className="bg-muted/40 border border-border rounded-xl px-3 py-2 space-y-2">
          <Field
            label="Agent for new triggers"
            hint="The managed agent a trigger Cronsole creates will run. It is a preview id with a date in it, so it will be replaced eventually — if creates start failing, this is the first thing to change. Leave it empty to use the default."
            value={agent}
            onChange={setAgent_}
            placeholder={defaultAgent}
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[10px] text-subtle-foreground">
              A trigger Cronsole creates gets{' '}
              <span className="font-bold text-foreground">no network allowlist</span>, so its agent
              can reach nothing outside its sandbox. Add domains in Google AI Studio.
            </p>
            <button
              onClick={submitAgent}
              disabled={setAgent.isPending || agent.trim() === storedAgent.trim()}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-40 transition-all active:scale-95"
            >
              {setAgent.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save agent
            </button>
          </div>
        </div>
      )}

      {isLoading && <p className="text-[11px] text-subtle-foreground">Loading…</p>}

      {note && (
        <p className="text-[11px] text-success-text bg-success/10 border border-success/30 rounded-xl px-3 py-2">
          {note}
        </p>
      )}

      {warnings.length > 0 && (
        <div className="text-[11px] text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2 space-y-1">
          {warnings.map(w => (
            <p key={w} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
};

export default GeminiTriggersPanel;
