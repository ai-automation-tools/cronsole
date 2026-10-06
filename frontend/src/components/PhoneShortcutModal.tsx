import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, Loader2, Smartphone, TriangleAlert } from 'lucide-react';
import type { Task } from '../types';
import { api, API_ORIGIN } from '../api';
import { useToast } from '../hooks/useToast';
import { errorMessage } from '../utils/errorMessage';
import { Modal } from './ui/Modal';
import { HelpButton } from './HelpButton';
import { LIFETIMES, type ApiTokenLifetime } from '../utils/apiTokenLifetimes';

/**
 * Issue a token that can run this one task, and say how to put it behind a
 * home-screen icon. The shortcut holds the credential on a phone that can be
 * lost, so the token is scoped server-side to `POST /api/tasks/<id>/run` and
 * nothing else (`checkToken`). It is a GET-free design on purpose: a link that
 * runs a task would be fired by link previews and prefetchers.
 */

const inputClass =
  'w-full bg-background border border-border rounded-xl px-3 py-2 text-xs text-foreground outline-none focus:border-primary shadow-sm';

/** The page's own origin is the desktop's when issued from the desktop — useless on a phone. */
const isLoopback = (origin: string) => {
  try {
    return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname);
  } catch {
    return false;
  }
};

export function PhoneShortcutModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [lifetime, setLifetime] = useState<ApiTokenLifetime>('90d');
  const [password, setPassword] = useState('');
  const [origin, setOrigin] = useState(API_ORIGIN);
  const [busy, setBusy] = useState(false);
  // Shown once, then gone — only the jti is stored.
  const [token, setToken] = useState<string | null>(null);

  const url = `${origin.trim().replace(/\/+$/, '')}/api/tasks/${task.id}/run`;
  const header = `Bearer ${token ?? ''}`;

  const create = async () => {
    setBusy(true);
    try {
      const { data } = await api.post<{ token: string }>('/auth/tokens', {
        name: `Phone shortcut: ${task.name}`.slice(0, 80),
        expiresIn: lifetime,
        password,
        runTaskId: task.id
      });
      setToken(data.token);
      setPassword('');
      await queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    } catch (err) {
      toast(errorMessage(err, 'Could not create the shortcut token.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied.`, 'success');
    } catch {
      toast('Could not copy — select it and copy it manually.', 'error');
    }
  };

  const field = (label: string, value: string) => (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-bold text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2">
        <code className="flex-1 min-w-0 break-all rounded-lg bg-background border border-border px-3 py-2 text-[11px] font-mono text-foreground">
          {value}
        </code>
        <button
          onClick={() => copy(value, label)}
          aria-label={`Copy ${label}`}
          className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-bold bg-background border border-border text-muted-foreground hover:text-foreground transition-all active:scale-95"
        >
          <Copy size={12} /> Copy
        </button>
      </div>
    </div>
  );

  return (
    <Modal onClose={onClose} labelledBy="phone-shortcut-title">
      <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center gap-2">
          <Smartphone size={16} className="text-primary" />
          <h2 id="phone-shortcut-title" className="text-sm font-black text-foreground">
            Phone shortcut for “{task.name}”
          </h2>
          <HelpButton topic="phone-shortcut" />
        </div>

        <p className="text-xs text-muted-foreground">
          Creates a token that can <b>only run this task</b> — it cannot read, change or run anything
          else. Revoke it any time under Settings › API tokens.
        </p>

        <div className="flex flex-col gap-1">
          <label htmlFor="phone-shortcut-origin" className="text-[11px] font-bold text-muted-foreground">
            Address your phone uses to reach Cronsole
          </label>
          <input
            id="phone-shortcut-origin"
            value={origin}
            onChange={e => setOrigin(e.target.value)}
            className={inputClass}
          />
          {isLoopback(origin) && (
            <p className="text-[11px] text-warning-text">
              On your phone, localhost is the phone. Use your Tailscale or tunnel address, e.g.
              https://my-pc.tailnet-name.ts.net — see the Remote Access guide.
            </p>
          )}
        </div>

        {!token ? (
          <div className="flex flex-col gap-2">
            <select
              value={lifetime}
              onChange={e => setLifetime(e.target.value as ApiTokenLifetime)}
              className={inputClass}
              aria-label="Token lifetime"
            >
              {LIFETIMES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
            </select>
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
                disabled={busy || !password}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold bg-primary text-primary-foreground hover:bg-primary-hover transition-all active:scale-95 disabled:opacity-50 disabled:active:scale-100"
              >
                {busy && <Loader2 size={14} className="animate-spin" />} Create shortcut token
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground transition-all active:scale-95"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 text-xs font-bold text-warning-text">
              <TriangleAlert size={14} /> Copy the header now — the token cannot be shown again.
            </div>
            {field('URL', url)}
            {field('Authorization header', header)}

            <div className="text-xs text-foreground space-y-2">
              <p className="font-bold">iPhone — Shortcuts app</p>
              <ol className="list-decimal pl-5 space-y-0.5 text-muted-foreground">
                <li>New shortcut → add <b>Get Contents of URL</b>, paste the URL.</li>
                <li>Method <b>POST</b>; add header <b>Authorization</b> with the value above.</li>
                <li>Add <b>Get Dictionary Value</b> “message”, then <b>Show Notification</b>.</li>
                <li>Share → <b>Add to Home Screen</b>, or add it as a Shortcuts widget.</li>
              </ol>
              <p className="font-bold">Android — HTTP Shortcuts app</p>
              <ol className="list-decimal pl-5 space-y-0.5 text-muted-foreground">
                <li>New regular shortcut, method <b>POST</b>, paste the URL.</li>
                <li>Request headers → <b>Authorization</b> with the value above.</li>
                <li>Response handling → show as toast; then place it on the home screen.</li>
              </ol>
            </div>

            <p className="text-[11px] text-muted-foreground">
              The phone must be able to reach that address (Tailscale connected, or through your
              Access-gated tunnel).
              {task.platform === 'WINDOWS_TASK_SCHEDULER' &&
                ' For a Windows task, success means the agent started it — whether it worked shows up later in Cronsole.'}
            </p>

            <button
              onClick={onClose}
              className="self-start px-4 py-2 rounded-xl text-xs font-bold bg-background border border-border text-muted-foreground hover:text-foreground transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
