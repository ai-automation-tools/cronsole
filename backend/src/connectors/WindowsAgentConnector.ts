import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions } from './platform.interface.js';
import { agentManager } from '../ws/AgentManager.js';
import { emitSignedCommand } from '../ws/agentAuth.js';
import { toStructuredAction } from '../utils/commandParser.js';
import { convertWindowsTriggerToCron, WindowsTrigger } from '../utils/scheduler-conversion.js';

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
      emitSignedCommand(socket, {
        event: 'task:create',
        name,
        schedule,
        command,
        action,
        trigger
      });

      setTimeout(() => {
        socket.off('task:created', handler);
        resolve({ success: false, message: 'Agent creation timeout' });
      }, 15000);
    });
  }
}
