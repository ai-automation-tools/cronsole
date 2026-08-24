import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Eye, Loader2, Plus, Trash2, X } from 'lucide-react';
import {
  useDisconnectGitHub,
  useGitHubConnection,
  useSetGitHubToken,
  useUnwatchRepository,
  useWatchRepository,
  type WatchedRepository
} from '../hooks/useGitHubConnection';
import { errorMessage } from '../utils/errorMessage';

/**
 * **Watch a repository so Cronsole can read its scheduled workflows.**
 *
 * The second connection a user composes by hand, and the panel is deliberately
 * simpler than the Claude one because the platform is. Anthropic mints a token
 * per routine, so that panel needs a separate edit path (fixing a typo must not
 * discard a credential claude.ai shows once) and calls a re-add a rotation.
 * GitHub issues **one** token per account, so here there is a token, and there
 * is a list, and the list holds no secrets — removing a repository can never
 * cost anything.
 *
 * Three things on screen exist for a reason:
 *
 * **The read-only line, first.** Every mutating capability on the card above
 * reads *Unsupported*, and this is the only platform on the tab where that is
 * the design rather than a fault. Said in words at the top, because a row of
 * greyed cells with no explanation reads as a broken connection.
 *
 * **"Stop watching", never "Remove" or "Delete".** The workflows keep running on
 * GitHub. A label implying otherwise would let someone believe they had turned
 * off a nightly job that is still firing — the invisible-fence lie the Claude
 * panel names in the other direction.
 *
 * **The task count before the click.** Unwatching a repository removes its
 * tracked workflows, so the number is in the confirmation rather than in the
 * result — the rule the bulk recategorize dialog follows.
 */
export const GitHubReposPanel = () => {
  const { data, isLoading } = useGitHubConnection();
  const setToken = useSetGitHubToken();
  const watch = useWatchRepository();
  const unwatch = useUnwatchRepository();
  const disconnect = useDisconnectGitHub();

  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken_] = useState('');
  const [repoOpen, setRepoOpen] = useState(false);
  const [repository, setRepository] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const hasToken = data?.hasToken ?? false;
  const repositories = data?.repositories ?? [];

  const submitToken = async () => {
    setError(null);
    setWarnings([]);
    setNote(null);
    try {
      const result = await setToken.mutateAsync(token.trim());
      setWarnings(result.warnings ?? []);
      setNote(`Verified as ${result.login}.`);
      setToken_('');
      setTokenOpen(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not save that token.'));
    }
  };

  const submitRepository = async () => {
    setError(null);
    setWarnings([]);
    setNote(null);
    try {
      const result = await watch.mutateAsync(repository.trim());
      // What syncing will find, stated now. `workflowCount` is every workflow in
      // the repository — how many are *scheduled* needs each file read, which is
      // the sync's job, so this deliberately does not promise a task count.
      setNote(
        result.already
          ? `${result.repository.fullName} was already being watched.`
          : `Watching ${result.repository.fullName} — ${result.workflowCount} workflow${
              result.workflowCount === 1 ? '' : 's'
            } in the repository. Sync to bring in the scheduled ones.`
      );
      setRepository('');
      setRepoOpen(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not watch that repository.'));
    }
  };

  const onUnwatch = async (repo: WatchedRepository) => {
    const tracked =
      repo.taskCount === 1
        ? '\n\n1 tracked workflow will be removed from the dashboard.'
        : repo.taskCount > 1
          ? `\n\n${repo.taskCount} tracked workflows will be removed from the dashboard.`
          : '';
    const ok = window.confirm(
      `Stop watching ${repo.fullName}?\n\n` +
        'The workflows keep running on GitHub exactly as before — Cronsole only reads them. ' +
        'This just stops reading.' +
        tracked
    );
    if (!ok) return;
    setError(null);
    setNote(null);
    try {
      const result = await unwatch.mutateAsync(repo);
      setNote(`Stopped watching ${result.removed}.`);
    } catch (e) {
      setError(errorMessage(e, 'Could not stop watching that repository.'));
    }
  };

  const onDisconnect = async () => {
    const tracked = repositories.reduce((sum, r) => sum + r.taskCount, 0);
    const ok = window.confirm(
      'Disconnect GitHub?\n\n' +
        'Cronsole forgets the token and every watched repository. Nothing changes on GitHub — the ' +
        'workflows keep running.' +
        (tracked > 0 ? `\n\n${tracked} tracked workflow${tracked === 1 ? '' : 's'} will be removed from the dashboard.` : '')
    );
    if (!ok) return;
    setError(null);
    setNote(null);
    try {
      await disconnect.mutateAsync();
      setNote('Disconnected.');
    } catch (e) {
      setError(errorMessage(e, 'Could not disconnect.'));
    }
  };

  return (
    <div className="border-t border-border px-5 py-4 space-y-3" data-testid="github-repos-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h5 className="text-xs font-black uppercase tracking-widest text-subtle-foreground">
            Watched repositories
          </h5>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-prose">
            Cronsole reads the <span className="font-bold text-foreground">scheduled</span> workflows
            in the repositories you name — their crons and how their last runs actually went — and
            changes nothing. Running, pausing and editing stay on GitHub.
          </p>
        </div>
        <a
          href="https://github.com/settings/tokens"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-github-text hover:underline"
        >
          GitHub tokens <ExternalLink size={11} />
        </a>
      </div>

      {/*
        The token's own row, above the list. It gates everything below it — a
        repository cannot even be verified without one — so it is stated as a
        state rather than left to be inferred from a failing add.
      */}
      <div className="flex items-center justify-between gap-3 flex-wrap bg-muted/40 border border-border rounded-xl px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-bold">
            {hasToken ? 'Token stored' : 'No token yet'}
            {hasToken && data?.tokenHint && (
              <span className="ml-2 text-[10px] font-mono text-subtle-foreground">…{data.tokenHint}</span>
            )}
          </p>
          <p className="text-[10px] text-subtle-foreground">
            {hasToken
              ? 'Never shown again — GitHub cannot re-display it either. Paste a new one to rotate.'
              : 'A classic or fine-grained PAT with read access to the repositories you want to watch.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => { setTokenOpen(!tokenOpen); setError(null); }}
            className="px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95"
          >
            {hasToken ? 'Replace token' : 'Add token'}
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

      {tokenOpen && (
        <div className="bg-background border border-border rounded-xl p-3 space-y-2">
          <Field
            label="Personal access token"
            hint="Needs `repo` for private repositories, or `public_repo` for public ones. Cronsole verifies it before saving."
            value={token}
            onChange={setToken_}
            placeholder="ghp_…  or  github_pat_…"
            secret
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setTokenOpen(false); setToken_(''); }}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={submitToken}
              disabled={!token.trim() || setToken.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-primary-foreground transition-all active:scale-95"
            >
              {setToken.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Verify and save
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-[11px] text-subtle-foreground">Loading…</p>
      ) : repositories.length === 0 ? (
        <p className="text-[11px] text-subtle-foreground">No repositories watched yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repositories.map(repo => (
            <li
              key={repo.fullName}
              className="flex items-center justify-between gap-3 bg-muted/40 border border-border rounded-xl px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold truncate font-mono">{repo.fullName}</p>
                <p className="text-[10px] text-subtle-foreground">
                  {repo.taskCount === 0
                    ? 'Nothing tracked yet — sync to read its scheduled workflows.'
                    : `${repo.taskCount} scheduled workflow${repo.taskCount === 1 ? '' : 's'} tracked`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={`https://github.com/${repo.fullName}/actions`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${repo.fullName} Actions on GitHub`}
                  aria-label={`Open ${repo.fullName} Actions on GitHub`}
                  className="p-1 rounded-lg text-subtle-foreground hover:text-foreground transition-colors"
                >
                  <Eye size={13} />
                </a>
                {/*
                  "Stop watching", never "Remove" or "Delete" — the workflows
                  keep running on GitHub and Cronsole has no verb that could
                  change that.
                */}
                <button
                  onClick={() => onUnwatch(repo)}
                  disabled={unwatch.isPending}
                  title={`Stop watching ${repo.fullName} (its workflows keep running on GitHub)`}
                  aria-label={`Stop watching ${repo.fullName}`}
                  className="p-1 rounded-lg text-subtle-foreground hover:text-danger-text transition-colors disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </li>
          ))}
        </ul>
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

      {note && (
        <p className="text-[11px] text-success-text bg-success/10 border border-success/30 rounded-xl px-3 py-2">
          {note}
        </p>
      )}

      {error && (
        <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
          {error}
        </p>
      )}

      {repoOpen ? (
        <div className="bg-background border border-border rounded-xl p-3 space-y-2">
          <Field
            label="Repository"
            hint="The URL from your browser, or owner/name. Cronsole checks it can read the repository before saving."
            value={repository}
            onChange={setRepository}
            placeholder="github.com/acme/website   or   acme/website"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setRepoOpen(false); setRepository(''); }}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={submitRepository}
              disabled={!repository.trim() || watch.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-primary-foreground transition-all active:scale-95"
            >
              {watch.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Watch repository
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => { setRepoOpen(true); setError(null); }}
          disabled={!hasToken}
          // A refusal is a sentence in the form, never a disabled control whose
          // only explanation is a `title=` — so the reason sits beside it.
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95 disabled:opacity-40 disabled:hover:text-muted-foreground"
        >
          <Plus size={12} /> Watch a repository
        </button>
      )}
      {!hasToken && !repoOpen && (
        <p className="text-[11px] text-subtle-foreground">Add a token first — Cronsole needs one to read a repository.</p>
      )}
    </div>
  );
};

const Field = ({
  label, hint, value, onChange, placeholder, secret
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
}) => (
  <label className="block">
    <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">{label}</span>
    <input
      // type="password" on the token: it is a live third-party credential typed
      // into a tab someone may well be screen-sharing.
      type={secret ? 'password' : 'text'}
      autoComplete="off"
      spellCheck={false}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className="mt-1 w-full px-2.5 py-1.5 rounded-lg text-xs bg-surface border border-border text-foreground placeholder:text-subtle-foreground/60 focus:outline-none focus:border-primary font-mono"
    />
    <span className="text-[10px] text-subtle-foreground mt-1 block">{hint}</span>
  </label>
);

export default GitHubReposPanel;
