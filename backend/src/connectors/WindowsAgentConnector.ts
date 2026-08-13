import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions, UpdateActionsInput, UpdateScheduleOptions, PlatformFolder, ImportTaskResult } from './platform.interface.js';
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

    return new Promise((resolve, reject) => {
      // Listen for the one-time response
      const handler = (payload: any) => {
        socket.off('task:full_list', handler);
        if (payload && payload.tasks) {
          resolve(payload.tasks.map((t: any) => ({
            externalId: t.path,
            name: t.name,
            status: (t.state === 'Ready' || t.state === 'Running') ? 'ACTIVE' : 'DISABLED',
            schedule: deriveCron(t.trigger),
            nextRunTime: parseNextRun(t.nextRunTime),
            metadata: t
          })));
        } else {
          reject(new Error('Invalid task list received from agent'));
        }
      };

      socket.on('task:full_list', handler);
      socket.emit('task:list');

      // Timeout after 15s
      setTimeout(() => {
        socket.off('task:full_list', handler);
        agentManager.markUnresponsive(userId, 'task:list');
        reject(new Error('Agent sync timeout'));
      }, 15000);
    });
  }

  async runTask(externalId: string, config: any): Promise<{ success: boolean; platformRunId?: string; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:executed', handler);
          resolve({
            success: payload.success,
            message: payload.output
          });
        }
      };

      socket.on('task:executed', handler);
      emitSignedCommand(socket, { event: 'task:run', taskPath: externalId });

      setTimeout(() => {
        socket.off('task:executed', handler);
        agentManager.markUnresponsive(userId, 'task:run');
        resolve({ success: false, message: 'Agent trigger timeout' });
      }, 15000);
    });
  }

  async deleteTask(externalId: string, config: any): Promise<{ success: boolean; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:deleted', handler);
          resolve({
            success: payload.success,
            message: payload.message
          });
        }
      };

      socket.on('task:deleted', handler);
      emitSignedCommand(socket, { event: 'task:delete', taskPath: externalId });

      setTimeout(() => {
        socket.off('task:deleted', handler);
        agentManager.markUnresponsive(userId, 'task:delete');
        resolve({ success: false, message: 'Agent delete timeout' });
      }, 15000);
    });
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

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        socket.off('task:folders_list', handler);
        resolve({
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
      };

      socket.on('task:folders_list', handler);
      socket.emit('task:folders', {});

      setTimeout(() => {
        socket.off('task:folders_list', handler);
        agentManager.markUnresponsive(userId, 'task:folders');
        resolve({ success: false, folders: [], message: 'Agent folder list timeout' });
      }, 15000);
    });
  }

  async exportTask(externalId: string, config: any): Promise<{ success: boolean; xml?: string; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    // Read-only, like syncTasks — no per-command signature (the socket is
    // authenticated at the handshake). The agent returns the task's native XML.
    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:exported', handler);
          resolve({
            success: payload.success,
            xml: payload.xml,
            message: payload.message
          });
        }
      };

      socket.on('task:exported', handler);
      socket.emit('task:export', { taskPath: externalId });

      setTimeout(() => {
        socket.off('task:exported', handler);
        agentManager.markUnresponsive(userId, 'task:export');
        resolve({ success: false, message: 'Agent export timeout' });
      }, 15000);
    });
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

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:imported', handler);
          resolve({
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
      };

      socket.on('task:imported', handler);
      emitSignedCommand(socket, {
        event: 'task:import',
        taskPath: externalId,
        xml,
        overwrite: options.overwrite,
        createFolders: options.createFolders
      });

      setTimeout(() => {
        socket.off('task:imported', handler);
        agentManager.markUnresponsive(userId, 'task:import');
        resolve({
          success: false,
          outcome: 'refused',
          message: 'Agent restore timeout',
          foldersCreated: []
        });
      }, 15000);
    });
  }

  async setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:status_set', handler);
          resolve({
            success: payload.success,
            message: payload.message
          });
        }
      };

      socket.on('task:status_set', handler);
      emitSignedCommand(socket, { event: 'task:set_status', taskPath: externalId, enabled });

      setTimeout(() => {
        socket.off('task:status_set', handler);
        agentManager.markUnresponsive(userId, 'task:set_status');
        resolve({ success: false, message: 'Agent status update timeout' });
      }, 15000);
    });
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

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:schedule_updated', handler);
          resolve({
            success: payload.success,
            message: payload.message
          });
        }
      };

      socket.on('task:schedule_updated', handler);
      emitSignedCommand(socket, { event: 'task:update_schedule', taskPath: externalId, trigger });

      setTimeout(() => {
        socket.off('task:schedule_updated', handler);
        agentManager.markUnresponsive(userId, 'task:update_schedule');
        resolve({ success: false, message: 'Agent schedule update timeout' });
      }, 15000);
    });
  }

  async updateActions(externalId: string, input: UpdateActionsInput, config: any): Promise<{ success: boolean; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.taskExternalId === externalId) {
          socket.off('task:updated', handler);
          resolve({
            success: payload.success,
            message: payload.message
          });
        }
      };

      socket.on('task:updated', handler);
      // The action, working dir, description, and run level are all covered by
      // the command signature (see agentAuth.ts commandMessage 'task:update').
      emitSignedCommand(socket, {
        event: 'task:update',
        taskPath: externalId,
        action: input.action,
        workingDirectory: input.workingDirectory,
        description: input.description,
        runLevel: input.runLevel
      });

      setTimeout(() => {
        socket.off('task:updated', handler);
        agentManager.markUnresponsive(userId, 'task:update');
        resolve({ success: false, message: 'Agent action update timeout' });
      }, 15000);
    });
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

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.name === name) {
          socket.off('task:created', handler);
          resolve({
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
      };

      // Structure the command into { executable, args[] } so the agent registers
      // a direct ExecAction with no shell (closes the cmd.exe injection sink).
      // Prefer the action the template route resolved from raw parameters
      // (per-token substitution — a parameter can't split into extra args);
      // fall back to tokenizing the command string for plain create/clone flows.
      // Both the action and the trigger are covered by the command signature.
      const action = options?.action ?? toStructuredAction(command);
      const trigger = options?.trigger ?? null;

      socket.on('task:created', handler);
      // The folder is signed: it decides WHERE the task lands, and Windows
      // silently overwrites a same-named task in the same folder — so an
      // unsigned folder would let an on-path attacker redirect a create onto an
      // existing task. Normalized here so the string the agent verifies is
      // byte-identical to the one we signed.
      emitSignedCommand(socket, {
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
      });

      setTimeout(() => {
        socket.off('task:created', handler);
        agentManager.markUnresponsive(userId, 'task:create');
        resolve({ success: false, message: 'Agent creation timeout', foldersCreated: [] });
      }, 15000);
    });
  }
}
