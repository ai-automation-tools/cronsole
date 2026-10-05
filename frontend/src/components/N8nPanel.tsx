import { useState } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import {
  useDisconnectN8n,
  useN8nConnection,
  useSetN8nConnection,
  useSetN8nTimeZone
} from '../hooks/useN8nConnection';
import { errorMessage } from '../utils/errorMessage';
import { ConnectionField as Field } from './sources/ConnectionField';

/** The browser's own zone — the likeliest answer for a self-hosted instance, offered, never assumed. */
const browserZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    return '';
  }
};

/**
 * **Connect an n8n instance so Cronsole can read its scheduled workflows.**
 *
 * Read-only, and it says so first, like the other observers. Two controls:
 *
 * **The instance and key.** Verified before they are stored. One key reaches
 * one instance, so there is nothing to pick.
 *
 * **The time zone.** The field no other panel has. n8n runs a Schedule
 * Trigger in the instance's time zone and its API does not report which one,
 * so without this every schedule arrives without a time — correctly, with the
 * reason, but uselessly. The browser's zone is offered as the placeholder and
 * a one-click fill, never saved on its own: a cloud instance often runs in a
 * zone that is not yours.
 */
export const N8nPanel = () => {
  const { data, isLoading } = useN8nConnection();
  const setConnection = useSetN8nConnection();
  const setTimeZone = useSetN8nTimeZone();
  const disconnect = useDisconnectN8n();

  const [formOpen, setFormOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  /** Typed zone, or null before the first keystroke — then the stored value shows. */
  const [zoneDraft, setZoneDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const connected = data?.connected ?? false;
  const storedZone = data?.timeZone ?? '';
  const zone = zoneDraft ?? storedZone;
  const suggested = browserZone();

  const clear = () => {
    setError(null);
    setNote(null);
  };

  const openForm = () => {
    setBaseUrl(data?.baseUrl ?? '');
    setApiKey('');
    setFormOpen(!formOpen);
    setError(null);
  };

  const submitConnection = async () => {
    clear();
    try {
      await setConnection.mutateAsync({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        // On first connect, carry the typed zone so one click is enough.
        ...(connected ? {} : { timeZone: zone.trim() })
      });
      setNote('Connected. Sync n8n to bring in its scheduled workflows.');
      setApiKey('');
      setFormOpen(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not connect to that n8n instance.'));
    }
  };

  const submitZone = async () => {
    clear();
    try {
      const result = await setTimeZone.mutateAsync(zone.trim());
      setZoneDraft(null);
      setNote(result.message);
    } catch (e) {
      setError(errorMessage(e, 'Could not save that time zone.'));
    }
  };

  const onDisconnect = async () => {
    const tracked = data?.taskCount ?? 0;
    const ok = window.confirm(
      'Disconnect n8n?\n\nCronsole forgets the URL and API key. Nothing changes in n8n — every workflow ' +
        'keeps running.' +
        (tracked > 0 ? `\n\n${tracked} tracked workflow${tracked === 1 ? '' : 's'} will be removed from the dashboard.` : '')
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
    <div className="border-t border-border px-5 py-4 space-y-3" data-testid="n8n-panel">
      <div className="min-w-0">
        <h5 className="text-xs font-black uppercase tracking-widest text-subtle-foreground">n8n connection</h5>
        <p className="text-[11px] text-muted-foreground mt-1 max-w-prose">
          <span className="font-bold text-foreground">Read-only.</span> Cronsole reads the workflows that have a
          Schedule Trigger, their schedules and how their runs went, and changes nothing — running, publishing and
          editing stay in n8n.
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap bg-muted/40 border border-border rounded-xl px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-bold break-all">
            {connected ? data?.baseUrl : 'Not connected'}
            {data?.hasKey && data.keyHint && (
              <span className="ml-2 text-[10px] font-mono text-subtle-foreground">key …{data.keyHint}</span>
            )}
          </p>
          <p className="text-[10px] text-subtle-foreground">
            {connected
              ? `The key is never shown again. ${data?.taskCount ?? 0} workflow${data?.taskCount === 1 ? '' : 's'} tracked.`
              : 'Your instance address and an API key from Settings › n8n API.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={openForm}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95"
          >
            {connected ? 'Replace key' : 'Connect'}
          </button>
          {connected && (
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

      {formOpen && (
        <div className="bg-background border border-border rounded-xl p-3 space-y-2">
          <Field
            label="Instance address"
            hint="The address you open n8n at. A pasted /api/v1 or /home/workflows is trimmed off."
            value={baseUrl}
            onChange={setBaseUrl}
            placeholder="https://n8n.example.com  or  https://you.app.n8n.cloud"
          />
          <Field
            label="API key"
            hint="Create one in n8n under Settings › n8n API. A scoped key needs workflow:read and execution:read."
            value={apiKey}
            onChange={setApiKey}
            placeholder="Paste your n8n API key"
            secret
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setFormOpen(false); setApiKey(''); }}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={submitConnection}
              disabled={!baseUrl.trim() || !apiKey.trim() || setConnection.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-primary-foreground transition-all active:scale-95"
            >
              {setConnection.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Verify and save
            </button>
          </div>
        </div>
      )}

      {(connected || formOpen) && (
        <div className="bg-muted/40 border border-border rounded-xl px-3 py-2 space-y-2">
          <Field
            label="Instance time zone"
            hint="The zone your n8n instance schedules in (its GENERIC_TIMEZONE). n8n's API does not report it, so without it Cronsole shows schedules without a time rather than guess."
            value={zone}
            onChange={setZoneDraft}
            placeholder={suggested || 'America/New_York'}
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {suggested && zone.trim() !== suggested ? (
              <button
                type="button"
                onClick={() => setZoneDraft(suggested)}
                className="text-[10px] font-bold text-n8n-text hover:underline"
              >
                Use this browser&apos;s zone ({suggested})
              </button>
            ) : (
              <span />
            )}
            {connected && (
              <button
                onClick={submitZone}
                disabled={setTimeZone.isPending || zone.trim() === storedZone}
                className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 disabled:opacity-40 transition-all active:scale-95"
              >
                {setTimeZone.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save time zone
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading && <p className="text-[11px] text-subtle-foreground">Loading…</p>}

      {note && (
        <p className="text-[11px] text-success-text bg-success/10 border border-success/30 rounded-xl px-3 py-2">{note}</p>
      )}
      {error && (
        <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">{error}</p>
      )}
    </div>
  );
};

export default N8nPanel;
