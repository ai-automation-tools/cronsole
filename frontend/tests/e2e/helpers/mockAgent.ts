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
  // Per-command nonce: signed and sent by emitSignedCommand so two identical
  // commands in the same second stay distinguishable (troubleshooting #16).
  // The mock does not verify signatures, so this is descriptive, not enforced.
  nonce?: string;
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
  // Per-command nonce: signed and sent by emitSignedCommand so two identical
  // commands in the same second stay distinguishable (troubleshooting #16).
  // The mock does not verify signatures, so this is descriptive, not enforced.
  nonce?: string;
  ts?: number;
  sig?: string;
}

export interface MockUpdateScheduleCommand {
  taskPath: string;
  trigger?: unknown;
  // Per-command nonce: signed and sent by emitSignedCommand so two identical
  // commands in the same second stay distinguishable (troubleshooting #16).
  // The mock does not verify signatures, so this is descriptive, not enforced.
  nonce?: string;
  ts?: number;
  sig?: string;
}

export interface MockUpdateCommand {
  taskPath: string;
  action?: {
    executable?: string;
    args?: string[];
  };
  workingDirectory?: string;
  description?: string;
  runLevel?: string;
  // Per-command nonce: signed and sent by emitSignedCommand so two identical
  // commands in the same second stay distinguishable (troubleshooting #16).
  // The mock does not verify signatures, so this is descriptive, not enforced.
  nonce?: string;
  ts?: number;
  sig?: string;
}

export interface MockImportCommand {
  taskPath: string;
  xml?: string;
  overwrite?: boolean;
  createFolders?: boolean;
  // Per-command nonce: signed and sent by emitSignedCommand so two identical
  // commands in the same second stay distinguishable (troubleshooting #16).
  // The mock does not verify signatures, so this is descriptive, not enforced.
  nonce?: string;
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

export class MockCronsoleAgent {
  readonly runs: MockRunCommand[] = [];
  readonly creates: MockCreateCommand[] = [];
  readonly deletes: MockRunCommand[] = [];
  readonly scheduleUpdates: MockUpdateScheduleCommand[] = [];
  readonly actionUpdates: MockUpdateCommand[] = [];
  readonly imports: MockImportCommand[] = [];
  /** Folders the mock machine has. Restore refuses a task whose folder is missing. */
  private folders = new Set<string>(['\\', '\\Cronsole', '\\E2E']);
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

    socket.on('task:folders', () => {
      socket.emit('task:folders_list', {
        success: true,
        message: 'OK',
        folders: [...this.folders].map((path) => ({
          path,
          taskCount: this.tasks.filter((t) => t.path.startsWith(path)).length,
          writable: !path.toLowerCase().startsWith('\\microsoft')
        }))
      });
    });

    socket.on('task:import', (payload: MockImportCommand) => {
      this.imports.push(payload);
      const exists = this.tasks.some((t) => t.path.toLowerCase() === payload.taskPath.toLowerCase());
      const folder = payload.taskPath.split('\\').slice(0, -1).join('\\') || '\\';
      const foldersCreated: string[] = [];

      // Mirrors the real agent's three refusals, in the same order, so an E2E
      // run exercises the same decision tree rather than a friendlier one.
      if (folder.toLowerCase().startsWith('\\microsoft')) {
        socket.emit('task:imported', {
          taskExternalId: payload.taskPath,
          success: false,
          outcome: 'refused',
          message: 'Refusing to restore under \\Microsoft\\.',
          foldersCreated
        });
        return;
      }
      if (exists && !payload.overwrite) {
        socket.emit('task:imported', {
          taskExternalId: payload.taskPath,
          success: false,
          outcome: 'exists',
          message: 'A task already exists at this path. It was left exactly as it is.',
          foldersCreated
        });
        return;
      }
      if (!this.folders.has(folder)) {
        if (!payload.createFolders) {
          socket.emit('task:imported', {
            taskExternalId: payload.taskPath,
            success: false,
            outcome: 'refused',
            message: `Task Scheduler folder '${folder}' does not exist.`,
            foldersCreated
          });
          return;
        }
        this.folders.add(folder);
        foldersCreated.push(folder);
      }

      this.tasks = [
        ...this.tasks.filter((t) => t.path.toLowerCase() !== payload.taskPath.toLowerCase()),
        {
          path: payload.taskPath,
          name: payload.taskPath.split('\\').pop() ?? payload.taskPath,
          state: 'Ready',
          enabled: true,
          author: 'Cronsole E2E mock agent',
          description: 'Restored by mock agent'
        }
      ];
      socket.emit('task:imported', {
        taskExternalId: payload.taskPath,
        success: true,
        outcome: exists ? 'replaced' : 'created',
        message: exists ? 'Task replaced' : 'Task restored',
        foldersCreated
      });
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

    socket.on('task:update', (payload: MockUpdateCommand) => {
      this.actionUpdates.push(payload);
      const existed = this.tasks.some((t) => t.path === payload.taskPath);
      // Mirror the real agent: replace the matching task's exec action +
      // description on success.
      this.tasks = this.tasks.map((t) =>
        t.path === payload.taskPath
          ? {
              ...t,
              actions: payload.action
                ? [
                    {
                      path: payload.action.executable,
                      arguments: payload.action.args?.join(' ') ?? '',
                      workingDirectory: payload.workingDirectory ?? ''
                    }
                  ]
                : t.actions,
              description: payload.description ?? t.description
            }
          : t
      );
      socket.emit('task:updated', {
        taskExternalId: payload.taskPath,
        success: existed,
        message: existed ? 'Task updated' : 'Task not found'
      });
    });

    socket.on('task:create', (payload: MockCreateCommand) => {
      this.creates.push(payload);
      const path = `\\Cronsole\\${payload.name}`;
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
          author: 'Cronsole E2E mock agent',
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
        arguments: '-NoProfile -ExecutionPolicy Bypass -File C:\\CronsoleE2E\\backup.ps1',
        workingDirectory: 'C:\\CronsoleE2E'
      }
    ],
    enabled: true,
    author: 'Cronsole E2E mock agent',
    description: 'Deterministic task for Playwright mock-agent coverage'
  };
}

