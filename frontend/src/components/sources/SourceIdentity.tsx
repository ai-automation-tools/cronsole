import { createElement } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { platformAccent, sourceIcon } from '../../platform';
import type { PlatformMatrixRow } from '../../hooks/usePlatformMatrix';
import type { sourceVisibility } from '../../utils/sourceVisibility';
import { HelpButton } from '../HelpButton';
import { sourceTopicId } from '../../data/help';
import { ACCESS_STYLE, BADGE_BASE, EXPERIMENTAL_CHIP, healthStyle } from './sourceStyles';

/**
 * The parts every source card shares: the glyph, the name and its badges, the
 * health readout, and the sidebar switch.
 *
 * Three cards draw a source — connected, waiting to be set up, and on offer —
 * and they must agree on what a source *looks like*, or the same platform reads
 * as three different things while you move between two tabs.
 *
 * **Identity is the tile; status is the pill.** They are deliberately two
 * separate marks in two separate colour families: `--claude` and `--github` say
 * *which* source this is, `--success` and `--danger` say how it is doing. One
 * mark carrying both is how a brand colour starts being read as a verdict.
 */

/** The platform's glyph in the platform's own colour. */
export const SourceTile = ({ platform, size = 'md' }: {
  platform: string;
  size?: 'sm' | 'md';
}) => {
  const accent = platformAccent(platform);
  const box = size === 'sm' ? 'h-9 w-9 rounded-lg' : 'h-11 w-11 rounded-xl';

  return (
    <span className={`${box} ${accent.tile} shrink-0 grid place-items-center`}>
      {/* `createElement` rather than binding the lookup to a capitalised local
          and rendering `<Icon />`: the glyph is chosen per platform at render
          time, which `react-hooks/static-components` reads as declaring a
          component inside a component. It is one element, not a component. */}
      {createElement(sourceIcon(platform), { size: size === 'sm' ? 16 : 19, strokeWidth: 2 })}
    </span>
  );
};

/** Name, per-source help, and the two badges that qualify it. */
export const SourceHeading = ({ row, as: Tag = 'h4' }: {
  row: PlatformMatrixRow;
  as?: 'h3' | 'h4';
}) => {
  const access = ACCESS_STYLE[row.access];

  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <Tag className="font-bold text-[15px] leading-tight truncate">{row.label}</Tag>
      {/* Per-source help, on the screen that is *about* sources — so "what can
          this one actually do, and what can it never do?" is answered next to
          the card that raises the question. */}
      <HelpButton topic={sourceTopicId(row.platform)} />
      <span title={access.hint} className={`${BADGE_BASE} ${access.chip}`}>{access.label}</span>
      {row.maturity === 'experimental' && (
        <span
          title="The API underneath this connector is still moving. Independent of what it can do."
          className={`${BADGE_BASE} ${EXPERIMENTAL_CHIP}`}
        >
          Experimental
        </span>
      )}
    </div>
  );
};

/**
 * Health, or the honest absence of it.
 *
 * **Never connected and connected-but-offline are different facts**, and only
 * one of them is something to go fix — so an unconfigured source gets its own
 * flat readout rather than borrowing `OFFLINE`'s red.
 */
export const SourceStatusPill = ({ row }: { row: PlatformMatrixRow }) => {
  if (!row.configured) {
    return (
      <span className={`${PILL_BASE} bg-muted/40 text-muted-foreground border-border`}>
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
        Not connected
      </span>
    );
  }

  const health = healthStyle(row.healthState);
  return (
    <span className={`${PILL_BASE} ${health.pill}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
      {health.label}
    </span>
  );
};

/** One geometry for every state, so the readout cannot move when it changes. */
const PILL_BASE =
  'inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-lg border whitespace-nowrap';

/**
 * Show or hide this source in the rail.
 *
 * **Disabled rather than absent when something is holding it visible.** A
 * control that vanishes when you go looking for it reads as a bug; one that
 * explains itself reads as a rule — and the rule is worth stating, because "a
 * source with tasks cannot be hidden" is the reason hiding is safe to offer.
 */
export const SidebarToggle = ({ row, visibility, onToggle }: {
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
      className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1.5 rounded-lg border border-border text-subtle-foreground hover:text-foreground hover:bg-raised disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-subtle-foreground transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {visibility.shown ? <Eye size={11} /> : <EyeOff size={11} />}
      {visibility.shown ? 'In sidebar' : 'Hidden'}
    </button>
  );
};

/** A labelled figure. `tabular-nums` so a column of them does not shimmer. */
export const Stat = ({ label, value, muted = false }: {
  label: string;
  value: string;
  muted?: boolean;
}) => (
  <div className="min-w-0">
    <dt className="text-subtle-foreground font-bold uppercase tracking-wider text-[9px]">{label}</dt>
    <dd className={`font-bold mt-1 tabular-nums truncate ${muted ? 'text-muted-foreground' : 'text-foreground'}`}>
      {value}
    </dd>
  </div>
);
