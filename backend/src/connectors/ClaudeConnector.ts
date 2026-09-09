import axios from 'axios';
import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import {
  PlatformConnector,
  TaskInfo,
  ConnectorHealth,
  CreateTaskOptions,
  UpdateScheduleOptions,
  CapabilityVerb
} from './platform.interface.js';
import { getClaudeCredential } from '../services/claudeOAuth.js';
import {
  listTriggers,
  createTrigger,
  updateTrigger,
  runTrigger,
  environmentIdFrom,
  promptOf,
  repositoriesOf,
  parseTimestamp,
  type ClaudeTrigger
} from '../services/claudeTriggers.js';

/**
 * **Claude Code Routines** — a routine is a saved prompt + repos + connectors that
 * Anthropic runs on a schedule, on a GitHub event, or when something POSTs to it.
 *
 * ## This connector has two modes, because the platform has two APIs
 *
 * From the MVP until 2026-08-13 this file asserted, in its own header, that
 * `POST /v1/claude_code/routines/{id}/fire` was *"the entire API surface"* — no
 * list, no create, no enable/disable — and built the whole connector around that:
 * `syncTasks` handed back the user's own typed registry, `create` and `setStatus`
 * were declared structurally impossible, and health could only be inferred from
 * whether a fire had worked.
 *
 * That was true of the **documented** API and false of the product. Claude Code
 * itself creates, lists, reschedules and fires routines every time someone runs
 * `/schedule`, through `/v1/code/triggers` — undocumented, beta-gated, and
 * authenticated with the account's own OAuth token rather than a per-routine one.
 *
 * | | **OAuth mode** (door 2) | **Declared mode** (door 1) |
 * |---|---|---|
 * | Credential | the Claude Code account token | a `sk-ant-oat01-…` token per routine |
 * | Available when | a host-run backend can read the CLI's credentials | always |
 * | `syncTasks` | a real read: names, cron, enabled, next run | the user's typed registry |
 * | `create` / `setStatus` / `updateSchedule` | yes | **unsupported** |
 * | `run` | no per-routine token needed | needs the routine's token |
 *
 * **Declared mode is kept, not deprecated.** Door 2 is undocumented and can be
 * withdrawn without notice; a connector that migrated onto it and deleted the
 * fallback would take every user's Claude routines down with it on the day the
 * beta header stops being accepted. Door 1 is slower and narrower and it is
 * *promised*. So the fallback is load-bearing, and
 * {@link ClaudeConnector.mode} is re-read per call rather than fixed at boot —
 * a credential expiring mid-session degrades the connector instead of breaking it.
 *
 * ## What is still impossible, in both modes
 *
 * **Delete.** There is no DELETE endpoint on either door — verified by
 * enumerating the surface, not assumed. A routine can be disabled and forgotten;
 * removing it happens at claude.ai. `deleteTask` is therefore not implemented,
 * and the route refuses rather than leaving an orphaned routine behind.
 */

/** The beta gate on the documented per-routine fire endpoint (door 1). */
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
 * object graph on a serializer's incidental behaviour is not a decision.
 */
const withoutToken = (routine: DeclaredRoutine): Record<string, unknown> => {
  const { token: _token, ...rest } = routine;
  return rest;
};

const declaredRoutines = (config: any): DeclaredRoutine[] =>
  Array.isArray(config?.routines) ? config.routines : [];

/** Verbs door 1 structurally cannot perform. Door 2 can do all of them. */
const DECLARED_MODE_UNSUPPORTED: readonly CapabilityVerb[] = ['create', 'setStatus', 'updateSchedule'];

export type ClaudeConnectorMode = 'oauth' | 'declared';

export class ClaudeConnector implements PlatformConnector {
  platform = PlatformType.CLAUDE_CODE;

  /** Which door is open right now. Re-read per call — see the header. */
  get mode(): ClaudeConnectorMode {
    return getClaudeCredential().credential ? 'oauth' : 'declared';
  }

  /**
   * **A getter, because the answer is a property of this install.**
   *
   * The capability matrix asks "what can Cronsole do with this platform *here*",
   * and the honest answer changes with the credential: without one, `create` is
   * a boundary; with one, it is a verb that works. A fixed array could only ever
   * be right in one of those worlds, and being wrong in the permissive direction
   * is the spec-table lie the matrix exists to prevent.
   *
   * Cheap to call despite the file read behind it — `getClaudeCredential` is
   * memoized, which is the reason that cache exists.
   */
  get unsupportedVerbs(): readonly CapabilityVerb[] {
    return this.mode === 'oauth' ? [] : DECLARED_MODE_UNSUPPORTED;
  }

  /**
   * The routines on the account (OAuth), or the ones the user declared.
   *
   * In **OAuth mode this is a real sync** and everything on the row is the
   * platform's own answer: the routine's name, its cron, whether it is enabled,
   * and when it next runs. Two details are deliberate. `cron_expression` is
   * already 5-field UTC, which is Cronsole's storage contract, so **nothing is
   * converted** anywhere in this path. And `next_run_at` is taken from the API
   * rather than recomputed from the cron, because Anthropic applies up to ~3
   * minutes of scheduling jitter — a locally derived time would disagree with
   * claude.ai forever, with nothing on screen to say which was right.
   *
   * In **declared mode** nothing is fetched, because there is nothing to fetch
   * from: every row is `ACTIVE` because the config says the routine exists, not
   * because the platform confirmed it, and a routine deleted at claude.ai still
   * lists until its next run 404s.
   */
  async syncTasks(config: any): Promise<TaskInfo[]> {
    const { credential } = getClaudeCredential();
    if (credential) {
      const result = await listTriggers(credential.token);
      if (result.ok) return result.data.map(toTaskInfo);
      // Door 2 failed. Fall through to the declaration rather than returning an
      // empty list: an empty sync would untrack every Claude task the user has
      // (or, with exclusions, look like they all vanished) over what may be a
      // transient 500. Absence of an answer is not an answer.
    }
    return declaredRoutines(config)
      .filter(r => typeof r.id === 'string' && r.id.length > 0)
      .map(r => ({
        externalId: r.id as string,
        name: (typeof r.name === 'string' && r.name) || (r.id as string),
        status: 'ACTIVE' as const,
        // Deliberately absent rather than guessed. Without a read API a routine's
        // schedule is not knowable here, and inventing a cron would put a
        // confident next-run time under a task Cronsole does not schedule.
        schedule: null,
        nextRunTime: null,
        metadata: { ...withoutToken(r), declared: true }
      }));
  }

  /**
   * Fire the routine now.
   *
   * OAuth mode needs **no per-routine token** — that is the practical payoff of
   * door 2, and the reason the paste-a-token-per-routine registry stops being
   * the price of admission.
   *
   * Neither path sends a body. The fire endpoints accept an optional `text`
   * delivered to the routine inside a block labelled untrusted, and a routine
   * only acts on it if its saved prompt says to. This used to send
   * `text: 'Triggered from Cronsole'`, which is inert for most routines and
   * actively harmful for the ones that opt in — an alert-triage routine told to
   * "investigate the alert in the fire payload" would find our filler string
   * where the alert should be.
   */
  async runTask(
    externalId: string,
    config: any
  ): Promise<{ success: boolean; platformRunId?: string; message?: string }> {
    const { credential } = getClaudeCredential();
    if (credential) {
      const result = await runTrigger(credential.token, externalId);
      if (result.ok) {
        // Fire-and-forget by design: the endpoint returns as soon as the session
        // is created and never waits for it. SUCCESS means "Anthropic accepted
        // the start" — the same caveat Windows carries.
        return {
          success: true,
          platformRunId: result.data.sessionId,
          message: result.data.sessionId
            ? `Session started: https://claude.ai/code/sessions/${result.data.sessionId}`
            : 'Session started'
        };
      }
      // A routine-specific failure (404, 429, paused) is the platform's answer
      // and stands. Only a surface change falls back to the declared token.
      if (!result.surfaceMoved) return { success: false, message: result.message };
    }
    return this.fireWithRoutineToken(externalId, config);
  }

  /** Door 1: the documented per-routine fire endpoint. */
  private async fireWithRoutineToken(
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
          'No API token for this routine, and no Claude Code session to fall back on. ' +
          'Either sign in with the Claude Code CLI (`/login`) on the machine running Cronsole, ' +
          'or generate a per-routine token at claude.ai (Edit routine → Add another trigger → API).'
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
   * Pause or resume a routine.
   *
   * Impossible through door 1, and the old comment here called it the refusal
   * that stings: routines really can be paused, and a paused routine is exactly
   * what makes `/fire` return 400 — so Cronsole could *observe* the state while
   * being unable to read or set it. Door 2 sets it directly.
   *
   * The update is **partial**, verified against the live API: sending `{enabled}`
   * alone leaves `job_config` and `cron_expression` untouched. That is the fact
   * this method rests on — a replace-semantics endpoint would erase the routine's
   * prompt every time someone clicked Disable.
   */
  async setTaskStatus(
    externalId: string,
    enabled: boolean,
    _config: any
  ): Promise<{ success: boolean; message?: string }> {
    const { credential, reason } = getClaudeCredential();
    if (!credential) {
      return {
        success: false,
        message:
          'Pausing a routine needs a Claude Code session on the machine running Cronsole. ' +
          (reason ?? 'Sign in with the Claude Code CLI (`/login`).') +
          ' Until then, pause it at claude.ai/code/routines.'
      };
    }
    const result = await updateTrigger(credential.token, externalId, { enabled });
    return result.ok ? { success: true } : { success: false, message: result.message };
  }

  /**
   * Change when a routine runs.
   *
   * Takes the **cron** rather than a native trigger: Claude's `cron_expression`
   * is 5-field UTC, the same form Cronsole stores, so this is the one platform
   * where a reschedule is a straight pass-through. `options.trigger` is the
   * Windows-shaped conversion the route also computes; it is deliberately
   * ignored here, since converting to a Windows trigger and back could only lose
   * information a cron already expresses exactly.
   */
  async updateSchedule(
    externalId: string,
    cron: string,
    _config: any,
    _options?: UpdateScheduleOptions
  ): Promise<{ success: boolean; message?: string; clientError?: boolean }> {
    const { credential, reason } = getClaudeCredential();
    if (!credential) {
      return {
        success: false,
        clientError: true,
        message:
          'Editing a routine\'s schedule needs a Claude Code session on the machine running Cronsole. ' +
          (reason ?? 'Sign in with the Claude Code CLI (`/login`).') +
          ' Until then, edit it at claude.ai/code/routines.'
      };
    }
    const result = await updateTrigger(credential.token, externalId, { cronExpression: cron });
    return result.ok ? { success: true } : { success: false, message: result.message };
  }

  /**
   * Create a routine.
   *
   * `command` is the routine's **prompt** — the whole of what it will do. That
   * is the one place this connector's shape diverges sharply from the others: a
   * Windows task's command is an executable and arguments, and a routine's is
   * natural language, so none of the no-shell `StructuredAction` machinery
   * applies or is needed (there is no shell here to inject into; the prompt is
   * data delivered to a model in a sandbox Anthropic owns).
   *
   * Two boundaries are honest refusals rather than guesses:
   *
   * **The environment.** A routine runs in a cloud environment, and the id is
   * read back from the account's existing routines rather than looked up through
   * a second authenticated endpoint. An account with no routines has nothing to
   * copy, and Cronsole says so instead of inventing an id that would fail at the
   * first run.
   *
   * **Repositories.** A routine with no `sources` still runs; it simply has no
   * checkout. Cronsole does not guess one, because attaching the wrong
   * repository to an agent with write access is not a mistake a user can see
   * before it happens.
   */
  async createTask(
    name: string,
    schedule: string,
    command: string,
    _config: any,
    options?: CreateTaskOptions
  ): Promise<{ success: boolean; externalId?: string; message?: string; foldersCreated?: string[] }> {
    const { credential, reason } = getClaudeCredential();
    if (!credential) {
      return {
        success: false,
        foldersCreated: [],
        message:
          'Creating a routine needs a Claude Code session on the machine running Cronsole. ' +
          (reason ?? 'Sign in with the Claude Code CLI (`/login`).') +
          ' Alternatively create it at claude.ai/code/routines or with `/schedule` in the CLI, then sync.'
      };
    }

    const existing = await listTriggers(credential.token);
    if (!existing.ok) {
      return { success: false, foldersCreated: [], message: existing.message };
    }
    const environmentId = environmentIdFrom(existing.data);
    if (!environmentId) {
      return {
        success: false,
        foldersCreated: [],
        message:
          'No Claude Code cloud environment found on this account. Create your first routine at ' +
          'claude.ai/code/routines (or with `/schedule`), which sets one up — Cronsole can create the rest.'
      };
    }

    const result = await createTrigger(credential.token, {
      name,
      cronExpression: schedule,
      prompt: command,
      environmentId,
      repositoryUrls: options?.repositoryUrls,
      allowedTools: options?.allowedTools
    });
    if (!result.ok) return { success: false, foldersCreated: [], message: result.message };

    return { success: true, externalId: result.data.id, foldersCreated: [] };
  }

  /**
   * Health from evidence, never from a precondition — and never from a probe.
   *
   * The probe question is settled differently in each mode, for the same reason.
   * Through door 1 the only endpoint **fires the routine**, so "check whether
   * this works" and "run the user's nightly job" are the same HTTP request, and
   * a health poll would burn their daily run cap. Door 2's `listTriggers` is a
   * clean read and *could* be probed — but `getHealth` runs on a 45-second poll
   * per open tab, so probing would put a steady stream of requests on Anthropic's
   * API for a question the user answers themselves whenever they sync. Same
   * conclusion the Windows connector reached: **sync is the user's probe.**
   *
   * So this reads back the `PlatformCapability` evidence the routes already
   * write. Every branch reporting an *absence* of evidence returns UNKNOWN
   * ("Not checked") rather than DEGRADED: never having run is not a degradation,
   * and a warning nobody can act on gets read at the same weight as one they
   * should — after which both get ignored.
   */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const { credential, reason } = getClaudeCredential();
    const routines = declaredRoutines(config);

    if (!credential && routines.length === 0) {
      return {
        state: HealthState.UNKNOWN,
        reason: reason ?? 'No routines configured, and no Claude Code session to read them from'
      };
    }

    const userId = config?.userId;
    if (typeof userId !== 'string' || !userId) {
      return { state: HealthState.UNKNOWN, reason: 'No evidence: connection is not scoped to a user' };
    }

    // In OAuth mode `sync` reaches the platform too, so it is evidence; in
    // declared mode it never leaves the process and says nothing about Anthropic.
    const verbs = credential ? ['sync', 'run'] : ['run'];
    let rows: Array<{ verb: string; lastSuccessAt: Date | null; lastFailureAt: Date | null; lastFailureReason: string | null }>;
    try {
      rows = await prisma.platformCapability.findMany({
        where: { userId, platform: PlatformType.CLAUDE_CODE, verb: { in: verbs } },
        select: { verb: true, lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true }
      });
    } catch {
      // Reading the evidence is not the subject of the check. A DB hiccup here
      // must not be reported as the platform being unhealthy.
      return { state: HealthState.UNKNOWN, reason: 'Could not read run history for this platform' };
    }

    const newest = (pick: (r: (typeof rows)[number]) => Date | null): { at: Date; row: (typeof rows)[number] } | null =>
      rows.reduce<{ at: Date; row: (typeof rows)[number] } | null>((best, row) => {
        const at = pick(row);
        if (!at) return best;
        return !best || at > best.at ? { at, row } : best;
      }, null);

    const succeeded = newest(r => r.lastSuccessAt);
    const failed = newest(r => r.lastFailureAt);

    if (!succeeded && !failed) {
      return {
        state: HealthState.UNKNOWN,
        reason: credential
          ? 'Connected with your Claude Code session; nothing exercised yet. Sync to check.'
          : `${routines.length} routine${routines.length === 1 ? '' : 's'} configured, none fired yet. ` +
            'Without a Claude Code session a routine can only be verified by running it.'
      };
    }

    if (failed && (!succeeded || failed.at > succeeded.at)) {
      return {
        state: HealthState.DEGRADED,
        reason: failed.row.lastFailureReason
          ? `Last ${failed.row.verb} failed: ${failed.row.lastFailureReason}`
          : `Last ${failed.row.verb} failed`,
        // The last time Anthropic answered us at all — a rejection is contact.
        lastContactAt: failed.at
      };
    }

    return { state: HealthState.HEALTHY, lastContactAt: succeeded?.at };
  }

  // deleteTask is deliberately absent. Neither door exposes a DELETE — verified
  // by enumerating the surface, not assumed — so the route refuses rather than
  // reporting a success that leaves the routine running at claude.ai.
}

/** One routine, as Cronsole's task shape. */
function toTaskInfo(trigger: ClaudeTrigger): TaskInfo {
  const repositories = repositoriesOf(trigger);
  const prompt = promptOf(trigger);
  return {
    externalId: trigger.id,
    name: trigger.name || trigger.id,
    status: trigger.enabled ? 'ACTIVE' : 'DISABLED',
    // Already 5-field UTC — Cronsole's storage contract. An empty string means
    // the routine has no schedule (it fires on an event or an API call), which
    // is null here rather than a cron nobody can read.
    schedule: trigger.cron_expression || null,
    // The platform's own answer, jitter included. Never recomputed locally.
    nextRunTime: parseTimestamp(trigger.next_run_at),
    metadata: {
      declared: false,
      ...(prompt ? { prompt } : {}),
      ...(repositories.length ? { repositories } : {}),
      ...(trigger.last_fired_at ? { lastFiredAt: trigger.last_fired_at } : {}),
      // A routine that also has an API trigger — useful to know, and the hint is
      // already redacted by the API (`sk-ant-oat01-Sc4…CQAA`).
      ...(trigger.api_token_hint ? { apiTokenHint: trigger.api_token_hint } : {}),
      url: `https://claude.ai/code/routines/${trigger.id}`
    }
  };
}

/**
 * Turn a door-1 fire failure into something that names the actual cause.
 *
 * Every one of these arrived as an opaque `error.message` before, which mattered
 * most for the two that are not really errors at all: a **paused routine** is a
 * 400 and is the *only* signal door 1 ever gets about a routine's enabled state,
 * and a **429** is a quota boundary rather than a broken config.
 */
function describeFireError(error: any): string {
  const status: number | undefined = error?.response?.status;
  const apiMessage: string | undefined = error?.response?.data?.error?.message;
  const retryAfter = error?.response?.headers?.['retry-after'];

  switch (status) {
    case 400: {
      // The docs give this status three causes — paused routine, missing beta
      // header, oversized `text` — and a paused routine is both the likeliest to
      // reach a user and the least self-explanatory. So the hint is worth having,
      // but ONLY when Anthropic did not already say what was wrong. It used to be
      // appended unconditionally, which produced "invalid routine ID: Refresh
      // sidebar links. Most often the routine is paused…" and sent the user to
      // unpause a routine that was fine. **A specific answer from the platform
      // outranks our most-likely-cause heuristic**; the heuristic fills a
      // silence, it does not talk over one.
      const generic = !apiMessage || /^(invalid request|bad request)\.?$/i.test(apiMessage.trim());
      if (!generic) return `Refused (400): ${apiMessage}`;
      return (
        'Refused (400): the request was rejected without a reason. ' +
        'Most often the routine is paused — resume it at claude.ai/code/routines.'
      );
    }
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
