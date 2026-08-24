import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import {
  PlatformConnector,
  TaskInfo,
  ConnectorHealth,
  CapabilityVerb
} from './platform.interface.js';
import {
  listWorkflows,
  listWorkflowRuns,
  workflowSchedules,
  type GitHubRun,
  type GitHubWorkflow
} from '../services/githubActions.js';
import {
  readConfig,
  repoFullName,
  workflowExternalId,
  type StoredRepository
} from '../services/githubRepositories.js';

/**
 * **GitHub Actions — Cronsole's first read-only observer.**
 *
 * Every connector before this one could change something. Windows registers,
 * reschedules and deletes real Task Scheduler entries through the elevated
 * agent; Claude fires routines and, through door 2, creates and pauses them;
 * Cronsole-native *is* the task. This one reads and stops.
 *
 * ## An observer is a finished state, not a stalled one
 *
 * That claim only became true on 2026-08-12, when the Platforms tab grew into a
 * capability matrix. Before it, a partial connector **lied**: the UI implied
 * every verb the interface mandated, so a platform Cronsole could only read
 * rendered a Run button that did nothing useful and an Enable toggle that
 * silently failed. `unsupportedVerbs` makes the boundary a *cell*, and a cell
 * that says `unsupported` says strictly more than a bookmark does. So the
 * guardrail — "two excellent connectors beat six half connectors" — is satisfied
 * here not by doing more, but by never implying more.
 *
 * ## Why this platform, and why it is easy
 *
 * Three properties, and each one removes a layer the other platforms need:
 *
 * **`on: schedule` cron is already UTC.** GitHub documents it as UTC with no
 * timezone support, which is Cronsole's storage contract exactly. Nothing is
 * converted anywhere in this file — no trigger conversion, no lossy warning, and
 * none of the DST asymmetry Windows carries between a wall-clock trigger and a
 * cron.
 *
 * **The run outcomes are real.** `conclusion` is `success` / `failure` /
 * `cancelled` / `timed_out` — the outcome of the *work*. Windows can only tell
 * Cronsole "the agent accepted a start" (`ExecutionLog` records runs Cronsole
 * *performed*), so health scoring is better-founded on the platform Cronsole
 * cannot touch than on the one it controls most. Carried in task metadata and
 * read by `services/taskHealth.ts`; **nothing here writes `ExecutionLog`**, which
 * would claim Cronsole ran something it did not.
 *
 * **A workflow is a file, so the schedule needs a second request.** The
 * workflows API returns id, name, path and state and never the triggers. That is
 * the one place this connector is more work than it looks, and it is why an
 * unreadable file yields `schedule: null` **with a reason in metadata** rather
 * than an invented cron.
 *
 * ## What is deliberately not here
 *
 * `deleteTask`, `exportTask`, `importTask`, `updateSchedule`, `updateActions`
 * and `listFolders` are absent, so `verbReachability` reports them
 * `unsupported` from their absence. `run`, `create` and `setStatus` are mandated
 * by the interface, so they are named in {@link unsupportedVerbs} — and each one
 * is a real boundary of this connector rather than of GitHub:
 *
 * - **`create`** would mean committing a workflow file to the user's default
 *   branch. Cronsole writing to somebody's repository to make a task is not a
 *   scheduler feature, it is a code change, and it is not one a "New Task"
 *   button should be able to make.
 * - **`setStatus`** and **`run`** *do* have APIs (`PUT .../disable`,
 *   `POST .../dispatches`). They are refused because this ships as an observer:
 *   a `workflow_dispatch` run is not the scheduled run, and enabling a workflow
 *   is a repository-state change. Both are a deliberate later step with their own
 *   scopes and their own confirmation, not a thing to slip in behind a read.
 */
export class GitHubActionsConnector implements PlatformConnector {
  platform = PlatformType.GITHUB_ACTIONS;

  /**
   * The three interface-mandated verbs this connector cannot perform.
   *
   * A **fixed array, unlike Claude's getter** — and the difference is the whole
   * distinction the matrix draws. Claude's answer changes with the install (a
   * readable Claude Code session turns `create` from a boundary into a verb), so
   * a constant could only be right in one of two worlds. Here the answer is a
   * property of *this connector's design*, not of the machine it runs on: no
   * token, scope or configuration makes Cronsole create a workflow. A constant
   * is the honest shape when the boundary is genuinely fixed.
   *
   * The optional verbs are unsupported by **absence** (`verbReachability` reads
   * `typeof connector.deleteTask === 'function'`), and listing them here too
   * would be a second statement of one fact, free to disagree with the first.
   */
  readonly unsupportedVerbs: readonly CapabilityVerb[] = ['run', 'create', 'setStatus'];

  /**
   * Every scheduled workflow in the repositories the user named.
   *
   * **Only scheduled ones.** A workflow with no `on: schedule` is not a
   * scheduled task and has no business on a scheduled-task dashboard — it would
   * arrive with no cron, no next run and nothing to be healthy or unhealthy
   * about, which is a row that can only ever say "unknown".
   *
   * Three refusals rather than guesses, in order of how easily each would have
   * become a quiet lie:
   *
   * **A repository that fails to enumerate does not empty the sync.** It is
   * skipped and the others proceed, so one revoked scope or one renamed
   * repository cannot flip every other workflow to MISSING. The failure travels
   * as a thrown error only when *nothing* could be read — see below.
   *
   * **An unreadable workflow file yields `schedule: null` plus a reason**, never
   * an assumed cron. `metadata.scheduleReason` carries it and the UI shows it,
   * because "Cronsole could not read this" and "this has no schedule" demand
   * different actions.
   *
   * **`status` reflects GitHub's `state`, which has four values, not two.** A
   * workflow disabled for 60 days of repository inactivity is `DISABLED` here
   * with the reason in metadata — GitHub does that silently, and a workflow
   * someone believes is nightly having quietly stopped two months ago is exactly
   * the failure this observer exists to surface.
   */
  async syncTasks(config: any): Promise<TaskInfo[]> {
    const { token, repositories } = readConfig(config);
    if (!token || repositories.length === 0) return [];

    const tasks: TaskInfo[] = [];
    const failures: string[] = [];

    for (const repository of repositories) {
      const listed = await listWorkflows(token, repository.owner, repository.repo);
      if (!listed.ok) {
        failures.push(`${repoFullName(repository)}: ${listed.message}`);
        continue;
      }

      // Named out loud rather than truncated silently. A repository with more
      // than 100 workflows is past what one page returns, and a sync that read
      // the first hundred and reported success would mark the rest MISSING.
      if (listed.data.total > listed.data.workflows.length) {
        failures.push(
          `${repoFullName(repository)}: ${listed.data.total} workflows, of which Cronsole read ` +
            `${listed.data.workflows.length} — GitHub returns at most 100 per page and Cronsole does not page here.`
        );
      }

      for (const workflow of listed.data.workflows) {
        const task = await this.toTaskInfo(token, repository, workflow);
        if (task) tasks.push(task);
      }
    }

    // **Only when nothing could be read at all.** A partial sync is the normal
    // case and returning what we have is right — but an empty list from a
    // connection that *has* repositories is indistinguishable from "every
    // workflow was deleted", and `reconcileMissingTasks` would act on it. So the
    // one case that must not return `[]` quietly is the one where every
    // repository failed: throwing makes `POST /sync` record the failure against
    // the `sync` capability and report it per platform, and the reconcile step
    // never runs.
    if (tasks.length === 0 && failures.length > 0) {
      throw new Error(failures.join(' · '));
    }

    return tasks;
  }

  /** One workflow as a Cronsole task, or null when it has no schedule. */
  private async toTaskInfo(
    token: string,
    repository: StoredRepository,
    workflow: GitHubWorkflow
  ): Promise<TaskInfo | null> {
    const schedules = await workflowSchedules(token, repository.owner, repository.repo, workflow.path);

    // A read failure is not "no schedule". Keep the workflow, say why we cannot
    // read its cron, and let the row be honest about not knowing.
    const scheduleReason = schedules.ok ? schedules.data.reason : schedules.message;
    const crons = schedules.ok ? schedules.data.crons : [];

    // Not scheduled and we could read the file: it belongs to `push` or
    // `workflow_dispatch` and is not a scheduled task.
    if (crons.length === 0 && !scheduleReason) return null;

    const runs = await listWorkflowRuns(token, repository.owner, repository.repo, workflow.id, 5);
    const history = runs.ok ? runs.data : [];

    return {
      externalId: workflowExternalId(repository, workflow.id),
      name: workflow.name,
      status: workflow.state === 'active' ? 'ACTIVE' : 'DISABLED',
      // **The first cron, with the rest reported in metadata.** `Task.schedule`
      // is one 5-field string — the storage contract — and a workflow may
      // declare several. Picking one and hiding the others would make the row
      // quietly wrong about when it runs, so `metadata.allSchedules` carries
      // them all and the UI can say "and 2 more".
      schedule: crons[0] ?? null,
      // **Never computed locally.** GitHub queues scheduled runs on a best-effort
      // basis and delays them under load — on a busy hour by tens of minutes —
      // so a next-run time derived from the cron would disagree with what
      // actually happens, with nothing on screen to say which was right. The API
      // does not return a next-run time for a workflow, so Cronsole reports
      // none. The same call the Claude connector makes about Anthropic's jitter,
      // reached from the opposite direction.
      nextRunTime: null,
      metadata: {
        repository: repoFullName(repository),
        workflowId: workflow.id,
        path: workflow.path,
        state: workflow.state,
        url: workflow.html_url,
        ...(crons.length > 1 ? { allSchedules: crons } : {}),
        ...(scheduleReason ? { scheduleReason } : {}),
        ...(workflow.state !== 'active' ? { disabledReason: describeState(workflow.state) } : {}),
        ...runMetadata(history),
        // Present-and-true rather than implied by the platform, so
        // `taskHealth.ts` can tell "GitHub reported no runs" from "Cronsole
        // never asked" — the `reportsRunResult` distinction one platform over,
        // which exists because reading an absent key as "never ran" flagged
        // every Windows task on a real machine at once.
        reportsRunResult: runs.ok
      }
    };
  }

  /**
   * `run` is impossible here — see {@link unsupportedVerbs}.
   *
   * Required by the interface, so it exists and answers honestly. The route
   * answers **400** rather than 502 for it (`verbDeclaredUnsupported` picks the
   * status), because a verb the connector cannot perform is not the platform
   * having a moment.
   */
  async runTask(): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Cronsole cannot run a GitHub Actions workflow. It reads your scheduled workflows and their ' +
        'run outcomes and changes nothing — run one from the repository\'s Actions tab.'
    };
  }

  /** Enable/disable is impossible here — see {@link unsupportedVerbs}. */
  async setTaskStatus(): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Cronsole cannot enable or disable a GitHub Actions workflow. Use the workflow\'s own page in ' +
        'the repository\'s Actions tab.'
    };
  }

  /** Creating is impossible here — see {@link unsupportedVerbs}. */
  async createTask(): Promise<{ success: boolean; message?: string; foldersCreated?: string[] }> {
    return {
      success: false,
      foldersCreated: [],
      message:
        'Creating a GitHub Actions workflow means committing a file to your repository, which Cronsole ' +
        'does not do. Add the workflow in the repository, then sync.'
    };
  }

  /**
   * Health from stored evidence, never from a probe.
   *
   * `getHealth` runs on the dashboard's 45-second poll **per open tab**, and
   * GitHub's REST API is rate-limited at 5,000 requests an hour for a PAT. A
   * probing health check would spend that budget on a question the user answers
   * themselves every time they sync — the same conclusion the Windows and Claude
   * connectors reached, for three different reasons that all land here:
   * **sync is the user's probe.**
   *
   * So this reads back the `PlatformCapability` row `POST /api/tasks/sync`
   * already writes. Every branch reporting an *absence* of evidence returns
   * `UNKNOWN` rather than `DEGRADED`: never having synced is not a degradation,
   * and amber over something nobody can act on gets read at the same weight as
   * amber over something they should.
   */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const { token, repositories } = readConfig(config);

    if (!token) {
      return { state: HealthState.UNKNOWN, reason: 'No GitHub token stored — nothing has been read yet.' };
    }
    if (repositories.length === 0) {
      return {
        state: HealthState.UNKNOWN,
        reason: 'Connected, but no repositories are being watched yet. Add one to start reading workflows.'
      };
    }

    const userId = config?.userId;
    if (typeof userId !== 'string' || !userId) {
      return { state: HealthState.UNKNOWN, reason: 'No evidence: connection is not scoped to a user' };
    }

    let row: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastFailureReason: string | null } | null;
    try {
      row = await prisma.platformCapability.findFirst({
        where: { userId, platform: PlatformType.GITHUB_ACTIONS, verb: 'sync' },
        select: { lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true }
      });
    } catch {
      // Reading the evidence is not the subject of the check. A DB hiccup here
      // must not be reported as GitHub being unhealthy.
      return { state: HealthState.UNKNOWN, reason: 'Could not read sync history for this platform' };
    }

    const succeeded = row?.lastSuccessAt ?? null;
    const failed = row?.lastFailureAt ?? null;

    if (!succeeded && !failed) {
      const count = repositories.length;
      return {
        state: HealthState.UNKNOWN,
        reason: `${count} repositor${count === 1 ? 'y' : 'ies'} configured, none read yet. Sync to check.`
      };
    }

    if (failed && (!succeeded || failed > succeeded)) {
      return {
        state: HealthState.DEGRADED,
        reason: row?.lastFailureReason ? `Last sync failed: ${row.lastFailureReason}` : 'Last sync failed',
        // A rejection is contact: GitHub answered, and the answer was no.
        lastContactAt: failed
      };
    }

    return { state: HealthState.HEALTHY, lastContactAt: succeeded ?? undefined };
  }

  // deleteTask, exportTask, importTask, updateSchedule, updateActions and
  // listFolders are deliberately absent. Their absence is what makes
  // `verbReachability` report them `unsupported`, so there is exactly one
  // statement of each boundary — see the class comment.
}

/** GitHub's four workflow states, in the user's terms. */
function describeState(state: string): string {
  switch (state) {
    case 'disabled_manually':
      return 'Disabled in the repository\'s Actions tab.';
    case 'disabled_inactivity':
      return 'GitHub disabled this scheduled workflow after 60 days without repository activity. It will not run until someone re-enables it.';
    case 'disabled_fork':
      return 'Disabled because this is a fork — GitHub does not run scheduled workflows on forks by default.';
    default:
      return `GitHub reports this workflow as "${state}".`;
  }
}

/**
 * The last outcome and a short streak, from the scheduled runs GitHub returned.
 *
 * Only what a health signal needs, and each field is a fact GitHub stated. In
 * particular `lastConclusion` is left **absent** — not defaulted to anything —
 * when a run is still in flight, because `conclusion` is null until a run
 * finishes and reading that as a failure would flag every workflow mid-run.
 */
function runMetadata(runs: GitHubRun[]): Record<string, unknown> {
  const finished = runs.filter(r => r.conclusion !== null);
  const last = finished[0];
  if (!last) {
    // Present-and-empty: GitHub answered, and the answer was that there are no
    // finished scheduled runs. Distinct from the key being absent, which is what
    // a failed run query leaves behind.
    return { scheduledRunCount: 0 };
  }

  // How many of the most recent finished runs failed in a row. Short by
  // construction (we ask for 5), so it is a streak *seen*, never a claim about
  // the whole history — which is why it is named alongside the sample size.
  let streak = 0;
  for (const run of finished) {
    if (run.conclusion === 'success') break;
    streak += 1;
  }

  return {
    scheduledRunCount: finished.length,
    lastConclusion: last.conclusion,
    ...(last.run_started_at ? { lastRunTime: last.run_started_at } : {}),
    ...(last.html_url ? { lastRunUrl: last.html_url } : {}),
    ...(streak > 0 ? { failureStreak: streak } : {})
  };
}
