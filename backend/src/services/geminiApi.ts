import axios, { type AxiosInstance } from 'axios';

/**
 * **The Gemini API surface Cronsole reads and writes, and nothing else.**
 *
 * Cronsole's **first hosted controller**. The two hosted sources before it —
 * GitHub Actions and Vercel Cron — are read-only observers, and both refuse
 * `run` for the same reason: the endpoint they could call would not produce the
 * *scheduled* invocation. Gemini's does, and that single fact is what moves this
 * platform from one half of the matrix to the other.
 *
 * Four facts about the platform shape everything below.
 *
 * **A trigger is a first-class resource with a verb per endpoint.** `GET
 * /v1beta/triggers` lists, `PATCH …/{id}` pauses and renames, `DELETE …/{id}`
 * removes, `POST /v1beta/triggers` creates, and `POST …/{id}/executions` runs one
 * now. `PATCH` is the one that does **less** than its name suggests: it accepts
 * `status` and `display_name` and answers `400 Unknown parameter 'schedule'` to
 * a reschedule, so a trigger's *when* is fixed at create time on `v1beta`.
 * Otherwise nothing here is a lookalike wearing a verb's name: Google's own
 * documentation notes that pausing a trigger stops its *scheduled* executions
 * while leaving manual ones alone, which is the platform saying outright that
 * the two travel the same machinery.
 *
 * **It reports run outcomes.** `GET …/{id}/executions` returns real executions
 * with a status and a start time, and the trigger resource itself carries
 * `consecutive_failure_count`. So this connector sets `reportsRunResult: true`
 * and gets a real arm in `scoreTask`, rather than the permanent `unknown` Vercel
 * is honestly owed.
 *
 * **A trigger auto-pauses.** After `max_consecutive_failures` (default 5) the
 * platform sets `status: "disabled"` by itself. That is GitHub's silent 60-day
 * auto-disable in a more honest form — the count is published on the resource —
 * and it is the single most useful thing this source surfaces, so it is read
 * back deliberately rather than folded into a generic "disabled".
 *
 * **The schedule carries a zone.** `{ schedule, time_zone }`, and `time_zone` is
 * whatever the developer wrote. Cronsole's contract is 5-field UTC, so the read
 * normalizes and the write always sends `UTC` — see `shiftCronToUtc` in
 * `utils/cron.ts` for why that conversion lives on the server at all.
 *
 * **Auth is one API key in one header** (`x-goog-api-key`), which is the
 * cheapest auth surface of any candidate source: no OAuth dance, no team
 * scoping, no per-resource token. That is a real part of why this connector
 * jumped the queue ahead of a third observer.
 *
 * The API is `v1beta` and documented as **preview**, which is why the platform's
 * `maturity` is `experimental` — the same call Claude's connector makes for the
 * same reason, and a different question from whether the connector is finished.
 */

/** The Generative Language API host. Every call below is a documented endpoint. */
const BASE_URL = 'https://generativelanguage.googleapis.com';

/** How long any one Gemini request may take before it is a failure. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * How many executions to read back per trigger when scoring health.
 *
 * Enough to see a failure streak worth reporting and no more: this runs once per
 * trigger per sync, and the only questions it answers are "how did the last one
 * go" and "how many in a row before it". `consecutive_failure_count` on the
 * trigger already carries the platform's own answer to the second, so this is
 * corroboration rather than the sole source.
 */
const EXECUTION_PAGE_SIZE = 20;

/**
 * A Gemini call's outcome.
 *
 * A discriminated union rather than a throw, modelled on `vercelApi.ts`,
 * `githubActions.ts` and `claudeTriggers.ts` for the same reason: every caller
 * has a *specific* thing to say when the platform declines, and a 404 on one
 * trigger's executions must not empty a sync that read the trigger list fine.
 */
export type GeminiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number | null; message: string };

/**
 * A trigger's lifecycle state, as the platform reports it.
 *
 * Three values, and the third is the one worth having: `disabled` is **not** a
 * synonym for `paused`. A user pauses; the platform disables, on its own, after
 * `max_consecutive_failures` consecutive failures. Collapsing them into a
 * boolean would lose the difference between a task somebody parked and one that
 * has been quietly broken for a week — which is the distinction GitHub's
 * `disabled_inactivity` exists to preserve one source over.
 */
export type GeminiTriggerStatus = 'active' | 'paused' | 'disabled' | 'unknown';

/**
 * One tool a trigger's agent can use, reduced to what is safe to display.
 *
 * **The credentials are dropped at the parse, not filtered later**, and that
 * placement is the whole design. An `mcp_server` tool carries a `headers` map
 * whose values are bearer tokens; an allowlist entry can carry header transforms
 * that are the same thing by another name. If those were parsed into a
 * `GeminiTrigger` and removed downstream, every future reader — task metadata,
 * an export, an archive, a log line, an MCP tool response — would be one
 * forgotten `delete` away from publishing somebody's token.
 *
 * So they never enter the object. This is `TaskSecret`'s rule pointed the other
 * way: there, no route returns a stored value; here, no parse produces one.
 */
/**
 * The tool types the platform accepts, **taken from the API rather than the docs**.
 *
 * Obtained by sending a bogus type and reading the refusal, which enumerates the
 * supported set — a better source than any document, and this connector's
 * documentation has disagreed with the wire five times. Validated before the
 * create so a typo is refused by Cronsole with a list, rather than by Google
 * with a sentence about a field the user did not know they were setting.
 *
 * It will grow. An unknown type is refused *here* rather than silently dropped,
 * because dropping one would create a trigger with less reach than the form
 * showed — and a security-relevant field that quietly does nothing is worse than
 * an error.
 */
export const GEMINI_TOOL_TYPES = [
  'filesystem',
  'file_search',
  'google_maps',
  'bash',
  'computer_use',
  'mcp_server',
  'url_context',
  'code_execution',
  'google_search',
  'tool_search',
  'function'
] as const;

/** A tool as it goes *in*. Distinct from {@link GeminiToolSummary}: this one has headers. */
export interface GeminiToolInput {
  type: string;
  name?: string;
  url?: string;
  headers?: Record<string, string>;
}

export interface GeminiToolSummary {
  /** `mcp_server`, `bash`, `google_search`, … — the platform's own word. */
  type: string;
  /** The server or function name, where the tool has one. */
  name: string | null;
  /** An MCP server's endpoint. Credential-free: `headers` is never read. */
  url: string | null;
  /**
   * Whether the trigger restricts which of an MCP server's tools may be used.
   *
   * A boolean rather than the list, because the element shape is still unknown
   * (an object, and not `name`/`tool`/`tool_name`) — and reporting *that it is
   * restricted* is the fact worth having. Guessing at contents Cronsole cannot
   * parse would be worse than saying less.
   */
  restricted: boolean;
}

export interface GeminiTrigger {
  /** The platform's id — Cronsole's `externalId`, unchanged by a rename. */
  id: string;
  /** The trigger's human-readable name, when it has one. */
  displayName: string | null;
  /** The cron expression **as the platform stores it**, in `timeZone`. */
  schedule: string | null;
  /** The IANA zone the schedule is written in, e.g. `UTC`, `America/New_York`. */
  timeZone: string | null;
  status: GeminiTriggerStatus;
  /** Next scheduled execution, as reported by the platform. Never computed here. */
  nextRunTime: Date | null;
  /** Consecutive failures the platform has counted. Auto-pause happens at the max. */
  consecutiveFailureCount: number;
  /** The ceiling that triggers the auto-pause, when the resource states it. */
  maxConsecutiveFailures: number | null;
  /** The managed agent this trigger runs, e.g. `antigravity-preview-05-2026`. */
  agent: string | null;
  /** The prompt the agent is given. Read for display; never edited by Cronsole yet. */
  input: string | null;
  /** The sandbox type the interaction declares, e.g. `remote`. */
  environmentType: string | null;
  /**
   * The tools this trigger's agent can reach — **without their credentials**.
   *
   * Cronsole creates triggers with no `tools` at all, but one made in AI Studio
   * or through the API can carry MCP servers, `bash`, `computer_use` and more.
   * Reading them is not a nicety: an agent's *reach* is the most consequential
   * thing about a scheduled autonomous task, and until this existed a trigger
   * with a shell and three MCP servers was indistinguishable on the dashboard
   * from one that could only think.
   */
  tools: GeminiToolSummary[];
  /**
   * The domains the sandbox may reach, when the trigger declares an allowlist.
   *
   * Empty means the environment states none — the default, and what Cronsole
   * itself creates. Domains only: see {@link toToolSummary} for why the header
   * transforms that can accompany them never leave the parse.
   */
  networkAllowlist: string[];
  executionTimeoutSeconds: number | null;
}

/** One run of a trigger, as `GET …/{id}/executions` reports it. */
export interface GeminiExecution {
  id: string;
  /** The platform's own word — `completed`, `failed`, `in_progress`, … */
  status: string;
  startTime: Date | null;
  endTime: Date | null;
  /**
   * The interaction this run produced, which is **where the output lives**.
   *
   * An execution row carries the run's *shape* — when, how long, what state —
   * and none of its content. The agent's actual work is a separate resource at
   * `GET /v1beta/interactions/{id}`, reachable only through this id, and there
   * is no Google web UI that renders it: their trigger documentation is entirely
   * programmatic. So this field is the only route a user has to what their agent
   * actually produced, and dropping it would leave run history able to say a run
   * succeeded and never what it did.
   *
   * Null on a run still in progress — the interaction exists but is not yet
   * worth reading, and absent is more honest than a half-written transcript.
   */
  interactionId: string | null;
  /**
   * Why the run failed, when the platform says so on the execution itself.
   *
   * **The most valuable field on this object and it was dropped for a day.** A
   * run that fails *before* the agent starts — a tool the agent is not allowed,
   * a malformed environment — has no interaction, so the transcript path has
   * nothing to show and Cronsole reported "there is nothing to read" while the
   * exact reason sat one key over in the same response
   * ([#84](../../../docs/troubleshooting/README.md)).
   *
   * Null on a run that succeeded, and on one that failed *inside* the agent —
   * there the interaction holds the story.
   */
  error: string | null;
}

/**
 * What an agent actually produced on one run.
 *
 * Deliberately **not** the raw interaction. That document is ~90KB for a
 * two-minute run — search grounding blobs, per-step tool arguments, encoded
 * environment state — and almost all of it is machinery rather than result.
 * What a person opening run history wants is the answer, plus enough shape to
 * trust it.
 */
export interface GeminiRunOutput {
  /** The agent's final message — the thing it produced. Null if it never got there. */
  text: string | null;
  /**
   * The tools it reached for, in order, deduplicated to type names.
   *
   * This is the field that answers *"did it actually do what I asked?"*, and it
   * earns its place because the honest answer is often no: a trigger told to
   * email a report **completes successfully** having only called `write_file`,
   * because the sandbox has no mailer and the agent narrates around what it
   * cannot do. The status says `completed`; only the step list says what
   * happened.
   */
  steps: string[];
  /** Total tokens the run cost, when the platform reports it. */
  totalTokens: number | null;
}


/**
 * The fields a create or an edit may set.
 *
 * `timeZone` is absent on purpose: **everything Cronsole writes is UTC**, set by
 * the caller in one place, because a zone reaching a stored schedule is the one
 * thing the storage contract rules out. A trigger created elsewhere keeps its
 * own zone and is normalized on the way in.
 */
export interface GeminiTriggerWrite {
  displayName?: string;
  status?: 'active' | 'paused';
  agent?: string;
  input?: string;
  environmentType?: string;
}

/**
 * One authenticated client per call site.
 *
 * Not a module-level singleton: the key belongs to a *user's* connection, and a
 * process-wide client holding one user's credential is exactly the shape that
 * makes a multi-user install leak across accounts. Cheap — axios instances are
 * plain objects.
 */
function client(apiKey: string): AxiosInstance {
  return axios.create({
    baseURL: BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': 'Cronsole'
    },
    // Every status is interpreted here — see `describeError`. Letting axios throw
    // on 4xx would turn "this trigger no longer exists" into a stack trace
    // indistinguishable from a network fault.
    validateStatus: () => true
  });
}

/**
 * Turn a Gemini response into a sentence naming the actual cause.
 *
 * Two carry the weight. A **403** on this API is far more often *the Generative
 * Language API is not enabled on the project behind this key* than a permissions
 * problem, and sending someone to check permissions they do not have is the same
 * misdirection Vercel's 404-means-scope message exists to correct. A **404 on a
 * trigger** is usually a trigger deleted in Google's console since the last sync,
 * which is a normal thing that happened rather than an error to debug.
 */
function describeError(status: number, body: unknown, what: string): string {
  const error = (body && typeof body === 'object' ? (body as { error?: unknown }).error : null) as
    | { message?: unknown; status?: unknown }
    | null;
  const apiMessage = typeof error?.message === 'string' ? error.message : null;

  switch (status) {
    case 400:
      return apiMessage
        ? `Gemini rejected the request (400): ${apiMessage}`
        : `Gemini rejected the request (400) for ${what}.`;
    case 401:
    case 403:
      return (
        `Gemini refused access (${status})${apiMessage ? `: ${apiMessage}` : ''}. An API key is scoped ` +
        'to one Google Cloud project, and triggers are part of the Managed Agents preview — check that ' +
        'the key is current and that the Generative Language API is enabled on its project.'
      );
    case 404:
      return (
        `Gemini returned 404 for ${what}. A trigger deleted in Google's console is gone from the API ` +
        'immediately, so this is the expected answer for one removed since the last sync.'
      );
    case 429:
      return 'Gemini rate limit reached (429). This clears on its own — sync again in a minute.';
    case 500:
    case 502:
    case 503:
      return `Gemini server error (${status}). Safe to retry.`;
    default:
      return apiMessage ? `Gemini error ${status}: ${apiMessage}` : `Gemini error ${status} for ${what}.`;
  }
}

/** Wrap a request so a transport failure reads like every other refusal. */
async function attempt<T>(
  what: string,
  run: () => Promise<{ status: number; data: unknown }>,
  map: (data: unknown) => T
): Promise<GeminiResult<T>> {
  let response;
  try {
    response = await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: null, message: `Could not reach Gemini for ${what}: ${message}` };
  }

  if (response.status >= 200 && response.status < 300) {
    return { ok: true, data: map(response.data) };
  }
  return { ok: false, status: response.status, message: describeError(response.status, response.data, what) };
}

/**
 * Every trigger this key can see.
 *
 * There is no container to scope by — no repository, no project, no team. A key
 * reaches its project's triggers and that is the whole tracked set, which is why
 * this connector's `trackedCategories` is a constant rather than a list read out
 * of the config. The listing is the connect-time check as well as the sync's
 * read: a key that can list triggers is a key that works, so there is no separate
 * "verify" endpoint to call and no second failure mode to explain.
 */
export async function listTriggers(apiKey: string): Promise<GeminiResult<GeminiTrigger[]>> {
  return attempt(
    'your triggers',
    () => client(apiKey).get('/v1beta/triggers'),
    data => {
      const body = (data ?? {}) as { triggers?: unknown };
      const rows = Array.isArray(body.triggers) ? body.triggers : [];
      return rows.map(toTrigger).filter((t): t is GeminiTrigger => t !== null);
    }
  );
}

/** One trigger by id — used after a write, to report back what the platform now holds. */
export async function getTrigger(apiKey: string, id: string): Promise<GeminiResult<GeminiTrigger>> {
  return attempt(
    `the trigger ${id}`,
    () => client(apiKey).get(`/v1beta/triggers/${encodeURIComponent(id)}`),
    data => {
      const trigger = toTrigger(data);
      if (!trigger) throw new Error('Gemini returned a trigger with no id');
      return trigger;
    }
  );
}

/**
 * A trigger's recent executions — the run evidence this platform actually has.
 *
 * One request per trigger per sync, which is the same bargain
 * `githubActions.ts` makes for the same payoff: without it, "this trigger has
 * never run" and "Cronsole did not look" render identically, and that ambiguity
 * has already cost this repo an afternoon once (troubleshooting #75).
 *
 * A failure here is **not** a failure of the sync. The trigger was read; only its
 * history was not, so the caller keeps the task and leaves `reportsRunResult`
 * false for that row — the same rule that stops one rate-limited request from
 * flagging every workflow in a repository.
 */
export async function listExecutions(
  apiKey: string,
  triggerId: string
): Promise<GeminiResult<GeminiExecution[]>> {
  return attempt(
    `executions of trigger ${triggerId}`,
    () =>
      client(apiKey).get(`/v1beta/triggers/${encodeURIComponent(triggerId)}/executions`, {
        params: { pageSize: EXECUTION_PAGE_SIZE }
      }),
    data => {
      // **`trigger_executions`, not `executions`.** The list endpoint names its
      // array after the resource rather than after the path, unlike
      // `GET /triggers` (which really does answer `{ triggers: [...] }`). Reading
      // the obvious key returned `[]` for every trigger forever — and `[]` is not
      // an error here, it is the platform's own way of saying "this has never
      // run", so a source that reported run outcomes reported *none* and looked
      // exactly like a set of brand-new triggers
      // ([#83](../../../docs/troubleshooting/README.md#83-a-gemini-trigger-runs-fine-and-cronsole-shows-no-run-history-then-calls-a-good-run-a-failure)).
      const body = (data ?? {}) as { trigger_executions?: unknown; triggerExecutions?: unknown; executions?: unknown };
      const raw = body.trigger_executions ?? body.triggerExecutions ?? body.executions;
      const rows = Array.isArray(raw) ? raw : [];
      return rows.map(toExecution).filter((e): e is GeminiExecution => e !== null);
    }
  );
}

/**
 * Run a trigger now.
 *
 * **The one hosted `run` in Cronsole that is the real thing.** GitHub's
 * `workflow_dispatch` and Vercel's cron path are both refused because calling
 * them produces something that merely resembles the scheduled run — a different
 * event, or an HTTP request the scheduler never records. Here the manual
 * execution is the same agent, the same prompt and the same sandbox as the
 * scheduled one, on the platform's own execution list.
 *
 * `ran` is deliberately **not** set by the caller for this: creating an execution
 * starts an agent that will work for minutes, so what Cronsole gets back is an
 * accepted dispatch, exactly like a Windows start.
 *
 * **It routinely times out, and that is not a failure.** This endpoint does not
 * answer when the run is accepted — it holds the connection while the agent
 * works, far past {@link REQUEST_TIMEOUT_MS}. The timeout is deliberately *not*
 * raised to cover it: the ceiling would have to be the agent's whole runtime
 * (minutes), which means an HTTP request of Cronsole's own hanging that long for
 * a dispatch that was accepted in the first second. The connector answers the
 * timeout with a read instead — see `executionStartedSince`. Only Cronsole-native can say
 * `ran: true`, and for the reason in the interface — dispatch and execution are
 * the same act only where Cronsole is the executor.
 */
export async function runTrigger(
  apiKey: string,
  triggerId: string
): Promise<GeminiResult<{ executionId: string | null }>> {
  return attempt(
    `a manual run of trigger ${triggerId}`,
    () => client(apiKey).post(`/v1beta/triggers/${encodeURIComponent(triggerId)}/executions`, {}),
    data => {
      const body = (data ?? {}) as Record<string, unknown>;
      return { executionId: typeof body.id === 'string' ? body.id : null };
    }
  );
}

/**
 * Patch a trigger — the one write path for pause, resume and rename.
 *
 * One function rather than two, because the platform has one endpoint and
 * splitting it here would invent a distinction the API does not make. Each
 * connector method builds its own body, so the *verbs* stay separate where users
 * see them and the transport stays single where the platform defines it.
 *
 * **There is no schedule here, and that is the platform's boundary rather than
 * an omission.** `PATCH` rejects `schedule` outright (`400 Unknown parameter`),
 * with no `PUT` and no field mask that changes it, so `createTrigger` is the only
 * place a schedule — and its mandatory `time_zone: "UTC"` — is ever written.
 */
export async function patchTrigger(
  apiKey: string,
  triggerId: string,
  patch: GeminiTriggerWrite
): Promise<GeminiResult<GeminiTrigger>> {
  const body: Record<string, unknown> = {};
  if (patch.displayName !== undefined) body.display_name = patch.displayName;
  if (patch.status !== undefined) body.status = patch.status;

  return attempt(
    `the trigger ${triggerId}`,
    () => client(apiKey).patch(`/v1beta/triggers/${encodeURIComponent(triggerId)}`, body),
    data => toTrigger(data) ?? emptyTrigger(triggerId)
  );
}

/**
 * Create a trigger.
 *
 * The four fields the platform requires are `schedule`, `time_zone`, and an
 * `interaction` naming an `agent` and an `input`. Cronsole supplies `UTC` for
 * the zone on everything it writes, and the caller supplies the rest — including
 * the agent, which is **never defaulted here**: a managed-agent id is a preview
 * string that changes, and guessing one would produce a trigger that 400s at
 * create time or, worse, runs a different agent than the user meant.
 *
 * **The environment is declared with no network allowlist.** Gemini's own
 * example attaches domains with header transforms — bearer tokens, in effect —
 * to the sandbox. Cronsole creates the plainest environment the API accepts and
 * nothing more, because widening what an autonomous agent may reach is not a
 * default a task manager gets to pick on someone's behalf. It is the same rule
 * `repositoryUrls` follows for Claude: never defaulted or guessed, because
 * attaching the wrong reach to an agent is not a mistake the user can see before
 * it happens. Add domains in Google's console.
 */
export async function createTrigger(
  apiKey: string,
  spec: {
    schedule: string;
    displayName: string;
    agent: string;
    input: string;
    environmentType?: string;
    /** Tools to grant. Omitted entirely when empty — see `GEMINI_TOOL_TYPES`. */
    tools?: GeminiToolInput[];
    /** Domains the sandbox may reach. Omitted entirely when empty. */
    allowlist?: string[];
  }
): Promise<GeminiResult<GeminiTrigger>> {
  // **Both omitted when empty, never sent as `[]`.** An empty `tools` array is
  // not the same request as no `tools` key: the API documents the field as the
  // way to *restrict* the default set, so sending `[]` could plausibly mean "no
  // tools at all" rather than "use the defaults". Cronsole's create has always
  // meant the latter, and an empty form must not silently change what a trigger
  // can do.
  const tools = (spec.tools ?? []).map(tool => ({
    type: tool.type,
    ...(tool.name ? { name: tool.name } : {}),
    ...(tool.url ? { url: tool.url } : {}),
    // The one credential on this path. It goes into the request body and
    // nowhere else — not into a log line, not into the returned trigger, not
    // into task metadata. `toTrigger` cannot read it back even if it wanted to.
    ...(tool.headers && Object.keys(tool.headers).length ? { headers: tool.headers } : {})
  }));

  const allowlist = (spec.allowlist ?? []).filter(Boolean);

  const body = {
    schedule: spec.schedule,
    time_zone: 'UTC',
    display_name: spec.displayName,
    interaction: {
      agent: spec.agent,
      input: spec.input,
      ...(tools.length ? { tools } : {}),
      environment: {
        type: spec.environmentType || 'remote',
        // `allowlist`, with `{ domain }` entries — **not** the `allowed_domains`
        // the documentation names, which the API rejects outright.
        ...(allowlist.length ? { network: { allowlist: allowlist.map(domain => ({ domain })) } } : {})
      }
    }
  };

  return attempt(
    'a new trigger',
    () => client(apiKey).post('/v1beta/triggers', body),
    data => toTrigger(data) ?? emptyTrigger('')
  );
}

/**
 * Delete a trigger.
 *
 * **Idempotent by design**: a 404 is reported as success, because the desired end
 * state holds. The interface asks for exactly this — "deleting a task that no
 * longer exists on the platform is a success" — and the alternative is a delete
 * that fails loudly whenever someone removed the trigger in Google's console
 * first, which is a normal thing to have done.
 */
export async function deleteTrigger(apiKey: string, triggerId: string): Promise<GeminiResult<null>> {
  const result = await attempt(
    `the trigger ${triggerId}`,
    () => client(apiKey).delete(`/v1beta/triggers/${encodeURIComponent(triggerId)}`),
    () => null
  );
  if (!result.ok && result.status === 404) return { ok: true, data: null };
  return result;
}

/**
 * A raw trigger object as Cronsole reads it — exported for its own test.
 *
 * Tolerant of both spellings of every field. The REST API answers in
 * `snake_case` and the Python SDK's documented examples print `camelCase`
 * attributes, and Google's own client libraries have historically served both
 * over the same resource. Reading one spelling and silently getting `null` for
 * the other is the failure that would show up as *every trigger has no
 * schedule* — a whole-platform outage with a green suite behind it.
 */
export function toTrigger(raw: unknown): GeminiTrigger | null {
  const t = (raw ?? {}) as Record<string, unknown>;
  const id = str(t.id) ?? str(t.name)?.replace(/^triggers\//, '') ?? null;
  if (!id) return null;

  const interaction = (t.interaction ?? {}) as Record<string, unknown>;
  const environment = (interaction.environment ?? {}) as Record<string, unknown>;

  return {
    id,
    displayName: str(t.display_name) ?? str(t.displayName),
    schedule: normalizeCron(str(t.schedule)),
    timeZone: str(t.time_zone) ?? str(t.timeZone),
    status: toStatus(str(t.status)),
    nextRunTime: toDate(str(t.next_run_time) ?? str(t.nextRunTime)),
    // Absent means zero, which is the platform's own reading: the field counts up
    // from a clean slate and is omitted while it is at zero.
    consecutiveFailureCount: num(t.consecutive_failure_count ?? t.consecutiveFailureCount) ?? 0,
    // Null rather than 5, even though 5 is the documented default. A default read
    // back as a fact would let the health signal say "3 of 5" about a trigger
    // whose real ceiling is 20.
    maxConsecutiveFailures: num(t.max_consecutive_failures ?? t.maxConsecutiveFailures),
    agent: str(interaction.agent),
    input: readInput(interaction.input),
    environmentType: str(environment.type),
    tools: Array.isArray(interaction.tools) ? interaction.tools.map(toToolSummary) : [],
    networkAllowlist: readAllowlist(environment.network),
    executionTimeoutSeconds: num(t.execution_timeout_seconds ?? t.executionTimeoutSeconds)
  };
}

/**
 * **The platform's word for a clean run is `completed`, not `succeeded`.**
 *
 * Both are accepted because the docs use the second and the API returns the
 * first, and getting this wrong is not a cosmetic mismatch: `scoreTask` treats
 * any finished status that is not a success as a **critical** run failure, so a
 * perfect run reported as `completed` scored the task *broken* and told the user
 * *"the most recent run ended as \\"completed\\""* — a sentence that reads as a
 * bug report about Cronsole itself.
 *
 * One definition, exported, because the connector and the health scorer both ask
 * this question and a second copy is how they end up disagreeing about a run
 * neither of them can see twice.
 */
export const isSuccessStatus = (status: string): boolean =>
  status === 'completed' || status === 'succeeded';

/**
 * Is this run still going? `in_progress` is the platform's word.
 *
 * Kept separate from success because an unfinished run is **not evidence of
 * anything** — counting one as finished makes `lastStatus: "in_progress"` the
 * newest outcome, which the scorer then reads as a failure that is not one.
 */
export const isPendingStatus = (status: string): boolean =>
  status === 'in_progress' || status === 'running' || status === 'pending' || status === 'queued';

/** A raw execution as Cronsole reads it — exported for its own test. */
export function toExecution(raw: unknown): GeminiExecution | null {
  const e = (raw ?? {}) as Record<string, unknown>;
  const id = str(e.id) ?? str(e.name);
  if (!id) return null;
  return {
    id,
    // Lowercased so `SUCCEEDED` and `succeeded` are one value. The platform's own
    // word is kept otherwise — mapping it onto Cronsole's `ExecutionStatus` would
    // be a second judgement about an outcome the platform already named.
    status: (str(e.status) ?? 'unknown').toLowerCase(),
    startTime: toDate(str(e.start_time) ?? str(e.startTime)),
    endTime: toDate(str(e.end_time) ?? str(e.endTime)),
    interactionId: str(e.interaction_id) ?? str(e.interactionId),
    error: str(e.error)
  };
}

/**
 * One run's interaction — the transcript, reduced to what a person can use.
 *
 * The reduction happens **here rather than in the route**, for the reason every
 * other parse in this module does: the shape is the platform's, so the knowledge
 * of it stays behind the connector boundary and one caller cannot start reading
 * `steps[]` differently from another.
 *
 * A missing final message is `null`, never `''`. A run that failed mid-way has
 * real steps and no answer, and those two facts have to stay separately visible
 * or "it produced nothing" and "it produced an empty string" render the same.
 */
export async function getInteraction(
  apiKey: string,
  interactionId: string
): Promise<GeminiResult<GeminiRunOutput>> {
  return attempt(
    `the output of interaction ${interactionId}`,
    () => client(apiKey).get(`/v1beta/interactions/${encodeURIComponent(interactionId)}`),
    data => {
      const body = (data ?? {}) as { steps?: unknown; usage?: unknown };
      const steps = Array.isArray(body.steps) ? body.steps : [];

      // The LAST `model_output`, not the first: an agent that hits a tool error
      // and recovers emits more than one, and the earlier ones are its working.
      const finals = steps.filter(s => (s as { type?: unknown })?.type === 'model_output');
      const last = finals[finals.length - 1] as { content?: unknown } | undefined;
      const content = Array.isArray(last?.content) ? last.content : [];
      const text = content
        .map(c => str((c as { text?: unknown })?.text))
        .filter((t): t is string => Boolean(t))
        .join('\n');

      // Order preserved, immediate repeats collapsed: "search, search, search"
      // is one action taken three times and reads as noise, but a second write
      // after a read is a different thing happening and must stay visible.
      const kinds: string[] = [];
      for (const step of steps) {
        const raw = (step as { type?: unknown; name?: unknown }) ?? {};
        // A function call names the *tool* — `write_file` is the useful word,
        // `function_call` is not.
        const kind = str(raw.name) ?? str(raw.type);
        if (kind && kind !== kinds[kinds.length - 1]) kinds.push(kind);
      }

      const usage = (body.usage ?? {}) as Record<string, unknown>;
      return { text: text || null, steps: kinds, totalTokens: num(usage.total_tokens) };
    }
  );
}

/**
 * A placeholder for a write whose response body Cronsole could not read.
 *
 * The write succeeded — a 2xx said so — and the only thing missing is the
 * platform's echo of the new state. Returning this rather than an error keeps
 * "the change did not happen" and "the change happened and the response was
 * shaped unexpectedly" as different outcomes, because only the first is worth
 * retrying.
 */
function emptyTrigger(id: string): GeminiTrigger {
  return {
    id,
    displayName: null,
    schedule: null,
    timeZone: null,
    status: 'unknown',
    nextRunTime: null,
    consecutiveFailureCount: 0,
    maxConsecutiveFailures: null,
    agent: null,
    input: null,
    environmentType: null,
    executionTimeoutSeconds: null,
    // Empty, not "unknown": this placeholder describes a write whose echo could
    // not be read, and claiming a tool list Cronsole never saw would be worse
    // than claiming none — the next sync replaces it with the real one anyway.
    tools: [],
    networkAllowlist: []
  };
}

/**
 * The prompt an agent is given, from either shape the API uses.
 *
 * **A create sends a plain string and a read gets a structured array back.**
 * `POST /v1beta/triggers` accepts `interaction.input: "do the thing"`, and the
 * very same trigger comes back from `GET` as
 * `[{ type: 'user_input', content: [{ type: 'text', text: 'do the thing' }] }]`.
 * Reading only the string spelling returned `null` for every trigger on the
 * platform, so the prompt vanished from a task the first time it was synced —
 * including one Cronsole itself had just created with that prompt
 * ([#82](../../../docs/troubleshooting/README.md#82-a-gemini-trigger-loses-its-prompt-on-the-first-sync-and-edit-schedule-fails-with-googles-word)).
 *
 * Non-text parts are skipped rather than stringified: this value is displayed as
 * the task's action, and `[object Object]` on screen is worse than a shorter
 * true sentence.
 */
function readInput(raw: unknown): string | null {
  if (typeof raw === 'string') return raw || null;
  if (!Array.isArray(raw)) return null;

  const text = raw
    .flatMap(part => {
      const content = (part as { content?: unknown })?.content;
      const parts = Array.isArray(content) ? content : [content];
      return parts.map(c => str((c as { text?: unknown })?.text));
    })
    .filter((t): t is string => Boolean(t))
    .join('\n');

  return text || null;
}

/**
 * One raw tool object, with everything credential-shaped left behind.
 *
 * `headers` is read **nowhere in this function**, deliberately and permanently.
 * It is the field an MCP server's bearer token lives in, and the safest place
 * for a secret Cronsole has no reason to hold is outside the object entirely.
 */
function toToolSummary(raw: unknown): GeminiToolSummary {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    type: str(t.type) ?? 'unknown',
    name: str(t.name),
    url: str(t.url),
    restricted: Array.isArray(t.allowed_tools) ? t.allowed_tools.length > 0 : false
  };
}

/**
 * The domains an environment's network allowlist names.
 *
 * `allowlist`, not the documented `allowed_domains` — that name is rejected by
 * the API, one of five places its documentation disagrees with the wire on this
 * platform. Entries are objects (`{ domain }`), and only the domain is read: an
 * entry may also carry header transforms, which are credentials wearing a
 * routing name.
 */
function readAllowlist(network: unknown): string[] {
  const list = (network as { allowlist?: unknown })?.allowlist;
  if (!Array.isArray(list)) return [];
  return list
    .map(entry => str((entry as { domain?: unknown })?.domain))
    .filter((d): d is string => Boolean(d));
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function toDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `unknown` for a status the platform introduces later, never a guess at
 * `active`.
 *
 * A new fourth state read as `active` would show a parked trigger as running;
 * read as `paused` it would show a running one as parked. `unknown` is the only
 * answer that is wrong in neither direction, and the connector maps it to
 * Cronsole's `ACTIVE` while saying so in metadata rather than inventing a
 * fourth `TaskStatus`.
 */
function toStatus(raw: string | null): GeminiTriggerStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'disabled':
      return 'disabled';
    default:
      return 'unknown';
  }
}

/**
 * Collapse runs of whitespace in a cron, the way `vercelApi` and
 * `parseWorkflowSchedules` both do.
 *
 * Cronsole's storage contract is a normalized 5-field string, so this happens
 * once here rather than in four call sites downstream.
 */
function normalizeCron(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim().replace(/\s+/g, ' ');
  return normalized || null;
}
