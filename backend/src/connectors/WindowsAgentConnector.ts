import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions } from './platform.interface.js';
import { agentManager } from '../ws/AgentManager.js';
import { emitSignedCommand } from '../ws/agentAuth.js';
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

  async setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean }> {
    const userId = config.userId;
    const socket = agentManager.getSocket(userId);

    if (!socket) return { success: false };

    // Status update is currently fire-and-forget in agent for simplicity
    emitSignedCommand(socket, { event: 'task:set_status', taskPath: externalId, enabled });
    return { success: true };
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

      socket.on('task:created', handler);
      // `trigger` rides along unsigned (server-derived structured data). The
      // signature covers name/schedule/command; trigger integrity relies on WSS
      // in transit (see the note on commandMessage in agentAuth.ts).
      emitSignedCommand(
        socket,
        { event: 'task:create', name, schedule, command },
        { trigger: options?.trigger ?? null }
      );

      setTimeout(() => {
        socket.off('task:created', handler);
        resolve({ success: false, message: 'Agent creation timeout' });
      }, 15000);
    });
  }
}
