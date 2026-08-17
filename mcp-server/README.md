<h1 align="center">🧩 Cronsole MCP Server</h1>

<p align="center">
  <em>A Model Context Protocol server that lets Claude, Codex, Cursor, and other MCP hosts
  list, run, and create Cronsole scheduled tasks in natural language.</em>
</p>

---

## What it is

A **thin wrapper over the Cronsole REST API**. The server owns no business logic — every
tool is a call through to a backend route, so all the important guarantees (owner scoping,
no-shell command structuring, signed agent commands, cron→trigger conversion) stay
server-side where they're already tested. See [`docs/ROADMAP.md`](../docs/ROADMAP.md) › P3.

It speaks MCP over **stdio** and authenticates to the backend as **one user** via a JWT you
supply — its tasks are the tasks it can see, run, and create.

## Tools

| Tool | Maps to | What it does |
|:---|:---|:---|
| `list_tasks` | `GET /api/tasks` | List tracked tasks with schedule, status, next run, last result. Optional `platform` / `status` / `category` / `search` filters. `status` includes **`MISSING`** — tracked by Cronsole but absent from the platform on the last sync (a native delete, or an offline agent / unreadable folder — indistinguishable from here); it self-heals to ACTIVE/DISABLED when the task reappears. |
| `run_task` | `POST /api/tasks/:id/run` | Trigger a task now by its Cronsole id (Windows → signed agent run; native → backend runs it). **A native job that ran and *failed* comes back as a result with `ran: true`, `success: false` — a finding about the user's system, not a tool error. A tool error means the run could not be started.** |
| `list_templates` | `GET /api/templates` | Browse the catalog with each template's id, tags, target platforms, default schedule, and declared `{{placeholder}}` parameters. |
| `list_folders` | `GET /api/tasks/folders` | List the real Windows Task Scheduler folders, with task counts and whether each is writable. **How you find a valid `folder`** before creating: Cronsole creates only its own `\Cronsole`, so any other folder must already exist. Unwritable folders (`\Microsoft\…`) are listed with `writable: false` rather than hidden — "exists but refused" is a different answer from "doesn't exist". Optional `search` / `writableOnly` / `limit` (a real machine can have 150+). |
| `create_task` | `POST /api/tasks` | Create a real task straight from a `command` + `schedule` — **no template needed**. The template is the wrong unit when the caller already knows the command. Windows commands are structured **no-shell** (`{executable, args[]}`) server-side, so a shell must be opted into explicitly (`cmd.exe /c "…"`). Optional `folder` / `category`. Optional **`createFolder`** (default `false`) creates a missing `folder` instead of refusing — the agent is elevated, so a folder it creates needs **administrator rights** to remove, and any folder created is named in the response. `TASKHUB_NATIVE` accepts a URL (HTTP GET job) and honestly refuses anything else. |
| `create_task_from_template` | `POST /api/templates/:id/apply` | Create a real task from a template — server fills placeholders from `parameters`, converts the cron, and registers it. Optional `folder` picks the Windows Task Scheduler folder (default `\Cronsole`; `\Microsoft\` refused). Targets **Windows, Cronsole-native and `CLAUDE_CODE`**: a Claude template's command is a *prompt*, so applying one creates a real routine (optional `repositoryUrls` attaches its checkout) — which needs a Claude Code session on the backend's machine, else a `400`. |
| `create_native_task` | `POST /api/tasks/native` | Create a Cronsole-**native** HTTP task run by the backend itself — no agent, no machine to be logged into. Takes a full job spec (`method` / `headers` / `body`), which is why it's separate from `create_task`, whose native path accepts only a URL. Native schedules are used **as given** (the backend owns the scheduler), so none of the Windows hourly-fallback risk applies. |
| `create_native_program_task` | `POST /api/tasks/native` | Create a Cronsole-**native** task that **runs an existing program** on a schedule, executed by the backend itself. Real run results — exit code, duration and captured output — land in the task history, unlike a Windows task where a `SUCCESS` only means the agent accepted the start. **Runs wherever the backend runs**, which is inside the container on a Dockerized install; check `executionHost` on the Cronsole-native row of `GET /api/tools/platforms` when the environment is unknown. The command is tokenized server-side and run with **no shell**. *(Named `create_native_script_task` until 2026-08-15 — it never took a script.)* |
| `create_native_script_task` | `POST /api/tasks/native` | Create a native task from a **script you supply**. Cronsole stores the body, writes it to a temp file at run time under a named `interpreter` (`powershell`·`pwsh`·`bash`·`sh`·`python`·`node` — a fixed list, never a path), runs it, and deletes it. Nothing needs to exist on the user's disk, which makes this the right tool when *you* are authoring the script. `node` is the safest interpreter: the backend runs on it, so it is present everywhere. |
| `create_native_check_task` | `POST /api/tasks/native` | Create a monitoring **check**: `http` (assert on status, body text, or a dotted JSON path), `tcp` (port accepts a connection), `fileFresh` (a file was written recently — **missing counts as failed**), `diskFree`. Use over `create_native_task` when the point is to *verify* rather than to *trigger* — a check can fail a `200` that serves an error page. `fileFresh`/`diskFree` measure the **backend's** filesystem. |
| `convert_schedule` | `POST /api/tasks/preview` | Validate/convert a 5-field UTC cron to a platform-native trigger; returns a confidence score (0–1), lossy-conversion warnings, a machine-readable **`lossy`** (`approximated` = derived-but-drifts vs. `replaced` = discarded for an hourly default — the two meanings the `0.7` score alone conflates), the resulting trigger, and **the upcoming run times** — all rendered in the text (`Weekly at 09:00 on Monday, …` + a `Lossy:` line) so a wrong conversion is visible without reading `structuredContent`. When the registered trigger disagrees with the cron, the text prints **both** lists (`You asked for: …` / `It will ACTUALLY run: …`), which is the one rendering that cannot be misread — a bare `confidence 1.0` is exactly what the Monday-only bug printed. Dates are only shown where they can be derived: an `approximated` step returns none rather than a guess. |
| `get_task_history` | `GET /api/tasks/:id/executions` | Recent runs — when, status, duration, captured log. Answers *"did last night's job work?"*. Capped at the 20 the route returns. **An empty history is not proof a task never ran**: Cronsole records manual runs and native fires, while a Windows task firing on its own trigger is recorded by *Windows* — so the tool says so instead of implying "never ran". |
| `export_task` | `GET /api/tasks/:id/export` | Windows → native Task Scheduler **XML**; native → Cronsole **JSON**. The route delivers XML as **UTF-16 LE + BOM** (the only encoding Windows re-imports), so the tool decodes it to real text — and tells you the file must be *saved back* as UTF-16 LE, since the encoding is lost the moment an agent writes a string to disk. |
| `import_task` | `POST /api/tasks/import` | The read half of `export_task`: a `cronsoleTaskVersion` bundle → a real task. Pass the file's contents **whole**, not just its `task` field. **Cronsole-native only** — a property of the format, not a policy: a native task's DB row *is* the task, so it round-trips, while a Windows definition is Task Scheduler XML on the machine and restores through the UI (Tools → Restore). Other platforms are refused by name, with the route that can do it. Creates a **new** task (new id, `ACTIVE`), so importing twice yields two — report the returned `nextRunTime`, since the file's cron is UTC. Ungated. |
| `list_task_archives` | `GET /api/tools/task-archives` | The tasks Cronsole archived before deleting them, newest first — what, when, and through which door. Each row carries **`restorable` with its reason**, so a Windows archive says *why* it cannot be rebuilt (its definition was never in the archive) rather than just refusing later. This is how you find an `archiveId`. |
| `restore_task_archive` | `POST /api/tools/task-archives/:id/restore` | Rebuild a deleted Cronsole-native task from its archived definition. What you get is a **new task** — new id, same schedule — and the archived **run history is not reattached**, because those runs happened to a task that no longer exists. The archive is **kept**, so the record of the deletion survives and a second call makes a second task. Ungated: undoing a delete is a create. |
| `set_task_status` | `PATCH /api/tasks/:id/status` | Enable / disable. **The honest way to park a task** — never encode "don't run" in the cron; an expression Windows can't express is silently replaced with an *hourly* trigger ([#14](../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)). Reversible, so it ships ungated. |
| `update_task_schedule` | `PATCH /api/tasks/:id/schedule` | Re-schedule without delete+recreate; the agent rebuilds only the trigger, preserving command and permissions. Same hourly-fallback caveat as create: **read the returned trigger, not the score**. |
| `update_task_action` | `PATCH /api/tasks/:id/actions` | Change command / working dir / description / run level. **Replaces** the action rather than patching it, so `command` and `runLevel` are both required — read the current values first. Structured no-shell, same as create. |
| `update_native_job` | `PATCH /api/tasks/:id/job` | Change what a Cronsole-**native** task runs — an HTTP job's URL/method/headers/body, or a script job's command and working directory. The native counterpart to `update_task_action`: no agent involved, cannot be refused by a platform, works while the agent is offline. **Replaces** the job rather than patching it (the two job types share no fields, so a merge would strand one type's fields inside the other) — send the whole spec, and passing a different `jobType` deliberately converts the task. A script runs **wherever the backend runs**; check `executionHost` on the Cronsole-native row of `GET /api/tools/platforms`. No shell. Ungated. |
| `rename_task` | `PATCH /api/tasks/:id` | Change the name Cronsole shows for a task. **A Cronsole label only** — nothing is renamed on the platform, `externalId` is unchanged, and a Windows task still appears in Task Scheduler under its original name (say so if the user might go looking). Survives future syncs: `upsertTasks` writes `name` on create and never on update, because no platform can supply a new name for an existing row. Cannot collide — the duplicate-name guard applies at *create*, where the name becomes part of the Windows path. Ungated. |
| `untrack_task` | `POST /api/tasks/:id/untrack` | Remove a task from Cronsole **without deleting it** — the scheduled task stays on the machine and keeps running; only Cronsole's record and its Cronsole run history go, and future syncs won't re-import it. The right verb for tidying a dashboard or undoing an over-broad import. Reversible by re-importing the category. Refuses `TASKHUB_NATIVE` (exists only inside Cronsole, so nothing to keep) and `CLAUDE_CODE` (tracked *because* the routine is declared in the connection config, so removing the row leaves the declaration and the next sync brings it back — use `disconnect_claude_routine`). Ungated. |
| `list_platforms` | `GET /api/tools/platforms` | The capability matrix: per platform, which verbs Cronsole can perform and the evidence behind each. Three states, and the middle one is the design — `verified` (has succeeded here, with the timestamp that earned it), `declared` (the route would accept it; nothing observed yet), `unsupported` (the route would refuse, because no such API exists). `unsupported` is a boundary, not a to-do. Call it before planning anything you are unsure is possible. |
| `list_claude_routines` | `GET /api/tools/platforms/claude/routines` | **Which of Claude's two APIs this install can reach** (`session.mode`), plus the routines declared with per-routine tokens, **without the tokens** (`hasToken` only). `mode: "oauth"` — the backend can read the user's Claude Code session, so routines can be listed, created, rescheduled, paused and fired directly; use `sync_tasks` + `list_tasks` for the real list. `mode: "declared"` — no session, so this list is all Cronsole knows and Claude's documented API has no list endpoint. Check this before `create_claude_routine`. |
| `create_claude_routine` | `POST /api/tasks` (`platform: CLAUDE_CODE`) | Create a real Claude Code routine — name, prompt, 5-field UTC cron, optional repositories and tool allowlist. **Requires `session.mode: "oauth"`**; otherwise 400. The prompt is natural language for an agent running in Anthropic's cloud, not a command line — which is why this is not `create_task`. Created with **no MCP connectors attached** deliberately (the server would otherwise attach every connector on the account). **Cannot be undone from here**: neither Claude API has a DELETE, so removal happens at claude.ai. Ungated — it creates, it does not destroy. |
| `connect_claude_routine` | `POST /api/tools/platforms/claude/routines` (+ `POST /api/tasks/sync`) | Store a routine's id and token so Cronsole can fire it, then import it. **Connect, not create** — this is the path for a routine that already exists, and the only one available in `declared` mode. Re-connecting an id **replaces** the stored token, which is the rotation path (generating at claude.ai revokes the previous one). Takes a live credential as a parameter, so it lands in the host's transcript — prefer the UI when a human is present. Ungated. |
| `edit_claude_routine` | `PATCH /api/tools/platforms/claude/routines/:id` | Fix a mistyped id or rename, **keeping the stored token**. Use instead of disconnect-then-connect: disconnecting discards the token, and claude.ai shows one once — so a typo would cost a regeneration (which revokes the old token elsewhere). The tracked task follows the id, so run history, star and category survive. To *rotate* a token, re-connect the same id. Ungated. |
| `disconnect_claude_routine` | `DELETE /api/tools/platforms/claude/routines/:id` | Forget a routine. **Not a delete** — it keeps running at claude.ai, which Cronsole has no API to stop. The stored token is discarded and cannot be recovered (claude.ai shows it once), so re-connecting means generating a new one. **Removes the tracked tasks with it** (`tasksRemoved`), which is not incidental cleanup — a Claude task is tracked *because* the routine is declared, so this is the only way to take one off the dashboard. Ungated. |
| `sync_tasks` | `POST /api/tasks/sync` | Import or refresh. Omit `categories` to REFRESH what you already track (adds nothing new); pass `categories` to IMPORT them — which also forgets prior untracks inside those categories, because naming a category is the gesture that started tracking it. A plain refresh deliberately does not, so it can never undo a deliberate removal. |
| `get_diagnostics` | `GET /api/tools/diagnostics` | **Is Cronsole itself working?** — the agent connection, database, native scheduler, template catalog, API-token expiry and allowed origins, each with the evidence behind it. Ask this **before** `get_task_health`: a wedged agent makes every Windows task look unhealthy, and the fix is in none of them. `unknown` is **not** `pass` — it means the check could not be measured, and it ranks above pass for that reason. `measuredOn` says which machine the facts describe (on a Dockerized stack, the container). Read-only, no inputs, repairs nothing — and it cannot report on a backend that is down, because that backend serves it. |
| `get_task_health` | `GET /api/tools/task-health` | Tier + score per task, worst first, with signals that each name the field they came from. `unknown` is **not** `ok` — it means no evidence was reported. `disabled` is not unhealthy. System tasks hidden by default (they bury your own), and the count of what was hidden is stated. `tier` / `includeSystem` / `limit` are applied **by the route**, so `counts` always describes the same population as the list — `scope` says which one. |
| `list_run_history` | `GET /api/tools/history` | Run history **across** tasks, unlike `get_task_history`. Rows are runs *Cronsole performed* — a Windows task firing on its own schedule writes nothing, so empty ≠ nothing ran. Each row carries `runKind`: `native-execution` is a real outcome, `manual-trigger` only means the agent accepted the start. |
| `delete_task` | `DELETE /api/tasks/:id/native` | **Cronsole-native only** — refuses every other platform with a `400`, Windows included, so no MCP verb can destroy a scheduled task on the machine. The backend **archives the definition + last 20 runs before deleting**, and refuses the delete if that archive fails (task left unchanged); recover from `GET /api/tools/task-archives`. Only registered when `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`; otherwise **absent** from `tools/list`, not present-and-erroring. Prefer `set_task_status: DISABLED` to stop it running, or `untrack_task` to stop *tracking* it. |

### Why `delete_task` is native-only

It used to wrap `DELETE /api/tasks/:id` — the same route the UI uses — which meant the one verb on
this surface that could not be undone also had the **widest** reach on it, straight through to a
real Task Scheduler entry via the elevated agent. It now wraps a narrower route that refuses
anything but `TASKHUB_NATIVE`.

The point is the whole-surface property that buys: **no MCP tool can destroy an artifact on the
user's machine.** Windows removal over MCP means `untrack_task` (the row goes, the task keeps
running); genuinely destroying a Windows task needs a human in the UI. Where delete *is* allowed,
the row **is** the task, so there is no machine artifact to orphan — and it is archived first.

**The check is in the backend route, and must stay there.** A platform check written into this
package would be a *client-side* check the REST API still ignores, so the guarantee would hold only
for callers who came through the wrapper. That is not a guarantee — it is a convention. Same reason
`mcp-server/` owns no other logic.

### Why `delete_task` is gated and the rest are not

The verbs that *mutate* real Task Scheduler entries do so under an **elevated** agent, and an MCP
host may call a tool with far less deliberation than a user clicking through the UI's confirm
dialog — so "the route already exists" is not on its own an argument for exposing it. The gate is
therefore **tiered**, not blanket:

- **Read-only** (`list_*`, `get_task_history`, `export_task`, `convert_schedule`) — always on.
- **Creating** (`create_*`, `import_task`, `restore_task_archive`) — always on. `restore_task_archive`
  is the sharp case and the asymmetry is deliberate: `delete_task` is gated, undoing one is not.
  Gating recovery behind the same flag as destruction would mean the flag that protects a user
  from a bad delete also stops them fixing it.
- **Reversible** (`set_task_status`, `update_task_*`, `untrack_task`) — always on.
  `set_task_status` especially: it is the *safe* way to stop a task, and gating it would push a
  caller toward the unsafe workaround of cronning a task into silence ([#14](../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)).
  A gate that makes the safe path harder than the unsafe one is worse than no gate.
  `untrack_task` is the same argument applied to *removal*: gating deletion is only honest if a
  safe way to remove a task from the dashboard exists without the gate, or an agent asked to
  "clean this up" has exactly one tool for the job and it is the irreversible one.
- **Irreversible** (`delete_task`) — off unless you opt in, *and* narrowed to native tasks with a
  mandatory pre-delete archive (above). The gate stayed shut by default even after that narrowing:
  loosening two safety dimensions in one change means a later failure cannot be attributed to
  either.

Why an **env var** and not a `confirm: true` parameter: the model fills a parameter in itself, so
it is the caller assuring itself it is sure — the exact deliberation that's missing. An env var is
**out of band**; the human sets it, and no amount of agent reasoning reaches it.

## Configuration

Set via environment (see [`.env.example`](.env.example)):

| Var | Required | Default | Notes |
|:---|:---:|:---|:---|
| `CRONSOLE_TOKEN` | ✅ | — | A user JWT presented as `Authorization: Bearer <token>`. |
| `CRONSOLE_API_URL` |  | `http://localhost:3000/api` | Backend REST base URL (include `/api`). |
| `CRONSOLE_TIMEOUT_MS` |  | `15000` | Per-request timeout. |
| `CRONSOLE_MCP_ALLOW_DESTRUCTIVE` |  | `false` | Register `delete_task` (**Cronsole-native tasks only**, archived before deletion). Only an exact `true`/`1` opens it — a typo, an empty value, or an unexpanded `${…}` literal all fail **closed**, because a false negative costs one missing tool while a false positive hands an agent a deletion verb you never granted. When off, `delete_task` is **absent** from `tools/list`. |

> [!IMPORTANT]
> The server reads its **process environment only** — it does not load a `.env` file, so
> copying `.env.example` to `.env.local` accomplishes nothing on its own. Export
> `CRONSOLE_TOKEN` in the environment your MCP host is **launched from**:
>
> ```powershell
> [Environment]::SetEnvironmentVariable('CRONSOLE_TOKEN', '<jwt>', 'User')   # Windows, persistent
> ```
> ```bash
> export CRONSOLE_TOKEN='<jwt>'                                              # POSIX
> ```
>
> On Windows a process inherits its environment from its parent, so a **already-open terminal
> won't see a newly set variable** — close it and open a fresh one, then relaunch the host.
> Restarting the host alone is not enough.

**Getting a token** — issue one from the dashboard: **Settings -> Account -> API tokens -> New API
token**. Name it, pick a lifetime (**30 / 60 / 90 days, or never**), confirm with your password, and
copy it. It is shown once; nothing stores it, only its `jti`, which is what makes revocation
possible.

Export it as `CRONSOLE_TOKEN` in the environment your MCP host launches from.

> Prefer **never expires** for a machine you control. An expired token makes this server *refuse to
> start*, so its tools go **missing** rather than erroring — a never-expiring token removes that
> failure mode, and is only safe to offer because **Revoke** in the same panel kills it immediately
> without touching any other client.

> ⚠️ The token is a real credential — keep it in your environment, never in a committed file.
> `.mcp.json` references it as `${CRONSOLE_TOKEN}` precisely so the literal secret never lands
> in the repo. The list shows a last-used date, so an unfamiliar token that is being used is worth
> revoking.

> **Note:** API tokens are separate from your browser session, which stays at 24h. Until 2026-08-15
> this section told you to hand-mint with `jsonwebtoken.sign` and the backend's `JWT_SECRET`; such
> tokens carry no `jti` and cannot be revoked individually — see the
> [MCP Server Guide](../docs/user-guides/guides/MCP_Server_Guide.md#getting-a-token).

## Build & run

```bash
npm install
npm test           # vitest — no backend or token needed
npm run build      # tsc → dist/
npm start          # runs dist/index.js over stdio (expects CRONSOLE_TOKEN in env)
npm run inspect    # open the MCP Inspector against the server
```

> [!IMPORTANT]
> **`npm start` runs `dist/`, not `src/`** — so an unbuilt change is invisible. This is the
> **third thing that runs stale**, alongside the Dockerized backend and the published agent.
> Build before you conclude a change didn't work.

### What the tests cover — and what they can't

`npm test` drives the **real registered tools** through a **real MCP client** over an
in-memory transport, stubbing only the HTTP client; `client.ts` is tested against a real local
HTTP server rather than a mocked axios (the thing under test *is* how axios reports failures,
so a mock would only assert our belief about it). That covers everything the wrapper owns:
tool registration, input-schema validation, filtering and limits, request-body shaping, error
normalization, and honest rendering of lossy conversions.

It **cannot** tell you the wrapper and the API still agree — the stub encodes the response
shape we *think* the backend returns. If a route's shape moves, the suite stays green while
the real tool breaks. That's the [#9](../docs/troubleshooting/README.md#9-agent-payload-arrives-with-every-field-empty)
failure mode one layer up: *both sides green while disagreeing about the wire.* **After
changing a wrapped route, drive the tool against a running backend by hand.**

## Wiring into an MCP host

The backend must be running and reachable at `CRONSOLE_API_URL`.

**Claude Code**

```bash
claude mcp add cronsole \
  --env CRONSOLE_TOKEN=<your-jwt> \
  --env CRONSOLE_API_URL=http://localhost:3000/api \
  -- node /absolute/path/to/cronsole/mcp-server/dist/index.js
```

**Claude Desktop / any JSON-config host** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cronsole": {
      "command": "node",
      "args": ["D:/AI_Agents/Projects/Mikes_AI_Lab/Repos/Live_Apps/cronsole/mcp-server/dist/index.js"],
      "env": {
        "CRONSOLE_TOKEN": "<your-jwt>",
        "CRONSOLE_API_URL": "http://localhost:3000/api"
      }
    }
  }
}
```

**This repo (dogfooding)**

The root [`.mcp.json`](../.mcp.json) — seeded from
[`.mcp.json.example`](../.mcp.json.example) — carries a `cronsole` entry alongside the dev
tooling (context7, playwright, …), so a Claude Code session in this repo can drive a running
Cronsole while building it:

```json
"cronsole": {
  "type": "stdio",
  "command": "node",
  "args": ["./mcp-server/dist/index.js"],
  "env": {
    "CRONSOLE_TOKEN": "${CRONSOLE_TOKEN}",
    "CRONSOLE_API_URL": "http://localhost:3000/api"
  }
}
```

The `${CRONSOLE_TOKEN}` reference is deliberate: the config is committed, the secret is not.
It also means the entry is **inert until you export the variable** — see the Configuration
note above, and [troubleshooting #8](../docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)
for what an unset variable looks like from the outside.

> [!NOTE]
> Two different MCP surfaces share that one file. The other servers are **dev tooling** for
> *building* Cronsole; `cronsole` is a **product component** for *using* it. Only the latter
> needs a backend and a token, which is why it's the only entry that can fail to start.

## Design notes

- **Honest errors.** The client normalizes an API failure into the backend's own message +
  status (`Task not found`, `HTTP 409 …`), and every tool returns `isError: true` on failure
  instead of throwing — the model sees a readable reason, not a stack trace.
- **stdout is sacred.** All logging goes to `stderr` (`console.error`); stdout is the
  JSON-RPC stream.
- **Read/preview vs. side-effecting.** `list_*` (incl. `list_folders`) and `convert_schedule`
  are safe to call freely; `run_task`, `create_task`, and `create_task_from_template` cause
  real effects on the user's machine (running / registering Windows tasks) — same guardrails
  as the dashboard.
- **Say why, not just no.** `list_folders` reports an unwritable folder rather than filtering
  it out, because an omission reads as *"that folder doesn't exist"* and sends the caller
  looking for a folder it can already see. The route made this choice for the UI; the wrapper
  must not quietly undo it.
- **Lossy conversions are surfaced at the volume of a success.** The backend *accepts* a
  fallback trigger rather than refusing it, so a task can be created on a schedule that isn't
  the one asked for. `create_task` prints the warnings next to the result and points at
  `convert_schedule`. The wrapper does **not** re-derive the trigger to compensate for the
  backend's mild warning text — that fix belongs in the route (ROADMAP), and a wrapper that
  patches over a backend message has started owning logic.

## Layout

```
mcp-server/
├── src/
│   ├── index.ts     # stdio bootstrap
│   ├── client.ts    # thin axios client over the REST API + error normalization
│   ├── tools.ts     # the tool registrations
│   └── __tests__/   # vitest — `npm test`, no backend needed
├── .env.example
├── package.json
└── tsconfig.json
```

## Related

| Resource | Why |
|:---|:---|
| [**💬 MCP prompt library**](../docs/prompts/mcp-server/README.md) | What to say to an assistant once this is connected, grouped by task — Windows jobs, headless agent runs, native HTTP and script jobs, Claude routines, audits, cleanup. |
| [**🧩 MCP Server Guide**](../docs/user-guides/guides/MCP_Server_Guide.md) | Setup, token minting, host wiring, troubleshooting. |
| [**✍️ Task authoring**](../skills/cronsole/references/task-authoring.md) | The invariants every create tool here is bound by. |
