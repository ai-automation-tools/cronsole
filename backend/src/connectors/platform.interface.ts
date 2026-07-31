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
  /**
   * Normalized native folder to create the task in — Windows Task Scheduler
   * only (e.g. `\Cronsole`, `\Work\Backups`). Defaults to `\Cronsole` when unset.
   * Must already have passed windowsTaskFolderError: it is part of the signed
   * command, and the agent re-validates it before registering.
   */
  folder?: string;
}

/**
 * A real native folder a task can live in. Reported honestly, including ones
 * Cronsole will not write to — the UI shows WHY a folder is unavailable rather
 * than hiding it (leaving the user wondering) or offering it and failing late.
 */
export interface PlatformFolder {
  /** Normalized native path, e.g. `\`, `\Cronsole`, `\Microsoft\Windows`. */
  path: string;
  /** Tasks directly in this folder, excluding subfolders. */
  taskCount: number;
  /** False for `\Microsoft\` and descendants — Windows' own tasks live there. */
  writable: boolean;
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
  /**
   * List the platform's real task folders, so the UI can offer actual
   * destinations instead of assuming one. Optional — only platforms with a
   * native folder hierarchy (Windows Task Scheduler) implement it; others get
   * an honest 400 from the route. Read-only.
   */
  listFolders?(config: any): Promise<{ success: boolean; folders: PlatformFolder[]; message?: string }>;

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

  /**
   * Export the platform's native task definition (read-only). Optional —
   * implemented only where the platform has a portable native format. The
   * Windows agent returns the task's Task Scheduler XML (round-trips into any
   * Windows machine); Cronsole-native tasks have no such format and are exported
   * as JSON directly from the DB by the route, so this stays connector-specific.
   */
  exportTask?(externalId: string, config: any): Promise<{ success: boolean; xml?: string; message?: string }>;

  /**
   * Register a task from its native definition — the inverse of exportTask, and
   * the restore half of the backup story. Optional for the same reason export is:
   * only platforms with a portable native format can do it.
   *
   * Unlike export this WRITES, so the whole input (path, XML, and both flags) is
   * covered by the command signature and re-validated by the agent, which holds
   * the elevation. Implementations must NOT overwrite an existing task unless
   * `overwrite` is set — that refusal is the feature, not a limitation.
   */
  importTask?(
    externalId: string,
    xml: string,
    options: { overwrite: boolean; createFolders: boolean },
    config: any
  ): Promise<ImportTaskResult>;
}

/**
 * Outcome of restoring one task. Four states rather than a boolean, because
 * collapsing them lies in both directions: `exists` is not a failure (nothing
 * went wrong and the user's task is intact) and not a success (nothing was
 * restored). `foldersCreated` is always reported — Cronsole creating a folder is
 * a carve-out to a standing invariant, so it may never be silent.
 */
export interface ImportTaskResult {
  success: boolean;
  outcome: 'created' | 'replaced' | 'exists' | 'refused';
  message?: string;
  foldersCreated: string[];
}
