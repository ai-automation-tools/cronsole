import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WindowsAgentConnector, UNRESPONSIVE_EVIDENCE_TTL_MS, AGENT_REQUEST_TIMEOUT_MS } from '../WindowsAgentConnector.js';
import { agentManager } from '../../ws/AgentManager.js';
import { signCommand, type SignableCommand } from '../../ws/agentAuth.js';

// Mock AgentManager
vi.mock('../../ws/AgentManager.js', () => ({
  agentManager: {
    getSocket: vi.fn(),
    markResponsive: vi.fn(),
    markUnresponsive: vi.fn(),
    getLiveness: vi.fn()
  }
}));

const SESSION_KEY = 'test-session-key-1234567890';

/** Find the args a mock socket was emitted with for a given event. */
function emitArgs(socket: any, event: string): any[] | undefined {
  const call = socket.emit.mock.calls.find((c: any[]) => c[0] === event);
  return call?.slice(1);
}

/**
 * Assert the emitted command carries a valid signature for `cmd`.
 *
 * The signature is recomputed from the nonce and ts that were ACTUALLY emitted,
 * then compared against the emitted sig — so this verifies the payload is
 * internally consistent (the nonce on the wire is the one that was signed),
 * which is what the agent will check. `toEqual` keeps it exact, so a new wire
 * field fails here rather than silently reaching the agent.
 */
function expectSignedCommand(socket: any, event: string, cmd: SignableCommand) {
  const [payload] = emitArgs(socket, event) ?? [];
  expect(payload).toBeDefined();
  expect(typeof payload.ts).toBe('number');
  // Every signed command carries a fresh per-command nonce (troubleshooting #16).
  expect(typeof payload.nonce).toBe('string');
  expect(payload.nonce.length).toBeGreaterThan(0);
  const { sig } = signCommand(SESSION_KEY, cmd, payload.ts, payload.nonce);
  const { event: _e, ...fields } = cmd;
  expect(payload).toEqual({ ...fields, nonce: payload.nonce, ts: payload.ts, sig });
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
                path: '\\Cronsole\\Nightly', name: 'Nightly', state: 'Ready',
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
    const result = await connector.exportTask('\\Cronsole\\Nightly', { userId: 'test_user' });
    expect(result).toEqual({ success: false, message: 'Agent offline' });
  });

  it('exportTask emits an unsigned task:export and returns the agent XML', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:exported') {
        setTimeout(() => handler({
          taskExternalId: '\\Cronsole\\Nightly',
          success: true,
          xml: '<Task><Settings/></Task>',
          message: 'Exported'
        }), 10);
      }
    });

    const result = await connector.exportTask('\\Cronsole\\Nightly', { userId: 'test_user' });

    // Read-only: a plain (unsigned) emit, unlike run/delete/update.
    expect(mockSocket.emit).toHaveBeenCalledWith('task:export', { taskPath: '\\Cronsole\\Nightly' });
    expect(result.success).toBe(true);
    expect(result.xml).toBe('<Task><Settings/></Task>');
  });

  it('importTask returns a refusal when the socket is missing', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const result = await connector.importTask('\\Work\\Job', '<Task/>', { overwrite: false, createFolders: false }, { userId: 'test_user' });
    expect(result).toEqual({ success: false, outcome: 'refused', message: 'Agent offline', foldersCreated: [] });
  });

  it('importTask emits a SIGNED task:import carrying the XML and both flags', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    const xml = '<Task><RegistrationInfo><URI>\\Work\\Job</URI></RegistrationInfo></Task>';
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:imported') {
        setTimeout(() => handler({
          taskExternalId: '\\Work\\Job',
          success: true,
          outcome: 'created',
          message: 'Task restored',
          foldersCreated: ['\\Work']
        }), 10);
      }
    });

    const result = await connector.importTask('\\Work\\Job', xml, { overwrite: true, createFolders: true }, { userId: 'test_user' });

    // Unlike export, this one WRITES — so it is signed, and the signature covers
    // the XML and both flags (expectSignedCommand is exact, so a field going
    // missing from the wire fails here rather than at the agent).
    expectSignedCommand(mockSocket, 'task:import', {
      event: 'task:import',
      taskPath: '\\Work\\Job',
      xml,
      overwrite: true,
      createFolders: true
    });
    expect(result).toEqual({
      success: true,
      outcome: 'created',
      message: 'Task restored',
      foldersCreated: ['\\Work']
    });
  });

  it('importTask treats an outcome it does not recognize as a refusal', async () => {
    // An outcome we cannot interpret must never read as success — that is the
    // direction where being wrong costs the user a task.
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:imported') {
        setTimeout(() => handler({ taskExternalId: '\\Work\\Job', success: true, outcome: 'probably-fine' }), 10);
      }
    });

    const result = await connector.importTask('\\Work\\Job', '<Task/>', { overwrite: false, createFolders: false }, { userId: 'test_user' });
    expect(result.outcome).toBe('refused');
    expect(result.foldersCreated).toEqual([]);
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
            taskExternalId: '\\Cronsole\\Task1',
            success: true,
            message: 'Task deleted'
          });
        }, 10);
      }
    });

    const result = await connector.deleteTask('\\Cronsole\\Task1', { userId: 'test_user' });

    expectSignedCommand(mockSocket, 'task:delete', { event: 'task:delete', taskPath: '\\Cronsole\\Task1' });
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
          handler({ taskExternalId: '\\Cronsole\\Task1', success: true, message: 'Schedule updated' });
        }, 10);
      }
    });

    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const result = await connector.updateSchedule('\\Cronsole\\Task1', '0 3 * * *', { userId: 'test_user' }, { trigger });

    expectSignedCommand(mockSocket, 'task:update_schedule', {
      event: 'task:update_schedule',
      taskPath: '\\Cronsole\\Task1',
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
    const result = await connector.updateSchedule('\\Task1', '0 3 * * *', { userId: 'test_user' }, { trigger });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Task not found');
  });

  it('should fail to update a schedule if agent offline', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const result = await connector.updateSchedule('\\Task1', '0 3 * * *', { userId: 'test_user' }, { trigger });
    expect(result.success).toBe(false);
    expect(result.message).toBe('Agent offline');
  });

  it('should timeout if schedule update takes too long', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
    vi.useFakeTimers();

    const trigger = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
    const updatePromise = connector.updateSchedule('\\Task1', '0 3 * * *', { userId: 'test_user' }, { trigger });
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
          handler({ taskExternalId: '\\Cronsole\\Task1', success: true, message: 'Task updated' });
        }, 10);
      }
    });

    const input = {
      action: { executable: 'powershell.exe', args: ['-File', 'C:\\x.ps1'] },
      workingDirectory: 'C:\\scripts',
      description: 'Nightly job',
      runLevel: 'highest' as const
    };
    const result = await connector.updateActions('\\Cronsole\\Task1', input, { userId: 'test_user' });

    expectSignedCommand(mockSocket, 'task:update', {
      event: 'task:update',
      taskPath: '\\Cronsole\\Task1',
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

  it('signs the chosen folder into task:create, normalized', async () => {
    // The folder decides WHERE the task lands, and Windows silently overwrites a
    // same-named task in the same folder — so it must be covered by the
    // signature, and normalized first so the agent verifies the same bytes we
    // signed (a trailing slash or forward slashes would otherwise break the HMAC).
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({ name: 'NewTask', success: true, path: '\\Work\\Backups\\NewTask', message: 'Success' });
        }, 10);
      }
    });

    await connector.createTask(
      'NewTask',
      '0 3 * * *',
      'echo hello',
      { userId: 'test_user' },
      { folder: '/Work/Backups/' }
    );

    expectSignedCommand(
      mockSocket,
      'task:create',
      {
        event: 'task:create',
        name: 'NewTask',
        schedule: '0 3 * * *',
        command: 'echo hello',
        action: { executable: 'echo', args: ['hello'] },
        trigger: null,
        folder: '\\Work\\Backups',
        // Asserted explicitly: a create that did not ask for a folder must sign
        // false, or every existing caller would silently gain the ability to
        // create folders it can't remove.
        createFolder: false
      }
    );
  });

  it('signs createFolder when the caller opts in', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({ name: 'NewTask', success: true, path: '\\NewTree\\NewTask', message: 'Success' });
        }, 10);
      }
    });

    await connector.createTask(
      'NewTask',
      '0 3 * * *',
      'echo hello',
      { userId: 'test_user' },
      { folder: '\\NewTree', createFolder: true }
    );

    expectSignedCommand(
      mockSocket,
      'task:create',
      {
        event: 'task:create',
        name: 'NewTask',
        schedule: '0 3 * * *',
        command: 'echo hello',
        action: { executable: 'echo', args: ['hello'] },
        trigger: null,
        folder: '\\NewTree',
        createFolder: true
      }
    );
  });

  it('reports the folders a create had to make, on success and on failure', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({
            name: 'NewTask',
            success: true,
            path: '\\NewTree\\NewTask',
            message: 'Success',
            foldersCreated: ['\\NewTree']
          });
        }, 10);
      }
    });

    const result = await connector.createTask(
      'NewTask', '0 3 * * *', 'echo hello',
      { userId: 'test_user' }, { folder: '\\NewTree', createFolder: true }
    );

    expect(result.success).toBe(true);
    expect(result.foldersCreated).toEqual(['\\NewTree']);
  });

  it('carries foldersCreated through a FAILED create', async () => {
    // The case that matters most and is easiest to lose: the chain was made and
    // the registration then failed, so a real folder exists that needs an admin
    // to remove. Reporting it only on success would hide exactly that.
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({
            name: 'NewTask',
            success: false,
            message: 'Access is denied.',
            foldersCreated: ['\\NewTree']
          });
        }, 10);
      }
    });

    const result = await connector.createTask(
      'NewTask', '0 3 * * *', 'echo hello',
      { userId: 'test_user' }, { folder: '\\NewTree', createFolder: true }
    );

    expect(result.success).toBe(false);
    expect(result.foldersCreated).toEqual(['\\NewTree']);
  });

  it('reads an agent that omits foldersCreated as "created nothing"', async () => {
    // A pre-republish agent sends no such field. That must read as [], not
    // undefined — the route spreads it and the MCP tool renders it.
    vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);

    mockSocket.on.mockImplementation((event: string, handler: any) => {
      if (event === 'task:created') {
        setTimeout(() => {
          handler({ name: 'NewTask', success: true, path: '\\NewTask', message: 'Success' });
        }, 10);
      }
    });

    const result = await connector.createTask(
      'NewTask', '0 3 * * *', 'echo hello', { userId: 'test_user' }
    );

    expect(result.foldersCreated).toEqual([]);
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
        trigger: null,
        // No folder passed → the default. Asserted explicitly (not It.Any-style)
        // so this proves existing callers still land in \Cronsole.
        folder: '\\Cronsole',
        createFolder: false
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
        trigger,
        folder: '\\Cronsole',
        createFolder: false
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

  /**
   * Health is a claim about the agent, and the agent is the only thing that can
   * evidence it. These pin the rule that a socket object is not evidence — the
   * bug that let a wedged agent report HEALTHY and "synced just now" while every
   * request against it timed out (troubleshooting #40).
   */
  describe('getHealth', () => {
    const CONFIG = { userId: 'test_user' };

    it('is OFFLINE with no socket', async () => {
      vi.mocked(agentManager.getSocket).mockReturnValue(undefined);

      const health = await connector.getHealth(CONFIG);

      expect(health.state).toBe('OFFLINE');
      expect(health.reason).toBe('Agent not connected');
      expect(health.lastContactAt).toBeUndefined();
    });

    it('never invents a contact time: a connected agent that has answered nothing reports none', async () => {
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue({ connectedAt: new Date() });

      const health = await connector.getHealth(CONFIG);

      // Healthy — the authenticated handshake is real evidence it was alive.
      expect(health.state).toBe('HEALTHY');
      // But it has said nothing, so there is no contact time to report.
      expect(health.lastContactAt).toBeUndefined();
    });

    it('reports the real time of the agent\'s last response as lastSync', async () => {
      const answered = new Date('2026-08-11T10:00:00.000Z');
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue({
        connectedAt: new Date('2026-08-11T09:00:00.000Z'),
        lastResponseAt: answered
      });

      const health = await connector.getHealth(CONFIG);

      expect(health.state).toBe('HEALTHY');
      expect(health.lastContactAt).toBe(answered);
      // And NOT as a sync. An inbound event of any kind proves the agent is
      // alive; it says nothing about when the task list was last pulled, and
      // conflating the two printed "Synced 7m ago" over day-old data (#41).
      expect('lastSync' in health).toBe(false);
    });

    /**
     * How long ago the timeout happened is now part of the verdict, so these
     * cases fix the clock instead of relying on wall time.
     *
     * Note what changed underneath them: the dates here were absolute and
     * arbitrary while the rule was only "newest evidence wins". The moment
     * freshness mattered they quietly became *two days stale*, and the DEGRADED
     * assertion below started passing for the wrong reason — which is how a
     * suite keeps agreeing with itself through a behaviour change.
     */
    const FAILED_AT = new Date('2026-08-11T10:05:00.000Z');
    const RESPONDED_AT = new Date('2026-08-11T10:00:00.000Z');

    /** Liveness where a timeout is the newest evidence, as in the live defect. */
    const timedOut = {
      connectedAt: new Date('2026-08-11T09:00:00.000Z'),
      lastResponseAt: RESPONDED_AT,
      lastFailureAt: FAILED_AT,
      lastFailureVerb: 'task:list'
    };

    /** Fix "now" at `msAfterFailure` past the timeout. */
    const atAge = (msAfterFailure: number) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(FAILED_AT.getTime() + msAfterFailure));
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('is DEGRADED when the newest evidence is a RECENT timeout, and names the verb', async () => {
      // The exact live case: the socket is present and the handshake succeeded,
      // but discovery timed out a minute ago. A later timeout outranks an earlier
      // handshake — otherwise the wedged agent reads as healthy forever.
      atAge(60_000);
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue(timedOut);

      const health = await connector.getHealth(CONFIG);

      expect(health.state).toBe('DEGRADED');
      expect(health.reason).toContain('task:list');
      // The last contact is still reported — it happened, it is just older than
      // the failure. Degraded means "stale", not "we know nothing".
      expect(health.lastContactAt).toEqual(RESPONDED_AT);
    });

    it('is still DEGRADED exactly at the TTL — the boundary is inclusive', async () => {
      atAge(UNRESPONSIVE_EVIDENCE_TTL_MS);
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue(timedOut);

      expect((await connector.getHealth(CONFIG)).state).toBe('DEGRADED');
    });

    it('becomes UNKNOWN once the timeout is older than the TTL', async () => {
      // One millisecond past, so this pins the rule and not a comfortable margin.
      atAge(UNRESPONSIVE_EVIDENCE_TTL_MS + 1);
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue(timedOut);

      const health = await connector.getHealth(CONFIG);

      expect(health.state).toBe('UNKNOWN');
      // Not HEALTHY: nothing observed a recovery. Not DEGRADED: nothing observed
      // the failure continuing either. The reason has to carry both halves —
      // what went wrong, and why there is nothing newer than it.
      expect(health.reason).toContain('task:list');
      expect(health.reason).toContain('nothing has been asked of the agent since');
      // Still reported. It is real, and it is what makes "since" checkable.
      expect(health.lastContactAt).toEqual(RESPONDED_AT);
    });

    it('is UNKNOWN on a stale timeout even when the agent has never responded', async () => {
      // No lastResponseAt at all: connected, answered nothing, one old timeout.
      // The failure branch is reached by the `!lastContactAt` arm rather than by
      // comparison, so it needs its own case or the aging rule is only proven on
      // one of the two paths into it.
      atAge(UNRESPONSIVE_EVIDENCE_TTL_MS * 40); // ~10 hours, the live case
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue({
        connectedAt: new Date('2026-08-11T09:00:00.000Z'),
        lastFailureAt: FAILED_AT,
        lastFailureVerb: 'task:folders'
      });

      const health = await connector.getHealth(CONFIG);

      expect(health.state).toBe('UNKNOWN');
      expect(health.reason).toContain('task:folders');
      expect(health.lastContactAt).toBeUndefined();
    });

    it('a stale timeout does not survive a newer response', async () => {
      // Aging must not outrank real evidence: a response after the failure is
      // HEALTHY however old both are, because the newest thing we know is good.
      atAge(UNRESPONSIVE_EVIDENCE_TTL_MS * 40);
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue({
        ...timedOut,
        lastResponseAt: new Date(FAILED_AT.getTime() + 5_000)
      });

      expect((await connector.getHealth(CONFIG)).state).toBe('HEALTHY');
    });

    it('is HEALTHY again once a response arrives after a timeout', async () => {
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.mocked(agentManager.getLiveness).mockReturnValue({
        connectedAt: new Date('2026-08-11T09:00:00.000Z'),
        lastFailureAt: new Date('2026-08-11T10:00:00.000Z'),
        lastFailureVerb: 'task:list',
        lastResponseAt: new Date('2026-08-11T10:05:00.000Z')
      });

      const health = await connector.getHealth(CONFIG);

      expect(health.state).toBe('HEALTHY');
    });

    it('records the agent as unresponsive when a request times out', async () => {
      vi.mocked(agentManager.getSocket).mockReturnValue(mockSocket);
      vi.useFakeTimers();

      const syncPromise = connector.syncTasks(CONFIG);
      vi.advanceTimersByTime(15500);
      await expect(syncPromise).rejects.toThrow('Agent sync timeout');

      // Without this the timeout is invisible to getHealth and the wedged agent
      // keeps reporting HEALTHY — the whole defect in one assertion.
      expect(agentManager.markUnresponsive).toHaveBeenCalledWith('test_user', 'task:list');
      vi.useRealTimers();
    });
  });
});

/**
 * A verb that SUCCEEDS must never report a timeout afterwards.
 *
 * Every verb used to schedule its 15-second deadline and never cancel it, so a
 * request answered in 200ms still ran `markUnresponsive` a quarter of a minute
 * later. The stale `resolve`/`reject` was a no-op — the promise had settled —
 * so the only surviving effect was a stamp on the health record, and Windows
 * reported "Agent connected but not responding (task:list timed out)" fifteen
 * seconds after every successful sync. It could not stay HEALTHY longer than
 * that between requests.
 *
 * Table-driven over all ten verbs on purpose: the defect was ten copies of one
 * mistake, and the next verb is the one at risk. A new agent verb belongs in
 * this table.
 */
describe('a successful agent request cancels its own deadline', () => {
  const CONFIG = { userId: 'test_user' };
  const TRIGGER = { type: 'Daily' as const, startBoundary: '03:00', daysInterval: 1 };
  const ACTION_INPUT = {
    action: { executable: 'cmd.exe', args: [] },
    workingDirectory: '',
    description: '',
    runLevel: 'least' as const
  };

  const ROUND_TRIPS: {
    verb: string;
    responseEvent: string;
    payload: Record<string, unknown>;
    call: (c: WindowsAgentConnector) => Promise<unknown>;
  }[] = [
    { verb: 'task:list', responseEvent: 'task:full_list', payload: { tasks: [] },
      call: c => c.syncTasks(CONFIG) },
    { verb: 'task:run', responseEvent: 'task:executed', payload: { taskExternalId: '\T', success: true },
      call: c => c.runTask('\T', CONFIG) },
    { verb: 'task:delete', responseEvent: 'task:deleted', payload: { taskExternalId: '\T', success: true },
      call: c => c.deleteTask('\T', CONFIG) },
    { verb: 'task:folders', responseEvent: 'task:folders_list', payload: { success: true, folders: [] },
      call: c => c.listFolders(CONFIG) },
    { verb: 'task:export', responseEvent: 'task:exported', payload: { taskExternalId: '\T', success: true, xml: '<Task/>' },
      call: c => c.exportTask('\T', CONFIG) },
    { verb: 'task:import', responseEvent: 'task:imported', payload: { taskExternalId: '\T', success: true, outcome: 'created' },
      call: c => c.importTask('\T', '<Task/>', { overwrite: false, createFolders: false }, CONFIG) },
    { verb: 'task:set_status', responseEvent: 'task:status_set', payload: { taskExternalId: '\T', success: true },
      call: c => c.setTaskStatus('\T', true, CONFIG) },
    { verb: 'task:update_schedule', responseEvent: 'task:schedule_updated', payload: { taskExternalId: '\T', success: true },
      call: c => c.updateSchedule('\T', '0 3 * * *', CONFIG, { trigger: TRIGGER }) },
    { verb: 'task:update', responseEvent: 'task:updated', payload: { taskExternalId: '\T', success: true },
      call: c => c.updateActions('\T', ACTION_INPUT, CONFIG) },
    { verb: 'task:create', responseEvent: 'task:created', payload: { name: 'T', success: true, path: '\Cronsole\T' },
      call: c => c.createTask('T', '0 3 * * *', 'notepad.exe', CONFIG) }
  ];

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each(ROUND_TRIPS)('$verb', async ({ responseEvent, payload, call }) => {
    vi.useFakeTimers();
    const socket = {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (p: unknown) => void) => {
        if (event === responseEvent) setTimeout(() => handler(payload), 10);
      }),
      off: vi.fn(),
      data: { sessionKey: SESSION_KEY }
    };
    vi.mocked(agentManager.getSocket).mockReturnValue(socket as never);

    const pending = call(new WindowsAgentConnector());
    await vi.advanceTimersByTimeAsync(10);
    await pending;

    // The request is finished. Nothing may happen to the health record after
    // this, however long the process stays up.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(agentManager.markUnresponsive).not.toHaveBeenCalled();
    // And the listener is released rather than accumulating one per request.
    expect(socket.off).toHaveBeenCalledWith(responseEvent, expect.any(Function));
  });
});

describe('platform run history — the detail Windows publishes nowhere else', () => {
  const config = { userId: 'test_user' };
  let connector: WindowsAgentConnector;
  let socket: any;

  beforeEach(() => {
    connector = new WindowsAgentConnector();
    socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), data: { sessionKey: SESSION_KEY } };
    vi.mocked(agentManager.getSocket).mockReturnValue(socket);
  });

  afterEach(() => vi.clearAllMocks());

  /** Answer the agent's `task:history` request with a canned payload. */
  const answerHistory = (payload: Record<string, unknown>) => {
    socket.emit.mockImplementation((event: string) => {
      if (event !== 'task:history') return;
      const handler = socket.on.mock.calls.find((c: any[]) => c[0] === 'task:history_list')?.[1];
      handler?.({ taskExternalId: '\Folder\Task', success: true, ...payload });
    });
  };

  const evt = (eventId: number, timeCreated: string, message = '', level: number | null = 4) =>
    ({ eventId, level, timeCreated, message });

  it('says history is switched off rather than reporting no runs', async () => {
    // The distinction the whole agent-side reader exists for: a disabled log and
    // a task that has never run are both zero events. Reporting them the same way
    // tells a user their nightly task has never run.
    answerHistory({ historyEnabled: false, events: [] });
    const result = await connector.listPlatformRuns!('\Folder\Task', config);

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/not recording task history/i);
    // And it says the fix is not retroactive, because turning it on will not
    // bring back the run the user is looking for.
    expect(result.message).toMatch(/not retroactive/i);
  });

  it('groups several events into one run, not one run per event', async () => {
    // Task Scheduler writes started / action-completed / completed per run, so a
    // raw list would show "3 runs" for one night.
    answerHistory({
      historyEnabled: true,
      events: [
        evt(102, '2026-08-25T03:00:09Z', 'Task completed'),
        evt(201, '2026-08-25T03:00:08Z', 'Action "C:\backup.cmd" completed with return code 0'),
        evt(100, '2026-08-25T03:00:00Z', 'Task started')
      ]
    });

    const result = await connector.listPlatformRuns!('\Folder\Task', config);
    expect(result.runs).toHaveLength(1);
    expect(result.runs![0]).toMatchObject({ id: '2026-08-25T03:00:00Z', status: 'completed' });
  });

  it('reports a run Windows flagged as an error as failed', async () => {
    answerHistory({
      historyEnabled: true,
      events: [
        evt(103, '2026-08-25T03:00:02Z', 'Action failed to start', 2),
        evt(100, '2026-08-25T03:00:00Z', 'Task started')
      ]
    });
    const result = await connector.listPlatformRuns!('\Folder\Task', config);
    expect(result.runs![0]!.status).toBe('failed');
  });

  it('keeps two nights apart, newest first', async () => {
    answerHistory({
      historyEnabled: true,
      events: [
        evt(102, '2026-08-25T03:00:05Z'),
        evt(100, '2026-08-25T03:00:00Z'),
        evt(102, '2026-08-24T03:00:05Z'),
        evt(100, '2026-08-24T03:00:00Z')
      ]
    });
    const result = await connector.listPlatformRuns!('\Folder\Task', config);
    expect(result.runs).toHaveLength(2);
    expect(result.runs![0]!.id).toBe('2026-08-25T03:00:00Z');
  });

  it('surfaces the exit code and the action beside the events', async () => {
    // The exit code is what the task card already shows as a bare number.
    // Opening the run is how you find out which action produced it.
    answerHistory({
      historyEnabled: true,
      events: [
        evt(201, '2026-08-25T03:00:08Z', 'Action "C:\backup.cmd" completed with return code 2147942401'),
        evt(100, '2026-08-25T03:00:00Z', 'Task started')
      ]
    });

    const result = await connector.getRunOutput!('\Folder\Task', '2026-08-25T03:00:00Z', config);
    expect(result.success).toBe(true);
    expect(result.output!.facts).toContainEqual({ label: 'Exit code', value: '2147942401' });
    expect(result.output!.facts).toContainEqual({ label: 'Action', value: 'C:\backup.cmd' });
    // Windows' own sentence kept verbatim — rewriting it would put a translation
    // between the user and the only detail this platform gives.
    expect(result.output!.text).toContain('return code 2147942401');
    // Task Scheduler is an MMC snap-in, not a web page.
    expect(result.output!.url).toBeNull();
  });

  it('explains a run that has aged out of the ring buffer', async () => {
    answerHistory({ historyEnabled: true, events: [] });
    const result = await connector.getRunOutput!('\Folder\Task', 'gone', config);
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/no longer has an entry/i);
  });

  it('refuses without an agent rather than reporting an empty history', async () => {
    vi.mocked(agentManager.getSocket).mockReturnValue(undefined);
    expect(await connector.listPlatformRuns!('\Folder\Task', config)).toMatchObject({
      success: false,
      message: 'Agent offline'
    });
  });
});

describe('an optional verb an old agent lacks is not evidence of a sick agent', () => {
  it('does not mark the agent unresponsive when a history request times out', async () => {
    // A published agent from before 2026-08-25 has no `task:history` handler, so
    // it will never answer. Recording that as a timeout would hold the whole
    // Windows platform at DEGRADED for fifteen minutes because someone opened a
    // tab — #62's shape, manufactured by something that is not a health check.
    vi.useFakeTimers();
    const connector = new WindowsAgentConnector();
    const socket = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), data: { sessionKey: SESSION_KEY } };
    vi.mocked(agentManager.getSocket).mockReturnValue(socket as any);

    const pending = connector.listPlatformRuns!('\Folder\Task', { userId: 'test_user' });
    await vi.advanceTimersByTimeAsync(AGENT_REQUEST_TIMEOUT_MS + 100);
    const result = await pending;

    expect(agentManager.markUnresponsive).not.toHaveBeenCalled();
    // And the message names the actual likely cause rather than blaming the agent.
    expect(result.message).toMatch(/republish/i);
    vi.useRealTimers();
  });
});
