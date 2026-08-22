import { useState } from 'react';
import { KeyRound, Plus, Trash2, Loader2, AlertTriangle, Check } from 'lucide-react';
import { secretRefsIn, type NativeJobValues } from '../../utils/taskEditing';

/**
 * The secrets a Cronsole-native job uses — ADR 0003.
 *
 * **Write-only, and structurally so.** There is no route that returns a stored
 * value, so this component cannot show one however it is asked. What it shows is
 * three different facts, kept apart because they mean different things:
 *
 * - **referenced** — what the job asks for (`${secret.NAME}` in its fields)
 * - **stored** — what the task actually holds
 * - **missing** — the intersection that will make the next run refuse to start
 *
 * A stored secret nothing references is harmless leftovers from an edit and is
 * shown as *unused*, not as a problem. A referenced secret that is not stored is
 * a task that will not run, and is shown as one.
 *
 * ## Two modes, one component
 *
 * On an existing task each change is **its own request, applied immediately** —
 * a secret is a separate resource with its own routes, not part of the job the
 * Save button writes. That is deliberate: the job route *replaces*, so folding
 * secrets into it would destroy them on every unrelated edit.
 *
 * On a task that does not exist yet there is nothing to PUT to, so the values are
 * held locally and go with the create in one request. The same component, because
 * "which secrets does this job need and are they set" is one question whether or
 * not the row exists, and two components would answer it two ways.
 */

export interface PendingSecret {
  name: string;
  value: string;
}

/** What the server reports about a live task's secrets. Values are never in it. */
export interface StoredSecretsState {
  stored: string[];
  referenced: string[];
  missing: string[];
  unreadable: boolean;
  secretsUpdatedAt: string | null;
}

interface Props {
  /** The job being edited, so the references can be read straight off the form. */
  job: NativeJobValues;
  /**
   * `pending` — the task does not exist yet; values are collected and sent with
   * the create. `live` — each change is written immediately through its own route.
   */
  mode: 'pending' | 'live';
  /** `pending` only: the collected pairs and their setter. */
  pending?: PendingSecret[];
  onPendingChange?: (next: PendingSecret[]) => void;
  /** `live` only: what the server says, and the two writes. */
  state?: StoredSecretsState;
  onSet?: (name: string, value: string) => Promise<void>;
  onRemove?: (name: string) => Promise<void>;
  busy?: boolean;
}

const FIELD =
  'w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary transition-colors disabled:opacity-50';
const LABEL =
  'text-[10px] font-black text-subtle-foreground uppercase tracking-wider flex items-center gap-1.5';

/**
 * Mirrors the server's `SECRET_NAME_RE` and `MIN_SECRET_VALUE_LENGTH`.
 *
 * The browser gets no vote — every rule is enforced again at the boundary — but
 * a form that submits a name the API will refuse is a round trip spent to learn
 * something the field could have said while it was being typed.
 */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MIN_VALUE_LENGTH = 4;

export const TaskSecretsFields = ({
  job, mode, pending = [], onPendingChange, state, onSet, onRemove, busy
}: Props) => {
  const [newName, setNewName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const referenced = mode === 'live' ? (state?.referenced ?? []) : secretRefsIn(job);
  const stored = mode === 'live' ? (state?.stored ?? []) : pending.map(p => p.name);
  const storedSet = new Set(stored);
  const rows = [...new Set([...referenced, ...stored])].sort();

  const nameProblem = (name: string): string | null => {
    if (!name.trim()) return 'Give the secret a name.';
    if (!NAME_RE.test(name.trim())) {
      return 'Letters, digits and underscores only, starting with a letter or underscore.';
    }
    return null;
  };

  const add = async () => {
    const name = newName.trim();
    const problem = nameProblem(name);
    if (problem) return setError(problem);
    if (newValue.length < MIN_VALUE_LENGTH) {
      // The server's reason, said here rather than after a round trip: redaction
      // is a substring replace over captured output, so a very short value would
      // blank those characters out of every word the job prints.
      return setError(
        `A secret must be at least ${MIN_VALUE_LENGTH} characters — Cronsole redacts stored values out of ` +
        'a job\'s output by matching them, and a shorter one would mangle the log.'
      );
    }
    setError(null);

    if (mode === 'pending') {
      onPendingChange?.([...pending.filter(p => p.name !== name), { name, value: newValue }]);
      setNewName('');
      setNewValue('');
      return;
    }

    setWorking(name);
    try {
      await onSet?.(name, newValue);
      setNewName('');
      setNewValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that secret.');
    } finally {
      setWorking(null);
    }
  };

  const remove = async (name: string) => {
    if (mode === 'pending') {
      onPendingChange?.(pending.filter(p => p.name !== name));
      return;
    }
    setWorking(name);
    setError(null);
    try {
      await onRemove?.(name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove that secret.');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-[11px] text-subtle-foreground leading-relaxed">
        Put a credential here instead of in the job. Refer to it from a URL, a header value, a request
        body, an argument or an environment value as{' '}
        <span className="font-mono text-foreground">{'${secret.NAME}'}</span> — Cronsole substitutes it
        when the task runs and takes the value back out of the run log.{' '}
        <span className="text-foreground">Values are never shown again</span>, so a forgotten one is
        replaced rather than read.
      </p>

      {state?.unreadable && (
        /*
         * A third state, never folded into "no secrets". A row exists and cannot
         * be decrypted, so reporting an empty list would tell the user to set
         * values that are already there — absence of evidence is unknown, not ok.
         */
        <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 flex items-start gap-2">
          <AlertTriangle size={13} className="shrink-0 mt-0.5" />
          <span>
            This task has stored secrets that cannot be decrypted — <span className="font-mono">ENCRYPTION_KEY</span>{' '}
            has changed since they were saved. The values are unrecoverable; enter them again below.
          </span>
        </p>
      )}

      {rows.length > 0 && (
        <ul className="space-y-1.5">
          {rows.map(name => {
            const isStored = storedSet.has(name);
            const isReferenced = referenced.includes(name);
            return (
              <li
                key={name}
                className="flex items-center gap-3 bg-background border border-border rounded-xl px-3 py-2"
              >
                <span className="font-mono text-xs text-foreground truncate flex-1">{name}</span>
                {isStored ? (
                  <span
                    className={`text-[10px] font-bold flex items-center gap-1 shrink-0 ${
                      isReferenced ? 'text-success-text' : 'text-subtle-foreground'
                    }`}
                  >
                    <Check size={11} /> {isReferenced ? 'Set' : 'Set · unused'}
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-warning-text flex items-center gap-1 shrink-0">
                    <AlertTriangle size={11} /> Not set
                  </span>
                )}
                {isStored && (
                  <button
                    type="button"
                    onClick={() => remove(name)}
                    disabled={busy || working === name}
                    aria-label={`Remove secret ${name}`}
                    title={`Remove ${name}`}
                    className="p-1.5 rounded-lg text-subtle-foreground hover:text-danger-text hover:bg-muted transition-colors disabled:opacity-50 shrink-0"
                  >
                    {working === name
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Trash2 size={13} />}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rows.some(n => referenced.includes(n) && !storedSet.has(n)) && (
        <p className="text-[11px] text-warning-text flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          This job refers to a secret that is not set, so it will refuse to start rather than run with a
          blank credential.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="space-y-2">
          <label htmlFor="secret-name" className={LABEL}>
            <KeyRound size={11} /> Name
          </label>
          <input
            id="secret-name"
            value={newName}
            onChange={e => { setNewName(e.target.value); setError(null); }}
            placeholder="API_TOKEN"
            disabled={busy}
            className={FIELD}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="secret-value" className={LABEL}>
            Value {storedSet.has(newName.trim()) && <span className="normal-case font-normal">(replaces the stored one)</span>}
          </label>
          <input
            id="secret-value"
            type="password"
            value={newValue}
            onChange={e => { setNewValue(e.target.value); setError(null); }}
            placeholder="•••••••••"
            autoComplete="new-password"
            disabled={busy}
            className={FIELD}
          />
        </div>
      </div>

      {error && (
        <p className="text-[11px] text-danger-text flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {error}
        </p>
      )}

      <button
        type="button"
        onClick={add}
        disabled={busy || working !== null || !newName.trim() || !newValue}
        className="w-full py-2.5 rounded-xl text-xs font-bold border border-border bg-background text-foreground hover:border-foreground/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
      >
        {working !== null
          ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
          : <><Plus size={13} /> {storedSet.has(newName.trim()) ? 'Replace secret' : 'Add secret'}</>}
      </button>

      {mode === 'pending' && (
        <p className="text-[10px] text-subtle-foreground italic">
          Saved with the task when you create it — one request, so a task is never left holding a
          reference to a credential that failed to store.
        </p>
      )}
      {mode === 'live' && (
        <p className="text-[10px] text-subtle-foreground italic">
          Applied immediately, one secret at a time — not part of Save changes. Editing what the task runs
          never touches them.
        </p>
      )}
    </div>
  );
};
