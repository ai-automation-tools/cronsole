import { useState } from 'react';
import {
  AlertTriangle, Bot, Check, ChevronDown, ChevronRight, Cpu, ExternalLink,
  Globe, HelpCircle, Loader2, Minus, Plus, Sparkles, Trash2
} from 'lucide-react';
import {
  usePlatformMatrix,
  type CapabilityCell,
  type CapabilitySupport,
  type PlatformMatrixRow
} from '../hooks/usePlatformMatrix';
import { timeAgo } from '../utils/datetime';
import { ClaudeRoutinesPanel } from '../components/ClaudeRoutinesPanel';
import { HelpButton } from '../components/HelpButton';
import { sourceTopicId } from '../data/help';
import type { PlatformLink } from '../types';

/**
 * What Cronsole can actually do with each platform.
 *
 * This tab used to be three `localStorage` bookmarks to Claude, ChatGPT and
 * Gemini — and never mentioned Windows Task Scheduler or Cronsole-native, the
 * only two platforms that actually work. The bookmarks were the whole page; the
 * product was invisible on its own platforms screen.
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
 * evidence behind it, the same division `isSystem` and the Failures view use —
 * re-deriving a judgement client-side is the shape that silently took a folder
 * out of every sync (troubleshooting #20a).
 *
 * The custom-links section stays: a link-only platform has no connector and
 * nothing to report, and a bookmark is the honest thing to offer for it.
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
  OFFLINE: { label: 'Offline', dot: 'bg-danger', text: 'text-danger-text' }
};

export const PlatformsScreen = () => {
  const [links, setLinks] = useState<PlatformLink[]>(() => {
    const saved = localStorage.getItem('cronsole_platform_links');
    if (saved) return JSON.parse(saved);
    return [
      { id: 'claude', name: 'Claude Routines', url: 'https://claude.ai/code/routines', iconType: 'claude' },
      { id: 'chatgpt', name: 'ChatGPT Schedules', url: 'https://chatgpt.com/schedules', iconType: 'chatgpt' },
      { id: 'gemini', name: 'Gemini Scheduled', url: 'https://gemini.google.com/scheduled', iconType: 'gemini' },
    ];
  });

  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const { data, isLoading, isError } = usePlatformMatrix();

  const saveLinks = (newLinks: PlatformLink[]) => {
    setLinks(newLinks);
    localStorage.setItem('cronsole_platform_links', JSON.stringify(newLinks));
  };

  const addLink = () => {
    if (!newName || !newUrl) return;
    saveLinks([...links, {
      id: Date.now().toString(),
      name: newName,
      url: newUrl.startsWith('http') ? newUrl : `https://${newUrl}`,
      iconType: 'custom'
    }]);
    setNewName('');
    setNewUrl('');
    setShowAdd(false);
  };

  const deleteLink = (id: string) => saveLinks(links.filter(l => l.id !== id));

  return (
    <div className="space-y-10 animate-in fade-in duration-500 pb-20">
      <div>
        <h2 className="text-2xl font-bold mb-1 flex items-center gap-1.5">
          Platforms
          <HelpButton topic="platforms" size="md" />
        </h2>
        <p className="text-muted-foreground">
          What Cronsole can do with each connected platform, and how it knows.
        </p>
      </div>

      <section className="space-y-4 max-w-5xl">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h3 className="text-[10px] font-black text-subtle-foreground uppercase tracking-[0.2em] ml-1">
            Capability matrix
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

        {data?.platforms.map(row => <PlatformMatrixCard key={row.platform} row={row} />)}
      </section>

      <section className="space-y-4 max-w-5xl">
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
      </section>
    </div>
  );
};

const PlatformMatrixCard = ({ row }: { row: PlatformMatrixRow }) => {
  const [expanded, setExpanded] = useState(false);
  const health = row.healthState ? HEALTH_STYLE[row.healthState] : null;
  const verifiedCount = row.capabilities.filter(c => c.support === 'verified').length;
  const declaredCount = row.capabilities.filter(c => c.support === 'declared').length;
  const failing = row.capabilities.filter(
    c => c.lastFailureAt && (!c.lastSuccessAt || c.lastFailureAt > c.lastSuccessAt)
  );

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
              {/* Per-platform help, on the screen that is *about* platforms —
                  so "what can this one actually do, and what can it never do?"
                  is answered next to the matrix that raises the question. */}
              <HelpButton topic={sourceTopicId(row.platform)} />
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

      {link.iconType === 'custom' && (
        <button
          onClick={e => { e.preventDefault(); onDelete(link.id); }}
          aria-label={`Remove the ${link.name} link`}
          title="Remove link"
          className="absolute -right-3 top-1/2 -translate-y-1/2 p-2 bg-background border border-border rounded-full text-subtle-foreground hover:text-danger-text opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all shadow-lg z-10"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
};
