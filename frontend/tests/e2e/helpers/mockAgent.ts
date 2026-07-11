import crypto from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { agentPairingSecret, backendOrigin } from './env';

export interface MockAgentTask {
  path: string;
  name: string;
  state: 'Ready' | 'Running' | 'Disabled';
  nextRunTime?: string;
  lastRunTime?: string;
  trigger?: unknown;
  actions?: unknown[];
  enabled?: boolean;
  author?: string;
  description?: string;
}

export interface MockRunCommand {
  taskPath: string;
  ts?: number;
  sig?: string;
}

export interface MockCreateCommand {
  name: string;
  schedule: string;
  command: string;
  action?: {
    executable?: string;
    args?: string[];
  };
  trigger?: unknown;
  ts?: number;
  sig?: string;
}

export interface MockUpdateScheduleCommand {
  taskPath: string;
  trigger?: unknown;
  ts?: number;
  sig?: string;
}

function hmacHex(key: string, message: string): string {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

function authPayload(agentId: string, secret: string) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const ts = Math.floor(Date.now() / 1000);
  return {
    agentId,
    nonce,
    ts,
    hmac: hmacHex(secret, `${agentId}|${nonce}|${ts}`)
  };
}

export class MockTaskHubAgent {
  readonly runs: MockRunCommand[] = [];
  readonly creates: MockCreateCommand[] = [];
  readonly deletes: MockRunCommand[] = [];
  readonly scheduleUpdates: MockUpdateScheduleCommand[] = [];
  private socket: Socket | null = null;

  constructor(
    private tasks: MockAgentTask[],
    private readonly agentId = `e2e-agent-${Date.now()}`
  ) {}

  async connect(): Promise<void> {
    const socket = io(backendOrigin(), {
      auth: authPayload(this.agentId, agentPairingSecret()),
      transports: ['websocket'],
      reconnection: false
    });
    this.socket = socket;

    socket.on('task:list', () => {
      socket.emit('task:full_list', { tasks: this.tasks });
    });

    socket.on('task:run', (payload: MockRunCommand) => {
      this.runs.push(payload);
      socket.emit('task:executed', {
        taskExternalId: payload.taskPath,
        success: true,
        output: `Mock agent ran ${payload.taskPath}`
      });
    });

    socket.on('task:delete', (payload: MockRunCommand) => {
      this.deletes.push(payload);
      const existed = this.tasks.some((t) => t.path === payload.taskPath);
      this.tasks = this.tasks.filter((t) => t.path !== payload.taskPath);
      // Mirrors the real agent: deleting an already-gone task is a success.
      socket.emit('task:deleted', {
        taskExternalId: payload.taskPath,
        success: true,
        message: existed ? 'Task deleted' : 'Task not found (already removed)'
      });
    });

    socket.on('task:update_schedule', (payload: MockUpdateScheduleCommand) => {
      this.scheduleUpdates.push(payload);
      const existed = this.tasks.some((t) => t.path === payload.taskPath);
      // Mirror the real agent: swap only the trigger on the matching task.
      this.tasks = this.tasks.map((t) =>
        t.path === payload.taskPath ? { ...t, trigger: payload.trigger ?? t.trigger } : t
      );
      socket.emit('task:schedule_updated', {
        taskExternalId: payload.taskPath,
        success: existed,
        message: existed ? 'Schedule updated' : 'Task not found'
      });
    });

    socket.on('task:create', (payload: MockCreateCommand) => {
      this.creates.push(payload);
      const path = `\\TaskHub\\${payload.name}`;
      this.tasks = [
        ...this.tasks,
        {
          path,
          name: payload.name,
          state: 'Ready',
          nextRunTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
          trigger: payload.trigger ?? null,
          actions: payload.action
            ? [
                {
                  path: payload.action.executable,
                  arguments: payload.action.args?.join(' ') ?? ''
                }
              ]
            : [],
          enabled: true,
          author: 'TaskHub E2E mock agent',
          description: payload.command
        }
      ];
      socket.emit('task:created', {
        name: payload.name,
        success: true,
        path,
        message: 'Created by mock agent'
      });
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Mock agent connection timed out'));
      }, 5000);

      socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}

export function e2eAgentTask(): MockAgentTask {
  return {
    path: '\\E2E\\Mock Nightly Backup',
    name: 'E2E Mock Nightly Backup',
    state: 'Ready',
    nextRunTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    trigger: {
      type: 'Daily',
      startBoundary: '09:15',
      daysInterval: 1
    },
    actions: [
      {
        path: 'powershell.exe',
        arguments: '-NoProfile -ExecutionPolicy Bypass -File C:\\TaskHubE2E\\backup.ps1',
        workingDirectory: 'C:\\TaskHubE2E'
      }
    ],
    enabled: true,
    author: 'TaskHub E2E mock agent',
    description: 'Deterministic task for Playwright mock-agent coverage'
  };
}

