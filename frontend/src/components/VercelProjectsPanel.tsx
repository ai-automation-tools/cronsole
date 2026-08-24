import { useState } from 'react';
import { AlertTriangle, Check, ExternalLink, Eye, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import {
  useDisconnectVercel,
  useSetVercelToken,
  useUnwatchProject,
  useVercelConnection,
  useVercelDiscovery,
  useWatchProject,
  type DiscoveredProject,
  type WatchedProject
} from '../hooks/useVercelConnection';
import { errorMessage } from '../utils/errorMessage';
import { ConnectionField as Field } from './sources/ConnectionField';

/**
 * **Watch a Vercel project so Cronsole can read its cron jobs.**
 *
 * The third connection a user composes by hand. It is shaped like the GitHub
 * panel — one account token, then a list of things to watch, and the list holds
 * no secrets — and it differs from it in exactly two places, both of which are
 * differences in the *platform* rather than in taste.
 *
 * **It offers a picker, not just a paste box.** GitHub cannot usefully list
 * "your repositories": one token reaches thousands, so its panel has to ask you
 * to name one. Vercel's project list is one small request that **already carries
 * each project's crons**, so the picker can say "this one has 3 cron jobs, that
 * one has none" before you commit to anything. Pasting a URL is kept as the
 * fallback for a project past the first page, not removed — a picker that cannot
 * reach something with no other route to it is a dead end.
 *
 * **It says up front that health will read unknown.** Every mutating capability
 * on the card above reads *Unsupported*, which this panel explains the way
 * GitHub's does. But Vercel adds a second surprise GitHub does not have: it
 * publishes no run history for a cron, so these tasks sit at `unknown` health
 * permanently. Learning that from a grey pill three days later reads as a broken
 * integration; learning it here reads as the shape of one.
 *
 * The two rules it shares with GitHub's panel are load-bearing and unchanged:
 * **"Stop watching", never "Remove" or "Delete"** — the crons keep running on
 * Vercel — and **the task count before the click**, because unwatching removes
 * tracked rows and that number belongs in the confirmation rather than in the
 * result.
 */
export const VercelProjectsPanel = () => {
  const { data, isLoading } = useVercelConnection();
  const setToken = useSetVercelToken();
  const watch = useWatchProject();
  const unwatch = useUnwatchProject();
  const disconnect = useDisconnectVercel();

  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken_] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [project, setProject] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const hasToken = data?.hasToken ?? false;
  const projects = data?.projects ?? [];

  // Only asked while the picker is open, and only once a token exists: it is one
  // request per team against a rate limit, and firing it because a card happens
  // to be expanded would be the "health probes the platform" mistake in a new
  // costume.
  const discovery = useVercelDiscovery(pickerOpen && hasToken);

  const clear = () => {
    setError(null);
    setWarnings([]);
    setNote(null);
  };

  const submitToken = async () => {
    clear();
    try {
      const result = await setToken.mutateAsync(token.trim());
      setWarnings(result.warnings ?? []);
      setNote(`Verified as ${result.username}.`);
      setToken_('');
      setTokenOpen(false);
    } catch (e) {
      setError(errorMessage(e, 'Could not save that token.'));
    }
  };

  const add = async (input: { project: string; teamId?: string }, label: string) => {
    clear();
    try {
      const result = await watch.mutateAsync(input);
      // The exact number, said now. Unlike GitHub's `workflowCount` this is not
      // an upper bound: a Vercel project hands over its cron definitions in the
      // same response, so nothing has to be read per task to know it.
      setNote(
        result.already
          ? `${result.project.name} was already being watched.`
          : result.cronCount > 0
            ? `Watching ${result.project.name} — ${result.cronCount} cron job${
                result.cronCount === 1 ? '' : 's'
              }. Sync to bring them in.`
            : `Watching ${result.project.name}. It declares no cron jobs right now — ` +
              'anything added to its vercel.json will arrive on the next sync.'
      );
      setProject('');
      setManualOpen(false);
    } catch (e) {
      setError(errorMessage(e, `Could not watch ${label}.`));
    }
  };

  const onUnwatch = async (target: WatchedProject) => {
    const tracked =
      target.taskCount === 1
        ? '\n\n1 tracked cron job will be removed from the dashboard.'
        : target.taskCount > 1
          ? `\n\n${target.taskCount} tracked cron jobs will be removed from the dashboard.`
          : '';
    const ok = window.confirm(
      `Stop watching ${target.name}?\n\n` +
        'The cron jobs keep running on Vercel exactly as before — Cronsole only reads them. ' +
        'This just stops reading.' +
        tracked
    );
    if (!ok) return;
    clear();
    try {
      const result = await unwatch.mutateAsync(target);
      setNote(`Stopped watching ${result.removed}.`);
    } catch (e) {
      setError(errorMessage(e, 'Could not stop watching that project.'));
    }
  };

  const onDisconnect = async () => {
    const tracked = projects.reduce((sum, p) => sum + p.taskCount, 0);
    const ok = window.confirm(
      'Disconnect Vercel?\n\n' +
        'Cronsole forgets the token and every watched project. Nothing changes on Vercel — the ' +
        'cron jobs keep running.' +
        (tracked > 0 ? `\n\n${tracked} tracked cron job${tracked === 1 ? '' : 's'} will be removed from the dashboard.` : '')
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
    <div className="border-t border-border px-5 py-4 space-y-3" data-testid="vercel-projects-panel">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h5 className="text-xs font-black uppercase tracking-widest text-subtle-foreground">
            Watched projects
          </h5>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-prose">
            Cronsole reads the <span className="font-bold text-foreground">cron jobs</span> declared
            by the projects you name and changes nothing. Vercel publishes no run history for a cron,
            so these tasks show their schedule and stay at{' '}
            <span className="font-bold text-foreground">unknown</span> health — their invocations are
            in the project&rsquo;s function logs.
          </p>
        </div>
        <a
          href="https://vercel.com/account/tokens"
          target="_blank"
          rel="noreferrer"
          className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold text-vercel-text hover:underline"
        >
          Vercel tokens <ExternalLink size={11} />
        </a>
      </div>

      {/*
        The token's own row, above the list. It gates everything below it — a
        project can be neither listed nor verified without one — so it is stated
        as a state rather than left to be inferred from a failing add.
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
              ? 'Never shown again — Vercel cannot re-display it either. Paste a new one to rotate.'
              : 'An account access token. Read access is all Cronsole ever uses.'}
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
            label="Access token"
            hint="Create one under Account Settings › Tokens. Scope it to the team whose projects you want, or to your personal account. Cronsole verifies it before saving."
            value={token}
            onChange={setToken_}
            placeholder="Paste your Vercel access token"
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
      ) : projects.length === 0 ? (
        <p className="text-[11px] text-subtle-foreground">No projects watched yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {projects.map(p => (
            <li
              key={p.id}
              className="flex items-center justify-between gap-3 bg-muted/40 border border-border rounded-xl px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-xs font-bold truncate font-mono">{p.name}</p>
                <p className="text-[10px] text-subtle-foreground">
                  {p.taskCount === 0
                    ? 'Nothing tracked yet — sync to read its cron jobs.'
                    : `${p.taskCount} cron job${p.taskCount === 1 ? '' : 's'} tracked`}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <a
                  href={`https://vercel.com/dashboard`}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open Vercel to find ${p.name}`}
                  aria-label={`Open Vercel to find ${p.name}`}
                  className="p-1 rounded-lg text-subtle-foreground hover:text-foreground transition-colors"
                >
                  <Eye size={13} />
                </a>
                {/*
                  "Stop watching", never "Remove" or "Delete" — the crons keep
                  running on Vercel and Cronsole has no verb that could change
                  that.
                */}
                <button
                  onClick={() => onUnwatch(p)}
                  disabled={unwatch.isPending}
                  title={`Stop watching ${p.name} (its cron jobs keep running on Vercel)`}
                  aria-label={`Stop watching ${p.name}`}
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

      {/*
        The picker. Only reachable with a token, because listing projects is
        itself an authenticated read — and the refusal is a sentence beside the
        control rather than a `title=` on a disabled one.
      */}
      {pickerOpen && (
        <ProjectPicker
          discovery={discovery}
          busy={watch.isPending}
          onPick={p => add({ project: p.id, ...(p.teamId ? { teamId: p.teamId } : {}) }, p.name)}
          onClose={() => setPickerOpen(false)}
        />
      )}

      {manualOpen && (
        <div className="bg-background border border-border rounded-xl p-3 space-y-2">
          <Field
            label="Project"
            hint="The URL from your browser, its name, or its prj_… id. A team project needs the URL — a bare name resolves against your personal account."
            value={project}
            onChange={setProject}
            placeholder="vercel.com/acme/website   or   website"
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={() => { setManualOpen(false); setProject(''); }}
              className="px-3 py-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
            >
              <X size={12} className="inline mr-1" />Cancel
            </button>
            <button
              onClick={() => add({ project: project.trim() }, 'that project')}
              disabled={!project.trim() || watch.isPending}
              className="flex items-center gap-1.5 bg-primary hover:bg-primary-hover disabled:opacity-40 px-4 py-1.5 rounded-xl text-[11px] font-bold text-primary-foreground transition-all active:scale-95"
            >
              {watch.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Watch project
            </button>
          </div>
        </div>
      )}

      {!pickerOpen && !manualOpen && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { setPickerOpen(true); setError(null); }}
            disabled={!hasToken}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold bg-surface border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all active:scale-95 disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            <Plus size={12} /> Browse your projects
          </button>
          <button
            onClick={() => { setManualOpen(true); setError(null); }}
            disabled={!hasToken}
            className="text-[11px] font-bold text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40 disabled:hover:text-muted-foreground"
          >
            or paste a URL
          </button>
        </div>
      )}
      {!hasToken && !pickerOpen && !manualOpen && (
        <p className="text-[11px] text-subtle-foreground">
          Add a token first — Cronsole needs one to list or read a project.
        </p>
      )}
    </div>
  );
};

/**
 * Every project this token can see, grouped by the account or team it lives in.
 *
 * Three things it refuses to smooth over, each because the smoothed version
 * would say something false:
 *
 * **A project with no crons is shown, greyed, and still addable.** Hiding it
 * would make "you have no Vercel projects" and "none of your projects have
 * crons" the same empty screen — the ambiguity `SyncOutcome.notes` exists to
 * kill one layer down. And watching one *before* it has a cron is legitimate:
 * the cron arrives on the next sync.
 *
 * **A team whose listing failed is named, not dropped.** An account whose team
 * projects silently vanished looks like an empty account, which sends the user
 * to check the wrong thing.
 *
 * **A truncated listing says so.** Vercel returns one page; the paste-a-URL path
 * beside this is what reaches the rest, so the warning names it rather than
 * leaving a dead end.
 */
const ProjectPicker = ({
  discovery,
  busy,
  onPick,
  onClose
}: {
  discovery: ReturnType<typeof useVercelDiscovery>;
  busy: boolean;
  onPick: (project: DiscoveredProject) => void;
  onClose: () => void;
}) => {
  const { data, isLoading, isError, error, refetch, isFetching } = discovery;
  const rows = data?.projects ?? [];

  // Grouped by scope in the order the server returned them — personal account
  // first, then each team — so the list reads the way the Vercel dashboard's own
  // account switcher does.
  const scopes = [...new Set(rows.map(r => r.scope))];

  return (
    <div className="bg-background border border-border rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-widest text-subtle-foreground">
          Your projects
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            title="Read the list again"
            aria-label="Refresh the project list"
            className="p-1 rounded-lg text-subtle-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={isFetching ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={onClose}
            className="px-2 py-1 text-[11px] font-bold text-muted-foreground hover:text-foreground"
          >
            <X size={12} className="inline mr-1" />Close
          </button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-[11px] text-subtle-foreground flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin" /> Reading your projects…
        </p>
      ) : isError ? (
        <p className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2">
          {errorMessage(error, 'Could not list your projects.')}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-subtle-foreground">
          This token can see no projects. If your work is under a team, the token has to be scoped to
          that team — or paste the project&rsquo;s URL instead.
        </p>
      ) : (
        scopes.map(scope => (
          <div key={scope} className="space-y-1">
            <p className="text-[10px] font-bold text-subtle-foreground">{scope}</p>
            <ul className="flex flex-col gap-1">
              {rows
                .filter(r => r.scope === scope)
                .map(r => (
                  <li key={r.id}>
                    <button
                      onClick={() => onPick(r)}
                      disabled={r.watched || busy}
                      className="w-full flex items-center justify-between gap-3 text-left bg-surface border border-border rounded-lg px-2.5 py-1.5 hover:border-foreground/30 transition-colors disabled:opacity-50 disabled:hover:border-border"
                    >
                      <span className="min-w-0">
                        <span className="block text-xs font-bold truncate font-mono">{r.name}</span>
                        <span className="block text-[10px] text-subtle-foreground">
                          {r.cronCount > 0
                            ? `${r.cronCount} cron job${r.cronCount === 1 ? '' : 's'}`
                            : r.hasCrons
                              ? 'Crons enabled, none declared right now'
                              : 'No cron jobs'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10px] font-bold text-subtle-foreground">
                        {r.watched ? 'Watching' : 'Watch'}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        ))
      )}

      {(data?.warnings.length ?? 0) > 0 && (
        <div className="text-[11px] text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2 space-y-1">
          {data!.warnings.map(w => (
            <p key={w} className="flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};

export default VercelProjectsPanel;
