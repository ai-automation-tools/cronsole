import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import {
  PlatformConnector,
  TaskInfo,
  ConnectorHealth,
  CapabilityVerb,
  SyncOutcome,
  CreateTaskOptions,
  UpdateScheduleOptions,
  PlatformRunsResult,
  PlatformRunOutputResult
} from './platform.interface.js';
import {
  listTriggers,
  listExecutions,
  runTrigger,
  patchTrigger,
  createTrigger,
  deleteTrigger,
  getInteraction,
  isPendingStatus,
  type GeminiTrigger,
  type GeminiExecution
} from '../services/geminiApi.js';
import { readConfig, GEMINI_CATEGORY } from '../services/geminiTriggers.js';
import { shiftCronToUtc } from '../utils/cron.js';

/**
 * **Gemini API Triggers — Cronsole's first hosted controller.**
 *
 * The two hosted sources before it are read-only observers, and the capability
 * matrix's controller half had exactly two inhabitants, both local (Windows
 * through an agent, Cronsole-native through the backend itself). This is the
 * first source Cronsole can *act on* over somebody else's HTTP API, and almost
 * everything interesting about it follows from that one difference.
 *
 * ## Why `run` is real here, when it is refused twice over
 *
 * GitHub Actions and Vercel Cron both name `run` in `unsupportedVerbs`, and both
 * have an endpoint they could have called. A `workflow_dispatch` run is a
 * different event from the scheduled one; hitting a Vercel cron path is an
 * ordinary HTTP request the scheduler never records. In both cases Cronsole
 * would report a success for something that did not happen.
 *
 * `POST /v1beta/triggers/{id}/executions` is not that. It runs the trigger's own
 * agent, with the trigger's own prompt, in the trigger's own environment, and it
 * lands on the same execution list the scheduled runs land on. Google's docs
 * state that pausing a trigger stops its *scheduled* executions while leaving
 * manual ones alone — which is the platform saying the two are one mechanism
 * with two entry points. **That sentence is the whole justification**, and it is
 * why this connector is a controller rather than a third observer.
 *
 * It still returns `ran: false`. Creating an execution starts an agent that will
 * work for minutes; what comes back is an accepted dispatch, exactly like a
 * Windows start. Only Cronsole-native may set `ran: true`, and only because
 * there dispatch and execution are the same act.
 *
 * ## The one thing that does not fit the storage contract
 *
 * A trigger carries `{ schedule, time_zone }` and the zone is the developer's,
 * not the browser's. Cronsole stores 5-field UTC. So:
 *
 * - **Everything Cronsole writes is UTC** — `createTrigger` and `patchTrigger`
 *   send `time_zone: "UTC"` on every schedule they touch, so a round trip
 *   through Cronsole is exact and never accumulates a shift.
 * - **Everything Cronsole reads is normalized**, through `shiftCronToUtc`, with
 *   the platform's original pair kept in `metadata.platformSchedule` /
 *   `platformTimeZone`. A shifted field that does not print what it was shifted
 *   from is troubleshooting #60's shape.
 * - **A schedule that cannot be converted is `null` with a reason**, never a
 *   guessed cron. A zone-crossing expression that pins a day of the month has no
 *   5-field UTC equivalent, and emitting a plausible one would fire on the wrong
 *   date silently.
 *
 * ## What is deliberately not here
 *
 * `updateSchedule`, `updateActions`, `exportTask`, `importTask` and `listFolders`
 * are absent, so `verbReachability` reports them `unsupported` from their absence
 * — one statement of each boundary, as the interface intends.
 *
 * **`updateSchedule` is a boundary rather than a gap, and it was found by driving
 * the API rather than by reading it.** `PATCH /v1beta/triggers/{id}` is documented
 * as the update endpoint and it is real — it takes `status` and `display_name` —
 * but it answers `400 Unknown parameter 'schedule'` to the one field a reschedule
 * is made of, and there is no `PUT` and no field mask that changes that. So a
 * trigger's *when* is fixed at create time on `v1beta`: the honest paths are
 * delete-and-recreate (a new `externalId`, so not a reschedule) or Google's own
 * console. Declaring the verb bought nothing but a failure that handed Google's
 * word `schedule` back to a user who never typed it.
 *
 * `unsupportedVerbs` is **empty**, and that is the point of the whole platform:
 * every verb the interface mandates is reachable here — and `updateSchedule`,
 * which is optional, is not one of them. Editing a trigger's *action* — its
 * prompt, agent, environment and network allowlist — is the one verb that is
 * genuinely *not yet* rather than *cannot*, and it is absent rather than
 * declared, so the cell can change when Cronsole grows a form that can hold one.
 */
export class GeminiTriggersConnector implements PlatformConnector {
  platform = PlatformType.GEMINI_TRIGGERS;

  /**
   * **Empty, and that is a claim rather than an oversight.**
   *
   * Every other hosted connector in this repo names two or three verbs it
   * structurally cannot do. This one names none: `sync`, `run`, `create` and
   * `setStatus` each map onto a documented endpoint that does the thing the verb
   * says. Leaving the array off entirely would have read the same to
   * `verbReachability`, and it is written out so the difference between "no
   * boundaries" and "nobody thought about boundaries" is on the page.
   *
   * It stays empty now that `updateSchedule` has turned out to be impossible,
   * because that verb is **optional** on the interface and an optional boundary is
   * stated by absence — the same rule GitHub's connector follows in the other
   * direction, naming only the three *mandated* verbs it must refuse out loud.
   */
  readonly unsupportedVerbs: readonly CapabilityVerb[] = [];

  /**
   * The one category every trigger lands in.
   *
   * **Declared, like GitHub's and Vercel's, and a constant because the platform
   * is flat.** Those two read a list of repositories or projects out of the
   * config, because that list is the gesture by which the user said what to
   * track. Here there is no such gesture: an API key is scoped to one Google
   * Cloud project and sees all of its triggers, so the tracked set is "everything"
   * and the category is a single constant.
   *
   * Implementing it at all still matters. The default — derive the include-set
   * from stored rows — is what made a freshly added GitHub repository import
   * nothing forever (troubleshooting #75), and a brand-new Gemini connection has
   * no rows either. Without this line the first sync after connecting would
   * filter out every trigger it just read and report success over nothing.
   */
  trackedCategories(): string[] {
    return [GEMINI_CATEGORY];
  }

  /**
   * Every trigger this key can see, with its recent executions.
   *
   * Two requests per trigger plus one for the list, and the per-trigger one is
   * for run evidence — the same bargain `GitHubActionsConnector` makes. A trigger
   * whose executions could not be read is **kept, with `reportsRunResult: false`**,
   * so one rate-limited request cannot flag every trigger in the account. That is
   * the rule that stops absence of evidence from rendering as evidence of
   * absence, one layer down from where `partial` operates.
   *
   * The listing either works or it does not — there is no partial read of a flat
   * list — so `partial` is set only when execution reads failed, which narrows
   * what Cronsole *knows about* each task without narrowing which tasks it saw.
   * Retirement is suppressed for that pass anyway, because a `reconcileMissingTasks`
   * run against a snapshot Cronsole is not fully confident in is the #74 shape.
   */
  async syncTasks(config: any): Promise<SyncOutcome> {
    const { apiKey } = readConfig(config);
    if (!apiKey) return { tasks: [] };

    const listed = await listTriggers(apiKey);
    if (!listed.ok) {
      // The whole read failed. **Throw rather than return `[]`** — an empty list
      // from a connection that has a key is indistinguishable from "every trigger
      // was deleted", and `reconcileMissingTasks` would act on it. Throwing makes
      // `POST /sync` record the failure against the `sync` capability, report it
      // per platform, and skip the reconcile entirely.
      throw new Error(listed.message);
    }

    const triggers = listed.data;
    const notes: string[] = [];
    const warnings: string[] = [];
    /** Triggers whose history could not be read — see {@link SyncOutcome.partial}. */
    let historyFailures = 0;
    /** Schedules the platform stores in a zone Cronsole declined to convert. */
    const unconvertible: string[] = [];
    /** Triggers the platform paused by itself after consecutive failures. */
    const autoPaused: string[] = [];

    const tasks: TaskInfo[] = [];
    for (const trigger of triggers) {
      const runs = await listExecutions(apiKey, trigger.id);
      if (!runs.ok) historyFailures += 1;

      const task = this.toTaskInfo(trigger, runs.ok ? runs.data : null);
      tasks.push(task);

      const reason = (task.metadata as Record<string, unknown>)?.scheduleUnavailableReason;
      if (typeof reason === 'string') unconvertible.push(task.name);
      if (trigger.status === 'disabled') autoPaused.push(task.name);
    }

    notes.push(coverageNote(triggers.length, triggers.length - historyFailures));

    if (historyFailures > 0) {
      warnings.push(
        `Could not read run history for ${historyFailures} of ${triggers.length} trigger` +
          `${triggers.length === 1 ? '' : 's'}. Those show no run results until the next sync — ` +
          'their schedules and status are current.'
      );
    }

    // **Never suppressible**, because it is the opposite of success noise: a
    // trigger whose schedule Cronsole declined to convert shows an empty schedule
    // column, and without this sentence that is indistinguishable from a trigger
    // that has no schedule at all.
    for (const name of unconvertible) {
      warnings.push(
        `${name}: Gemini stores this schedule in a time zone Cronsole could not re-express in UTC, so ` +
          'no schedule is shown for it. The original is on the task, under Platform schedule.'
      );
    }

    // The signal this source exists to surface, said at sync time rather than
    // waiting to be noticed as a grey pill three days later.
    for (const name of autoPaused) {
      warnings.push(
        `${name}: Gemini paused this trigger itself after consecutive failures. It will not run again ` +
          'until it is resumed.'
      );
    }

    return {
      tasks,
      notes,
      warnings,
      // A narrowed *view* of each task rather than of the task list. Retirement is
      // suppressed anyway: the guard costs one pass of staleness and buys back the
      // whole class of #74.
      partial: historyFailures > 0
    };
  }

  /**
   * One trigger as a Cronsole task.
   *
   * `runs` is `null` when the execution read failed — deliberately distinct from
   * `[]`, which means the platform answered and this trigger has never run. Only
   * the second is evidence, and `reportsRunResult` carries the difference.
   */
  private toTaskInfo(trigger: GeminiTrigger, runs: GeminiExecution[] | null): TaskInfo {
    const shifted = trigger.schedule
      ? shiftCronToUtc(trigger.schedule, trigger.timeZone)
      : { cron: null, shifted: false, reason: undefined as string | undefined };

    // `paused` and `disabled` both mean "will not run on its own", which is what
    // Cronsole's DISABLED says. **The difference between them is not lost** — it
    // is in `metadata.platformStatus` and drives its own health signal, because a
    // trigger somebody parked and one the platform switched off after five
    // failures demand opposite actions.
    const active = trigger.status === 'active' || trigger.status === 'unknown';

    // The newest **finished** run, not the newest run. An execution that is still
    // in progress says nothing about health yet, and reporting it as the last
    // outcome hides the real one underneath it.
    const latest = (runs ?? []).find(r => !isPendingStatus(r.status)) ?? null;
    // `isPendingStatus`, not a local list of words: the platform says
    // `in_progress`, and a run still going is not an outcome. Counting one as
    // finished made it the newest `lastStatus`, which the scorer read as a
    // failure it was not.
    const finished = (runs ?? []).filter(r => !isPendingStatus(r.status));

    return {
      externalId: trigger.id,
      // The platform's id when there is no display name. A trigger created by a
      // script often has none, and an empty name renders as a blank row.
      name: trigger.displayName || trigger.id,
      status: active ? 'ACTIVE' : 'DISABLED',
      schedule: shifted.cron,
      // **Never computed locally.** The platform reports it, and a value derived
      // from the cron would disagree with the platform's own queuing with nothing
      // on screen to say which was right — the same call the Claude, GitHub and
      // Vercel connectors make, reached from a fourth direction.
      nextRunTime: trigger.nextRunTime,
      metadata: {
        // The pair the shift came from, always, so a shifted field prints what it
        // was shifted from. Kept even when no shift happened: "stored in UTC" is
        // itself worth being able to see.
        ...(trigger.schedule ? { platformSchedule: trigger.schedule } : {}),
        ...(trigger.timeZone ? { platformTimeZone: trigger.timeZone } : {}),
        ...(shifted.shifted ? { scheduleShiftedToUtc: true } : {}),
        ...(shifted.reason ? { scheduleUnavailableReason: shifted.reason } : {}),
        platformStatus: trigger.status,
        ...(trigger.agent ? { agent: trigger.agent } : {}),
        ...(trigger.input ? { prompt: trigger.input } : {}),
        ...(trigger.environmentType ? { environmentType: trigger.environmentType } : {}),
        ...(trigger.executionTimeoutSeconds
          ? { executionTimeoutSeconds: trigger.executionTimeoutSeconds }
          : {}),
        consecutiveFailureCount: trigger.consecutiveFailureCount,
        ...(trigger.maxConsecutiveFailures
          ? { maxConsecutiveFailures: trigger.maxConsecutiveFailures }
          : {}),
        ...(trigger.status === 'disabled'
          ? {
              disabledReason:
                'Gemini paused this trigger itself after too many consecutive failures. Fix what the ' +
                'agent is failing on, then resume it — resuming does not clear the cause.'
            }
          : {}),
        // **Present-and-boolean, never absent.** `taskHealth` reads an absent key
        // as "Cronsole never asked" rather than "the platform has nothing to say",
        // and the two demand opposite next actions. False here means this sync
        // could not read this trigger's executions, which scores nothing at all
        // rather than reading as "never ran".
        reportsRunResult: runs !== null,
        ...(runs !== null
          ? {
              executionCount: finished.length,
              ...(latest ? { lastStatus: latest.status } : {}),
              ...(latest?.startTime ? { lastRunTime: latest.startTime.toISOString() } : {})
            }
          : {})
      }
    };
  }

  /**
   * Run a trigger now — the real scheduled invocation, not a lookalike.
   *
   * See the class comment for why this is a controller verb here and a refusal on
   * both observers. `ran` stays false: this is an accepted dispatch of an agent
   * that will work for minutes, which is a handshake, not an outcome.
   */
  async runTask(
    externalId: string,
    config: any
  ): Promise<{ success: boolean; ran?: boolean; platformRunId?: string; message?: string }> {
    const { apiKey } = readConfig(config);
    if (!apiKey) {
      return { success: false, ran: false, message: 'No Gemini API key is stored for this connection.' };
    }

    // Noted **before** the request, so a timeout can be answered with evidence
    // rather than with an assumption. One second of slack absorbs clock skew
    // between this process and Google's.
    const dispatchedAt = new Date(Date.now() - 1000);

    const result = await runTrigger(apiKey, externalId);

    if (!result.ok) {
      // **A transport timeout is not a failed dispatch, and here it is usually a
      // successful one.** `POST /executions` does not return when the run is
      // accepted — it holds the connection well past the 20-second client
      // timeout while the agent works, so a manual run of a task that behaves
      // perfectly was reported to the user as *"Run now failed"*, written to
      // `ExecutionLog` as a FAILURE, and shown on the dashboard banner. The
      // platform's own history said `completed` in the same modal.
      //
      // So on a timeout — and only a timeout, `status === null` — ask the
      // platform what actually happened. A new execution started since the
      // request went out is the dispatch, observed rather than assumed. This is
      // the `getHealth` rule applied to a write: report evidence, and where
      // there is none, say so.
      if (result.status === null) {
        const started = await this.executionStartedSince(apiKey, externalId, dispatchedAt);
        if (started) {
          return {
            success: true,
            ran: false,
            platformRunId: started,
            message:
              'Gemini did not answer within the request timeout, but a run started on the platform ' +
              'and is in progress. Its outcome appears in Run History.'
          };
        }
      }
      return { success: false, ran: false, message: result.message };
    }

    return {
      success: true,
      ran: false,
      ...(result.data.executionId ? { platformRunId: result.data.executionId } : {}),
      message: 'Gemini accepted the run. The agent works in the background — its outcome appears on the next sync.'
    };
  }

  /**
   * Did a run start on the platform since this moment? Returns its id.
   *
   * The corroborating read behind the timeout branch above. **Silent on its own
   * failure** — this runs only when something has already gone wrong, and a
   * second error message about the check would replace the first one, which is
   * the one that describes what the user did.
   */
  private async executionStartedSince(
    apiKey: string,
    externalId: string,
    since: Date
  ): Promise<string | null> {
    const runs = await listExecutions(apiKey, externalId);
    if (!runs.ok) return null;

    const started = runs.data.find(r => r.startTime !== null && r.startTime >= since);
    return started?.id ?? null;
  }

  /**
   * Pause or resume a trigger.
   *
   * **A genuine per-resource switch**, which is the thing Vercel does not have —
   * there, crons are enabled for a whole project at once, so a per-task toggle
   * would have been inventing a control.
   *
   * Resuming a trigger the *platform* disabled after consecutive failures is
   * allowed and does exactly what it says: it sets the status back to active
   * without touching whatever the agent was failing on. Refusing it would be
   * Cronsole deciding it knows better; saying nothing would imply the cause was
   * addressed. So the message says which.
   */
  async setTaskStatus(
    externalId: string,
    enabled: boolean,
    config: any
  ): Promise<{ success: boolean; message?: string }> {
    const { apiKey } = readConfig(config);
    if (!apiKey) return { success: false, message: 'No Gemini API key is stored for this connection.' };

    const result = await patchTrigger(apiKey, externalId, { status: enabled ? 'active' : 'paused' });
    if (!result.ok) return { success: false, message: result.message };

    return {
      success: true,
      ...(enabled
        ? {
            message:
              'Trigger resumed. If Gemini had paused it after repeated failures, this clears the pause ' +
              'and not the cause.'
          }
        : {})
    };
  }

  /**
   * Create a trigger.
   *
   * `command` is the **prompt** — the thing the agent is told to do. That is the
   * honest mapping of "what this task runs" onto a platform whose unit of work is
   * a sentence rather than an executable, and it is the same mapping the Claude
   * connector makes.
   *
   * Two things are read from the connection rather than invented:
   *
   * **The agent id** comes from `config.agent`, defaulted to the one Google's
   * docs name today. It is a preview string with a date in it, so compiling it in
   * would mean creates that start failing months later with nothing in Cronsole
   * to change.
   *
   * **The environment gets no network allowlist.** Gemini's own example attaches
   * domains with header transforms — bearer tokens, in effect — to the sandbox.
   * Cronsole creates the plainest environment the API accepts, because widening
   * what an autonomous agent may reach is not a default a task manager picks on
   * someone's behalf. Same rule as `repositoryUrls` for Claude, and the message
   * says where to widen it.
   */
  async createTask(
    name: string,
    schedule: string,
    command: string,
    config: any,
    _options?: CreateTaskOptions
  ): Promise<{ success: boolean; externalId?: string; message?: string; foldersCreated?: string[] }> {
    const { apiKey, agent } = readConfig(config);
    if (!apiKey) {
      return { success: false, foldersCreated: [], message: 'No Gemini API key is stored for this connection.' };
    }
    if (!command.trim()) {
      return {
        success: false,
        foldersCreated: [],
        message:
          'A Gemini trigger needs a prompt — the instruction the agent runs on the schedule. There is ' +
          'no executable to fall back on here.'
      };
    }

    const result = await createTrigger(apiKey, {
      schedule: schedule.trim().replace(/\s+/g, ' '),
      displayName: name,
      agent,
      input: command
    });
    if (!result.ok) return { success: false, foldersCreated: [], message: result.message };

    return {
      success: true,
      externalId: result.data.id,
      // Always empty: this platform has no folders at all, and the field is
      // required rather than optional precisely so a connector cannot stay silent
      // about having created one.
      foldersCreated: [],
      message:
        'Created with no network allowlist, so the agent can reach nothing outside its sandbox. Add ' +
        'domains in Google AI Studio if it needs them.'
    };
  }

  /**
   * Delete a trigger.
   *
   * Idempotent, as the interface requires: a trigger already gone is a success,
   * because the desired end state holds. `geminiApi.deleteTrigger` maps the 404,
   * so the rule lives at the transport where every caller inherits it rather than
   * in each caller.
   */
  async deleteTask(externalId: string, config: any): Promise<{ success: boolean; message?: string }> {
    const { apiKey } = readConfig(config);
    if (!apiKey) return { success: false, message: 'No Gemini API key is stored for this connection.' };

    const result = await deleteTrigger(apiKey, externalId);
    return result.ok ? { success: true } : { success: false, message: result.message };
  }

  /**
   * The runs Gemini itself performed for this trigger.
   *
   * **The first implementation of this verb in the repo, and the platform that
   * makes the case for it.** Cronsole's `ExecutionLog` holds only runs Cronsole
   * performed, which is right — but here almost every run is one the platform
   * did on its own schedule, so the run history tab was correctly reporting
   * *"no recorded runs"* over a trigger that had been working for a week. This
   * reads the platform's own list instead, live, and the UI keeps the two apart.
   *
   * `outputAvailable` is gated on **both** an interaction id and a finished run:
   * an execution in flight has no transcript worth opening, and offering the
   * click anyway spends a request to render nothing.
   */
  async listPlatformRuns(externalId: string, config: any): Promise<PlatformRunsResult> {
    const { apiKey } = readConfig(config);
    if (!apiKey) return { success: false, message: 'No Gemini API key is stored for this connection.' };

    const result = await listExecutions(apiKey, externalId);
    if (!result.ok) return { success: false, message: result.message };

    return {
      success: true,
      runs: result.data.map(run => ({
        id: run.id,
        status: run.status,
        startedAt: run.startTime,
        endedAt: run.endTime,
        outputAvailable: Boolean(run.interactionId) && !isPendingStatus(run.status)
      }))
    };
  }

  /**
   * What one run produced.
   *
   * **Two requests, and the first one is not redundant.** The output lives on an
   * *interaction*, and the only place its id is published is the execution row —
   * there is no `GET /triggers/{id}/executions/{runId}` (it 404s), so the list
   * has to be re-read to resolve one run's id. Caching it on the task was the
   * alternative and it is worse: a stored id is a claim about a resource this
   * connector does not own, and the whole point of this path is that it reads
   * the platform rather than Cronsole's memory of it.
   *
   * A run that exists but has no interaction is **not** an error — it is a run
   * still in flight, or one that failed before producing anything, and both are
   * facts worth stating in their own words.
   */
  async getRunOutput(
    externalId: string,
    runId: string,
    config: any
  ): Promise<PlatformRunOutputResult> {
    const { apiKey } = readConfig(config);
    if (!apiKey) return { success: false, message: 'No Gemini API key is stored for this connection.' };

    const runs = await listExecutions(apiKey, externalId);
    if (!runs.ok) return { success: false, message: runs.message };

    const run = runs.data.find(r => r.id === runId);
    if (!run) {
      return {
        success: false,
        message:
          'Gemini no longer lists that run. Its execution history is bounded, so a run can age out ' +
          'of the list while the task it belongs to is perfectly healthy.'
      };
    }
    if (!run.interactionId) {
      return {
        success: false,
        message: isPendingStatus(run.status)
          ? 'This run is still going. Its output exists once the agent finishes.'
          : `Gemini recorded this run as "${run.status}" but attached no interaction to it, so there is nothing to read.`
      };
    }

    const output = await getInteraction(apiKey, run.interactionId);
    return output.ok ? { success: true, output: output.data } : { success: false, message: output.message };
  }

  /**
   * Health from stored evidence, never from a probe.
   *
   * `getHealth` runs on the dashboard's 45-second poll **per open tab**, and this
   * is a metered API on a free tier. Listing triggers from here would spend that
   * budget on a question the user answers themselves every time they sync — the
   * fifth connector to reach the same conclusion, from a fifth direction:
   * **sync is the user's probe.**
   *
   * So this reads back the `PlatformCapability` row `POST /api/tasks/sync`
   * already writes. Every branch reporting an *absence* of evidence returns
   * `UNKNOWN` rather than `DEGRADED`: never having synced is not a degradation,
   * and amber over something nobody can act on gets read at the same weight as
   * amber over something they should.
   */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const { apiKey } = readConfig(config);

    if (!apiKey) {
      return { state: HealthState.UNKNOWN, reason: 'No Gemini API key stored — nothing has been read yet.' };
    }

    const userId = config?.userId;
    if (typeof userId !== 'string' || !userId) {
      return { state: HealthState.UNKNOWN, reason: 'No evidence: connection is not scoped to a user' };
    }

    let row: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastFailureReason: string | null } | null;
    try {
      row = await prisma.platformCapability.findFirst({
        where: { userId, platform: PlatformType.GEMINI_TRIGGERS, verb: 'sync' },
        select: { lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true }
      });
    } catch {
      // Reading the evidence is not the subject of the check. A DB hiccup here
      // must not be reported as Gemini being unhealthy.
      return { state: HealthState.UNKNOWN, reason: 'Could not read sync history for this platform' };
    }

    const succeeded = row?.lastSuccessAt ?? null;
    const failed = row?.lastFailureAt ?? null;

    if (!succeeded && !failed) {
      return { state: HealthState.UNKNOWN, reason: 'Connected, but nothing has been read yet. Sync to check.' };
    }

    if (failed && (!succeeded || failed > succeeded)) {
      return {
        state: HealthState.DEGRADED,
        reason: row?.lastFailureReason ? `Last sync failed: ${row.lastFailureReason}` : 'Last sync failed',
        // A rejection is contact: Gemini answered, and the answer was no.
        lastContactAt: failed
      };
    }

    return { state: HealthState.HEALTHY, lastContactAt: succeeded ?? undefined };
  }

  // updateActions, exportTask, importTask and listFolders are deliberately
  // absent. Their absence is what makes `verbReachability` report them
  // `unsupported`, so there is exactly one statement of each boundary — see the
  // class comment for which of them are "cannot" and which is "not yet".
}

/**
 * The one sentence that turns "nothing imported" from an ambiguity into a fact.
 *
 * A Gemini key that can list triggers and finds none is a working connection with
 * an empty account — the same screen as a broken sync unless the number is said
 * out loud. That ambiguity hid a real defect on GitHub until the database was
 * read by hand (troubleshooting #75), and it costs one sentence to close.
 *
 * The second number is the one this source can report and neither observer can:
 * how many of those triggers Cronsole also has run history for.
 */
function coverageNote(total: number, withHistory: number): string {
  const word = total === 1 ? 'trigger' : 'triggers';
  if (total === 0) return 'Gemini API Triggers: read 0 triggers — this API key\'s project has none.';
  if (withHistory === total) return `Gemini API Triggers: read ${total} ${word}, with run history for each.`;
  return `Gemini API Triggers: read ${total} ${word}, with run history for ${withHistory}.`;
}
