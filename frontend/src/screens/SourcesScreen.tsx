import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Cpu, ExternalLink, Eye, EyeOff,
  GitPullRequest, Globe, HelpCircle, Loader2, Minus, Plus, Sparkles, Trash2
} from 'lucide-react';
import {
  usePlatformMatrix,
  type CapabilityCell,
  type CapabilitySupport,
  type PlatformMatrixRow
} from '../hooks/usePlatformMatrix';
import { useSettings } from '../hooks/useSettings';
import { timeAgo } from '../utils/datetime';
import { sourceVisibility, toggleShownSource } from '../utils/sourceVisibility';
import { DEFAULT_QUICK_LINKS, normalizeLinkUrl } from '../utils/quickLinks';
import { ClaudeRoutinesPanel } from '../components/ClaudeRoutinesPanel';
import { GitHubReposPanel } from '../components/GitHubReposPanel';
import { HelpButton } from '../components/HelpButton';
import { sourceTopicId } from '../data/help';
import { sourcesGuide } from '../data/docs';
import type { PlatformLink } from '../types';

/**
 * Everything about **where tasks come from**: what Cronsole can do with each
 * source it has, what else it could be watching, and what it can only bookmark.
 *
 * This was the *Platforms* tab, which named the code rather than the question —
 * and it already held the capability matrix, both hand-composed connection
 * panels and the quick links. Renaming it and giving it an *Available* section
 * was the smaller change than standing up a second screen about the same four
 * platforms, which is how two surfaces end up disagreeing (CLAUDE.md §11a).
 *
 * Four sections, in the order somebody actually needs them:
 *
 * 1. **Your sources** — the capability matrix, one card per source you have.
 * 2. **Available** — sources you have not added. **A fresh install shows two**,
 *    so this is where the other two live, and its existence is what makes
 *    hiding a source safe: nothing you turn off becomes unfindable.
 * 3. **Quick links** — bookmarks to schedulers with no connector. Below the real
 *    sources rather than among them: a bookmark that looks like a connector
 *    reads as a broken one.
 * 4. **Add a custom source** — which is a pull request, and says so.
 *
 * The rule the matrix is built on: **a cell is evidence, not a spec.** Three
 * states, and the middle one is the point:
 *
 *  - **Verified** — this verb has succeeded here, and the cell carries the
 *    timestamp that earned it.
 *  - **Declared** — the route would accept it, but it has never been observed to
 *    work on this machine. Not a yes.
 *  - **Unsupported** — the route would refuse.
 *
 * Nothing here is derived in the browser. The server sends the verdict and the
 * evidence behind it — including `access` (controller or observer), which is a
 * judgement and therefore the server's. Re-deriving one client-side is the shape
 * that silently took a folder out of every sync (troubleshooting #20a).
 */

const SUPPORT_STYLE: Record<CapabilitySupport, {
  label: string;
  icon: typeof Check;
  chip: string;
  /** What the state means, for the tooltip — a badge nobody can decode is decoration. */
  hint: string;
}> = {
  verified: {
    label: 'Verified',
    icon: Check,
    chip: 'bg-success/10 text-success-text border-success/30',
    hint: 'This has actually worked on this machine.'
  },
  declared: {
    label: 'Declared',
    icon: HelpCircle,
    chip: 'bg-neutral-text/10 text-neutral-text border-neutral-text/30',
    hint: 'Cronsole will attempt it, but it has never been observed to succeed here.'
  },
  unsupported: {
    label: 'Unsupported',
    icon: Minus,
    chip: 'bg-muted/40 text-muted-foreground border-border',
    hint: 'Cronsole cannot do this on this platform — the request would be refused.'
  }
};

const HEALTH_STYLE: Record<string, { label: string; dot: string; text: string }> = {
  HEALTHY: { label: 'Online', dot: 'bg-success', text: 'text-success-text' },
  DEGRADED: { label: 'Degraded', dot: 'bg-warning', text: 'text-warning-text' },
  OFFLINE: { label: 'Offline', dot: 'bg-danger', text: 'text-danger-text' },
  // Kept in step with healthMeta() in hooks/useConnections.ts — two tables for
  // one enum, which is why a state missing from this one renders as no status
  // dot at all rather than failing.
  UNKNOWN: { label: 'Not checked', dot: 'bg-muted', text: 'text-muted-foreground' }
};

/** What `access` means, in the words someone reading a card needs. */
const ACCESS_STYLE: Record<PlatformMatrixRow['access'], { label: string; chip: string; hint: string }> = {
  controller: {
    label: 'Controller',
    chip: 'bg-primary/10 text-foreground border-primary/30',
    hint: 'Cronsole can change scheduled work here, not only read it.'
  },
  observer: {
    label: 'Observer',
    chip: 'bg-neutral-text/10 text-neutral-text border-neutral-text/30',
    hint: 'Read-only by design. Cronsole reads what is scheduled here and changes nothing.'
  }
};

/**
 * Which section the rail sent us to.
 *
 * The two rail buttons are one destination with two entry points, so they arrive
 * as `?focus=` rather than as two routes — the screen is the same either way,
 * and a second path would be a second thing to keep in step.
 */
type Focus = 'yours' | 'available';

const SECTION_ID: Record<Focus, string> = { yours: 'your-sources', available: 'available-sources' };

export const SourcesScreen = () => {
  const location = useLocation();
  const { settings, update } = useSettings();
  const { data, isLoading, isError } = usePlatformMatrix();

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const links = settings.quickLinks;
  const saveLinks = (next: PlatformLink[]) => update('quickLinks', next);

  const addLink = () => {
    if (!newName || !newUrl) return;
    saveLinks([...links, {
      // `Date.now()` is enough: these are per-account bookmarks, not a keyspace
      // anything joins on, and two links added in the same millisecond by one
      // person through one form is not a case worth a uuid dependency.
      id: Date.now().toString(),
      name: newName,
      url: normalizeLinkUrl(newUrl),
      iconType: 'custom'
    }]);
    setNewName('');
    setNewUrl('');
    setShowAdd(false);
  };

  const deleteLink = (id: string) => saveLinks(links.filter(l => l.id !== id));

  const rows = data?.platforms ?? [];
  const yours = rows.filter(r => sourceVisibility(r, settings.shownSources).shown);
  const available = rows.filter(r => !sourceVisibility(r, settings.shownSources).shown);

  const toggleShown = (platform: string) =>
    update('shownSources', toggleShownSource(settings.shownSources, platform));

  // Scroll the requested section into view once the matrix has actually
  // rendered — before that the target is a loading placeholder and the browser
  // would scroll to where it *was*, which reads as the button doing nothing.
  const focus = readFocus(location.search);
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || isLoading) return;
    const key = `${focus}:${location.key}`;
    if (scrolledFor.current === key) return;
    scrolledFor.current = key;
    document.getElementById(SECTION_ID[focus])?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, isLoading, location.key]);

  return (
    // The width lives on the wrapper, not on each section, so the heading is
    // centred with the cards it introduces rather than starting at a different
    // left edge. Same `max-w-6xl mx-auto` as the Tools tab — the two screens are
    // the same shape and must end their column in the same place.
    <div className="space-y-10 animate-in fade-in duration-500 pb-20 max-w-6xl mx-auto">
      <div>
        <h2 className="text-2xl font-bold mb-1 flex items-center gap-1.5">
          Sources
          <HelpButton topic="platforms" size="md" />
        </h2>
        <p className="text-muted-foreground">
          Where your tasks come from — what Cronsole can do with each one, and what else it could watch.
        </p>
      </div>

      <section id={SECTION_ID.yours} className="space-y-4 scroll-mt-24">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">
            Your sources
          </h3>
          <p className="text-[11px] text-muted-foreground">
            <span className="font-bold text-success-text">Verified</span> means it has worked here.{' '}
            <span className="font-bold text-neutral-text">Declared</span> means it has not been tried.
          </p>
        </div>

        {isLoading && (
          <div className="bg-surface border border-border rounded-2xl p-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" /> Reading platform evidence…
          </div>
        )}

        {isError && (
          <div className="bg-surface border border-danger/30 rounded-2xl p-6 text-sm text-danger-text">
            Could not load the capability matrix. The backend may be down.
          </div>
        )}

        {yours.map(row => (
          <PlatformMatrixCard
            key={row.platform}
            row={row}
            shownSources={settings.shownSources}
            onToggleShown={toggleShown}
          />
        ))}
      </section>

      {/*
        Omitted rather than shown empty. An "Available" heading over nothing is a
        rail node with a `0` beside it — the rail may read `0` because a route to
        an empty place is the point, and this is not navigation.
      */}
      {available.length > 0 && (
        <section id={SECTION_ID.available} className="space-y-4 scroll-mt-24">
          <div>
            <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">
              Available
            </h3>
            <p className="text-xs text-muted-foreground mt-1 ml-1">
              Sources Cronsole supports that you have not added. Adding one lists it in the sidebar;
              it stays empty until you connect it.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {available.map(row => (
              <AvailableSourceCard key={row.platform} row={row} onAdd={() => toggleShown(row.platform)} />
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <div className="flex justify-between items-end gap-4 flex-wrap">
          <div>
            <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">
              Quick links
            </h3>
            <p className="text-xs text-muted-foreground mt-1 ml-1">
              Schedulers Cronsole has no connector for. These are bookmarks — nothing is read or written.
            </p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="bg-muted hover:bg-primary hover:text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all active:scale-95"
          >
            <Plus size={16} /> Add link
          </button>
        </div>

        {showAdd && (
          <div className="bg-surface border border-border p-6 rounded-2xl space-y-4 animate-in slide-in-from-top-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-subtle-foreground ml-1" htmlFor="platform-link-name">
                  PLATFORM NAME
                </label>
                <input
                  id="platform-link-name"
                  type="text"
                  placeholder="e.g. N8N, OpenClaw"
                  className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-subtle-foreground ml-1" htmlFor="platform-link-url">
                  URL
                </label>
                <input
                  id="platform-link-url"
                  type="text"
                  placeholder="https://..."
                  className="w-full bg-background border border-border rounded-xl px-4 py-2 text-sm outline-none focus:border-primary"
                  value={newUrl}
                  onChange={e => setNewUrl(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm font-bold text-muted-foreground hover:text-foreground">Cancel</button>
              <button onClick={addLink} className="bg-primary hover:bg-primary-hover px-6 py-2 rounded-xl text-sm font-bold shadow-lg shadow-primary/20">Save link</button>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {links.map(link => <PlatformLinkRow key={link.id} link={link} onDelete={deleteLink} />)}
        </div>

        {links.length === 0 && (
          <p className="text-xs text-muted-foreground ml-1">
            No links. <button onClick={() => saveLinks(DEFAULT_QUICK_LINKS)} className="underline hover:text-foreground">
              Restore the defaults
            </button> — Claude, ChatGPT and Gemini.
          </p>
        )}
      </section>

      <AddCustomSourcePanel />
    </div>
  );
};

/** `?focus=available` from a rail button, or nothing. Anything else is ignored. */
function readFocus(search: string): Focus | null {
  const value = new URLSearchParams(search).get('focus');
  return value === 'yours' || value === 'available' ? value : null;
}

/**
 * A source you have: the full capability matrix card.
 *
 * Also the home of the **Show in sidebar** switch, because this is the row that
 * already answers "what is this source" — a hide control anywhere else would be
 * a second place to look for the same fact.
 */
const PlatformMatrixCard = ({ row, shownSources, onToggleShown }: {
  row: PlatformMatrixRow;
  shownSources: string[];
  onToggleShown: (platform: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const health = row.healthState ? HEALTH_STYLE[row.healthState] : null;
  const verifiedCount = row.capabilities.filter(c => c.support === 'verified').length;
  const declaredCount = row.capabilities.filter(c => c.support === 'declared').length;
  const failing = row.capabilities.filter(
    c => c.lastFailureAt && (!c.lastSuccessAt || c.lastFailureAt > c.lastSuccessAt)
  );
  const visibility = sourceVisibility(row, shownSources);
  const access = ACCESS_STYLE[row.access];

  return (
    <div
      data-testid={`platform-row-${row.platform}`}
      className="bg-surface border border-border rounded-2xl shadow-xl overflow-hidden"
    >
      <div className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="font-bold text-lg">{row.label}</h4>
              {/* Per-source help, on the screen that is *about* sources — so
                  "what can this one actually do, and what can it never do?"
                  is answered next to the matrix that raises the question. */}
              <HelpButton topic={sourceTopicId(row.platform)} />
              <span
                title={access.hint}
                className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${access.chip}`}
              >
                {access.label}
              </span>
              {row.maturity === 'experimental' && (
                <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border bg-warning/10 text-warning-text border-warning/30">
                  Experimental
                </span>
              )}
            </div>
            <p className="text-xs text-subtle-foreground mt-1">{row.summary}</p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {!row.configured ? (
              // Never connected is a different fact from connected-and-offline,
              // and only one of them is something the user should go fix.
              <span className="text-[11px] font-bold text-muted-foreground">Not connected</span>
            ) : health ? (
              <span className={`flex items-center gap-1.5 text-[11px] font-bold ${health.text}`}>
                <span className={`h-2 w-2 rounded-full ${health.dot}`} />
                {health.label}
              </span>
            ) : null}
            <ShowInSidebarButton
              row={row}
              visibility={visibility}
              onToggle={() => onToggleShown(row.platform)}
            />
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[11px]">
          <Stat label="Tracked tasks" value={String(row.taskCount)} />
          {/*
            Absent, not "just now". A sync timestamp is only ever a real one:
            Cronsole-native reports none because this database IS its source of
            truth, so it has nothing to be stale against (troubleshooting #40).
          */}
          <Stat label="Last sync" value={row.lastSync ? timeAgo(row.lastSync) : '—'} />
          <Stat label="Last verified" value={row.lastVerifiedAt ? timeAgo(row.lastVerifiedAt) : 'Never'} />
          <Stat label="Verified verbs" value={`${verifiedCount} of ${row.capabilities.length}`} />
        </dl>

        {row.healthReason && (
          <p className="text-[11px] text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2">
            {row.healthReason}
          </p>
        )}

        {failing.length > 0 && (
          <div className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2 space-y-1">
            <p className="font-bold flex items-center gap-1.5">
              <AlertTriangle size={12} />
              {failing.length === 1 ? '1 verb failed more recently than it succeeded' : `${failing.length} verbs failed more recently than they succeeded`}
            </p>
            {failing.map(c => (
              <p key={c.verb} className="opacity-90">
                <span className="font-bold">{c.label}:</span> {c.lastFailureReason || 'no reason reported'}
              </p>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {row.capabilities.map(cell => <CapabilityChip key={cell.verb} cell={cell} />)}
        </div>

        {/*
          An observer's struck-through cells need one sentence saying they were
          chosen. Without it a reader has ten refusals and no way to tell a
          finished read-only connector from a broken one — which is the whole
          reason `access` is a declared field rather than a count of cells.
        */}
        {row.access === 'observer' && (
          <p className="text-[11px] text-muted-foreground">
            Read-only <span className="font-bold">by design</span>. The struck-through capabilities are
            boundaries this connector chose, not ones waiting to be built.
          </p>
        )}

        {declaredCount > 0 && (
          <p className="text-[11px] text-muted-foreground">
            {declaredCount === 1
              ? '1 capability is declared but unproven here — use it once and this row will say so.'
              : `${declaredCount} capabilities are declared but unproven here — use one and this row will say so.`}
          </p>
        )}
      </div>

      {/*
        Claude is the only platform whose connection a user composes by hand:
        Anthropic issues a bearer token per routine and exposes no API to list
        them, so nothing can be discovered and the registry has to be typed in.
        The panel lives inside the platform's own card because that is where
        someone goes when the row says "Not connected".
      */}
      {row.platform === 'CLAUDE_CODE' && <ClaudeRoutinesPanel />}

      {/*
        GitHub is the second hand-composed connection, and the first read-only
        one. The panel lives in the platform's own card for the same reason
        Claude's does — this is where someone goes when the row says "Not
        connected" — and it opens by saying what Cronsole will *not* do, because
        a card of `unsupported` cells otherwise reads as a fault rather than as
        the shape of the integration.
      */}
      {row.platform === 'GITHUB_ACTIONS' && <GitHubReposPanel />}

      <button
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="w-full border-t border-border px-5 py-2.5 text-[11px] font-bold text-subtle-foreground hover:text-foreground hover:bg-muted/40 flex items-center gap-1.5 transition-colors"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {expanded ? 'Hide the evidence' : 'Show the evidence behind each capability'}
      </button>

      {expanded && (
        <div className="border-t border-border overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-subtle-foreground border-b border-border">
                <th scope="col" className="font-black uppercase tracking-widest px-5 py-2">Capability</th>
                <th scope="col" className="font-black uppercase tracking-widest px-3 py-2">State</th>
                <th scope="col" className="font-black uppercase tracking-widest px-3 py-2 whitespace-nowrap">Last success</th>
                <th scope="col" className="font-black uppercase tracking-widest px-5 py-2">Last failure</th>
              </tr>
            </thead>
            <tbody>
              {row.capabilities.map(cell => {
                const style = SUPPORT_STYLE[cell.support];
                return (
                  <tr key={cell.verb} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-5 py-2.5">
                      <div className="font-bold text-foreground">{cell.label}</div>
                      <div className="text-muted-foreground">{cell.description}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-block text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${style.chip}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap">
                      {cell.lastSuccessAt ? timeAgo(cell.lastSuccessAt) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-muted-foreground">
                      {cell.lastFailureAt
                        ? <>{timeAgo(cell.lastFailureAt)}{cell.lastFailureReason ? ` — ${cell.lastFailureReason}` : ''}</>
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/**
 * Show or hide this source in the rail.
 *
 * **Disabled rather than absent when something is holding it visible.** A
 * control that vanishes when you go looking for it reads as a bug; one that
 * explains itself reads as a rule — and the rule is worth stating, because "a
 * source with tasks cannot be hidden" is the reason hiding is safe to offer.
 */
const ShowInSidebarButton = ({ row, visibility, onToggle }: {
  row: PlatformMatrixRow;
  visibility: ReturnType<typeof sourceVisibility>;
  onToggle: () => void;
}) => {
  const title = visibility.canHide
    ? visibility.shown
      ? `Hide ${row.label} from the sidebar. It stays connected and nothing is removed.`
      : `List ${row.label} in the sidebar.`
    : visibility.heldBy === 'tasks'
      ? `${row.label} holds ${row.taskCount} task${row.taskCount === 1 ? '' : 's'}, so it is always listed.`
      : `${row.label} is connected, so it is always listed. Disconnect it to hide the row.`;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!visibility.canHide}
      aria-pressed={visibility.shown}
      title={title}
      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest px-2.5 py-1.5 rounded-lg border border-border text-subtle-foreground hover:text-foreground hover:bg-muted/40 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-subtle-foreground transition-colors"
    >
      {visibility.shown ? <Eye size={11} /> : <EyeOff size={11} />}
      {visibility.shown ? 'In sidebar' : 'Hidden'}
    </button>
  );
};

/**
 * A source you have not added: what it is, what shape it is, and one button.
 *
 * Deliberately not the full matrix card. Its capability cells would all be
 * `declared` — nothing has been tried, because nothing is connected — so a
 * matrix here would be ten chips carrying no information at all.
 */
const AvailableSourceCard = ({ row, onAdd }: { row: PlatformMatrixRow; onAdd: () => void }) => {
  const access = ACCESS_STYLE[row.access];

  return (
    <div
      data-testid={`available-source-${row.platform}`}
      className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-3"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <h4 className="font-bold">{row.label}</h4>
        <HelpButton topic={sourceTopicId(row.platform)} />
        <span
          title={access.hint}
          className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border ${access.chip}`}
        >
          {access.label}
        </span>
        {row.maturity === 'experimental' && (
          <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-lg border bg-warning/10 text-warning-text border-warning/30">
            Experimental
          </span>
        )}
      </div>

      <p className="text-xs text-subtle-foreground flex-1">{row.summary}</p>

      <button
        type="button"
        onClick={onAdd}
        className="self-start bg-muted hover:bg-primary hover:text-primary-foreground px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition-all active:scale-95"
      >
        <Plus size={14} /> Add to sidebar
      </button>
    </div>
  );
};

/**
 * The honest answer to "can I add my own scheduler?".
 *
 * A source is a `PlatformConnector` compiled into the backend — there is no
 * plugin folder, and saying otherwise would advertise an extension point that
 * does not exist. So this panel points at the guide and at a pull request, and
 * says up front that the answer may be *no*, because a connector for a platform
 * with no scheduled-task API renders as a row of refusals that says less than a
 * bookmark does.
 */
const AddCustomSourcePanel = () => (
  <section className="space-y-4">
    <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">
      Add a custom source
    </h3>

    <div className="bg-surface border border-border rounded-2xl p-5 space-y-3">
      <div className="flex items-center gap-2">
        <GitPullRequest size={16} className="text-subtle-foreground" />
        <h4 className="font-bold">A source is a connector, so it arrives as a pull request</h4>
      </div>

      <p className="text-xs text-subtle-foreground">
        Sources are compiled into Cronsole rather than loaded at runtime — a connector holds
        credentials, issues commands to your machine and decides what a sync may retire, which is not
        something to load off disk unreviewed. Adding one means opening a PR against the repository,
        and you will get a straight answer about whether it fits: a platform with no public
        scheduled-task API is better served by a quick link above, which says more than a row of
        refusals would.
      </p>

      <p className="text-xs text-subtle-foreground">
        A connector that only <span className="font-bold">reads</span> is a finished thing, not a
        stalled one — GitHub Actions ships that way on purpose.
      </p>

      <a
        href={sourcesGuide('adding-a-source')}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-xs font-bold text-foreground hover:text-primary transition-colors"
      >
        Sources Guide › Adding a source <ExternalLink size={12} />
      </a>
    </div>
  </section>
);

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div>
    <dt className="text-subtle-foreground font-bold uppercase tracking-widest text-[9px]">{label}</dt>
    <dd className="text-foreground font-bold mt-0.5">{value}</dd>
  </div>
);

const CapabilityChip = ({ cell }: { cell: CapabilityCell }) => {
  const style = SUPPORT_STYLE[cell.support];
  const Icon = style.icon;
  // The tooltip carries the evidence, so the chip never asserts alone.
  const title = [
    `${cell.label}: ${style.label}`,
    style.hint,
    cell.lastSuccessAt ? `Last succeeded ${timeAgo(cell.lastSuccessAt)}.` : null,
    cell.lastFailureAt ? `Last failed ${timeAgo(cell.lastFailureAt)}.` : null
  ].filter(Boolean).join('\n');

  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${style.chip} ${cell.support === 'unsupported' ? 'line-through opacity-70' : ''}`}
    >
      <Icon size={10} />
      {cell.label}
    </span>
  );
};

const PlatformLinkRow = ({ link, onDelete }: { link: PlatformLink; onDelete: (id: string) => void }) => {
  const icon = {
    claude: <Bot size={20} />,
    chatgpt: <Cpu size={20} />,
    gemini: <Sparkles size={20} />
  }[link.iconType] ?? <Globe size={20} />;

  return (
    <div className="relative group">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="bg-surface border border-border p-4 rounded-2xl flex items-center gap-6 hover:border-primary/50 transition-all shadow-xl group/card"
      >
        <div className={`p-3 rounded-xl flex-shrink-0 ${
          link.iconType === 'claude' ? 'bg-claude/10 text-claude-text' :
          link.iconType === 'chatgpt' ? 'bg-chatgpt/10 text-chatgpt-text' :
          link.iconType === 'gemini' ? 'bg-primary/10 text-foreground' :
          'bg-muted/10 text-muted-foreground'
        }`}>
          {icon}
        </div>

        <div className="flex-1 flex items-center justify-between min-w-0 gap-4">
          <div className="min-w-0">
            <h4 className="font-bold text-foreground truncate">{link.name}</h4>
            <p className="text-xs text-subtle-foreground truncate font-mono mt-0.5">{link.url}</p>
          </div>
          <div className="flex items-center gap-3 text-subtle-foreground group-hover/card:text-foreground transition-all shrink-0">
            <span className="text-[10px] font-bold uppercase tracking-widest hidden sm:inline opacity-0 group-hover/card:opacity-100 transition-opacity">
              Open
            </span>
            <ExternalLink size={18} />
          </div>
        </div>
      </a>

      <button
        onClick={e => { e.preventDefault(); onDelete(link.id); }}
        aria-label={`Remove the ${link.name} link`}
        title="Remove link"
        className="absolute -right-3 top-1/2 -translate-y-1/2 p-2 bg-background border border-border rounded-full text-subtle-foreground hover:text-danger-text opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shadow-lg z-10"
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
};
