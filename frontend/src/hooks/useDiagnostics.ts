import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown';

export interface DiagnosticFact {
  label: string;
  value: string;
}

export interface DiagnosticCheck {
  id: string;
  title: string;
  status: CheckStatus;
  summary: string;
  facts: DiagnosticFact[];
  remedy?: string;
  /** Repo-relative doc path (+anchor). The UI prepends `DOCS_BASE`. */
  doc?: string;
}

export interface DiagnosticsReport {
  generatedAt: string;
  measuredOn: { kind: 'host' | 'container'; hostname: string; os: string; summary: string };
  checks: DiagnosticCheck[];
  counts: Record<CheckStatus, number>;
  worst: CheckStatus;
}

/**
 * The system report behind "why isn't this working?".
 *
 * **Fetched on demand, never polled.** Every other status surface in the app is
 * on a timer because it answers a question the user has standing (is the agent
 * up?); this one answers a question they only ask when something looks wrong, and
 * putting it on an interval would run eight checks a minute per open tab to
 * produce a panel nobody is reading. `enabled` is the modal being open.
 *
 * `staleTime: 0` for the same reason it is not polled: when it *is* open, the
 * whole point is the state right now, so a cached copy from when the modal was
 * last closed would be answering about a moment the reader has already left.
 */
export function useDiagnostics(enabled: boolean) {
  return useQuery<DiagnosticsReport>({
    queryKey: ['diagnostics'],
    queryFn: async () => (await api.get('/tools/diagnostics')).data,
    enabled,
    staleTime: 0,
    // A diagnostics report that silently serves a stale copy on remount is the
    // one kind of staleness this feature cannot afford.
    refetchOnMount: 'always'
  });
}

/**
 * Colours and words for a check status.
 *
 * `unknown` is deliberately **neutral, not amber**. It is the absence of a
 * verdict rather than a mild problem, and amber would make missing information
 * look like something to go and fix — the same call `healthMeta` makes for
 * `HealthState.UNKNOWN`, for the same reason.
 */
export const statusMeta = (
  status: CheckStatus
): { label: string; dot: string; text: string; border: string } => {
  switch (status) {
    case 'pass':
      return { label: 'OK', dot: 'bg-success', text: 'text-success-text', border: 'border-success/30' };
    case 'warn':
      return { label: 'Check', dot: 'bg-warning', text: 'text-warning-text', border: 'border-warning/40' };
    case 'fail':
      return { label: 'Problem', dot: 'bg-danger', text: 'text-danger-text', border: 'border-danger/40' };
    default:
      return {
        // "Not measured", never "Unknown": it says why there is no verdict rather
        // than only that there isn't one.
        label: 'Not measured',
        dot: 'bg-muted',
        text: 'text-muted-foreground',
        border: 'border-border'
      };
  }
};
