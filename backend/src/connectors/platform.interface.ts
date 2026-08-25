import { PlatformType, HealthState } from '@prisma/client';
import { WindowsTrigger } from '../utils/scheduler-conversion.js';
import { StructuredAction } from '../utils/commandParser.js';

/**
 * One tool to give a hosted agent at create time.
 *
 * **An input type, deliberately distinct from `GeminiToolSummary`** — the shape
 * read back from the platform. They differ by exactly one field, and that field
 * is the whole reason they are two types: `headers` exists on the way *in* and
 * has no counterpart on the way *out*, because a bearer token is used once in
 * the create call and never read, stored or returned. A single type with an
 * optional `headers` would make "did this one come from a form or from a sync?"
 * a question every reader has to get right.
 */
export interface AgentToolInput {
  /** `mcp_server`, `bash`, `google_search`, … — validated against the platform. */
  type: string;
  /** An MCP server's name, or a function's. */
  name?: string;
  /** An MCP server's endpoint. */
  url?: string;
  /**
   * Headers the platform should send to that MCP server — **bearer tokens**.
   *
   * Travels exactly as far as the create call. Cronsole does not store it, and
   * cannot: the trigger lives on the platform, so the platform holds the
   * credential from that moment on. That is a fact to state at the point of
   * entry, not a limitation to design around — a UI implying the token stays
   * local would be false.
   */
  headers?: Record<string, string>;
}

export interface CreateTaskOptions {
  /**
   * Structured trigger produced by convertCronToWindowsTrigger. Platform
   * connectors that register native triggers (e.g. Windows Task Scheduler)
   * should prefer this over re-parsing the raw cron string.
   */
  trigger?: WindowsTrigger | null;
  /**
   * Structured { executable, args[] } action resolved server-side from raw
   * template parameters (utils/templateCommand.ts). Connectors that execute
   * commands should prefer this over re-tokenizing the `command` string, so a
   * parameter value can never split into extra arguments.
   */
  action?: StructuredAction;
  /**
   * A complete Cronsole-native job spec, for a template whose action cannot be
   * expressed as a command line — SCRIPT (the body is the template) and CHECK
   * (a probe with expectations). Cronsole-native only; every other connector
   * ignores it.
   *
   * When present it **replaces** the command-derived job entirely, so a template
   * stores the spec the executor will read rather than one re-guessed from a
   * display string at apply time.
   */
  nativeJob?: unknown;
  /**
   * Normalized native folder to create the task in — Windows Task Scheduler
   * only (e.g. `\Cronsole`, `\Work\Backups`). Defaults to `\Cronsole` when unset.
   * Must already have passed windowsTaskFolderError: it is part of the signed
   * command, and the agent re-validates it before registering.
   */
  folder?: string;
  /**
   * Create `folder` when its chain is missing, instead of refusing the create.
   * Windows Task Scheduler only, and **false by default** — this is the second
   * and last carve-out to "Cronsole creates only `\Cronsole`" (the first being
   * restore's `createFolders`).
   *
   * It is part of the signed command, because the agent is elevated: a folder it
   * creates carries an administrator ACE and needs administrator rights to
   * remove (troubleshooting #28). It never widens *where* a task may go —
   * `\Microsoft\` is refused by windowsTaskFolderError here and independently by
   * the agent, with or without this flag.
   */
  createFolder?: boolean;
  /**
   * Git repositories a Claude Code routine may check out and work in.
   *
   * Meaningless on Windows, where a task's "action" is an executable. Never
   * defaulted or guessed: a routine with no sources still runs, it simply has no
   * checkout, whereas attaching the *wrong* repository to an agent with write
   * access is not a mistake the user can see before it happens.
   */
  repositoryUrls?: string[];
  /**
   * What a hosted agent may use and reach — **Gemini API Triggers only**.
   *
   * Sits beside `repositoryUrls` and follows the same rule for the same reason:
   * **never defaulted, never guessed**. A trigger with no tools still runs; one
   * handed the wrong reach is a mistake nobody can see until an autonomous agent
   * has already acted on it. Cronsole's own default remains the plainest
   * environment the API accepts.
   *
   * `headers` on an MCP server is the one field here that is a **credential**,
   * and it is `agentTools`'s reason for existing as an input type rather than a
   * stored one: the value is used in the create call and **kept nowhere**. See
   * `GeminiToolInput`.
   */
  agentTools?: AgentToolInput[];
  /**
   * Domains a hosted agent's sandbox may contact — Gemini only, same rules.
   *
   * Empty and absent mean the same thing and are both the default: no allowlist,
   * so the sandbox reaches nothing outside itself.
   */
  agentAllowlist?: string[];
  /**
   * Cronsole label to file the created task under — **Cronsole-native only**.
   *
   * Every other platform derives its category from the platform itself (a
   * Windows task's category is the root segment of its folder) and the caller
   * applies the label after the row exists. Native has nothing to derive it
   * from and writes its own row, so the label has to travel with the create or
   * it cannot be set at all without a second write.
   */
  category?: string;
  /**
   * Tool allowlist for a Claude Code routine (`["Bash","Read",…]`). Absent means
   * the platform's own default for the environment — Cronsole does not narrow it
   * silently, because a routine that cannot do its job fails at 3am rather than
   * at the click that created it.
   */
  allowedTools?: string[];
}

/**
 * Extra context for a reschedule. Carries the native trigger for platforms that
 * register one; platforms whose schedule *is* a cron ignore it.
 */
export interface UpdateScheduleOptions {
  /**
   * The cron converted to a Windows trigger, or null when it is not expressible
   * as one. Windows Task Scheduler needs this; Claude Code does not, and a
   * connector that stores cron directly must not be blocked by a conversion it
   * never uses.
   */
  trigger?: import('../utils/scheduler-conversion.js').WindowsTrigger | null;
}

/**
 * A real native folder a task can live in. Reported honestly, including ones
 * Cronsole will not write to — the UI shows WHY a folder is unavailable rather
 * than hiding it (leaving the user wondering) or offering it and failing late.
 */
export interface PlatformFolder {
  /** Normalized native path, e.g. `\`, `\Cronsole`, `\Microsoft\Windows`. */
  path: string;
  /** Tasks directly in this folder, excluding subfolders. */
  taskCount: number;
  /** False for `\Microsoft\` and descendants — Windows' own tasks live there. */
  writable: boolean;
}

/**
 * The editable action + settings for an existing platform task, resolved
 * server-side. The action is the structured { executable, args[] } form (same
 * no-shell model as create); workingDirectory/description are normalized to an
 * empty string when unset so the signed canonical form is unambiguous.
 */
export interface UpdateActionsInput {
  action: StructuredAction;
  workingDirectory: string;
  description: string;
  runLevel: 'least' | 'highest';
}

export interface ConnectorHealth {
  state: HealthState;
  reason?: string;
  /**
   * When the platform last said anything to us — liveness, not freshness.
   *
   * This field used to be called `lastSync`, and `WindowsAgentConnector` filled
   * it with `lastResponseAt`: the time of the newest *inbound event of any kind*
   * (a folder listing, a run ack, a heartbeat reply). The dashboard renders
   * `lastSync` as "Synced N ago", so a folder listing made a 19-hour-old task
   * list read as seven minutes old (troubleshooting #41).
   *
   * That is troubleshooting #40 one level down. #40 stopped `getHealth`
   * inventing a timestamp; the replacement was a real timestamp of the wrong
   * event, which is harder to spot and just as false. **Connected is not
   * synced** — the sentence was already in the comment above the bug.
   *
   * So there is no `lastSync` on this interface at all. A connector has no
   * honest way to fill one: a sync happens in exactly one place,
   * `POST /api/tasks/sync`, and that writes `PlatformConnection.lastSync`
   * itself. A field only a mistake can fill should not exist.
   */
  lastContactAt?: Date;
}

export interface TaskInfo {
  externalId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  /** Normalized 5-field cron (UTC) derived from the platform's trigger, if expressible. */
  schedule?: string | null;
  /** Next scheduled run reported by the platform, or null if unset. */
  nextRunTime?: Date | null;
  metadata?: any;
}

/**
 * The verbs the capability matrix reports on.
 *
 * Declared here rather than in `services/platformCapabilities.ts` so a connector
 * can name the verbs its platform cannot do (`unsupportedVerbs`) without the
 * service importing the connectors and the connectors importing the service.
 * The labels and descriptions stay in the service — those are presentation.
 */
export type CapabilityVerb =
  | 'sync'
  | 'run'
  | 'create'
  | 'setStatus'
  | 'updateSchedule'
  | 'updateAction'
  | 'export'
  | 'restore'
  | 'delete'
  | 'listFolders';

/**
 * A sync that also reports what it *looked at*, not only what it found.
 *
 * **The gap this closes: "found nothing" and "looked at nothing" render the
 * same.** A GitHub repository with no `on: schedule` workflow imports zero
 * tasks, which is correct — and indistinguishable, on screen, from a sync that
 * is broken. That ambiguity has now cost time twice: once as troubleshooting #20
 * on Windows (a fence nobody could see) and once as #75 on GitHub, where a real
 * defect hid behind exactly this silence for as long as it took to read the
 * database by hand.
 *
 * `notes` are user-facing sentences about *this* sync — coverage, and anything
 * partial. They are **not** errors: a connector that could not sync at all still
 * throws, because a caller must not have to read prose to find out. The rule
 * they exist to enforce is the one #20 already forced on the Windows sync — a
 * surface that omits what it withheld is lying by omission.
 *
 * Returning a bare `TaskInfo[]` stays legal, and is what three of the four
 * connectors do: a connector with nothing to add should not be made to say so.
 */
export interface SyncOutcome {
  tasks: TaskInfo[];
  /**
   * What this sync **covered** — routine, and true on a completely healthy run.
   *
   * "Read 9 workflows across 3 repositories, 3 scheduled." Success information,
   * so a user who has turned success toasts off does not see it.
   */
  notes?: string[];
  /**
   * What this sync could **not** do, while still returning what it had.
   *
   * A repository that failed while others worked, or a listing truncated at
   * GitHub's page limit. **Separate from `notes` because it must survive the
   * "hide success toasts" preference**: that setting suppresses *it worked*
   * noise, and this is the opposite. Same division the untracked sentence
   * already gets — and a partial read reported only as success noise is how a
   * truncated sync gets mistaken for a complete one.
   */
  warnings?: string[];
  /**
   * Did this sync see **less than the whole platform**?
   *
   * A repository that failed while others worked; a listing truncated at a page
   * limit. When true the route **adds and refreshes rows but retires none** —
   * because a task absent from a narrowed enumeration is not evidence the task
   * is gone, and acting on it is how 86 healthy Windows tasks were declared
   * MISSING by an unelevated agent (troubleshooting #74).
   *
   * The 50%-retention guard does not cover this: reading 100 of 140 workflows
   * looks entirely plausible, which is exactly what makes a partial view more
   * dangerous than a catastrophically empty one.
   */
  partial?: boolean;
}

/** One shape for the route, whichever form a connector returned. */
export function syncOutcomeOf(result: TaskInfo[] | SyncOutcome): SyncOutcome {
  return Array.isArray(result) ? { tasks: result } : result;
}

export interface PlatformConnector {
  platform: PlatformType;

  /**
   * Verbs this platform **cannot** perform — not "has not yet", but *cannot*.
   *
   * `sync`, `run`, `create` and `setStatus` are required by this interface, so
   * `verbReachability` treated their presence as proof the route would accept
   * them. That holds for a connector whose method reaches a platform. It is
   * false for one whose method is a hardcoded `{ success: false }` because the
   * platform exposes no such API — Claude Code routines have exactly one HTTP
   * endpoint (`/fire`), so `createTask` and `setTaskStatus` there can never do
   * anything.
   *
   * Without this the matrix rendered those cells `declared`, which reads as
   * *"reachable, just unproven"* and invites the user to wait for evidence that
   * cannot arrive. `unsupported` is the truth, and the distinction is the whole
   * point of the matrix: `declared` is a promise, `unsupported` is a boundary.
   *
   * Only for verbs that are structurally impossible. A verb that fails today
   * because the agent is offline is still reachable — that is what health is for.
   */
  readonly unsupportedVerbs?: readonly CapabilityVerb[];

  /**
   * The categories this connector's **own configuration** declares as tracked.
   *
   * Optional, and the default is the right answer for most platforms: a plain
   * refresh (`POST /tasks/sync` with `scope: 'tracked'`) computes its include-set
   * from the categories already holding stored rows, because on Windows a folder
   * becomes tracked by being *picked* in the discovery modal and there is nowhere
   * else that fact lives.
   *
   * **It is the wrong question for a connector whose tracked set is declared
   * rather than observed.** GitHub Actions is the first: the repositories you
   * watch live in `PlatformConnection.config`, and adding one *is* the gesture
   * that names the folder — the same gesture the Windows modal performs. Deriving
   * the include-set from stored rows made that gesture unable to adopt anything:
   * a freshly added repository has no rows, so `trackedCategories` returned `[]`,
   * every task it reported was filtered out, and **Sync reported success over
   * nothing, forever**. There is no second gesture to reach for, because the
   * discovery modal talks to the Windows agent.
   *
   * Implement it when the answer is in the config. It changes only *which
   * categories a refresh includes* — it must not clear a `TaskExclusion`, because
   * an untracked workflow has to survive a routine refresh (that is the whole
   * distinction between a refresh and an import).
   */
  trackedCategories?(config: any): string[];

  /**
   * Sync tasks from the platform.
   * Returns a list of normalized task information, or a {@link SyncOutcome} when
   * the connector also has something to *say* about what it looked at.
   */
  syncTasks(config: any): Promise<TaskInfo[] | SyncOutcome>;

  /**
   * Trigger a task run.
   *
   * `ran` says **what `success` is a verdict about**, and the two are orthogonal:
   *
   * | `success` | `ran`   | meaning                                        |
   * |-----------|---------|------------------------------------------------|
   * | `true`    | `false` | the platform accepted the start (Windows, Claude) |
   * | `true`    | `true`  | the job executed here and passed (native)      |
   * | `false`   | `true`  | the job executed here and **failed** (native)  |
   * | `false`   | `false` | it could not be started at all                 |
   *
   * Set `ran: true` only once the job has actually executed — never for a
   * dispatch. It exists because the third row is not an error: a CHECK that
   * fails is the check *working*, reporting a fact about the user's system, and
   * that is the entire reason the job type exists. Without this field the route
   * answered `502` for it (troubleshooting #59), which means *retry, the gateway
   * had a problem* — so an agent could not tell "your disk is full" from
   * "monitoring is broken", two findings that demand opposite actions.
   *
   * Only Cronsole-native can set it: it is the one platform where dispatch and
   * execution are the same act, so for every other connector `success` describes
   * a handshake and nothing more (see `ExecutionLog`'s rule in CLAUDE.md §9).
   */
  runTask(
    externalId: string,
    config: any
  ): Promise<{ success: boolean; ran?: boolean; platformRunId?: string; message?: string }>;

  /**
   * Enable/Disable a task. `message` carries a platform failure reason (e.g. an
   * elevation/ACL refusal) the route surfaces on a non-success result.
   */
  setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean; message?: string }>;

  /**
   * Check health of the connection.
   */
  getHealth(config: any): Promise<ConnectorHealth>;

  /**
   * Create a new task on the platform. `schedule` is the normalized 5-field
   * cron (UTC); `options.trigger` carries the platform-native trigger when
   * the server was able to convert the cron.
   */
  /**
   * `foldersCreated` names every folder the create had to make, in creation
   * order — always present (empty when none), never optional, because Cronsole
   * creating a folder is the exception to a standing invariant and may not be
   * silent. Reported on failure too: a chain can be created and the
   * registration then fail, which leaves a real folder behind.
   */
  createTask(name: string, schedule: string, command: string, config: any, options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string; foldersCreated?: string[] }>;

  /**
   * Change the schedule (trigger) of an existing platform task, leaving its
   * action and settings intact. Optional — only platforms that register native
   * triggers (Windows Task Scheduler) implement it; others get an honest 400
   * from the route. `trigger` is the structured form produced by
   * convertCronToWindowsTrigger for the new cron.
   */
  /**
   * List the platform's real task folders, so the UI can offer actual
   * destinations instead of assuming one. Optional — only platforms with a
   * native folder hierarchy (Windows Task Scheduler) implement it; others get
   * an honest 400 from the route. Read-only.
   */
  listFolders?(config: any): Promise<{ success: boolean; folders: PlatformFolder[]; message?: string }>;

  /**
   * Change when an existing task runs, leaving its action and settings intact.
   *
   * **Takes the cron, not the trigger.** It used to take a `WindowsTrigger`, and
   * the route refused any cron that could not be converted into one — correct for
   * Windows and wrong for every platform that stores a cron natively. Claude Code
   * routines take 5-field UTC cron directly, so converting to a Windows trigger
   * and back could only lose what the cron already said exactly, and the
   * conversion failing would have blocked a reschedule the platform would have
   * accepted. Connectors that register native triggers read `options.trigger`.
   *
   * `clientError` marks a refusal caused by the *request* rather than by the
   * platform, so the route can answer 400 instead of 502 — the difference between
   * "fix your input" and "retry, the platform is having a moment".
   */
  updateSchedule?(
    externalId: string,
    cron: string,
    config: any,
    options?: UpdateScheduleOptions
  ): Promise<{ success: boolean; message?: string; clientError?: boolean }>;

  /**
   * Change the action (executable + args + working dir) and selected settings
   * (description, run level) of an existing platform task, leaving its trigger,
   * principal identity, and other settings intact. Optional — only Windows Task
   * Scheduler implements it today; other platforms get an honest 400. The whole
   * input is covered by the task:update HMAC signature.
   */
  updateActions?(externalId: string, input: UpdateActionsInput, config: any): Promise<{ success: boolean; message?: string }>;

  /**
   * Delete the platform's native task entry. Optional — platforms that can't
   * remove their real entry (quick-link platforms, the experimental Claude
   * connector) simply don't implement it, and the DELETE route refuses rather
   * than leaving an orphaned native task behind. Implementations should be
   * idempotent: deleting a task that no longer exists on the platform is a
   * success (the desired end state holds).
   */
  deleteTask?(externalId: string, config: any): Promise<{ success: boolean; message?: string }>;

  /**
   * Export the platform's native task definition (read-only). Optional —
   * implemented only where the platform has a portable native format. The
   * Windows agent returns the task's Task Scheduler XML (round-trips into any
   * Windows machine); Cronsole-native tasks have no such format and are exported
   * as JSON directly from the DB by the route, so this stays connector-specific.
   */
  exportTask?(externalId: string, config: any): Promise<{ success: boolean; xml?: string; message?: string }>;

  /**
   * Register a task from its native definition — the inverse of exportTask, and
   * the restore half of the backup story. Optional for the same reason export is:
   * only platforms with a portable native format can do it.
   *
   * Unlike export this WRITES, so the whole input (path, XML, and both flags) is
   * covered by the command signature and re-validated by the agent, which holds
   * the elevation. Implementations must NOT overwrite an existing task unless
   * `overwrite` is set — that refusal is the feature, not a limitation.
   */
  importTask?(
    externalId: string,
    xml: string,
    options: { overwrite: boolean; createFolders: boolean },
    config: any
  ): Promise<ImportTaskResult>;

  /**
   * Replace the credentials a task's agent uses — by **recreating it**.
   *
   * Optional, and unsupported by absence like every other optional verb. It
   * exists because a credential outlives nothing: tokens rotate, and a platform
   * where the task definition is immutable would otherwise strand a trigger the
   * day its MCP token expires, with no path but "delete it and build it again
   * from memory".
   *
   * **It genuinely recreates**, and the interface says so rather than pretending
   * to edit. Gemini's `PATCH` accepts a trigger's status and display name and
   * nothing else, so there is no way to change an interaction in place. The
   * implementation therefore creates the replacement **first** — a failure then
   * leaves the original untouched and running — and only deletes the old one
   * once the new one exists.
   *
   * Because the platform assigns a new id, the caller must **rekey the existing
   * row** rather than delete and re-create it: favorites, collections, run
   * history and the Cronsole name all hang off that row, and a user rotating a
   * token has not asked to lose them.
   *
   * `newExternalId` is returned for exactly that rekey. `oldRemoved: false`
   * means the replacement is live and the original is *also* still there — the
   * one outcome that must never be reported as a plain success.
   */
  rotateCredentials?(
    externalId: string,
    tools: AgentToolInput[],
    allowlist: string[],
    config: any
  ): Promise<{ success: boolean; newExternalId?: string; oldRemoved?: boolean; message?: string }>;

  /**
   * Runs that **happened on the platform**, read live.
   *
   * The counterpart to `ExecutionLog`, and deliberately not the same thing.
   * `ExecutionLog` records runs *Cronsole performed* — a task firing on its own
   * schedule writes nothing there, by design, because Cronsole did not do it and
   * claiming otherwise is the kind of confident lie this project exists to
   * avoid. That leaves a real gap on a platform that runs work on its own and
   * publishes the outcome: the run history tab correctly says *"no recorded
   * runs"* over a source with a week of them.
   *
   * This closes it without merging the two. Nothing here is stored: it is a
   * read of the platform's own record, fetched when a user opens the tab, and it
   * renders in its own group so *what Cronsole did* and *what happened* are
   * never summed into one list.
   *
   * Optional, and **unsupported by absence** like every other optional verb.
   * Most platforms genuinely have nothing to serve here (Vercel publishes no
   * cron run history at all), and a platform that reports run *outcomes* on the
   * task — `metadata.reportsRunResult` — does not necessarily expose the runs
   * themselves.
   */
  listPlatformRuns?(externalId: string, config: any): Promise<PlatformRunsResult>;

  /**
   * What one of those runs actually produced.
   *
   * Separate from `listPlatformRuns` because it is **expensive and usually
   * unwanted**: on Gemini the transcript behind a two-minute run is ~90KB, and
   * listing ten runs would mean a megabyte to render four timestamps. So the
   * list carries `outputAvailable` and this is called for the one run somebody
   * clicked.
   *
   * A run whose output cannot be read is not a failed run — say so with a
   * message rather than returning empty output, or "the agent produced nothing"
   * and "we could not fetch what it produced" become the same sentence.
   */
  getRunOutput?(externalId: string, runId: string, config: any): Promise<PlatformRunOutputResult>;
}

/** One run as the platform itself records it. */
export interface PlatformRun {
  /** The platform's own id for the run. */
  id: string;
  /**
   * The platform's own word for how it went — `completed`, `failed`,
   * `in_progress`, … **Not mapped** onto Cronsole's `ExecutionStatus`: that
   * would be a second judgement about an outcome the platform already named,
   * and the vocabulary is preview-era on at least one source. The UI styles
   * what it recognises and prints what it does not.
   */
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  /**
   * Whether {@link PlatformConnector.getRunOutput} has something to fetch.
   *
   * False for a run still in flight, and false where the platform records the
   * run but not its result — which keeps "nothing to show yet" and "this
   * platform never shows output" from both rendering as a dead click.
   */
  outputAvailable: boolean;
}

export interface PlatformRunsResult {
  success: boolean;
  runs?: PlatformRun[];
  message?: string;
}

/** One run's product, reduced to what a person reads. */
export interface PlatformRunOutput {
  /** The final result the run produced, or null if it never got that far. */
  text: string | null;
  /**
   * What the run actually did, in order — tool names where the platform gives
   * them. This is the field that catches an agent which **succeeded at finishing
   * and failed at the job**: a trigger asked to email a report completes with a
   * clean status having only written a file, because its sandbox has no mailer.
   * The status cannot show that. The steps can.
   */
  steps: string[];
  /**
   * Whatever else this platform reports about the run, as label/value pairs.
   *
   * Replaced a `totalTokens: number | null` field the day a second and third
   * connector implemented this. That field was **Gemini's fact wearing a
   * general name**: GitHub reports an attempt number and a duration, Windows
   * reports an exit code and an event id, and none of them has tokens. Adding a
   * nullable column per platform would have made the shape a union of every
   * source's vocabulary, with each connector returning null for everyone else's.
   *
   * Free-form on purpose, and **never parsed** — the UI prints these, so a
   * platform can report something Cronsole has never heard of without a schema
   * change. A connector states only what it actually knows: an absent fact is
   * omitted, never sent as `"unknown"`.
   */
  facts: { label: string; value: string }[];
  /**
   * Where to see this run on the platform, when the platform has such a page.
   *
   * Null is the common case and an honest one. GitHub has a real run URL and it
   * is the only route to the full logs, which are a zip behind a redirect and
   * deliberately not fetched here. Gemini has **no web UI for triggers at all**
   * — its documentation is entirely programmatic — so this is null there, which
   * is exactly why Cronsole showing the output matters more on that source.
   */
  url: string | null;
}

export interface PlatformRunOutputResult {
  success: boolean;
  output?: PlatformRunOutput;
  message?: string;
}

/**
 * Outcome of restoring one task. Four states rather than a boolean, because
 * collapsing them lies in both directions: `exists` is not a failure (nothing
 * went wrong and the user's task is intact) and not a success (nothing was
 * restored). `foldersCreated` is always reported — Cronsole creating a folder is
 * a carve-out to a standing invariant, so it may never be silent.
 */
export interface ImportTaskResult {
  success: boolean;
  outcome: 'created' | 'replaced' | 'exists' | 'refused';
  message?: string;
  foldersCreated: string[];
}
