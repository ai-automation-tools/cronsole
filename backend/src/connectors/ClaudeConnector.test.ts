import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ClaudeConnector } from './ClaudeConnector.js';
import { HealthState } from '@prisma/client';

vi.mock('axios');

describe('ClaudeConnector', () => {
  let connector: ClaudeConnector;

  beforeEach(() => {
    connector = new ClaudeConnector();
    vi.clearAllMocks();
  });

  it('should sync tasks from config', async () => {
    const config = {
      routines: [
        { id: 'trig_1', token: 'sk-1', name: 'Task 1' },
        { id: 'trig_2', token: 'sk-2', name: 'Task 2' }
      ]
    };

    const tasks = await connector.syncTasks(config);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].externalId).toBe('trig_1');
    expect(tasks[0].name).toBe('Task 1');
    expect(tasks[0].metadata.token).toBeUndefined(); // Should not expose token
  });

  it('should run a task successfully', async () => {
    const config = {
      routines: [{ id: 'trig_1', token: 'sk-1', name: 'Task 1' }]
    };

    (axios.post as any).mockResolvedValue({
      data: {
        claude_code_session_id: 'sess_123',
        claude_code_session_url: 'https://claude.ai/sess_123'
      }
    });

    const result = await connector.runTask('trig_1', config);
    expect(result.success).toBe(true);
    expect(result.platformRunId).toBe('sess_123');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('trig_1'),
      expect.any(Object),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer sk-1'
        })
      })
    );
  });

  it('should handle run failure', async () => {
    const config = {
      routines: [{ id: 'trig_1', token: 'sk-1', name: 'Task 1' }]
    };

    (axios.post as any).mockRejectedValue({
      response: { data: { error: { message: 'API Error' } } }
    });

    const result = await connector.runTask('trig_1', config);
    expect(result.success).toBe(false);
    expect(result.message).toBe('API Error');
  });

  it('should report health state', async () => {
    const config = { routines: [{ id: '1' }] };
    const health = await connector.getHealth(config);
    expect(health.state).toBe(HealthState.HEALTHY);

    const emptyHealth = await connector.getHealth({});
    expect(emptyHealth.state).toBe(HealthState.DEGRADED);
  });
});
