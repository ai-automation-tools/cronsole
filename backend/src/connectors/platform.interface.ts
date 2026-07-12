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

/**
 * The editable action + settings for an existing platform task, resolved
 * server-side. The action is the structured { executable, args[] } form (same
 * no-shell model as create); workingDirectory/description are normalized to an
 * empty string when unset so the signed canonical form is unambiguous.
 */
export interface UpdateActionsInput {
  action: StructuredAction;
  workingDirectory: string;
  description: string;
  runLevel: 'least' | 'highest';
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
   * Enable/Disable a task. `message` carries a platform failure reason (e.g. an
   * elevation/ACL refusal) the route surfaces on a non-success result.
   */
  setTaskStatus(externalId: string, enabled: boolean, config: any): Promise<{ success: boolean; message?: string }>;

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

  /**
   * Change the schedule (trigger) of an existing platform task, leaving its
   * action and settings intact. Optional — only platforms that register native
   * triggers (Windows Task Scheduler) implement it; others get an honest 400
   * from the route. `trigger` is the structured form produced by
   * convertCronToWindowsTrigger for the new cron.
   */
  updateSchedule?(externalId: string, trigger: WindowsTrigger, config: any): Promise<{ success: boolean; message?: string }>;

  /**
   * Change the action (executable + args + working dir) and selected settings
   * (description, run level) of an existing platform task, leaving its trigger,
   * principal identity, and other settings intact. Optional — only Windows Task
   * Scheduler implements it today; other platforms get an honest 400. The whole
   * input is covered by the task:update HMAC signature.
   */
  updateActions?(externalId: string, input: UpdateActionsInput, config: any): Promise<{ success: boolean; message?: string }>;

  /**
   * Delete the platform's native task entry. Optional — platforms that can't
   * remove their real entry (quick-link platforms, the experimental Claude
   * connector) simply don't implement it, and the DELETE route refuses rather
   * than leaving an orphaned native task behind. Implementations should be
   * idempotent: deleting a task that no longer exists on the platform is a
   * success (the desired end state holds).
   */
  deleteTask?(externalId: string, config: any): Promise<{ success: boolean; message?: string }>;
}
