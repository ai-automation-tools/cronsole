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
  /**
   * Is this task owned by the OS rather than the user? Decided **server-side**
   * (TaskService.isSystemTask) and sent as a verdict, deliberately: re-deriving
   * "is this `\Microsoft\`?" in the browser would be a second definition of a
   * rule that decides what the user sees — the shape of troubleshooting #20a.
   * Optional so a response from an older backend degrades to "not system"
   * rather than hiding everything.
   */
  isSystem?: boolean;
  /**
   * Which **source** bar entry this task belongs to: a platform, or a platform
   * and a subtype (`TASKHUB_NATIVE:EXEC`).
   *
   * Server-derived like `isSystem`, because deciding it means reading
   * `metadata.job.jobType` and a browser-side copy of that judgement is a second
   * definition of the same rule. Absent on older payloads — callers fall back to
   * `platform`, which is exactly what a source key is when nothing subdivides.
   */
  source?: string;
  /**
   * Has *this viewer* starred the task? From the `TaskFavorite` join, per user —
   * never a column on Task. Optional on the wire so an older backend degrades to
   * "nothing is favorited" (which shows the normal dashboard) rather than to an
   * empty Favorites view.
   */
  isFavorite?: boolean;
  /**
   * Ids of *this viewer's* collections that hold the task — the
   * `TaskCollectionMember` join, per user, never a column. Ids rather than names
   * so renaming a collection is one write instead of a re-sync of every task.
   * Optional on the wire, same degradation rule as `isFavorite`.
   */
  collectionIds?: string[];
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

/**
 * One run the **platform** performed, read live from it.
 *
 * Not an `ExecutionLogEntry`, and the two are never merged in the UI:
 * `ExecutionLogEntry` is a row Cronsole wrote about something Cronsole did,
 * while this is the platform's own record of a run that simply happened. A task
 * can legitimately have a week of these and zero of those.
 */
export interface PlatformRun {
  id: string;
  /** The platform's own word — `completed`, `failed`, `in_progress`, … */
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Whether there is a transcript to fetch. False while a run is still going. */
  outputAvailable: boolean;
}

/** What one platform run produced. */
export interface PlatformRunOutput {
  text: string | null;
  /** What the run reached for, in order — the tools, steps or events it went through. */
  steps: string[];
  /**
   * Whatever else the platform reports, as label/value pairs — **never parsed**.
   *
   * Free-form because every source counts something different: Gemini reports
   * tokens, GitHub jobs and failed steps, Windows an exit code and the action
   * that produced it. A field per platform would make this shape the union of
   * every vocabulary, with each source sending null for the others'.
   */
  facts: { label: string; value: string }[];
  /** Where to see this run on the platform. Null where there is no such page. */
  url: string | null;
}

/** `available: false` carries a reason, because "why not" is the useful half. */
export interface PlatformRunOutputResponse {
  available: boolean;
  output?: PlatformRunOutput;
  reason?: string;
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
  /** Free-form tags (git, build, ai, …) — distinct from the single `category`. */
  tags?: string[];
  isStarter?: boolean;
  icon?: string | null;
  /** Per-user favorite flag (from the TemplateFavorite join), enriched by GET /templates. */
  isFavorite?: boolean;
}

export interface PlatformLink {
  id: string;
  name: string;
  url: string;
  iconType: string;
}

/** Result of POST /api/templates/import — a per-item summary of the batch. */
export interface ImportResult {
  total: number;
  created: string[];
  updated: string[];
  errors: { id?: string; error: string }[];
}

/**
 * UNKNOWN is the absence of a verdict, not a fourth severity. It means Cronsole
 * has nothing current to go on — a platform never exercised, or a failure old
 * enough to be a fact about the past. Renders muted and neutral, because it is
 * neither a warning to act on nor a green light.
 */
export type HealthState = 'HEALTHY' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';

/** One row from GET /api/tasks/health — live status of a platform connection. */
export interface ConnectionHealth {
  platform: string;
  state: HealthState;
  reason?: string | null;
  /**
   * When the task list was last pulled from this platform. Written only by
   * `POST /api/tasks/sync`, so it is always a sync that really happened.
   */
  lastSync?: string | null;
  /**
   * When the platform last said anything — liveness, not freshness.
   *
   * Two fields and not one, because they answer different questions and were
   * briefly the same value: the Windows connector reported its last inbound
   * event *as* `lastSync`, so "Synced 7m ago" appeared over a task list from the
   * previous day (troubleshooting #41). Never render this as "synced".
   */
  lastContactAt?: string | null;
}
