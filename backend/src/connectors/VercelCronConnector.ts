import { PlatformType, HealthState } from '@prisma/client';
import { prisma } from '../db.js';
import {
  PlatformConnector,
  TaskInfo,
  ConnectorHealth,
  CapabilityVerb,
  SyncOutcome
} from './platform.interface.js';
import { getProject, type VercelCronDefinition, type VercelProject } from '../services/vercelApi.js';
import { readConfig, cronExternalId, type StoredProject } from '../services/vercelProjects.js';

/**
 * **Vercel Cron — Cronsole's second read-only observer.**
 *
 * GitHub Actions proved the shape on 2026-08-23 and this connector inherits all
 * of it: a fixed `unsupportedVerbs`, a **declared** tracked set, health read
 * back from stored sync evidence with no probe, and a hand-composed connection
 * holding one write-only account token. Where it differs from GitHub it differs
 * in both directions, and the two differences decide the design.
 *
 * ## Cheaper than GitHub, in the one place GitHub was expensive
 *
 * A GitHub workflow's cron lives in a *file*, so reading a schedule costs a
 * Contents-API fetch and a YAML parse per workflow, with an unreadable-file
 * branch behind it. A Vercel project carries `crons.definitions[]` on the
 * project object itself — so one `GET /v9/projects/:id` returns every cron in
 * the project, already parsed, already 5-field, already UTC. There is no second
 * request, no parser, no size cap and no "could not read it" state in this file,
 * and none of that is a simplification: it is what the platform hands over.
 *
 * ## Poorer than GitHub, in the one place GitHub was rich
 *
 * GitHub reports a `conclusion` per run, so a workflow can be scored healthy or
 * failing from real outcomes. **Vercel exposes no run history for a cron.**
 * Invocations appear as function logs behind no stable documented endpoint, so
 * there is nothing here to score with.
 *
 * The honest answer to that is `reportsRunResult: false` in every task's
 * metadata, which makes `services/taskHealth.ts` return `unknown` — the same key
 * and the same reading a pre-run-results Windows agent gets. It would be easy to
 * score `enabledAt` instead and call every configured cron healthy, and that is
 * precisely the confident lie the observer exists to avoid: *"this cron is
 * configured"* and *"this cron is working"* are different claims, and only one
 * of them is knowable here. **Absence of evidence is `unknown`, never `ok`.**
 *
 * ## What is deliberately not here
 *
 * `deleteTask`, `exportTask`, `importTask`, `updateSchedule`, `updateActions`
 * and `listFolders` are absent, so `verbReachability` reports them `unsupported`
 * from their absence. `run`, `create` and `setStatus` are mandated by the
 * interface, so they are named in {@link unsupportedVerbs} — and each is a real
 * boundary of this connector rather than of Vercel:
 *
 * - **`create`** would mean committing a `crons` entry to the user's
 *   `vercel.json` and redeploying. Cronsole writing to somebody's repository to
 *   make a task is a code change, not a scheduler feature.
 * - **`setStatus`** is project-wide on Vercel, not per cron — there is no
 *   per-definition enable to expose, so a per-task toggle would be inventing a
 *   control the platform does not have.
 * - **`run`** has an API of sorts (the cron path is just an HTTP endpoint), and
 *   is refused for the reason GitHub's dispatch is: calling the endpoint
 *   yourself is **not the scheduled run**. It would bypass Vercel's own
 *   `CRON_SECRET` check, be invisible in the platform's own view of the cron,
 *   and record a success for something the scheduler never did.
 */
export class VercelCronConnector implements PlatformConnector {
  platform = PlatformType.VERCEL_CRON;

  /**
   * The three interface-mandated verbs this connector cannot perform.
   *
   * A **fixed array, like GitHub's and unlike Claude's getter.** Claude's answer
   * changes with the install, so a constant could only be right in one of two
   * worlds. Here the answer is a property of *this connector's design*: no
   * token, scope or team makes Cronsole write a `vercel.json`, and no scope
   * turns a hand-made HTTP request into a scheduled invocation.
   *
   * The optional verbs are unsupported by **absence** (`verbReachability` reads
   * `typeof connector.deleteTask === 'function'`); listing them here too would
   * be a second statement of one fact, free to disagree with the first.
   */
  readonly unsupportedVerbs: readonly CapabilityVerb[] = ['run', 'create', 'setStatus'];

  /**
   * The projects being watched — this platform's tracked set, **declared**.
   *
   * A Vercel category is the project name, and the list of them is in the
   * connection config rather than inferred from stored rows. That is the lesson
   * troubleshooting #75 charged GitHub for: deriving the include-set from stored
   * rows makes *adding a project* unable to adopt anything, because a freshly
   * added one has no rows — so every cron it reports is filtered out and **Sync
   * reports success over nothing**, with no discovery modal to escape through.
   *
   * Adding a project is the gesture that names the folder, so this is where that
   * fact belongs. It changes only which categories a refresh *includes*; it
   * deliberately does not clear a `TaskExclusion`, because an individually
   * untracked cron must survive a routine refresh.
   */
  trackedCategories(config: any): string[] {
    return readConfig(config).projects.map(p => p.name);
  }

  /**
   * Every cron job declared by the projects the user named.
   *
   * Three refusals rather than guesses, in order of how easily each would have
   * become a quiet lie:
   *
   * **A project that fails to read does not empty the sync.** It is skipped, the
   * others proceed, and the pass is marked `partial` so `reconcileMissingTasks`
   * retires nothing — one revoked token scope must not flip every other cron to
   * MISSING (the #74 rule, generalized off the agent).
   *
   * **A project with `crons: null` is named, not counted.** It has never
   * deployed a cron, which is a working project with nothing to import — and on
   * screen that is identical to a broken sync unless the numbers are said out
   * loud (`SyncOutcome.notes`, the #75 rule).
   *
   * **A cron's status is the project's, because Vercel has no per-cron switch.**
   * `disabledAt` disables the whole project's crons at once, so every task from
   * that project reads `DISABLED` with the reason in metadata, rather than each
   * row inventing a state of its own.
   */
  async syncTasks(config: any): Promise<SyncOutcome> {
    const { token, projects } = readConfig(config);
    if (!token || projects.length === 0) return { tasks: [] };

    const tasks: TaskInfo[] = [];
    const failures: string[] = [];
    const notes: string[] = [];
    const warnings: string[] = [];
    /** Did this sync see less than the whole platform? See {@link SyncOutcome.partial}. */
    let partial = false;

    /** Projects that read fine and have never deployed a cron. Named, not counted. */
    const noCrons: string[] = [];
    /** Projects whose name on Vercel no longer matches the stored one. */
    const renamed: string[] = [];
    let projectsRead = 0;

    for (const project of projects) {
      const read = await getProject(token, project.id, project.teamId);
      if (!read.ok) {
        // A project that could not be read is a hole in the enumeration, not an
        // empty project — so nothing in it may be retired on this pass.
        partial = true;
        failures.push(`${project.name}: ${read.message}`);
        continue;
      }

      projectsRead += 1;

      // The stored name is the category and rides inside every `externalId`, so
      // a rename on Vercel re-keys the project's rows: the old ones retire and
      // new ones arrive under the new name. GitHub carries the identical caveat
      // with `owner/repo`. It is **said out loud** rather than papered over,
      // because a category silently changing and a sync silently breaking look
      // the same from the dashboard.
      if (read.data.name && read.data.name !== project.name) {
        renamed.push(`${project.name} → ${read.data.name}`);
      }

      const found = this.toTaskInfos(project, read.data);
      if (found === null) {
        noCrons.push(project.name);
        continue;
      }
      tasks.push(...found);
    }

    // **Only when nothing could be read at all.** A partial sync is the normal
    // case and returning what we have is right — but an empty list from a
    // connection that *has* projects is indistinguishable from "every cron was
    // removed", and `reconcileMissingTasks` would act on it. Throwing makes
    // `POST /sync` record the failure against the `sync` capability and report
    // it per platform, and the reconcile step never runs.
    if (tasks.length === 0 && failures.length > 0) {
      throw new Error(failures.join(' · '));
    }

    for (const failure of failures) warnings.push(`Could not read ${failure}`);
    for (const rename of renamed) {
      warnings.push(
        `Renamed on Vercel: ${rename}. Its cron jobs move to the new category — re-add the project ` +
          'here to follow the rename, or the old rows will retire on the next full sync.'
      );
    }

    notes.push(coverageNote(projects.length, projectsRead, tasks.length));
    for (const name of noCrons) {
      notes.push(`${name} has no cron jobs — nothing in it runs on a clock.`);
    }

    return { tasks, notes, warnings, partial };
  }

  /**
   * One project's crons as Cronsole tasks, or `null` when it has none configured.
   *
   * `null` and `[]` are different answers and the caller acts on the difference:
   * `null` is `crons: null` from the API — this project has never deployed a
   * cron — while `[]` is a project with crons enabled and no definitions right
   * now. Only the first is worth a sentence.
   */
  private toTaskInfos(stored: StoredProject, project: VercelProject): TaskInfo[] | null {
    if (!project.crons) return null;

    const { definitions, disabledAt, enabledAt, updatedAt, deploymentId } = project.crons;

    // Vercel enables and disables crons for the whole project, so this is one
    // fact shared by every row rather than ten independent ones.
    const disabled = disabledAt !== null;

    // A project may declare the same path twice with two schedules — Vercel's
    // own docs show it. They collapse into one row keyed on the path, with every
    // schedule in `metadata.allSchedules`, exactly as a GitHub workflow with
    // several `on: schedule` entries does. Keying on the schedule instead would
    // make every reschedule look like a delete plus a create.
    const byPath = new Map<string, VercelCronDefinition[]>();
    for (const definition of definitions) {
      const group = byPath.get(definition.path);
      if (group) group.push(definition);
      else byPath.set(definition.path, [definition]);
    }

    return [...byPath.entries()].map(([path, group]) => {
      const first = group[0]!;
      const schedules = group.map(d => d.schedule);
      return {
        externalId: cronExternalId(stored, path),
        // The path, because that is what a Vercel cron *is* — there is no name
        // field on a definition. A `description`, when the project set one, is
        // the closer thing to a name and wins.
        name: first.description || path,
        status: disabled ? ('DISABLED' as const) : ('ACTIVE' as const),
        // **The first schedule, with the rest in metadata.** `Task.schedule` is
        // one 5-field string — the storage contract — and a path may declare
        // several. Picking one and hiding the others would make the row quietly
        // wrong about when it runs.
        schedule: schedules[0] ?? null,
        // **Never computed locally.** Vercel queues cron invocations on a
        // best-effort basis (on Hobby, documented as within the hour), so a
        // next-run time derived from the cron would disagree with what actually
        // happens with nothing on screen to say which was right. The API reports
        // none, so Cronsole reports none — the same call the Claude and GitHub
        // connectors make about jitter, reached from a third direction.
        nextRunTime: null,
        metadata: {
          project: stored.name,
          projectId: stored.id,
          ...(stored.teamId ? { teamId: stored.teamId } : {}),
          path,
          ...(first.host ? { host: first.host, url: `https://${first.host}${path}` } : {}),
          ...(first.source ? { source: first.source } : {}),
          ...(schedules.length > 1 ? { allSchedules: schedules } : {}),
          ...(deploymentId ? { deploymentId } : {}),
          ...(enabledAt ? { cronsEnabledAt: new Date(enabledAt).toISOString() } : {}),
          ...(updatedAt ? { cronsUpdatedAt: new Date(updatedAt).toISOString() } : {}),
          ...(disabled
            ? {
                disabledReason:
                  'Cron jobs are turned off for this whole project on Vercel. Vercel disables them as a ' +
                  'unit — there is no per-cron switch — so every cron here is parked until the project is re-enabled.'
              }
            : {}),
          // **Present-and-false, not absent.** `taskHealth` reads this key to
          // tell "the platform reported no runs" from "Cronsole never asked",
          // and the answer for Vercel is a permanent property of the platform:
          // it publishes no cron run history at all, so a task here is
          // `unknown` rather than healthy. Reading an absent key as "never ran"
          // is what flagged every Windows task on a real machine at once.
          reportsRunResult: false
        }
      };
    });
  }

  /**
   * `run` is impossible here — see {@link unsupportedVerbs}.
   *
   * Required by the interface, so it exists and answers honestly. The route
   * answers **400** rather than 502 (`verbDeclaredUnsupported` picks the status),
   * because a verb the connector cannot perform is not the platform having a
   * moment.
   */
  async runTask(): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Cronsole cannot run a Vercel cron job. Calling the path yourself is an ordinary HTTP request, ' +
        'not the scheduled invocation — it bypasses your CRON_SECRET check and Vercel never sees it as a ' +
        'cron run. Trigger it from the project\'s Cron Jobs tab, or with `vercel crons run`.'
    };
  }

  /** Enable/disable is impossible here — see {@link unsupportedVerbs}. */
  async setTaskStatus(): Promise<{ success: boolean; message?: string }> {
    return {
      success: false,
      message:
        'Cronsole cannot enable or disable a Vercel cron job. Vercel turns crons on and off for a whole ' +
        'project rather than one at a time, so there is no per-cron switch to offer — use the project\'s ' +
        'Cron Jobs settings.'
    };
  }

  /** Creating is impossible here — see {@link unsupportedVerbs}. */
  async createTask(): Promise<{ success: boolean; message?: string; foldersCreated?: string[] }> {
    return {
      success: false,
      foldersCreated: [],
      message:
        'Creating a Vercel cron job means adding a `crons` entry to your project\'s vercel.json and ' +
        'deploying, which Cronsole does not do. Add it in the project, deploy, then sync.'
    };
  }

  /**
   * Health from stored evidence, never from a probe.
   *
   * `getHealth` runs on the dashboard's 45-second poll **per open tab**, and
   * Vercel's REST API is rate-limited. A probing health check would spend that
   * budget on a question the user answers themselves every time they sync — the
   * same conclusion the Windows, Claude and GitHub connectors reached, for four
   * different reasons that all land in the same place: **sync is the user's
   * probe.**
   *
   * So this reads back the `PlatformCapability` row `POST /api/tasks/sync`
   * already writes. Every branch reporting an *absence* of evidence returns
   * `UNKNOWN` rather than `DEGRADED`: never having synced is not a degradation,
   * and amber over something nobody can act on gets read at the same weight as
   * amber over something they should.
   */
  async getHealth(config: any): Promise<ConnectorHealth> {
    const { token, projects } = readConfig(config);

    if (!token) {
      return { state: HealthState.UNKNOWN, reason: 'No Vercel token stored — nothing has been read yet.' };
    }
    if (projects.length === 0) {
      return {
        state: HealthState.UNKNOWN,
        reason: 'Connected, but no projects are being watched yet. Add one to start reading cron jobs.'
      };
    }

    const userId = config?.userId;
    if (typeof userId !== 'string' || !userId) {
      return { state: HealthState.UNKNOWN, reason: 'No evidence: connection is not scoped to a user' };
    }

    let row: { lastSuccessAt: Date | null; lastFailureAt: Date | null; lastFailureReason: string | null } | null;
    try {
      row = await prisma.platformCapability.findFirst({
        where: { userId, platform: PlatformType.VERCEL_CRON, verb: 'sync' },
        select: { lastSuccessAt: true, lastFailureAt: true, lastFailureReason: true }
      });
    } catch {
      // Reading the evidence is not the subject of the check. A DB hiccup here
      // must not be reported as Vercel being unhealthy.
      return { state: HealthState.UNKNOWN, reason: 'Could not read sync history for this platform' };
    }

    const succeeded = row?.lastSuccessAt ?? null;
    const failed = row?.lastFailureAt ?? null;

    if (!succeeded && !failed) {
      const count = projects.length;
      return {
        state: HealthState.UNKNOWN,
        reason: `${count} project${count === 1 ? '' : 's'} configured, none read yet. Sync to check.`
      };
    }

    if (failed && (!succeeded || failed > succeeded)) {
      return {
        state: HealthState.DEGRADED,
        reason: row?.lastFailureReason ? `Last sync failed: ${row.lastFailureReason}` : 'Last sync failed',
        // A rejection is contact: Vercel answered, and the answer was no.
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

/**
 * The one sentence that turns "nothing imported" from an ambiguity into a fact.
 *
 * Every number in it is something the sync already counted, and each answers a
 * different question a confused user is actually asking: *is Cronsole reaching
 * Vercel at all* (projects read), and *why is my dashboard empty* (crons).
 * Reporting only the last one is what made a correct empty result and a broken
 * sync look identical on GitHub for as long as it took to read the database by
 * hand (troubleshooting #75).
 *
 * Deliberately not phrased as a warning. A project with no `crons` block in its
 * `vercel.json` is working exactly as intended, and saying so in an alarmed
 * voice would train people to ignore the line that matters.
 */
function coverageNote(configured: number, read: number, crons: number): string {
  const projectWord = configured === 1 ? 'project' : 'projects';
  const cronWord = crons === 1 ? 'cron job' : 'cron jobs';
  return `Vercel Cron: read ${read} of ${configured} ${projectWord}, ${crons} ${cronWord}.`;
}
