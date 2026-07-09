import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowsAgentConnector } from '../WindowsAgentConnector.js';
import { agentManager } from '../../ws/AgentManager.js';

// Mock AgentManager
vi.mock('../../ws/AgentManager.js', () => ({
  agentManager: {
    getSocket: vi.fn()
  }
}));

describe('WindowsAgentConnector', () => {
  let connector: WindowsAgentConnector;
  let mockSocket: any;

  beforeEach(() => {
    connector = new WindowsAgentConnector();
    mockSocket = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn()
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
    
    expect(mockSocket.emit).toHaveBeenCalledWith('task:run', '\\Task1');
    expect(result.success).toBe(true);
    expect(result.message).toBe('Success');
  });
  
  it('should return offline health if socket missing', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const health = await connector.getHealth({ userId: 'test_user' });
    expect(health.state).toBe('OFFLINE');
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

  it('should set task status successfully', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    const result = await connector.setTaskStatus('\\Task1', true, { userId: 'test_user' });
    expect(mockSocket.emit).toHaveBeenCalledWith('task:set_status', '\\Task1', true);
    expect(result.success).toBe(true);
  });

  it('should return false if setting status and agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const result = await connector.setTaskStatus('\\Task1', true, { userId: 'test_user' });
    expect(result.success).toBe(false);
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

    expect(mockSocket.emit).toHaveBeenCalledWith('task:create', { name: 'NewTask', schedule: '0 3 * * *', command: 'echo hello', trigger: null });
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

    expect(mockSocket.emit).toHaveBeenCalledWith('task:create', {
      name: 'NewTask',
      schedule: '0 8 * * *',
      command: 'echo hello',
      trigger
    });
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
