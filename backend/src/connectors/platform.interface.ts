import { PlatformType, HealthState } from '@prisma/client';

export interface ConnectorHealth {
  state: HealthState;
  reason?: string;
  lastSync?: Date;
}

export interface TaskInfo {
  externalId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  metadata?: any;
}

export interface PlatformConnector {
  platform: PlatformType;

  /**
   * Sync tasks from the platform.
   * Returns a list of normalized task information.
   */
  syncTasks(config: any): Promise<TaskInfo[]>;

  /**
   * Trigger a task run.
   */
  runTask(externalId: string, config: any): Promise<{ success: boolean; platformRunId?: string; message?: string }>;

  /**
   * Enable/Disable a task.
   */
  setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean }>;

  /**
   * Check health of the connection.
   */
  getHealth(config: any): Promise<ConnectorHealth>;

  /**
   * Create a new task on the platform.
   */
  createTask(name: string, schedule: string, command: string, config: any): Promise<{ success: boolean; externalId?: string; message?: string }>;
}
