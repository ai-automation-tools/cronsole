import axios from 'axios';
import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import {
  PlatformConnector,
  TaskInfo,
  ConnectorHealth,
  CreateTaskOptions,
  CapabilityVerb
} from './platform.interface.js';

/**
 * **Claude Code Routines** — a routine is a saved prompt + repos + connectors that
 * Anthropic runs on a schedule, on a GitHub event, or when something POSTs to it.
 *
 * The scaffold that stood here since the MVP guessed at an API. Checked against
 * the live docs (2026-08-12) the guess was right about the one endpoint that
 * exists and wrong about everything it implied would follow:
 *
 * > **`POST /v1/claude_code/routines/{trig_id}/fire` is the entire API surface.**
 * > Auth is a per-routine bearer token generated in the claude.ai UI, and the
 * > reference states it plainly: *"One routine only; **no read access**."*
 *
 * There is no list endpoint, no get, no enable/disable, no create, and no token
 * management — the docs say so in as many words. That is not a gap waiting on a
 * beta flag, it is the shape of the product: routines are owned by claude.ai and
 * exposed to the outside world through a single doorbell per routine.
 *
 * Three consequences run through everything below, and each one inverts a habit
 * the other connectors taught:
 *
 * **1. This connector writes but cannot read.** It is the mirror image of the
 * observer shape (GitHub Actions, Vercel Cron) the roadmap plans for everything
 * else — those can read everything and change nothing. `run` is the only verb
 * with a platform behind it; `create` and `setStatus` are declared
 * {@link unsupportedVerbs}, because a cell saying *"declared"* would promise
 * evidence that can never arrive.
 *
 * **2. `syncTasks` is a declared registry, not a sync.** Nothing is fetched. The
 * user pastes each routine's id and token into the connection config, and that
 * list *is* the answer — see {@link syncTasks} for why it is still worth having.
 *
 * **3. Health can only come from firing.** There is no probe: the sole endpoint
 * has a side effect, so "check if this works" and "run the user's routine" are
 * the same request. Health is therefore read back from the evidence the run
 * route already records, never invented — see {@link getHealth}.
 *
 * Expected config (per routine, from the routine's **API trigger** modal):
 * ```
 * { routines: [ { id: 'trig_xxx', token: 'sk-ant-oat01-xxx', name: 'Nightly PR review' } ] }
 * ```
 * `id` is `trig_`-prefixed despite the path calling it `routine_id` — the docs
 * flag that mismatch themselves, and a `routine_`-shaped value is a sign the
 * user copied the wrong identifier.
 */

/** The beta gate the endpoint ships behind. Absent → 400, not 404. */
const ROUTINE_BETA = 'experimental-cc-routine-2026-04-01';

const FIRE_ENDPOINT = (routineId: string) =>
  `https://api.anthropic.com/v1/claude_code/routines/${encodeURIComponent(routineId)}/fire`;

interface DeclaredRoutine {
  id?: unknown;
  token?: unknown;
  name?: unknown;
}

/**
 * Strip the token, keep everything else.
 *
 * Not `{ ...r, token: undefined }`, which is what this used to be: that leaves a
 * `token` key present with an undefined value, and it only stayed out of the DB
 * because `JSON.stringify` happens to drop undefined. A secret surviving in the
 * object graph on a serializer's incidental behaviour is not a decision, and the
 * next thing to touch this metadata may not serialize it the same way.
 */
const withoutToken = (routine: DeclaredRoutine): Record<string, unknown> => {
  const { token: _token, ...rest } = routine;
  return rest;
};

const declaredRoutines = (config: any): DeclaredRoutine[] =>
  Array.isArray(config?.routines) ? config.routines : [];

export class ClaudeConnector implements PlatformConnector {
  platform = PlatformType.CLAUDE_CODE;

  /**
   * Both are hardcoded refusals below, because Anthropic exposes no endpoint for
   * either. Naming them here is what makes the Platforms matrix say `unsupported`
   * rather than `declared` — see `unsupportedVerbs` on the interface.
   *
   * `setStatus` is the one that stings: routines really can be paused, and a
   * paused routine is precisely what makes `/fire` return 400. So Cronsole can
   * *observe* the disabled state (as a run failure) while being unable to read or
   * set it. Pausing stays in the claude.ai UI.
   */
  readonly unsupportedVerbs: readonly CapabilityVerb[] = ['create', 'setStatus'];

  /**
   * The routines the user declared, normalized into tasks.
   *
   * Nothing is fetched — there is no endpoint to fetch from. Calling that a
   * "sync" is generous, and the honest question is whether it should exist at
   * all rather than leaving Claude a quick link like ChatGPT and Jules.
   *
   * It should, for one reason: **a link cannot run anything.** A declared routine
   * gets a real row on the dashboard next to the Windows tasks, a Run button that
   * genuinely fires it, and run history in `ExecutionLog`. That is strictly more
   * than a bookmark, which is the bar the roadmap sets for keeping a connector.
   *
   * What it must not do is imply freshness. Every row is `ACTIVE` because the
   * config says the routine exists, not because the platform confirmed it — a
   * routine deleted in claude.ai still lists here and only reveals itself on the
   * 404 from its next run.
   */
  async syncTasks(config: any): Promise<TaskInfo[]> {
    return declaredRoutines(config)
      .filter(r => typeof r.id === 'string' && r.id.length > 0)
      .map(r => ({
        externalId: r.id as string,
        name: (typeof r.name === 'string' && r.name) || (r.id as string),
        // Declared, not observed. Claude exposes no read API, so this is the
        // user's assertion that the routine exists — never the platform's.
        status: 'ACTIVE' as const,
        // Deliberately absent rather than guessed. A routine's schedule lives in
        // claude.ai and is not readable here; inventing a cron would put a
        // confident next-run time under a task Cronsole does not schedule.
        schedule: null,
        nextRunTime: null,
        metadata: { ...withoutToken(r), declared: true }
      }));
  }

  /**
   * Fire the routine. The one verb with a platform behind it.
   *
   * **No request body.** The endpoint's optional `text` field is delivered to the
   * routine wrapped in a `<routine-fire-payload>` block labelled untrusted, and a
   * routine only acts on it if its saved prompt explicitly says to. This used to
   * send `text: 'Triggered from Cronsole'`, which is inert for most routines and
   * actively harmful for the ones that opt in — an alert-triage routine told to
   * "investigate the alert in the fire payload" would have found our filler
   * string where the alert should be. The body is optional; sending none is both
   * correct and the only thing that cannot displace real context.
   */
  async runTask(
    externalId: string,
    config: any
  ): Promise<{ success: boolean; platformRunId?: string; message?: string }> {
    const routine = declaredRoutines(config).find(r => r.id === externalId);
    if (!routine) {
      return { success: false, message: `Routine ${externalId} is not in this connection's config` };
    }
    if (typeof routine.token !== 'string' || !routine.token) {
      return {
        success: false,
        message:
          'No API token for this routine. Tokens are generated per routine in the claude.ai UI ' +
          '(Edit routine → Add another trigger → API → Generate token) and shown once.'
      };
    }

    try {
      const response = await axios.post(FIRE_ENDPOINT(externalId), undefined, {
        headers: {
          Authorization: `Bearer ${routine.token}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': ROUTINE_BETA
        }
      });

      // Fire-and-forget by design: the endpoint returns as soon as the session is
      // created and never waits for it. So this SUCCESS means "Anthropic accepted
      // the start" — the same caveat Windows carries, and the session URL is the
      // only place the real outcome can be read.
      return {
        success: true,
        platformRunId: response.data?.claude_code_session_id,
        message: response.data?.claude_code_session_url
          ? `Session started: ${response.data.claude_code_session_url}`
          : 'Session started'
      };
    } catch (error: any) {
      return { success: false, message: describeFireError(error) };
    }
  }

  /**
   * Not supported, and not pending. Pausing and resuming a routine happens in the
   * claude.ai UI; no endpoint exists. Declared in `unsupportedVerbs` so the
   * matrix says so rather than showing an unproven cell.
   */
  async setTaskStatus(
    _externalId: string,
    _enabled: boolean,
    _config: any
  ): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Claude Code exposes no API for pausing a routine — the fire endpoint is the whole surface. ' +
        'Pause or resume it at claude.ai/code/routines.'
    };
  }

  /**
   * Health from evidence, or no claim at all.
   *
   * This used to return HEALTHY whenever the config held a routine — a verdict
   * derived from a *precondition*, which cannot change when the platform fails.
   * That is troubleshooting #40 exactly, and the old comment here admitted it.
   *
   * The fix cannot be "probe it", because **the only endpoint has a side effect**:
   * checking whether a routine works and running the user's routine are the same
   * HTTP request. A connector that probed on every health poll would fire the
   * user's nightly PR review every thirty seconds and burn their daily run cap.
   *
   * So health is read back from the evidence the run route already records in
   * `PlatformCapability` — the same rows the Platforms matrix reads. Nothing new
   * is stored and nothing is stamped by the observer: a fire either happened or
   * it didn't.
   *
   * Before the first run there is genuinely nothing to report. `DEGRADED` with a
   * reason naming why is the closest the three-value `HealthState` enum gets to
   * *unknown*; erring pessimistic-with-an-explanation is the safe direction,
   * since the failure it prevents is trusting a config that was never checked.
   * The missing `UNKNOWN` state is logged as its own item — Windows has the same
   * gap, stamping HEALTHY at auto-init before the agent has ever spoken.
   */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const routines = declaredRoutines(config);
    if (routines.length === 0) {
      return { state: HealthState.DEGRADED, reason: 'No routines configured' };
    }

    const userId = config?.userId;
    if (typeof userId !== 'string' || !userId) {
      return { state: HealthState.DEGRADED, reason: 'No evidence: connection is not scoped to a user' };
    }

    // `run` is the only verb that reaches the platform, so it is the only verb
    // whose evidence says anything about whether this connection works.
    let evidence: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastFailureReason: string | null } | null =
      null;
    try {
      evidence = await prisma.platformCapability.findUnique({
        where: { userId_platform_verb: { userId, platform: PlatformType.CLAUDE_CODE, verb: 'run' } },
        select: { lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true }
      });
    } catch {
      // Reading the evidence is not the subject of the check. A DB hiccup here
      // must not be reported as the platform being unhealthy.
      return { state: HealthState.DEGRADED, reason: 'Could not read run history for this platform' };
    }

    const succeeded = evidence?.lastSuccessAt ?? null;
    const failed = evidence?.lastFailureAt ?? null;

    if (!succeeded && !failed) {
      return {
        state: HealthState.DEGRADED,
        reason:
          `${routines.length} routine${routines.length === 1 ? '' : 's'} configured, none fired yet. ` +
          'Claude Code exposes no read API, so a routine can only be verified by running it.'
      };
    }

    if (failed && (!succeeded || failed > succeeded)) {
      return {
        state: HealthState.DEGRADED,
        reason: evidence?.lastFailureReason
          ? `Last run failed: ${evidence.lastFailureReason}`
          : 'Last run failed',
        // The last time Anthropic answered us at all — a rejection is contact.
        lastContactAt: failed
      };
    }

    return { state: HealthState.HEALTHY, lastContactAt: succeeded ?? undefined };
  }

  /**
   * Not supported, and not pending. Routines are created at claude.ai/code/routines
   * or with `/schedule` in the Claude Code CLI; there is no create endpoint.
   */
  async createTask(
    _name: string,
    _schedule: string,
    _command: string,
    _config: any,
    _options?: CreateTaskOptions
  ): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Claude Code exposes no API for creating a routine. Create it at claude.ai/code/routines ' +
        '(or with /schedule in the Claude Code CLI), then add its id and API token here.'
    };
  }
}

/**
 * Turn a fire failure into something that names the actual cause.
 *
 * Every one of these arrived as an opaque `error.message` before, which mattered
 * most for the two that are not really errors at all: a **paused routine** is a
 * 400 and is the *only* signal Cronsole ever gets about a routine's enabled
 * state, and a **429** is a quota boundary rather than a broken config. Telling
 * a user "Bad Request" when their routine is simply paused sends them to debug
 * the token.
 */
function describeFireError(error: any): string {
  const status: number | undefined = error?.response?.status;
  const apiMessage: string | undefined = error?.response?.data?.error?.message;
  const retryAfter = error?.response?.headers?.['retry-after'];

  switch (status) {
    case 400:
      // The docs give this status three causes; a paused routine is by far the
      // most likely one to reach a user, and the least self-explanatory.
      return (
        `Refused (400): ${apiMessage ?? 'invalid request'}. ` +
        'Most often the routine is paused — resume it at claude.ai/code/routines.'
      );
    case 401:
      return 'Token rejected (401). Each token is scoped to one routine and is revoked when regenerated.';
    case 403:
      return 'No access (403). Routines need a Pro, Max, Team or Enterprise plan with Claude Code on the web enabled.';
    case 404:
      return 'Routine not found (404). It may have been deleted in claude.ai, or the id is not the trig_ value.';
    case 429:
      return (
        'Run limit reached (429)' +
        (retryAfter ? `, retry after ${retryAfter}s` : '') +
        '. Routine runs draw on a daily cap plus your Claude Code subscription usage.'
      );
    case 500:
      return 'Anthropic server error (500). Safe to retry with backoff.';
    case 503:
      // Worth naming: the Claude Platform returns 529 for this; this endpoint
      // returns 503, so a shared "is it 529?" check would miss it.
      return 'Anthropic temporarily overloaded (503). Retry shortly.';
    default:
      return apiMessage ?? error?.message ?? 'Unknown error firing routine';
  }
}
