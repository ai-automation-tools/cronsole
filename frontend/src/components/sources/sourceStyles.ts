import { Check, HelpCircle, Minus, type LucideIcon } from 'lucide-react';
import type { CapabilitySupport, PlatformMatrixRow } from '../../hooks/usePlatformMatrix';

/**
 * The three vocabularies the Sources tab renders — capability support, health,
 * and access — in one place because three cards read them.
 *
 * They were inline in `SourcesScreen` while it was the only reader. It is not:
 * a connected card, a card waiting to be set up and an offer card all draw the
 * access badge, and two of them draw health. A second copy of a legend is how
 * "Declared" comes to mean something different two screens apart.
 *
 * **Every colour here is a semantic role token**, never a raw Tailwind palette
 * utility — `bg-amber-500` is one value and cannot be right in both themes,
 * which is the whole reason the roles exist (`index.css`).
 */

export const SUPPORT_STYLE: Record<CapabilitySupport, {
  label: string;
  icon: LucideIcon;
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

/**
 * Health, as a pill rather than a bare dot.
 *
 * `pill` and `dot` are separate because the pill is the whole readout and the
 * dot is the colour inside it — the two never come apart, and a status readout
 * may not change its own geometry between states (troubleshooting #43), so
 * every entry here carries the same shape and differs only in colour and word.
 */
export const HEALTH_STYLE: Record<string, { label: string; dot: string; pill: string }> = {
  HEALTHY: { label: 'Online', dot: 'bg-success', pill: 'bg-success/10 text-success-text border-success/30' },
  DEGRADED: { label: 'Degraded', dot: 'bg-warning', pill: 'bg-warning/10 text-warning-text border-warning/30' },
  OFFLINE: { label: 'Offline', dot: 'bg-danger', pill: 'bg-danger/10 text-danger-text border-danger/30' },
  // Kept in step with healthMeta() in hooks/useConnections.ts — two tables for
  // one enum, which is why a state missing from this one renders as the neutral
  // pill rather than as no readout at all.
  UNKNOWN: { label: 'Not checked', dot: 'bg-muted-foreground', pill: 'bg-muted/40 text-muted-foreground border-border' }
};

export const healthStyle = (state: string | null) =>
  (state ? HEALTH_STYLE[state] : null) ?? HEALTH_STYLE.UNKNOWN;

/** What `access` means, in the words someone reading a card needs. */
export const ACCESS_STYLE: Record<PlatformMatrixRow['access'], {
  label: string;
  chip: string;
  hint: string;
}> = {
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

/** The chip every experimental source wears, in one place so it reads alike. */
export const EXPERIMENTAL_CHIP =
  'bg-warning/10 text-warning-text border-warning/30';

/** Shared geometry for the small uppercase badges that sit beside a source name. */
export const BADGE_BASE =
  'text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border whitespace-nowrap';
