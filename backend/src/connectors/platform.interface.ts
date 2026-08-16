import { PlatformType, HealthState } from '@prisma/client';
import { WindowsTrigger } from '../utils/scheduler-conversion.js';
import { StructuredAction } from '../utils/commandParser.js';

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
   * Sync tasks from the platform.
   * Returns a list of normalized task information.
   */
  syncTasks(config: any): Promise<TaskInfo[]>;

  /**
   * Trigger a task run.
   */
  runTask(externalId: string, config: any): Promise<{ success: boolean; platformRunId?: string; message?: string }>;

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
