import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions } from './platform.interface.js';
import { agentManager } from '../ws/AgentManager.js';

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
      socket.emit('task:run', externalId);

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
    socket.emit('task:set_status', externalId, enabled);
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
      socket.emit('task:create', { name, schedule, command, trigger: options?.trigger ?? null });

      setTimeout(() => {
        socket.off('task:created', handler);
        resolve({ success: false, message: 'Agent creation timeout' });
      }, 15000);
    });
  }
}
