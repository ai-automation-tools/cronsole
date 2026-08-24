import { useId, useState } from 'react';
import { ChevronDown, Info, Plus } from 'lucide-react';
import type { PlatformMatrixRow } from '../../hooks/usePlatformMatrix';
import { sourceVisibility } from '../../utils/sourceVisibility';
import { sourceSetupHint } from '../../platform';
import { ClaudeRoutinesPanel } from '../ClaudeRoutinesPanel';
import { GitHubReposPanel } from '../GitHubReposPanel';
import { VercelProjectsPanel } from '../VercelProjectsPanel';
import { SidebarToggle, SourceHeading, SourceStatusPill, SourceTile } from './SourceIdentity';

/**
 * The two shapes a source takes before it is connected.
 *
 * Deliberately **not** the full matrix card. Every capability cell on an
 * unconnected source is `declared` — nothing has been tried, because nothing is
 * connected — so a matrix here is ten chips carrying no information, and it was
 * the loudest thing on the card that had the least to say.
 *
 * The two are one file because they are one question asked twice: *this source
 * is not connected — what now?* The answer differs only in whether you have
 * asked for the source yet.
 */

/**
 * A source you added to your sidebar that has nothing connected behind it.
 *
 * **The state this redesign exists for.** It used to render a full capability
 * matrix with the words "Not connected" in the corner, which names the problem
 * and offers nothing to do about it. Now the card leads with the one sentence
 * that says what would actually connect it, and then splits on a real
 * difference rather than on copy:
 *
 *  - **Composed by hand** (Claude, GitHub) — there is something to fill in, so
 *    *Set up* opens that panel right here.
 *  - **Connects itself** (Windows, Cronsole-native) — nothing to type; the
 *    connection appears when the agent dials in or the backend comes up. There
 *    is no button, because a *Connect* button that cannot connect anything is
 *    worse than the sentence explaining why.
 */
export const PendingSourceCard = ({ row, shownSources, onToggleShown }: {
  row: PlatformMatrixRow;
  shownSources: string[];
  onToggleShown: (platform: string) => void;
}) => {
  const setup = sourceSetupHint(row.platform);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const visibility = sourceVisibility(row, shownSources);

  return (
    <article
      data-testid={`pending-source-${row.platform}`}
      className="bg-surface border border-border rounded-2xl overflow-hidden"
    >
      <div className="p-5 space-y-4">
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

        <div className="flex items-start gap-2.5 text-[11px] text-muted-foreground bg-raised border border-border rounded-xl px-3 py-2.5 leading-relaxed">
          <Info size={13} className="shrink-0 mt-0.5 text-subtle-foreground" />
          <p>{setup.hint}</p>
        </div>

        {setup.hasPanel && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={false}
            aria-controls={panelId}
            className="bg-primary hover:bg-primary-hover text-primary-foreground px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all duration-150 active:scale-[0.98] shadow-lg shadow-primary/20 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Set up {row.label}
          </button>
        )}
      </div>

      {setup.hasPanel && open && (
        <div id={panelId}>
          {/*
            The same panels the connected card holds, so setting a source up and
            maintaining it later are the same surface rather than two that drift.
          */}
          {row.platform === 'CLAUDE_CODE' && <ClaudeRoutinesPanel />}
          {row.platform === 'GITHUB_ACTIONS' && <GitHubReposPanel />}
          {row.platform === 'VERCEL_CRON' && <VercelProjectsPanel />}

          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-expanded
            aria-controls={panelId}
            className="w-full border-t border-border px-5 py-2.5 text-[11px] font-bold text-subtle-foreground hover:text-foreground hover:bg-raised/60 flex items-center gap-1.5 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <ChevronDown size={12} className="shrink-0" />
            Close setup
          </button>
        </div>
      )}
    </article>
  );
};

/**
 * A source you have not added: what it is, what shape it is, and one button.
 *
 * Adding is only ever a *listing* gesture — it puts the source in your sidebar
 * and in the group above so it has somewhere to be set up from. It connects
 * nothing, so the button says so.
 */
export const OfferSourceCard = ({ row, onAdd }: {
  row: PlatformMatrixRow;
  onAdd: () => void;
}) => (
  <article
    data-testid={`available-source-${row.platform}`}
    className="bg-surface border border-border rounded-2xl p-5 flex flex-col gap-3 transition-colors duration-150 hover:border-border/80"
  >
    <div className="flex items-start gap-3">
      <SourceTile platform={row.platform} size="sm" />
      <div className="min-w-0 flex-1 pt-0.5">
        <SourceHeading row={row} />
      </div>
    </div>

    <p className="text-xs text-subtle-foreground leading-relaxed flex-1">{row.summary}</p>

    <button
      type="button"
      onClick={onAdd}
      className="self-start bg-muted hover:bg-primary hover:text-primary-foreground px-3.5 py-2 rounded-lg text-[13px] font-bold flex items-center gap-1.5 transition-all duration-150 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      <Plus size={14} /> Add to sidebar
    </button>
  </article>
);
