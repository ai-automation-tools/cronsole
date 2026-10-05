import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import {
  PlatformConnector,
  TaskInfo,
  ConnectorHealth,
  CapabilityVerb,
  SyncOutcome,
  PlatformRunsResult,
  PlatformRunOutputResult
} from './platform.interface.js';
import {
  listWorkflows,
  getWorkflow,
  listExecutions,
  getExecution,
  isN8nPendingStatus,
  isN8nSuccessStatus,
  type N8nExecution,
  type N8nWorkflow
} from '../services/n8nApi.js';
import { readWorkflowSchedule } from '../services/n8nSchedule.js';
import { readConfig, N8N_CATEGORY } from '../services/n8nConnection.js';

/**
 * **n8n — an observer that reports outcomes.**
 *
 * The third read-only hosted source, and the first observer with real run
 * evidence on a platform that is *not* a CI system: GitHub reads conclusions,
 * Vercel reads nothing, and n8n publishes an execution per run with a status in
 * its own vocabulary. So `taskHealth` gets a real arm, and the run history tab
 * gets the platform's own list, where `ExecutionLog` — runs Cronsole performed —
 * is empty by design.
 *
 * **A task is a workflow with an enabled schedule node.** n8n workflows start
 * from forms, webhooks, chat, other workflows and the editor's own button;
 * only the schedule ones are what Cronsole manages. The rest are counted in the
 * sync's note rather than dropped in silence, because a sync that finds 90
 * workflows and keeps 20 must say so or it reads as having found 20.
 *
 * ## What is refused, and why
 *
 * - **`run`** — the public API has no execute endpoint. A webhook would start a
 *   run, but not the *scheduled* one: different trigger node, different input,
 *   and n8n records it as `mode: webhook`. Vercel's and GitHub's reason.
 * - **`setStatus`** — `activate` / `deactivate` exist, and switch the **whole
 *   workflow**: its webhook, form and chat triggers go dark with its schedule.
 *   A per-task toggle that silently disables a form somebody shares is a
 *   control the platform does not have. Revisit if that changes.
 * - **`create`** — a workflow is a graph of nodes and credentials; Cronsole
 *   writing one is building an n8n workflow, not scheduling a task.
 *
 * `updateSchedule`, `delete`, `export` and the rest are optional and absent.
 * `PUT /workflows/{id}` replaces the whole body and collides with n8n's
 * draft/publish model, so even the tempting one is not a safe edit.
 */
export class N8nConnector implements PlatformConnector {
  platform = PlatformType.N8N;

  /** A constant — a property of this connector's design, not of the install. */
  readonly unsupportedVerbs: readonly CapabilityVerb[] = ['run', 'create', 'setStatus'];

  /**
   * Declared and constant, Gemini's reason: one key sees one instance. Without
   * it a fresh connection has no rows and the first sync would filter out
   * everything it read (troubleshooting #75).
   */
  trackedCategories(): string[] {
    return [N8N_CATEGORY];
  }

  async syncTasks(config: any): Promise<SyncOutcome> {
    const { baseUrl, apiKey, timeZone } = readConfig(config);
    if (!baseUrl || !apiKey) return { tasks: [] };

    const listed = await listWorkflows(baseUrl, apiKey);
    // The whole read failed: throw, never `[]`, or `reconcileMissingTasks`
    // reads one bad key as every workflow deleted.
    if (!listed.ok) throw new Error(listed.message);

    const notes: string[] = [];
    const warnings: string[] = [];
    let historyFailures = 0;
    let unpublishedGraphs = 0;
    let missingZone = 0;
    const tasks: TaskInfo[] = [];

    const live = listed.data.workflows.filter(w => !w.isArchived);
    let scheduledCount = 0;

    for (const listedWorkflow of live) {
      let workflow = listedWorkflow;
      // The listing returned the draft without the published graph. Ask for the
      // one workflow; if that still has no published graph, the schedule is
      // refused below rather than read off a draft that may not be live.
      if (workflow.graph === 'draft-only') {
        const fetched = await getWorkflow(baseUrl, apiKey, workflow.id);
        if (fetched.ok && fetched.data) workflow = fetched.data;
      }

      const schedule = readWorkflowSchedule(workflow.nodes, {
        workflowZone: workflow.timezone,
        instanceZone: timeZone
      });
      if (!schedule.scheduled) continue;
      scheduledCount += 1;

      const runs = await listExecutions(baseUrl, apiKey, workflow.id);
      if (!runs.ok) historyFailures += 1;
      if (workflow.graph === 'draft-only') unpublishedGraphs += 1;

      const task = toTaskInfo(workflow, schedule, runs.ok ? runs.data : null);
      tasks.push(task);

      // A missing zone is one sentence for the whole sync, below; every other
      // refusal is about *this* workflow and is said by name. Never
      // suppressible: an empty schedule column with no sentence beside it reads
      // as a workflow that has no schedule.
      const zoneMissing = !schedule.timeZone && schedule.rules.length === 1 && schedule.rules[0]!.localCron !== null;
      if (zoneMissing) missingZone += 1;
      else if (workflow.graph !== 'draft-only' && schedule.reason) warnings.push(`${workflow.name}: ${schedule.reason}`);
    }

    notes.push(coverageNote(live.length, scheduledCount));

    if (missingZone > 0) {
      warnings.push(
        `n8n: ${missingZone} schedule${missingZone === 1 ? '' : 's'} run in the instance time zone, which the ` +
          'n8n API does not report, so no time is shown for them. Set the instance time zone on the n8n ' +
          'connection in the Sources tab.'
      );
    }
    if (unpublishedGraphs > 0) {
      warnings.push(
        `${unpublishedGraphs} workflow${unpublishedGraphs === 1 ? ' has' : 's have'} unpublished edits and n8n ` +
          'did not return the published version, so no schedule is shown for them.'
      );
    }
    if (historyFailures > 0) {
      warnings.push(
        `Could not read run history for ${historyFailures} of ${scheduledCount} scheduled workflow` +
          `${scheduledCount === 1 ? '' : 's'}. Their schedules are current; run results return on the next sync.`
      );
    }
    if (listed.data.truncated) {
      warnings.push('n8n: the workflow list was longer than Cronsole reads in one sync, so nothing was retired this time.');
    }

    const partial = listed.data.truncated || historyFailures > 0;
    return {
      tasks,
      notes,
      warnings,
      partial,
      // An unpaginated, successful listing is the instance's whole answer — so
      // unscheduling the last workflow retires its row (#95's lesson).
      ...(partial ? {} : { complete: true })
    };
  }

  async runTask(): Promise<{ success: boolean; ran?: boolean; message?: string }> {
    return {
      success: false,
      ran: false,
      message:
        'Cronsole cannot run an n8n workflow. The n8n API has no execute endpoint, and calling one of its ' +
        'webhooks would start a different run than the scheduled one. Use "Execute workflow" in n8n.'
    };
  }

  async setTaskStatus(): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Cronsole does not publish or unpublish n8n workflows. n8n switches a whole workflow at once — its ' +
        'webhooks and forms too, not just its schedule — so do it in n8n, where that is visible.'
    };
  }

  async createTask(): Promise<{ success: boolean; message?: string; foldersCreated?: string[]; refusedBeforeCalling?: boolean }> {
    return {
      success: false,
      foldersCreated: [],
      refusedBeforeCalling: true,
      message: 'Build the workflow in n8n with a Schedule Trigger and publish it, then sync — Cronsole reads it from there.'
    };
  }

  async listPlatformRuns(externalId: string, config: any): Promise<PlatformRunsResult> {
    const { baseUrl, apiKey } = readConfig(config);
    if (!baseUrl || !apiKey) return { success: false, message: 'No n8n connection is stored.' };

    const result = await listExecutions(baseUrl, apiKey, externalId);
    if (!result.ok) return { success: false, message: result.message };

    return {
      success: true,
      runs: result.data.map(run => ({
        id: run.id,
        status: run.status,
        startedAt: toDate(run.startedAt),
        endedAt: toDate(run.stoppedAt),
        outputAvailable: !isN8nPendingStatus(run.status)
      }))
    };
  }

  /**
   * Which nodes ran, how it ended, and where to read the rest.
   *
   * **No node data leaves n8n through here** — `toExecutionDetail` keeps node
   * names only. n8n has a real page per execution with the full data, so `url`
   * is set and is the honest route to the payload; Cronsole showing it would
   * mean holding somebody's API responses in a browser tab it does not need.
   */
  async getRunOutput(externalId: string, runId: string, config: any): Promise<PlatformRunOutputResult> {
    const { baseUrl, apiKey } = readConfig(config);
    if (!baseUrl || !apiKey) return { success: false, message: 'No n8n connection is stored.' };

    const result = await getExecution(baseUrl, apiKey, runId);
    if (!result.ok) {
      return {
        success: false,
        message: result.status === 404
          ? 'n8n no longer has that execution. Instances prune execution history, so a run can age out while its workflow is healthy.'
          : result.message
      };
    }
    const run = result.data;
    if (!run || (run.workflowId !== null && run.workflowId !== externalId)) {
      return { success: false, message: 'That execution does not belong to this workflow.' };
    }
    if (isN8nPendingStatus(run.status)) {
      return { success: false, message: 'This run is still going. Its steps exist once it finishes.' };
    }

    const facts: { label: string; value: string }[] = [{ label: 'Started by', value: describeMode(run.mode) }];
    const duration = durationOf(run);
    if (duration) facts.push({ label: 'Duration', value: duration });
    if (!isN8nSuccessStatus(run.status) && run.lastNodeExecuted) {
      facts.push({ label: 'Stopped at', value: run.lastNodeExecuted });
    }

    return {
      success: true,
      output: {
        text: run.errorMessage,
        steps: run.steps,
        facts,
        url: `${baseUrl}/workflow/${encodeURIComponent(externalId)}/executions/${encodeURIComponent(run.id)}`
      }
    };
  }

  /** Health from stored sync evidence, never from a probe — sync is the user's probe. */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const { baseUrl, apiKey } = readConfig(config);
    if (!baseUrl || !apiKey) {
      return { state: HealthState.UNKNOWN, reason: 'No n8n connection stored — nothing has been read yet.' };
    }

    const userId = config?.userId;
    if (typeof userId !== 'string' || !userId) {
      return { state: HealthState.UNKNOWN, reason: 'No evidence: connection is not scoped to a user' };
    }

    let row: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastFailureReason: string | null } | null;
    try {
      row = await prisma.platformCapability.findFirst({
        where: { userId, platform: PlatformType.N8N, verb: 'sync' },
        select: { lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true }
      });
    } catch {
      return { state: HealthState.UNKNOWN, reason: 'Could not read sync history for this platform' };
    }

    const succeeded = row?.lastSuccessAt ?? null;
    const failed = row?.lastFailureAt ?? null;
    if (!succeeded && !failed) {
      return { state: HealthState.UNKNOWN, reason: 'Connected, but nothing has been read yet. Sync to check.' };
    }
    if (failed && (!succeeded || failed > succeeded)) {
      return {
        state: HealthState.DEGRADED,
        reason: row?.lastFailureReason ? `Last sync failed: ${row.lastFailureReason}` : 'Last sync failed',
        lastContactAt: failed
      };
    }
    return { state: HealthState.HEALTHY, lastContactAt: succeeded ?? undefined };
  }
}

/**
 * One scheduled workflow as a Cronsole task. Exported for its own test.
 *
 * `runs` is null when the execution read failed — distinct from `[]`, which
 * means n8n answered and the workflow has never run.
 */
export function toTaskInfo(
  workflow: N8nWorkflow,
  schedule: ReturnType<typeof readWorkflowSchedule>,
  runs: N8nExecution[] | null
): TaskInfo {
  const draftOnly = workflow.graph === 'draft-only';
  const finished = (runs ?? []).filter(r => !isN8nPendingStatus(r.status));
  const latest = finished[0] ?? null;

  let streak = 0;
  for (const run of finished) {
    if (isN8nSuccessStatus(run.status)) break;
    streak += 1;
  }

  const reason = draftOnly
    ? 'This workflow has unpublished edits and n8n did not return the published version, so Cronsole cannot tell which schedule is live.'
    : schedule.reason;

  return {
    externalId: workflow.id,
    name: workflow.name,
    // An unpublished workflow fires nothing — that is DISABLED in Cronsole's words.
    status: workflow.active ? 'ACTIVE' : 'DISABLED',
    schedule: draftOnly ? null : schedule.cron,
    // n8n reports no next run, and computing one locally would disagree with
    // the platform's own scheduler with nothing on screen to say which was right.
    nextRunTime: null,
    metadata: {
      platformRules: schedule.rules,
      ...(schedule.timeZone ? { platformTimeZone: schedule.timeZone } : {}),
      ...(workflow.timezone && workflow.timezone !== 'DEFAULT' ? { workflowTimeZone: workflow.timezone } : {}),
      ...(reason ? { scheduleUnavailableReason: reason } : {}),
      graph: workflow.graph,
      ...(workflow.tags.length ? { tags: workflow.tags } : {}),
      // Present-and-boolean, never absent — see taskHealth.
      reportsRunResult: runs !== null,
      ...(runs !== null
        ? {
            executionCount: finished.length,
            consecutiveFailureCount: streak,
            ...(latest ? { lastStatus: latest.status, lastRunMode: latest.mode } : {}),
            ...(latest?.startedAt ? { lastRunTime: latest.startedAt } : {})
          }
        : {})
    }
  };
}

function coverageNote(total: number, scheduled: number): string {
  if (total === 0) return 'n8n: read 0 workflows — this instance has none.';
  return (
    `n8n: read ${total} workflow${total === 1 ? '' : 's'}, ${scheduled} with a schedule. ` +
    'Workflows started only by a form, webhook or the editor are not scheduled tasks.'
  );
}

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function describeMode(mode: string): string {
  switch (mode) {
    case 'trigger':
      return 'Schedule or other trigger';
    case 'manual':
      return 'Manual run in the editor';
    case 'webhook':
      return 'Webhook';
    case 'retry':
      return 'Retry';
    default:
      return mode;
  }
}

function durationOf(run: N8nExecution): string | null {
  const start = toDate(run.startedAt);
  const end = toDate(run.stoppedAt);
  if (!start || !end) return null;
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
