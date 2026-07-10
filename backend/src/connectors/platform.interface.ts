import { PlatformType, HealthState } from '@prisma/client';
import { WindowsTrigger } from '../utils/scheduler-conversion.js';
import { StructuredAction } from '../utils/commandParser.js';

export interface CreateTaskOptions {
  /**
   * Structured trigger produced by convertCronToWindowsTrigger. Platform
   * connectors that register native triggers (e.g. Windows Task Scheduler)
   * should prefer this over re-parsing the raw cron string.
   */
  trigger?: WindowsTrigger | null;
  /**
   * Structured { executable, args[] } action resolved server-side from raw
   * template parameters (utils/templateCommand.ts). Connectors that execute
   * commands should prefer this over re-tokenizing the `command` string, so a
   * parameter value can never split into extra arguments.
   */
  action?: StructuredAction;
}

export interface ConnectorHealth {
  state: HealthState;
  reason?: string;
  lastSync?: Date;
}

export interface TaskInfo {
  externalId: string;
  name: string;
  status: 'ACTIVE' | 'DISABLED';
  /** Normalized 5-field cron (UTC) derived from the platform's trigger, if expressible. */
  schedule?: string | null;
  /** Next scheduled run reported by the platform, or null if unset. */
  nextRunTime?: Date | null;
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
   * Create a new task on the platform. `schedule` is the normalized 5-field
   * cron (UTC); `options.trigger` carries the platform-native trigger when
   * the server was able to convert the cron.
   */
  createTask(name: string, schedule: string, command: string, config: any, options?: CreateTaskOptions): Promise<{ success: boolean; externalId?: string; message?: string }>;
}
