import { NativeJob } from './NativeTaskExecutor.js';
import { toStructuredAction } from '../utils/commandParser.js';

/**
 * One definition of "what a Cronsole-native task will actually run".
 *
 * Every write path to `metadata.job` goes through here — `POST /api/tasks/native`,
 * `PATCH /api/tasks/:id/job`, and `CronsoleNativeConnector.createTask` (the
 * template-apply and clone path). A second definition is how an edit produces a
 * spec creation would have refused, accepted at edit time and failing at 3am; the
 * same argument applies one step out, to a *template* that applies cleanly and
 * stores a job the executor cannot read.
 *
 * This lived in `routes/tasks.ts` until 2026-08-13, which is why the connector had
 * its own, narrower rule ("the command must be a URL") and Cronsole-native could
 * not be a template target at all.
 */

/**
 * Build the stored job from validated input.
 *
 * Normalizing here rather than storing the request body means a field the client
 * invented never reaches `metadata.job`, and the executor only ever reads shapes
 * this function can produce. Semantic validation stays in `validateJob`, which
 * the executor shares — so nothing is accepted at the boundary that the runner
 * would then reject.
 */
export function buildNativeJob(job: Record<string, unknown>): NativeJob {
  if (job.jobType === 'EXEC') {
    const env = job.env as Record<string, string> | undefined;
    // A caller may send either a structured {executable, args[]} — what MCP and
    // the API use — or a `command` line, which is what a human types and what a
    // template's `commandTemplate` resolves to. The line is tokenized **here**, by
    // the same `toStructuredAction` the Windows create path uses, so there is
    // exactly one definition of "how a command line becomes argv" and neither the
    // browser nor a connector needs a copy of it. Whichever arrives, what gets
    // stored is always the structured form the executor reads.
    const structured = typeof job.command === 'string' && job.command.trim()
      ? toStructuredAction(job.command)
      : null;
    return {
      jobType: 'EXEC',
      executable: structured ? structured.executable : String(job.executable ?? '').trim(),
      args: structured
        ? structured.args
        : Array.isArray(job.args) ? (job.args as string[]) : undefined,
      workingDirectory: job.workingDirectory ? String(job.workingDirectory).trim() : undefined,
      env: env && Object.keys(env).length ? env : undefined,
      timeoutMs: job.timeoutMs !== undefined ? Number(job.timeoutMs) : undefined
    };
  }
  if (job.jobType !== 'HTTP') {
    // Hand an unrecognized — or missing — discriminator straight through, so
    // `validateJob` rejects it **by name** rather than this function silently
    // coercing it into an HTTP job. A typo'd `jobType` that quietly becomes a
    // working HTTP task is worse than a 400: the caller gets a task that is not
    // the one they described.
    return job as unknown as NativeJob;
  }
  return {
    jobType: 'HTTP',
    url: String(job.url).trim(),
    method: String(job.method || 'GET').toUpperCase(),
    headers: (job.headers as Record<string, string>) || undefined,
    body: job.body ? String(job.body) : undefined
  };
}

/**
 * A **command string** → a native job.
 *
 * The connector interface hands every platform one `command` string, so the two
 * paths that come through it — applying a template and cloning a task — have no
 * way to say which job type they meant. The discriminator is therefore the
 * command itself: a URL is an HTTP job, and anything else is a program.
 *
 * That rule is a guess, and it is the *safe* guess in the one direction that
 * matters: `https://…` is not a runnable executable on any platform Cronsole
 * supports, so nothing that would have been a working EXEC job is captured as an
 * HTTP one. Callers that know their job type — `POST /api/tasks/native`, the MCP
 * create tools, the New Task modal — pass a full spec to `buildNativeJob` and
 * never come through here.
 */
export function nativeJobFromCommand(command: string): NativeJob {
  const trimmed = command.trim();
  return isUrlCommand(trimmed)
    ? buildNativeJob({ jobType: 'HTTP', url: trimmed, method: 'GET' })
    : buildNativeJob({ jobType: 'EXEC', command: trimmed });
}

/** The one test that decides HTTP vs EXEC for a bare command string. */
export function isUrlCommand(command: string): boolean {
  return /^https?:\/\//i.test(command.trim());
}
