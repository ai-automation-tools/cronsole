import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowsAgentConnector } from '../WindowsAgentConnector.js';
import { agentManager } from '../../ws/AgentManager.js';
import { signCommand, type SignableCommand } from '../../ws/agentAuth.js';

// Mock AgentManager
vi.mock('../../ws/AgentManager.js', () => ({
  agentManager: {
    getSocket: vi.fn()
  }
}));

const SESSION_KEY = 'test-session-key-1234567890';

/** Find the args a mock socket was emitted with for a given event. */
function emitArgs(socket: any, event: string): any[] | undefined {
  const call = socket.emit.mock.calls.find((c: any[]) => c[0] === event);
  return call?.slice(1);
}

/** Assert the emitted command carries a valid signature for `cmd`. */
function expectSignedCommand(socket: any, event: string, cmd: SignableCommand) {
  const [payload] = emitArgs(socket, event) ?? [];
  expect(payload).toBeDefined();
  expect(typeof payload.ts).toBe('number');
  const { sig } = signCommand(SESSION_KEY, cmd, payload.ts);
  const { event: _e, ...fields } = cmd;
  expect(payload).toEqual({ ...fields, ts: payload.ts, sig });
}

describe('WindowsAgentConnector', () => {
  let connector: WindowsAgentConnector;
  let mockSocket: any;

  beforeEach(() => {
    connector = new WindowsAgentConnector();
    mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      data: { sessionKey: SESSION_KEY }
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should throw "Agent offline" if socket not found in syncTasks', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    await expect(connector.syncTasks({ userId: 'test_user' })).rejects.toThrow('Agent offline');
  });

  it('should sync tasks successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    // Setup socket.on to immediately call the handler with fake data
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:full_list') {
        setTimeout(() => {
          handler({
            tasks: [
              { path: '\\Task1', name: 'Task1', state: 'Ready' },
              { path: '\\Task2', name: 'Task2', state: 'Disabled' }
            ]
          });
        }, 10);
      }
    });

    const tasks = await connector.syncTasks({ userId: 'test_user' });
    
    expect(mockSocket.emit).toHaveBeenCalledWith('task:list');
    expect(tasks).toHaveLength(2);
    expect(tasks[0].status).toBe('ACTIVE');
    expect(tasks[1].status).toBe('DISABLED');
  });

  it('should derive cron + nextRunTime from a trigger and null out sentinels', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:full_list') {
        setTimeout(() => {
          handler({
            tasks: [
              {
                path: '\\TaskHub\\Nightly', name: 'Nightly', state: 'Ready',
                nextRunTime: '2026-07-09T03:00:00Z',
                trigger: { type: 'Daily', startBoundary: '03:00', daysInterval: 1 }
              },
              {
                // No expressible trigger + unset (sentinel) next run.
                path: '\\Boot', name: 'Boot', state: 'Ready',
                nextRunTime: '0001-01-01T00:00:00', trigger: null
              }
            ]
          });
        }, 10);
      }
    });

    const tasks = await connector.syncTasks({ userId: 'test_user' });

    expect(tasks[0].schedule).toBe('0 3 * * *');
    expect(tasks[0].nextRunTime).toEqual(new Date('2026-07-09T03:00:00Z'));
    expect(tasks[1].schedule).toBeNull();
    expect(tasks[1].nextRunTime).toBeNull();
  });

  it('should run a task successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:executed') {
        setTimeout(() => {
          handler({
            taskExternalId: '\\Task1',
            success: true,
            output: 'Success'
          });
        }, 10);
      }
    });

    const result = await connector.runTask('\\Task1', { userId: 'test_user' });

    expectSignedCommand(mockSocket, 'task:run', { event: 'task:run', taskPath: '\\Task1' });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Success');
  });
  
  it('should return offline health if socket missing', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const health = await connector.getHealth({ userId: 'test_user' });
    expect(health.state).toBe('OFFLINE');
  });

  it('exportTask returns "Agent offline" when the socket is missing', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const result = await connector.exportTask('\\TaskHub\\Nightly', { userId: 'test_user' });
    expect(result).toEqual({ success: false, message: 'Agent offline' });
  });

  it('exportTask emits an unsigned task:export and returns the agent XML', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:exported') {
        setTimeout(() => handler({
          taskExternalId: '\\TaskHub\\Nightly',
          success: true,
          xml: '<Task><Settings/></Task>',
          message: 'Exported'
        }), 10);
      }
    });

    const result = await connector.exportTask('\\TaskHub\\Nightly', { userId: 'test_user' });

    // Read-only: a plain (unsigned) emit, unlike run/delete/update.
    expect(mockSocket.emit).toHaveBeenCalledWith('task:export', { taskPath: '\\TaskHub\\Nightly' });
    expect(result.success).toBe(true);
    expect(result.xml).toBe('<Task><Settings/></Task>');
  });

  it('should throw "Invalid task list received from agent" if payload is missing tasks', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:full_list') {
        setTimeout(() => {
          handler({}); // Missing tasks array
        }, 10);
      }
    });

    await expect(connector.syncTasks({ userId: 'test_user' })).rejects.toThrow('Invalid task list received from agent');
  });

  it('should timeout if sync tasks takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    // Don't mock the response handler, letting it hit the 15s timeout
    vi.useFakeTimers();
    
    const syncPromise = connector.syncTasks({ userId: 'test_user' });
    vi.advanceTimersByTime(15500);
    
    await expect(syncPromise).rejects.toThrow('Agent sync timeout');
    vi.useRealTimers();
  });

  it('should timeout if run task takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();
    
    const runPromise = connector.runTask('\\Task1', { userId: 'test_user' });
    vi.advanceTimersByTime(15500);
    
    const result = await runPromise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent trigger timeout');
    vi.useRealTimers();
  });

  it('should delete a task successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:deleted') {
        setTimeout(() => {
          handler({
            taskExternalId: '\\TaskHub\\Task1',
            success: true,
            message: 'Task deleted'
          });
        }, 10);
      }
    });

    const result = await connector.deleteTask('\\TaskHub\\Task1', { userId: 'test_user' });

    expectSignedCommand(mockSocket, 'task:delete', { event: 'task:delete', taskPath: '\\TaskHub\\Task1' });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Task deleted');
  });

  it('should surface an agent-side delete failure', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:deleted') {
        setTimeout(() => {
          handler({ taskExternalId: '\\Task1', success: false, message: 'Access is denied' });
        }, 10);
      }
    });

    const result = await connector.deleteTask('\\Task1', { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Access is denied');
  });

  it('should fail to delete a task if agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const result = await connector.deleteTask('\\Task1', { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent offline');
  });

  it('should timeout if delete task takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();

    const deletePromise = connector.deleteTask('\\Task1', { userId: 'test_user' });
    vi.advanceTimersByTime(15500);

    const result = await deletePromise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent delete timeout');
    vi.useRealTimers();
  });

  it('should set task status successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:status_set') {
        setTimeout(() => {
          handler({ taskExternalId: '\\Task1', success: true });
        }, 10);
      }
    });

    const result = await connector.setTaskStatus('\\Task1', true, { userId: 'test_user' });
    expectSignedCommand(mockSocket, 'task:set_status', { event: 'task:set_status', taskPath: '\\Task1', enabled: true });
    expect(result.success).toBe(true);
  });

  it('should return false if setting status and agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const result = await connector.setTaskStatus('\\Task1', true, { userId: 'test_user' });
    expect(result.success).toBe(false);
  });

  it('should timeout if set status takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();

    const setStatusPromise = connector.setTaskStatus('\\Task1', true, { userId: 'test_user' });
    vi.advanceTimersByTime(15500);

    const result = await setStatusPromise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent status update timeout');
    vi.useRealTimers();
  });

  it('should update a task schedule successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:schedule_updated') {
        setTimeout(() => {
          handler({ taskExternalId: '\\TaskHub\\Task1', success: true, message: 'Schedule updated' });
        }, 10);
      }
    });

    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const result = await connector.updateSchedule('\\TaskHub\\Task1', trigger, { userId: 'test_user' });

    expectSignedCommand(mockSocket, 'task:update_schedule', {
      event: 'task:update_schedule',
      taskPath: '\\TaskHub\\Task1',
      trigger
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Schedule updated');
  });

  it('should surface an agent-side schedule-update failure', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:schedule_updated') {
        setTimeout(() => {
          handler({ taskExternalId: '\\Task1', success: false, message: 'Task not found' });
        }, 10);
      }
    });

    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const result = await connector.updateSchedule('\\Task1', trigger, { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Task not found');
  });

  it('should fail to update a schedule if agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const result = await connector.updateSchedule('\\Task1', trigger, { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent offline');
  });

  it('should timeout if schedule update takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();

    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const updatePromise = connector.updateSchedule('\\Task1', trigger, { userId: 'test_user' });
    vi.advanceTimersByTime(15500);

    const result = await updatePromise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent schedule update timeout');
    vi.useRealTimers();
  });

  it('should update a task action successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:updated') {
        setTimeout(() => {
          handler({ taskExternalId: '\\TaskHub\\Task1', success: true, message: 'Task updated' });
        }, 10);
      }
    });

    const input = {
      action: { executable: 'powershell.exe', args: ['-File', 'C:\\x.ps1'] },
      workingDirectory: 'C:\\scripts',
      description: 'Nightly job',
      runLevel: 'highest' as const
    };
    const result = await connector.updateActions('\\TaskHub\\Task1', input, { userId: 'test_user' });

    expectSignedCommand(mockSocket, 'task:update', {
      event: 'task:update',
      taskPath: '\\TaskHub\\Task1',
      ...input
    });
    expect(result.success).toBe(true);
    expect(result.message).toBe('Task updated');
  });

  it('should surface an agent-side action-update failure', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:updated') {
        setTimeout(() => {
          handler({ taskExternalId: '\\Task1', success: false, message: 'This task requires administrator rights to edit.' });
        }, 10);
      }
    });

    const input = {
      action: { executable: 'cmd.exe', args: [] },
      workingDirectory: '',
      description: '',
      runLevel: 'least' as const
    };
    const result = await connector.updateActions('\\Task1', input, { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('This task requires administrator rights to edit.');
  });

  it('should fail to update an action if agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const input = {
      action: { executable: 'cmd.exe', args: [] },
      workingDirectory: '',
      description: '',
      runLevel: 'least' as const
    };
    const result = await connector.updateActions('\\Task1', input, { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent offline');
  });

  it('should timeout if action update takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();

    const input = {
      action: { executable: 'cmd.exe', args: [] },
      workingDirectory: '',
      description: '',
      runLevel: 'least' as const
    };
    const updatePromise = connector.updateActions('\\Task1', input, { userId: 'test_user' });
    vi.advanceTimersByTime(15500);

    const result = await updatePromise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent action update timeout');
    vi.useRealTimers();
  });

  it('should create a task successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({
            name: 'NewTask',
            success: true,
            path: '\\NewTask',
            message: 'Success'
          });
        }, 10);
      }
    });

    const result = await connector.createTask('NewTask', '0 3 * * *', 'echo hello', { userId: 'test_user' });

    expectSignedCommand(
      mockSocket,
      'task:create',
      {
        event: 'task:create',
        name: 'NewTask',
        schedule: '0 3 * * *',
        command: 'echo hello',
        action: { executable: 'echo', args: ['hello'] },
        trigger: null
      }
    );
    expect(result.success).toBe(true);
    expect(result.externalId).toBe('\\NewTask');
    expect(result.message).toBe('Success');
  });

  it('should pass the structured trigger through the task:create payload', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({ name: 'NewTask', success: true, path: '\\NewTask', message: 'Success' });
        }, 10);
      }
    });

    const trigger = {
      type: 'Daily' as const,
      startBoundary: '08:00',
      daysInterval: 1
    };

    const result = await connector.createTask('NewTask', '0 8 * * *', 'echo hello', { userId: 'test_user' }, { trigger });

    expectSignedCommand(
      mockSocket,
      'task:create',
      {
        event: 'task:create',
        name: 'NewTask',
        schedule: '0 8 * * *',
        command: 'echo hello',
        action: { executable: 'echo', args: ['hello'] },
        trigger
      }
    );
    expect(result.success).toBe(true);
  });

  it('should fail to create a task if agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const result = await connector.createTask('NewTask', '0 3 * * *', 'echo hello', { userId: 'test_user' });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent offline');
  });

  it('should timeout if create task takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();
    
    const createPromise = connector.createTask('NewTask', '0 3 * * *', 'echo hello', { userId: 'test_user' });
    vi.advanceTimersByTime(15500);
    
    const result = await createPromise;
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent creation timeout');
    vi.useRealTimers();
  });
});
