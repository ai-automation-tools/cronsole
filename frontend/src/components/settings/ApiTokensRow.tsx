import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Plus, Trash2, TriangleAlert } from 'lucide-react';
import { api } from '../../api';
import { useToast } from '../../hooks/useToast';
import { useConfirm } from '../../hooks/useConfirm';
import { errorMessage } from '../../utils/errorMessage';

/**
 * Manage long-lived API tokens for non-browser clients — the MCP server above
 * all, a stdio process that cannot re-authenticate when a 24h session lapses.
 *
 * The `never` option exists only because these are **revocable**. That is why
 * this is a manager rather than a "copy your token" button: issuing a permanent
 * credential with no list and no revoke would be strictly worse than the 24h
 * session it replaces.
 */

export type ApiTokenLifetime = '30d' | '60d' | '90d' | 'never';

export interface ApiTokenRecord {
  id: string;
  name: string;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

const LIFETIMES: { value: ApiTokenLifetime; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '60d', label: '60 days' },
  { value: '90d', label: '90 days' },
  { value: 'never', label: 'Never expires' }
];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : null;

/**
 * What a token's state is, in one phrase, worst-first. Revoked outranks expired
 * outranks live: a reader scanning this list is looking for "can this still be
 * used", and only the first answer that is true matters.
 */
function status(t: ApiTokenRecord): { text: string; tone: string } {
  if (t.revokedAt) return { text: `Revoked ${fmt(t.revokedAt)}`, tone: 'text-danger-text' };
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now())
    return { text: `Expired ${fmt(t.expiresAt)}`, tone: 'text-warning-text' };
  if (!t.expiresAt) return { text: 'Never expires', tone: 'text-warning-text' };
  return { text: `Expires ${fmt(t.expiresAt)}`, tone: 'text-muted-foreground' };
}

const inputClass =
  'w-full sm:w-64 bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-primary shadow-sm';

export const ApiTokensRow = () => {
  const { toast } = useToast();
  const confirm = useConfirm();

  const queryClient = useQueryClient();
  // Server state through TanStack Query, per the project convention — and it is
  // also what keeps the list correct when a token is issued or revoked from
  // another tab, which a one-shot fetch in an effect would not.
  const { data: tokens, isLoading } = useQuery<ApiTokenRecord[]>({
    queryKey: ['api-tokens'],
    queryFn: async () => (await api.get<{ tokens: ApiTokenRecord[] }>('/auth/tokens')).data.tokens
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['api-tokens'] });

  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [lifetime, setLifetime] = useState<ApiTokenLifetime>('30d');
  const [password, setPassword] = useState('');

  // Shown once, then gone — nothing stores the token, so there is no way to
  // retrieve it later and no endpoint that could.
  const [issued, setIssued] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<{ token: string }>('/auth/tokens', {
        name: name.trim(),
        expiresIn: lifetime,
        password
      });
      setIssued(data.token);
      setName(''); setPassword(''); setLifetime('30d'); setCreating(false);
      await refresh();
    } catch (err) {
      toast(errorMessage(err, 'Could not create the token.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (t: ApiTokenRecord) => {
    const ok = await confirm({
      title: `Revoke "${t.name}"?`,
      // Names the consequence rather than asking an abstract question: the point
      // of revoking is that something stops working, and the user should know
      // what before they click, not after.
      message:
        'Any client using this token stops working immediately — including the MCP server, whose ' +
        'tools go missing rather than erroring when its credential fails.\n\n' +
        'This cannot be undone. Issue a new token instead.',
      confirmText: 'Revoke token',
      tone: 'danger'
    });
    if (!ok) return;
    try {
      await api.delete(`/auth/tokens/${t.id}`);
      toast(`Revoked "${t.name}".`, 'success');
      await refresh();
    } catch (err) {
      toast(errorMessage(err, 'Could not revoke the token.'), 'error');
    }
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued);
      toast('Token copied.', 'success');
    } catch {
      toast('Could not copy — select the token and copy it manually.', 'error');
    }
  };

  const active = (tokens ?? []).filter(t => !t.revokedAt);

  return (
    <div className="flex flex-col gap-3">
      {/* The token, shown exactly once. */}
      {issued && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-3 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-warning-text">
            <TriangleAlert size={14} /> Copy this now — it cannot be shown again.
          </div>
          <code className="block break-all rounded-lg bg-background border border-border px-3 py-2 text-[11px] font-mono text-foreground">
            {issued}
          </code>
          <div className="flex gap-2">
            <button
              onClick={copy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-primary text-primary-foreground hover:bg-primary-hover transition-all active:scale-95"
            >
              <Copy size={13} /> Copy
            </button>
            <button
              onClick={() => setIssued(null)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Existing tokens. */}
      {isLoading ? (
        <span className="text-xs text-muted-foreground">Loading…</span>
      ) : !tokens || tokens.length === 0 ? (
        <span className="text-xs text-muted-foreground">No API tokens yet.</span>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {tokens.map(t => {
            const s = status(t);
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-foreground">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    <span className={s.tone}>{s.text}</span>
                    {' · '}
                    {t.lastUsedAt ? `last used ${fmt(t.lastUsedAt)}` : 'never used'}
                  </div>
                </div>
                {!t.revokedAt && (
                  <button
                    onClick={() => revoke(t)}
                    aria-label={`Revoke ${t.name}`}
                    className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-background border border-border text-muted-foreground hover:text-danger-text hover:border-danger/40 transition-all active:scale-95"
                  >
                    <Trash2 size={12} /> Revoke
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Create. */}
      {creating ? (
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
          <input
            placeholder="What is it for? e.g. Claude Code on my desktop"
            value={name}
            onChange={e => setName(e.target.value)}
            className={inputClass}
          />
          <select
            value={lifetime}
            onChange={e => setLifetime(e.target.value as ApiTokenLifetime)}
            className={inputClass}
            aria-label="Token lifetime"
          >
            {LIFETIMES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
          {lifetime === 'never' && (
            <p className="text-[11px] text-warning-text">
              A token that never expires is only safe because you can revoke it here. Keep it out of
              committed files.
            </p>
          )}
          <input
            type="password"
            autoComplete="current-password"
            placeholder="Your password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={inputClass}
          />
          <div className="flex gap-2">
            <button
              onClick={create}
              disabled={busy || !name.trim() || !password}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary-hover transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
            >
              {busy && <Loader2 size={14} className="animate-spin" />} Create token
            </button>
            <button
              onClick={() => { setCreating(false); setName(''); setPassword(''); }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground transition-all active:scale-95"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="self-start inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-all active:scale-95"
        >
          <Plus size={14} /> New API token
        </button>
      )}

      {active.length > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {active.length} active token{active.length === 1 ? '' : 's'}. These are separate from your
          browser session, which always lasts 24 hours.
        </p>
      )}
    </div>
  );
};
