import type { Socket } from 'socket.io';
import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions, UpdateActionsInput, UpdateScheduleOptions, PlatformFolder, ImportTaskResult, PlatformRun, PlatformRunOutput, PlatformRunsResult, PlatformRunOutputResult } from './platform.interface.js';
import { agentManager } from '../ws/AgentManager.js';
import { emitSignedCommand } from '../ws/agentAuth.js';
import { toStructuredAction } from '../utils/commandParser.js';
import { convertWindowsTriggerToCron, WindowsTrigger } from '../utils/scheduler-conversion.js';
import { DEFAULT_TASK_FOLDER, normalizeWindowsTaskFolder } from '../utils/windowsTaskFolder.js';

/**
 * Convert an agent-supplied Windows trigger to a 5-field cron string. Only
 * high-confidence conversions are kept; anything ambiguous stays null so the UI
 * honestly shows "No direct schedule" rather than a wrong cron.
 */
function deriveCron(trigger: unknown): string | null {
  if (!trigger || typeof trigger !== 'object') return null;
  const result = convertWindowsTriggerToCron(trigger as WindowsTrigger);
  return result.confidence >= 1 ? result.cron : null;
}

/** The outcome verbs the agent is allowed to report for an import. */
const IMPORT_OUTCOMES: ImportTaskResult['outcome'][] = ['created', 'replaced', 'exists', 'refused'];

/**
 * How long a request timeout stands as the *current* verdict before it becomes
 * a fact about the past.
 *
 * Fifteen minutes: comfortably longer than any legitimate request (the agent
 * verbs time out at 15s), so a genuinely wedged agent stays DEGRADED across an
 * entire session of someone trying to use it — each attempt renews the
 * evidence. Short enough that a single failure cannot narrate the dashboard
 * overnight, which is what it did.
 *
 * The exact value is a judgement, not a measurement. What is not negotiable is
 * that the number exists: without one, "not responding" is asserted forever
 * from one observation.
 */
export const UNRESPONSIVE_EVIDENCE_TTL_MS = 15 * 60 * 1000;

/** How long any single agent verb waits for its response before giving up. */
export const AGENT_REQUEST_TIMEOUT_MS = 15_000;

/** The two ways a request can finish, handed to the caller's callbacks. */
type Settle<T> = { resolve: (value: T) => void; reject: (error: Error) => void };

/**
 * One request/response round trip with the agent.
 *
 * It owns the whole lifecycle — register the response listener, send, and hold
 * a deadline that removes the listener and records the agent as unresponsive.
 *
 * **The deadline is cancelled the moment the request settles, and that is the
 * entire reason this helper exists.** Each of the ten verbs used to schedule
 * its own `setTimeout` and never clear it, so a call that came back in 200ms
 * still ran `markUnresponsive` fifteen seconds later. The stale `reject`/
 * `resolve` was harmless — the promise had settled — which is exactly why this
 * survived: the only surviving effect was a *stamp on the health record*.
 * Windows therefore reported "Agent connected but not responding (task:list
 * timed out)" fifteen seconds after every successful sync, and could not stay
 * HEALTHY for longer than that between requests. Measured live: sync HTTP 200
 * at 03:42:30 → HEALTHY at t+0s and t+8s → DEGRADED at t+17s, with nothing
 * asked of the agent in between.
 *
 * That is [#40](docs/troubleshooting/README.md#40) with the sign flipped. #40
 * was a status field reporting health it had not observed; this reported a
 * *failure that never happened*, which is the same dishonesty pointed the other
 * way — and the more expensive one, because it trains the reader to ignore the
 * one line that is supposed to mean something is wrong.
 *
 * It is a helper rather than ten `clearTimeout` calls for the reason `ran` is
 * stamped once inside `executeJob`: a rule every call site must remember is a
 * rule the eleventh verb will forget, and this failure is silent by
 * construction — nothing throws, no test goes red, and the only witness is a
 * dashboard quietly slandering a working agent.
 *
 * `onResponse` receives every payload on `responseEvent` and settles only the
 * ones that belong to it — several verbs share a channel and must match on the
 * task path first. A payload that is not ours leaves both the listener and the
 * deadline in place, which is what makes that filtering safe.
 */
function agentRequest<T>(
  socket: Socket,
  userId: string,
  verb: string,
  responseEvent: string,
  send: () => void,
  onResponse: (payload: any, settle: Settle<T>) => void,
  onTimeout: (settle: Settle<T>) => void,
  /**
   * Whether a timeout on this verb is evidence about the **agent's health**.
   *
   * True for every verb the agent has always had: silence there means it is not
   * answering. False for a verb introduced later, where silence far more likely
   * means *this published agent predates the verb* — a healthy agent that simply
   * does not know the word.
   *
   * Without this, opening Run History on a Windows task against an older agent
   * would mark it unresponsive and hold the whole platform at DEGRADED for
   * fifteen minutes, over an optional read the user merely clicked. That is #62's
   * shape exactly: a health verdict manufactured by something that was not a
   * health check.
   */
  timeoutIsHealthEvidence = true
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      clearTimeout(timer);
      socket.off(responseEvent, handler);
    };

    // Every exit runs through here, so the listener and the deadline are
    // released exactly once whichever path finishes first.
    const settle: Settle<T> = {
      resolve: value => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      },
      reject: error => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      }
    };

    const handler = (payload: any) => onResponse(payload, settle);

    const timer = setTimeout(() => {
      if (settled) return;
      // The only place a timeout is ever recorded. Reached only when the agent
      // really did not answer within the window — and skipped entirely for a verb
      // an older agent build would not recognise, because "does not know this
      // word" is not "not responding".
      if (timeoutIsHealthEvidence) agentManager.markUnresponsive(userId, verb);
      onTimeout(settle);
    }, AGENT_REQUEST_TIMEOUT_MS);

    socket.on(responseEvent, handler);
    send();
  });
}

/** Parse an agent-supplied timestamp, rejecting nulls and pre-2000 sentinels. */
function parseNextRun(value: unknown): Date | null {
  if (!value || (typeof value !== 'string' && typeof value !== 'number')) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000) return null;
  return d;
}

export class WindowsAgentConnector implements PlatformConnector {
  platform = PlatformType.WINDOWS_TASK_SCHEDULER;

  async syncTasks(config: any): Promise<TaskInfo[]> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);
    console.log(`[WindowsAgentConnector] syncTasks called with userId: ${userId}, socket exists: ${!!socket}`);

    if (!socket) {
      throw new Error('Agent offline');
    }

    return agentRequest<TaskInfo[]>(
      socket, userId, 'task:list', 'task:full_list',
      () => socket.emit('task:list'),
      (payload, settle) => {
        if (payload && payload.tasks) {
          settle.resolve(payload.tasks.map((t: any) => ({
            externalId: t.path,
            name: t.name,
            status: (t.state === 'Ready' || t.state === 'Running') ? 'ACTIVE' : 'DISABLED',
            schedule: deriveCron(t.trigger),
            nextRunTime: parseNextRun(t.nextRunTime),
            metadata: t
          })));
        } else {
          settle.reject(new Error('Invalid task list received from agent'));
        }
      },
      settle => settle.reject(new Error('Agent sync timeout'))
    );
  }

  async runTask(externalId: string, config: any): Promise<{ success: boolean; platformRunId?: string; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return agentRequest<{ success: boolean; platformRunId?: string; message?: string }>(
      socket, userId, 'task:run', 'task:executed',
      () => emitSignedCommand(socket, { event: 'task:run', taskPath: externalId }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({ success: payload.success, message: payload.output });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent trigger timeout' })
    );
  }

  async deleteTask(externalId: string, config: any): Promise<{ success: boolean; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return agentRequest<{ success: boolean; message?: string }>(
      socket, userId, 'task:delete', 'task:deleted',
      () => emitSignedCommand(socket, { event: 'task:delete', taskPath: externalId }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({ success: payload.success, message: payload.message });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent delete timeout' })
    );
  }

  /**
   * Enumerate the machine's real Task Scheduler folders. Read-only, like
   * syncTasks — no per-command signature (the socket is authenticated at the
   * handshake, and this reveals nothing the task list doesn't already).
   */
  async listFolders(config: any): Promise<{ success: boolean; folders: PlatformFolder[]; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, folders: [], message: 'Agent offline' };
    }

    return agentRequest<{ success: boolean; folders: PlatformFolder[]; message?: string }>(
      socket, userId, 'task:folders', 'task:folders_list',
      () => socket.emit('task:folders', {}),
      (payload, settle) => {
        settle.resolve({
          success: !!payload?.success,
          folders: Array.isArray(payload?.folders)
            ? payload.folders.map((f: any): PlatformFolder => ({
                path: String(f.path ?? ''),
                taskCount: Number(f.taskCount ?? 0),
                writable: !!f.writable
              }))
            : [],
          message: payload?.message
        });
      },
      settle => settle.resolve({ success: false, folders: [], message: 'Agent folder list timeout' })
    );
  }

  async exportTask(externalId: string, config: any): Promise<{ success: boolean; xml?: string; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    // Read-only, like syncTasks — no per-command signature (the socket is
    // authenticated at the handshake). The agent returns the task's native XML.
    return agentRequest<{ success: boolean; xml?: string; message?: string }>(
      socket, userId, 'task:export', 'task:exported',
      () => socket.emit('task:export', { taskPath: externalId }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({
            success: payload.success,
            xml: payload.xml,
            message: payload.message
          });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent export timeout' })
    );
  }

  /**
   * The runs **Windows** performed, and why they went the way they did.
   *
   * The gap this closes is the widest of any source. `ExecutionLog` holds runs
   * *Cronsole* performed, which for a Windows task is only the times somebody
   * pressed Run now — and even those record "the agent accepted the start",
   * not an outcome. So a task that has fired nightly for a month, failing every
   * time, shows an empty Run History and a red badge whose entire content is an
   * exit code.
   *
   * Task Scheduler does record the detail; it is in an event log the task object
   * knows nothing about, which is why this needs an agent verb rather than a
   * field on `task:list`.
   *
   * **The two facts kept separate here** — both from `TaskHistoryReader`, both
   * losable by a careless read:
   *
   * - **History can be switched off machine-wide.** A disabled log returns zero
   *   events, exactly like a task that has never run. Reporting them the same
   *   way tells a user their nightly task has never run. The agent answers
   *   `historyEnabled` so the two stay different sentences.
   * - **An event is not a run.** Task Scheduler writes several events per run
   *   (started, action started, action completed, task completed), so they are
   *   grouped into runs by their start event rather than listed raw — a modal
   *   showing "12 runs" for three nights would be worse than showing nothing.
   */
  async listPlatformRuns(externalId: string, config: any): Promise<PlatformRunsResult> {
    const history = await this.readHistory(externalId, config, 60);
    if ('message' in history) return { success: false, message: history.message };

    if (history.historyEnabled === false) {
      return {
        success: false,
        message:
          'Windows is not recording task history on this machine, so there is nothing to read. ' +
          'Turn it on in Task Scheduler (Action › Enable All Tasks History) and future runs will appear here. ' +
          'Past runs are gone — the setting is not retroactive.'
      };
    }

    return { success: true, runs: groupHistoryIntoRuns(history.events).map(g => g.run) };
  }

  /**
   * What one Windows run actually said.
   *
   * Re-reads the log rather than caching the previous listing, for the reason the
   * Gemini connector re-lists executions: a cached id is a claim about a resource
   * this connector does not own, and the whole point of this path is that it reads
   * the machine rather than Cronsole's memory of it.
   */
  async getRunOutput(
    externalId: string,
    runId: string,
    config: any
  ): Promise<PlatformRunOutputResult> {
    const history = await this.readHistory(externalId, config, 60);
    if ('message' in history) return { success: false, message: history.message };

    const group = groupHistoryIntoRuns(history.events).find(g => g.run.id === runId);
    if (!group) {
      return {
        success: false,
        message:
          'Windows no longer has an entry for that run. The task history log is a ring buffer, so ' +
          'an old run ages out while the task it belongs to is perfectly healthy.'
      };
    }

    return { success: true, output: describeWindowsRun(group.events) };
  }

  /** One definition of "ask the agent for this task's history". */
  private async readHistory(
    externalId: string,
    config: any,
    limit: number
  ): Promise<{ historyEnabled: boolean | null; events: WindowsHistoryEvent[] } | { message: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);
    if (!socket) return { message: 'Agent offline' };

    return agentRequest<{ historyEnabled: boolean | null; events: WindowsHistoryEvent[] } | { message: string }>(
      socket, userId, 'task:history', 'task:history_list',
      () => socket.emit('task:history', { taskPath: externalId, limit }),
      (payload, settle) => {
        if (payload.taskExternalId !== externalId) return;
        if (!payload.success) {
          settle.resolve({ message: payload.message || 'The agent could not read this task history.' });
          return;
        }
        settle.resolve({
          historyEnabled: payload.historyEnabled ?? null,
          events: Array.isArray(payload.events) ? payload.events : []
        });
      },
      settle => settle.resolve({
        message:
          'The agent did not answer a history request. Task history was added to the agent on ' +
          '2026-08-25 — if this agent was published before then, republish it ' +
          '(scripts/Republish-Agent.ps1) and the run detail will appear.'
      }),
      // A timeout here says nothing about the agent's health: an agent published
      // before this verb existed will never answer it, and it is otherwise fine.
      false
    );
  }

  /**
   * Restore a task from its native XML. The write counterpart of exportTask, so
   * unlike export it goes out as a SIGNED command — the XML carries the task's
   * action, trigger, and principal, i.e. everything the P0 guarantees exist to
   * protect.
   *
   * A timeout resolves as `refused` rather than throwing: the caller is restoring
   * a batch, and one unanswered task must be reported and stepped over, not turned
   * into a failure of the whole restore.
   */
  async importTask(
    externalId: string,
    xml: string,
    options: { overwrite: boolean; createFolders: boolean },
    config: any
  ): Promise<ImportTaskResult> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, outcome: 'refused', message: 'Agent offline', foldersCreated: [] };
    }

    return agentRequest<ImportTaskResult>(
      socket, userId, 'task:import', 'task:imported',
      () => emitSignedCommand(socket, {
        event: 'task:import',
        taskPath: externalId,
        xml,
        overwrite: options.overwrite,
        createFolders: options.createFolders
      }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({
            success: !!payload.success,
            // Trust the agent's own verb, but never let an unrecognized one read
            // as success: an outcome we can't interpret is a refusal we can.
            outcome: IMPORT_OUTCOMES.includes(payload.outcome) ? payload.outcome : 'refused',
            message: payload.message,
            foldersCreated: Array.isArray(payload.foldersCreated)
              ? payload.foldersCreated.map(String)
              : []
          });
        }
      },
      settle => settle.resolve({
        success: false,
        outcome: 'refused',
        message: 'Agent restore timeout',
        foldersCreated: []
      })
    );
  }

  async setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return agentRequest<{ success: boolean; message?: string }>(
      socket, userId, 'task:set_status', 'task:status_set',
      () => emitSignedCommand(socket, { event: 'task:set_status', taskPath: externalId, enabled }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({ success: payload.success, message: payload.message });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent status update timeout' })
    );
  }

  /**
   * Task Scheduler registers a **native trigger**, not a cron, so this is the
   * connector that needs `options.trigger` and refuses without it. The refusal
   * is a `clientError`: a cron Cronsole cannot express as a Windows trigger is a
   * fact about the request, and answering 502 would tell the user to retry
   * something that will never succeed.
   */
  async updateSchedule(
    externalId: string,
    _cron: string,
    config: any,
    options?: UpdateScheduleOptions
  ): Promise<{ success: boolean; message?: string; clientError?: boolean }> {
    const trigger = options?.trigger;
    if (!trigger) {
      return {
        success: false,
        clientError: true,
        message: 'Schedule cannot be converted to a Windows trigger.'
      };
    }

    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return agentRequest<{ success: boolean; message?: string; clientError?: boolean }>(
      socket, userId, 'task:update_schedule', 'task:schedule_updated',
      () => emitSignedCommand(socket, { event: 'task:update_schedule', taskPath: externalId, trigger }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({ success: payload.success, message: payload.message });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent schedule update timeout' })
    );
  }

  async updateActions(externalId: string, input: UpdateActionsInput, config: any): Promise<{ success: boolean; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return agentRequest<{ success: boolean; message?: string }>(
      socket, userId, 'task:update', 'task:updated',
      // The action, working dir, description, and run level are all covered by
      // the command signature (see agentAuth.ts commandMessage 'task:update').
      () => emitSignedCommand(socket, {
        event: 'task:update',
        taskPath: externalId,
        action: input.action,
        workingDirectory: input.workingDirectory,
        description: input.description,
        runLevel: input.runLevel
      }),
      (payload, settle) => {
        if (payload.taskExternalId === externalId) {
          settle.resolve({ success: payload.success, message: payload.message });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent action update timeout' })
    );
  }

  /**
   * Health from evidence, not from the socket existing.
   *
   * This used to return `HEALTHY` whenever a socket object was present and
   * stamp `lastSync: new Date()` — a timestamp created by the act of asking.
   * A wedged agent therefore reported healthy and "synced just now" forever
   * while every request against it timed out (troubleshooting #40).
   *
   * Four states, each earned:
   *  - no socket                    → OFFLINE. Nothing is connected.
   *  - a request timed out most recently, and recently → DEGRADED, naming the
   *    verb. The handshake proved the agent was alive once; a later timeout is
   *    newer evidence and outranks it.
   *  - that same timeout, gone stale → UNKNOWN. See below.
   *  - otherwise                    → HEALTHY, justified by the authenticated
   *    handshake or a real response.
   *
   * **Evidence of a failure expires; evidence of a connection does not.** That
   * asymmetry looks arbitrary and is the whole design. A live socket is
   * *continuously renewed* — the transport heartbeat re-proves every few seconds
   * that the process is up and reachable (not that its command loop works, which
   * is why a timeout can outrank it). A timeout is the opposite: one observation,
   * at one instant, never repeated. Nothing after it says the agent is still
   * wedged, because nothing after it asked.
   *
   * So a timeout that is not renewed stops being the current state and becomes a
   * fact about the past. Reporting it as DEGRADED indefinitely is a claim about
   * *now* backed by evidence about *then* — which is the same error as #40 with
   * the sign flipped: not a verdict from a precondition, but a verdict from an
   * expired observation. Both survive because nothing forces a status field to
   * say how old its evidence is.
   *
   * Measured live: one `task:folders` timeout at 21:05 left the strip reading
   * "Agent connected but not responding" for the next ten and a half hours, over
   * an agent that answered a sync immediately when finally asked. Nothing had
   * asked it anything in between (troubleshooting #48).
   *
   * The honest replacement is UNKNOWN, not HEALTHY. We did not observe a
   * recovery — we observed nothing at all, and this connector deliberately does
   * not probe to find out: `getHealth` is called on a 45-second dashboard poll,
   * and a probe would put a synthetic request on the agent for every mounted
   * browser tab. The `sync` button is the user's probe, and it is one click.
   *
   * What it reports is `lastContactAt` — the real time of the agent's last
   * inbound event, absent when it has connected but answered nothing.
   *
   * It is deliberately **not** `lastSync`, which is what this returned until
   * 2026-08-12. Both are real timestamps, which is what made the second bug
   * survive the fix for the first: `lastResponseAt` is any inbound event at all,
   * and the dashboard renders `lastSync` as "Synced N ago". A folder listing
   * therefore reported a task list as seven minutes old when the last real sync
   * was nineteen hours earlier (troubleshooting #41). **Connected is not
   * synced** — the sentence was already written here, three lines above the code
   * that broke it.
   */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { state: HealthState.OFFLINE, reason: 'Agent not connected' };
    }

    const liveness = agentManager.getLiveness(userId);
    const lastContactAt = liveness?.lastResponseAt;
    const failedAt = liveness?.lastFailureAt;

    if (failedAt && (!lastContactAt || failedAt > lastContactAt)) {
      const verb = liveness?.lastFailureVerb ?? 'last request';

      // Fresh enough to still describe the present.
      if (Date.now() - failedAt.getTime() <= UNRESPONSIVE_EVIDENCE_TTL_MS) {
        return {
          state: HealthState.DEGRADED,
          reason: `Agent connected but not responding (${verb} timed out)`,
          lastContactAt
        };
      }

      // Stale. The timeout happened, and nothing since has either confirmed or
      // contradicted it — so the truthful report is that we do not know, with
      // the reason naming what we last saw and why there is nothing newer.
      return {
        state: HealthState.UNKNOWN,
        // No "unverified" prefix: the state's own label already says that, and
        // a reason that restates its label spends the one line it gets.
        reason: `${verb} timed out, and nothing has been asked of the agent since`,
        lastContactAt
      };
    }

    return { state: HealthState.HEALTHY, lastContactAt };
  }

  async createTask(name: string, schedule: string, command: string, config: any, options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string; foldersCreated: string[] }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline', foldersCreated: [] };
    }

    // Structure the command into { executable, args[] } so the agent registers
    // a direct ExecAction with no shell (closes the cmd.exe injection sink).
    // Prefer the action the template route resolved from raw parameters
    // (per-token substitution — a parameter can't split into extra args);
    // fall back to tokenizing the command string for plain create/clone flows.
    // Both the action and the trigger are covered by the command signature.
    const action = options?.action ?? toStructuredAction(command);
    const trigger = options?.trigger ?? null;

    return agentRequest<{ success: boolean; externalId?: string; message?: string; foldersCreated: string[] }>(
      socket, userId, 'task:create', 'task:created',
      // The folder is signed: it decides WHERE the task lands, and Windows
      // silently overwrites a same-named task in the same folder — so an
      // unsigned folder would let an on-path attacker redirect a create onto an
      // existing task. Normalized here so the string the agent verifies is
      // byte-identical to the one we signed.
      () => emitSignedCommand(socket, {
        event: 'task:create',
        name,
        schedule,
        command,
        action,
        trigger,
        folder: normalizeWindowsTaskFolder(options?.folder ?? DEFAULT_TASK_FOLDER),
        // Coerced to a real boolean rather than passed through: it is signed, so
        // an undefined here and a `false` on the agent would produce different
        // canonical strings and fail every create.
        createFolder: options?.createFolder === true
      }),
      (payload, settle) => {
        if (payload.name === name) {
          settle.resolve({
            success: payload.success,
            externalId: payload.path,
            message: payload.message,
            // Carried through on BOTH outcomes. A create can make the folder
            // chain and then fail to register into it, and that folder is real
            // and needs an admin to remove — reporting it only on success would
            // hide exactly the case the user most needs to hear about. An older
            // agent omits the field entirely, which reads correctly as [].
            foldersCreated: Array.isArray(payload.foldersCreated)
              ? payload.foldersCreated.map(String)
              : []
          });
        }
      },
      settle => settle.resolve({ success: false, message: 'Agent creation timeout', foldersCreated: [] })
    );
  }
}

/** One Task Scheduler event as the agent reports it. */
interface WindowsHistoryEvent {
  eventId: number;
  level: number | null;
  timeCreated: string | null;
  message: string;
  /**
   * The event's own named fields — `ResultCode`, `ActionName`, and whatever else
   * that event id publishes.
   *
   * Optional because an agent published before 2026-08-25 does not send them,
   * and this must keep working against one that does not.
   */
  data?: Record<string, string>;
}

/**
 * Task Scheduler's event ids, in the terms a person uses.
 *
 * **Only the ones Cronsole actually acts on are named.** The log has dozens, and
 * mapping every one would be inventing a vocabulary for events nobody reads;
 * anything unnamed keeps its number and its own message, which is the same rule
 * `toStatus` follows for a platform status Cronsole has not seen before.
 */
const TASK_STARTED = 100;
const TASK_COMPLETED = 102;
const ACTION_COMPLETED = 201;
/**
 * The bucket for events whose opening `TASK_STARTED` has aged out of the log.
 *
 * A single constant rather than a per-event key: they are the surviving tail of
 * **one** run, and giving each its own id turned a truncated run into several
 * rows with no start time.
 */
const ORPHAN_RUN = 'before-the-log-window';

/** Every id that means "this run did not go well" — start refused, action failed, terminated. */
const FAILURE_EVENTS = new Set([101, 103, 111, 203, 329, 332]);

/**
 * Group a flat event list into runs, newest first, each carrying its own events.
 *
 * **One pure function returning both, rather than a grouping plus a lookup.**
 * The first version kept the "current run" in a module-level variable that a
 * second helper read back — which works for one caller at a time and silently
 * interleaves the moment two browser tabs open two tasks, producing a run made
 * of another task's events. Shared mutable state across an async boundary is not
 * a shortcut worth taking for a grouping this small.
 *
 * Task Scheduler writes **several events per run** — task started, action
 * started, action completed, task completed — so listing them raw would show
 * "12 runs" for three nights.
 *
 * Runs are keyed by the timestamp of the start event that opens them: stable
 * across re-reads (unlike an index), unique in practice (a task does not start
 * twice in the same millisecond), and requiring nothing to be stored.
 *
 * A run whose start event has aged out of the ring buffer while its completion
 * survives is **kept**, under its first event's own time. Dropping it would
 * shorten the history exactly at the oldest end — which is where someone
 * investigating a long-running failure is looking.
 */
function groupHistoryIntoRuns(
  events: WindowsHistoryEvent[]
): { run: PlatformRun; events: WindowsHistoryEvent[] }[] {
  type Bucket = {
    startedAt: Date | null;
    endedAt: Date | null;
    failed: boolean;
    completed: boolean;
    events: WindowsHistoryEvent[];
  };
  const buckets = new Map<string, Bucket>();
  let key: string | null = null;

  // The agent answers newest-first; walking in reverse means each run's start is
  // seen before its outcome.
  for (const event of [...events].reverse()) {
    if (event.eventId === TASK_STARTED && event.timeCreated) key = event.timeCreated;
    // Events before the first start belong to a run whose opening event has aged
    // out of the ring buffer. They share **one** bucket rather than one each:
    // keying them by their own timestamps made every stray event its own "run",
    // so a single truncated run rendered as three rows with no start time — the
    // exact "three nights read as twelve runs" failure this grouping exists to
    // prevent, arriving through the orphan path instead of the normal one.
    const id = key ?? ORPHAN_RUN;

    const at = event.timeCreated ? new Date(event.timeCreated) : null;
    const bucket: Bucket = buckets.get(id)
      ?? { startedAt: null, endedAt: null, failed: false, completed: false, events: [] };

    if (event.eventId === TASK_STARTED) bucket.startedAt = at;
    if (event.eventId === TASK_COMPLETED) {
      bucket.endedAt = at;
      bucket.completed = true;
    }
    if (event.eventId === ACTION_COMPLETED && !bucket.endedAt) bucket.endedAt = at;
    // Level 2 is Error in this log. Trusted alongside the id list, so an event id
    // Cronsole has never seen still registers as a failure when Windows flagged
    // it as one — the same reason an unrecognised platform status is `unknown`
    // rather than assumed healthy.
    if (FAILURE_EVENTS.has(event.eventId) || event.level === 2) bucket.failed = true;

    bucket.events.push(event);
    buckets.set(id, bucket);
  }

  return [...buckets.entries()]
    .map(([id, b]) => ({
      run: {
        id,
        // A truncated run has no start event, so its earliest surviving event is
        // the best time available — better than `null`, which renders as a run
        // that never happened.
        // **"completed" is not "succeeded"**, and the difference is real: a
        // Windows task completes whatever its action returned. The exit code is
        // surfaced by `describeWindowsRun` from the action-completed event, so
        // this word describes the run's lifecycle and the detail names the
        // outcome.
        status: b.failed
          ? 'failed'
          : b.completed
            ? 'completed'
            // No start event and no completion: this is the tail of a run the log
            // no longer holds the beginning of, not something still running.
            : b.startedAt ? 'in_progress' : id === ORPHAN_RUN ? 'partial' : 'unknown',
        startedAt: b.startedAt ?? earliestTime(b.events),
        endedAt: b.endedAt,
        // Always openable: for Windows the "output" IS the event text, and every
        // run in this list has at least the event that created it.
        outputAvailable: true
      },
      events: b.events
    }))
    .reverse();
}

/**
 * One run's events, rendered as something a person can act on.
 *
 * Windows' own words are kept verbatim — `FormatDescription()` already produces
 * a sentence naming the action and its return code, and rewriting it would put
 * a translation layer between the user and the only detail this platform gives.
 */
function describeWindowsRun(events: WindowsHistoryEvent[]): PlatformRunOutput {
  // Already oldest-first: `groupHistoryIntoRuns` fills each bucket while walking
  // the log in reverse. That is the order a run reads in — started, action ran,
  // action returned, task completed — and flipping it would put the ending first.
  const ordered = events;

  // The exit code, pulled out of the action-completed event where Windows states
  // it. This is the number `lastTaskResult` shows on the card, here beside the
  // action that produced it — which is the whole point of opening a run.
  const facts: { label: string; value: string }[] = [];
  for (const event of ordered) {
    if (event.eventId !== ACTION_COMPLETED) continue;

    // **The event's named fields first, the English sentence only as a
    // fallback.** `record.Message` is those same values pasted into a localized
    // template, so a regex over it returns nothing the moment Windows is not in
    // English — a silent, total loss of the one detail this platform publishes,
    // on somebody else's machine. The fallback exists only for an agent
    // published before the fields were sent.
    const code = event.data?.ResultCode ?? /return code (-?\d+)/i.exec(event.message)?.[1];
    if (code) facts.push({ label: 'Exit code', value: code });
    const action = event.data?.ActionName ?? /action "([^"]+)"/i.exec(event.message)?.[1];
    if (action) facts.push({ label: 'Action', value: action });
    break;
  }

  const text = ordered
    .map(e => `[${e.timeCreated ? new Date(e.timeCreated).toLocaleString() : 'time not recorded'}] ${e.message || `Event ${e.eventId}`}`)
    .join('\n\n');

  return {
    text: text || null,
    // The event ids in order — Windows' own vocabulary for what happened, the
    // way Gemini's step list is its own.
    steps: ordered.map(e => `Event ${e.eventId}`),
    facts,
    // No web page to link to: Task Scheduler is a local MMC snap-in, not a URL.
    url: null
  };
}

/** The oldest timestamp in a bucket, for a run whose start event is gone. */
function earliestTime(events: WindowsHistoryEvent[]): Date | null {
  const times = events
    .map(e => (e.timeCreated ? new Date(e.timeCreated) : null))
    .filter((d): d is Date => d !== null && !Number.isNaN(d.getTime()));
  return times.length ? new Date(Math.min(...times.map(d => d.getTime()))) : null;
}
