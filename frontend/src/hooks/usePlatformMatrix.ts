import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

/**
 * The platform capability matrix from `GET /api/tools/platforms` — what Cronsole
 * can do with each platform, and the evidence behind each claim.
 *
 * One hook because two surfaces read it: the Platforms tab renders the whole
 * matrix, and the dashboard's health strip renders the newest event out of it.
 * Two queries would eventually become two shapes, and the strip and the tab
 * disagreeing about the same fact is worse than either being absent.
 */

export type CapabilitySupport = 'verified' | 'declared' | 'unsupported';

export interface CapabilityCell {
  verb: string;
  label: string;
  description: string;
  support: CapabilitySupport;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
}

export interface PlatformMatrixRow {
  platform: string;
  label: string;
  summary: string;
  maturity: 'functional' | 'experimental';
  configured: boolean;
  isActive: boolean;
  healthState: string | null;
  healthReason: string | null;
  /** A real sync timestamp or null. The server never stamps one itself. */
  lastSync: string | null;
  taskCount: number;
  capabilities: CapabilityCell[];
  lastVerifiedAt: string | null;
  /**
   * Where this source's tasks execute — Cronsole-native only, `null` elsewhere.
   *
   * Native jobs run wherever the backend runs: the user's machine on a host-run
   * stack, a container's filesystem in the Dockerized one. The `EXEC` job type
   * makes that difference load-bearing — a path visible in Explorer simply is not
   * there inside a container — so the New Task modal states which it is.
   */
  executionHost: ExecutionHost | null;
}

export interface ExecutionHost {
  kind: 'host' | 'container';
  /** Which signal decided it. A verdict never travels without its evidence. */
  evidence: string;
  summary: string;
  os: string;
  hostname: string;
}

export function usePlatformMatrix() {
  return useQuery<{ platforms: PlatformMatrixRow[] }>({
    queryKey: ['platform-matrix'],
    queryFn: async () => (await api.get('/tools/platforms')).data,
    // The route reads stored evidence and asks no platform anything, so polling
    // harder cannot produce a fresher answer — only more requests.
    refetchInterval: 60_000,
    staleTime: 30_000
  });
}

/**
 * Whether Cronsole can create a task on a platform — three answers, not two.
 *
 * `yes` covers **verified and declared alike**: declared means the route would
 * accept a create and nothing has been observed to work yet, and refusing it
 * would be waiting for evidence that only applying a template can produce.
 * `unknown` is the honest render while the matrix is in flight — absence of an
 * answer is not a "no", and a badge that says "Cronsole can't create here"
 * because a request has not landed yet is the confident lie in miniature.
 */
export type Creatability = 'yes' | 'no' | 'unknown';

/**
 * Read creatability from the **server's** capability matrix.
 *
 * The Templates tab kept its own hardcoded set (`CREATABLE_PLATFORMS =
 * {WINDOWS_TASK_SCHEDULER, TASKHUB_NATIVE}`) until 2026-08-13 — a browser-side
 * copy of a judgement the server already owns, which is the drift shape that
 * silently took a folder out of every sync (troubleshooting #20a). It was wrong
 * in **both** directions within two days: Claude was listed as uncreatable while
 * `create_claude_routine` shipped, and Cronsole-native was listed as creatable
 * while its connector refused every command that was not a URL.
 *
 * The deeper reason it cannot be a constant: for Claude the answer is a property
 * of *this install*, not of the code. With a readable Claude Code session the
 * connector creates routines; without one `create` is a boundary. No literal in
 * this bundle can be right in both worlds.
 */
export function usePlatformCreatability(): {
  creatability: (platform: string) => Creatability;
  isLoading: boolean;
} {
  const { data, isLoading } = usePlatformMatrix();

  const creatability = (platform: string): Creatability => {
    if (!data) return 'unknown';
    const row = data.platforms.find(r => r.platform === platform);
    // Absent from the matrix is a real verdict, not a gap: the matrix covers
    // every platform with a connector, so anything missing (ChatGPT, Jules, and
    // for now macOS) is link-only and has nothing that could create a task.
    if (!row) return 'no';
    const cell = row.capabilities.find(c => c.verb === 'create');
    if (!cell) return 'no';
    return cell.support === 'unsupported' ? 'no' : 'yes';
  };

  return { creatability, isLoading };
}

/** One thing Cronsole asked a platform to do, and how it went. */
export interface CommandOutcome {
  platformLabel: string;
  verbLabel: string;
  at: string;
  ok: boolean;
  reason: string | null;
}

/**
 * The most recent verb Cronsole performed against any platform.
 *
 * Deliberately the newest *event*, success or failure — not the newest success.
 * "Last command outcome" that skipped failures would be a status line that gets
 * quieter exactly when something is wrong, which is the class of dishonesty
 * `getHealth` was fixed for (troubleshooting #40).
 *
 * Returns null when nothing has ever been recorded. Absence renders as absence;
 * it is never dressed up as "all good".
 */
export function newestOutcome(rows: PlatformMatrixRow[] | undefined): CommandOutcome | null {
  let best: CommandOutcome | null = null;
  for (const row of rows ?? []) {
    for (const cell of row.capabilities) {
      const candidates: CommandOutcome[] = [];
      if (cell.lastSuccessAt) {
        candidates.push({
          platformLabel: row.label, verbLabel: cell.label,
          at: cell.lastSuccessAt, ok: true, reason: null
        });
      }
      if (cell.lastFailureAt) {
        candidates.push({
          platformLabel: row.label, verbLabel: cell.label,
          at: cell.lastFailureAt, ok: false, reason: cell.lastFailureReason
        });
      }
      for (const c of candidates) {
        if (!best || c.at > best.at) best = c;
      }
    }
  }
  return best;
}
