import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions, UpdateActionsInput, PlatformFolder, ImportTaskResult } from './platform.interface.js';
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
        resolve({ success: false, message: 'Agent status update timeout' });
      }, 15000);
    });
  }

  async updateSchedule(externalId: string, trigger: WindowsTrigger, config: any): Promise<{ success: boolean; message?: string }> {
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
        resolve({ success: false, message: 'Agent action update timeout' });
      }, 15000);
    });
  }

  async getHealth(config: any): Promise<ConnectorHealth> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { state: HealthState.OFFLINE, reason: 'Agent not connected' };
    }

    return { state: HealthState.HEALTHY, lastSync: new Date() };
  }

  async createTask(name: string, schedule: string, command: string, config: any, options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) {
      return { success: false, message: 'Agent offline' };
    }

    return new Promise((resolve) => {
      const handler = (payload: any) => {
        if (payload.name === name) {
          socket.off('task:created', handler);
          resolve({
            success: payload.success,
            externalId: payload.path,
            message: payload.message
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
        folder: normalizeWindowsTaskFolder(options?.folder ?? DEFAULT_TASK_FOLDER)
      });

      setTimeout(() => {
        socket.off('task:created', handler);
        resolve({ success: false, message: 'Agent creation timeout' });
      }, 15000);
    });
  }
}
