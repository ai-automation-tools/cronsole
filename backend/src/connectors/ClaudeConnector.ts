import axios from 'axios';
import { PlatformType, HealthState } from '@prisma/client';
import { PlatformConnector, TaskInfo, ConnectorHealth, CreateTaskOptions } from './platform.interface.js';

/**
 * Claude Code Routines Connector
 * 
 * Note: Based on experimental 2026 API docs, routines are triggered via a 
 * per-routine token. Listing routines globally via API is currently limited.
 * 
 * Expected config:
 * {
 *   routines: [
 *     { id: 'trig_xxx', token: 'sk-ant-oat01-xxx', name: 'My Routine' },
 *     ...
 *   ]
 * }
 */
export class ClaudeConnector implements PlatformConnector {
  platform = PlatformType.CLAUDE_CODE;

  async syncTasks(config: any): Promise<TaskInfo[]> {
    if (!config || !config.routines) return [];

    // For now, we "sync" by returning the list provided in config
    // In a future update, we might poll a hypothetical list endpoint
    return config.routines.map((r: any) => ({
      externalId: r.id,
      name: r.name || r.id,
      status: 'ACTIVE', // Assuming active if present
      metadata: { ...r, token: undefined } // Don't expose token in metadata
    }));
  }

  async runTask(externalId: string, config: any): Promise<{ success: boolean; platformRunId?: string; message?: string }> {
    const routine = config.routines?.find((r: any) => r.id === externalId);
    if (!routine || !routine.token) {
      return { success: false, message: 'Routine token not found in config' };
    }

    try {
      const response = await axios.post(
        `https://api.anthropic.com/v1/claude_code/routines/${externalId}/fire`,
        { text: 'Triggered from TaskHub' },
        {
          headers: {
            'Authorization': `Bearer ${routine.token}`,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'experimental-cc-routine-2026-04-01',
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        platformRunId: response.data.claude_code_session_id,
        message: `Session started: ${response.data.claude_code_session_url}`
      };
    } catch (error: any) {
      console.error('Claude API Error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.error?.message || error.message
      };
    }
  }

  async setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean }> {
    // Anthropic API doesn't currently support enabling/disabling via HTTP API Fire endpoint.
    // This would likely be done in the Claude.ai Web UI.
    return { success: false };
  }

  async getHealth(config: any): Promise<ConnectorHealth> {
    if (!config || !config.routines || config.routines.length === 0) {
      return { state: HealthState.DEGRADED, reason: 'No routines configured' };
    }
    // We could potentially try a dry-run or check one token,
    // but for now we'll assume healthy if config exists.
    return { state: HealthState.HEALTHY, lastSync: new Date() };
  }

  async createTask(name: string, schedule: string, command: string, config: any, options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string }> {
    return { success: false, message: 'Creating Claude routines via API is not yet supported' };
  }
}
