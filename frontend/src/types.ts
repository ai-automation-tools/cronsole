export interface Task {
  id: string;
  name: string;
  category: string;
  platform: string;
  status: string;
  externalId: string;
  updatedAt: string;
  schedule?: string;
  metadata?: Record<string, unknown>;
  // Flattened last-execution summary from GET /api/tasks
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  lastRunDurationMs?: number | null;
}

export interface ExecutionLogEntry {
  id: string;
  taskId: string;
  triggeredAt: string;
  status: string; // SUCCESS | FAILURE | TIMEOUT | PENDING
  log?: string | null;
  durationMs?: number | null;
  platformRunId?: string | null;
}

export interface TemplateParameter {
  key: string;
  label: string;
  type: string; // text | path | url | number | select
  default?: string;
  required?: boolean;
  help?: string;
  options?: string[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  sourcePlatform: string;
  targetPlatforms: string[];
  scheduleExpression: string;
  command: string;
  scriptType?: string;
  os?: string;
  category?: string;
  commandTemplate?: string | null;
  parameters?: TemplateParameter[] | null;
  isStarter?: boolean;
  icon?: string | null;
}

export interface PlatformLink {
  id: string;
  name: string;
  url: string;
  iconType: string;
}

export type HealthState = 'HEALTHY' | 'DEGRADED' | 'OFFLINE';

/** One row from GET /api/tasks/health — live status of a platform connection. */
export interface ConnectionHealth {
  platform: string;
  state: HealthState;
  reason?: string | null;
  lastSync?: string | null;
}
