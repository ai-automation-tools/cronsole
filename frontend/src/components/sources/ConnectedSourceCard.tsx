import { useId, useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { CapabilityCell, PlatformMatrixRow } from '../../hooks/usePlatformMatrix';
import { sourceVisibility } from '../../utils/sourceVisibility';
import { timeAgo } from '../../utils/datetime';
import { ClaudeRoutinesPanel } from '../ClaudeRoutinesPanel';
import { GitHubReposPanel } from '../GitHubReposPanel';
import { VercelProjectsPanel } from '../VercelProjectsPanel';
import { SidebarToggle, SourceHeading, SourceStatusPill, SourceTile, Stat } from './SourceIdentity';
import { SUPPORT_STYLE } from './sourceStyles';

/**
 * A source that is connected: what it can do, what it has actually done, and
 * the evidence behind both.
 *
 * **Summary up front, evidence behind one disclosure** (2026-08-24). The card
 * used to render the four stats, the whole capability chip wall, two
 * explanatory paragraphs and a second disclosure holding the table — so four
 * connected sources filled three screens and the stat you wanted was always
 * below the fold. What stays visible is what you scan: identity, health, and
 * the four numbers. What moved is the per-verb detail, which you go looking for
 * rather than sweep past.
 *
 * **A problem is never behind the disclosure.** `healthReason` and any verb that
 * failed more recently than it succeeded break out above it, always. Collapsing
 * a card is a density decision; it must never become a way for the screen to get
 * quieter exactly when something is wrong — which is the class of dishonesty
 * `getHealth` was fixed for (troubleshooting #40).
 *
 * Nothing here is derived in the browser. The server sends the verdict and the
 * evidence behind it — including `access`, which is a judgement and therefore
 * the server's. Re-deriving one client-side is the shape that silently took a
 * folder out of every sync (troubleshooting #20a).
 */
export const ConnectedSourceCard = ({ row, shownSources, onToggleShown }: {
  row: PlatformMatrixRow;
  shownSources: string[];
  onToggleShown: (platform: string) => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();

  const verified = row.capabilities.filter(c => c.support === 'verified').length;
  const declared = row.capabilities.filter(c => c.support === 'declared').length;
  const failing = row.capabilities.filter(
    c => c.lastFailureAt && (!c.lastSuccessAt || c.lastFailureAt > c.lastSuccessAt)
  );
  const visibility = sourceVisibility(row, shownSources);

  return (
    <article
      data-testid={`platform-row-${row.platform}`}
      className="bg-surface border border-border rounded-2xl overflow-hidden transition-colors duration-150 hover:border-border/80"
    >
      <div className="p-5 space-y-5">
        <div className="flex items-start gap-3.5 flex-wrap sm:flex-nowrap">
          <SourceTile platform={row.platform} />

          <div className="min-w-0 flex-1 space-y-1">
            <SourceHeading row={row} />
            <p className="text-xs text-subtle-foreground leading-relaxed">{row.summary}</p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <SourceStatusPill row={row} />
            <SidebarToggle row={row} visibility={visibility} onToggle={() => onToggleShown(row.platform)} />
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-4 text-[11px] pt-4 border-t border-border">
          <Stat label="Tracked tasks" value={String(row.taskCount)} />
          {/*
            Absent, not "just now". A sync timestamp is only ever a real one:
            Cronsole-native reports none because this database IS its source of
            truth, so it has nothing to be stale against (troubleshooting #40).
          */}
          <Stat label="Last sync" value={row.lastSync ? timeAgo(row.lastSync) : '—'} muted={!row.lastSync} />
          <Stat
            label="Last verified"
            value={row.lastVerifiedAt ? timeAgo(row.lastVerifiedAt) : 'Never'}
            muted={!row.lastVerifiedAt}
          />
          <Stat label="Verified verbs" value={`${verified} of ${row.capabilities.length}`} />
        </dl>

        {row.healthReason && (
          <p className="text-[11px] text-warning-text bg-warning/10 border border-warning/30 rounded-xl px-3 py-2.5 leading-relaxed">
            {row.healthReason}
          </p>
        )}

        {failing.length > 0 && (
          <div className="text-[11px] text-danger-text bg-danger/10 border border-danger/30 rounded-xl px-3 py-2.5 space-y-1.5">
            <p className="font-bold flex items-center gap-1.5">
              <AlertTriangle size={12} className="shrink-0" />
              {failing.length === 1
                ? '1 verb failed more recently than it succeeded'
                : `${failing.length} verbs failed more recently than they succeeded`}
            </p>
            {failing.map(c => (
              <p key={c.verb} className="opacity-90 leading-relaxed">
                <span className="font-bold">{c.label}:</span> {c.lastFailureReason || 'no reason reported'}
              </p>
            ))}
          </div>
        )}
      </div>

      {/*
        Claude is the only platform whose connection a user composes by hand:
        Anthropic issues a bearer token per routine and exposes no API to list
        them, so nothing can be discovered and the registry has to be typed in.
        The panel lives inside the platform's own card because that is where
        someone goes when the card says "Not connected".
      */}
      {row.platform === 'CLAUDE_CODE' && <ClaudeRoutinesPanel />}

      {/*
        GitHub is the second hand-composed connection, and the first read-only
        one. The panel lives in the platform's own card for the same reason
        Claude's does, and it opens by saying what Cronsole will *not* do,
        because a card of `unsupported` cells otherwise reads as a fault rather
        than as the shape of the integration.
      */}
      {row.platform === 'GITHUB_ACTIONS' && <GitHubReposPanel />}

      {/*
        Vercel is the third hand-composed connection and the second read-only
        one. Its panel opens by saying two things rather than GitHub's one: what
        Cronsole will not do, and — the surprise GitHub does not have — that
        Vercel publishes no cron run history, so these tasks stay at `unknown`
        health however well they are running.
      */}
      {row.platform === 'VERCEL_CRON' && <VercelProjectsPanel />}

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full border-t border-border px-5 py-3 text-[11px] font-bold text-subtle-foreground hover:text-foreground hover:bg-raised/60 flex items-center gap-2 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <ChevronDown
          size={13}
          className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`}
        />
        Capabilities and evidence
        <span className="ml-auto flex items-center gap-2.5 tabular-nums font-black">
          <span className="text-success-text">{verified} verified</span>
          {declared > 0 && <span className="text-neutral-text">{declared} unproven</span>}
        </span>
      </button>

      {expanded && (
        <div id={panelId} className="border-t border-border animate-in fade-in slide-in-from-top-1 duration-200">
          <div className="p-5 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {row.capabilities.map(cell => <CapabilityChip key={cell.verb} cell={cell} />)}
            </div>

            {/*
              An observer's struck-through cells need one sentence saying they
              were chosen. Without it a reader has ten refusals and no way to
              tell a finished read-only connector from a broken one — which is
              the whole reason `access` is a declared field rather than a count
              of cells.
            */}
            {row.access === 'observer' && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Read-only <span className="font-bold text-foreground">by design</span>. The struck-through
                capabilities are boundaries this connector chose, not ones waiting to be built.
              </p>
            )}

            {declared > 0 && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {declared === 1
                  ? '1 capability is declared but unproven here — use it once and this card will say so.'
                  : `${declared} capabilities are declared but unproven here — use one and this card will say so.`}
              </p>
            )}
          </div>

          <div className="border-t border-border overflow-x-auto">
            <table className="w-full text-[11px] min-w-[34rem]">
              <thead>
                <tr className="text-left text-subtle-foreground border-b border-border bg-raised/40">
                  <th scope="col" className="font-black uppercase tracking-wider px-5 py-2.5">Capability</th>
                  <th scope="col" className="font-black uppercase tracking-wider px-3 py-2.5">State</th>
                  <th scope="col" className="font-black uppercase tracking-wider px-3 py-2.5 whitespace-nowrap">Last success</th>
                  <th scope="col" className="font-black uppercase tracking-wider px-5 py-2.5">Last failure</th>
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
                        <span className={`inline-block text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border ${style.chip}`}>
                          {style.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground whitespace-nowrap tabular-nums">
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
        </div>
      )}
    </article>
  );
};

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
      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-lg border ${style.chip} ${
        cell.support === 'unsupported' ? 'line-through opacity-70' : ''
      }`}
    >
      <Icon size={10} className="shrink-0" />
      {cell.label}
    </span>
  );
};
