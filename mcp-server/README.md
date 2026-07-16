<h1 align="center">🧩 TaskHub MCP Server</h1>

<p align="center">
  <em>A Model Context Protocol server that lets Claude, Codex, Cursor, and other MCP hosts
  list, run, and create TaskHub scheduled tasks in natural language.</em>
</p>

---

## What it is

A **thin wrapper over the TaskHub REST API**. The server owns no business logic — every
tool is a call through to a backend route, so all the important guarantees (owner scoping,
no-shell command structuring, signed agent commands, cron→trigger conversion) stay
server-side where they're already tested. See [`docs/ROADMAP.md`](../docs/ROADMAP.md) › P3.

It speaks MCP over **stdio** and authenticates to the backend as **one user** via a JWT you
supply — its tasks are the tasks it can see, run, and create.

## Tools

| Tool | Maps to | What it does |
|:---|:---|:---|
| `list_tasks` | `GET /api/tasks` | List tracked tasks with schedule, status, next run, last result. Optional `platform` / `status` / `category` / `search` filters. `status` includes **`MISSING`** — tracked by TaskHub but absent from the platform on the last sync (a native delete, or an offline agent / unreadable folder — indistinguishable from here); it self-heals to ACTIVE/DISABLED when the task reappears. |
| `run_task` | `POST /api/tasks/:id/run` | Trigger a task now by its TaskHub id (Windows → signed agent run; native → backend runs it). |
| `list_templates` | `GET /api/templates` | Browse the catalog with each template's id, tags, target platforms, default schedule, and declared `{{placeholder}}` parameters. |
| `list_folders` | `GET /api/tasks/folders` | List the real Windows Task Scheduler folders, with task counts and whether each is writable. **How you find a valid `folder`** before creating: TaskHub creates only its own `\TaskHub`, so any other folder must already exist. Unwritable folders (`\Microsoft\…`) are listed with `writable: false` rather than hidden — "exists but refused" is a different answer from "doesn't exist". Optional `search` / `writableOnly` / `limit` (a real machine can have 150+). |
| `create_task` | `POST /api/tasks` | Create a real task straight from a `command` + `schedule` — **no template needed**. The template is the wrong unit when the caller already knows the command. Windows commands are structured **no-shell** (`{executable, args[]}`) server-side, so a shell must be opted into explicitly (`cmd.exe /c "…"`). Optional `folder` / `category`. `TASKHUB_NATIVE` accepts a URL (HTTP GET job) and honestly refuses anything else. |
| `create_task_from_template` | `POST /api/templates/:id/apply` | Create a real task from a template — server fills placeholders from `parameters`, converts the cron, and registers it. Optional `folder` picks the Windows Task Scheduler folder (default `\TaskHub`; `\Microsoft\` refused). Only Windows + TaskHub-native are creatable today. |
| `create_native_task` | `POST /api/tasks/native` | Create a TaskHub-**native** HTTP task run by the backend itself — no agent, no machine to be logged into. Takes a full job spec (`method` / `headers` / `body`), which is why it's separate from `create_task`, whose native path accepts only a URL. Native schedules are used **as given** (the backend owns the scheduler), so none of the Windows hourly-fallback risk applies. |
| `convert_schedule` | `POST /api/tasks/preview` | Validate/convert a 5-field UTC cron to a platform-native trigger; returns a confidence score (0–1), lossy-conversion warnings, a machine-readable **`lossy`** (`approximated` = derived-but-drifts vs. `replaced` = discarded for an hourly default — the two meanings the `0.7` score alone conflates), and the resulting trigger — all rendered in the text (`Weekly at 09:00 on Monday, …` + a `Lossy:` line) so a wrong conversion is visible without reading `structuredContent`. |
| `get_task_history` | `GET /api/tasks/:id/executions` | Recent runs — when, status, duration, captured log. Answers *"did last night's job work?"*. Capped at the 20 the route returns. **An empty history is not proof a task never ran**: TaskHub records manual runs and native fires, while a Windows task firing on its own trigger is recorded by *Windows* — so the tool says so instead of implying "never ran". |
| `export_task` | `GET /api/tasks/:id/export` | Windows → native Task Scheduler **XML**; native → TaskHub **JSON**. The route delivers XML as **UTF-16 LE + BOM** (the only encoding Windows re-imports), so the tool decodes it to real text — and tells you the file must be *saved back* as UTF-16 LE, since the encoding is lost the moment an agent writes a string to disk. |
| `set_task_status` | `PATCH /api/tasks/:id/status` | Enable / disable. **The honest way to park a task** — never encode "don't run" in the cron; an expression Windows can't express is silently replaced with an *hourly* trigger ([#14](../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)). Reversible, so it ships ungated. |
| `update_task_schedule` | `PATCH /api/tasks/:id/schedule` | Re-schedule without delete+recreate; the agent rebuilds only the trigger, preserving command and permissions. Same hourly-fallback caveat as create: **read the returned trigger, not the score**. |
| `update_task_action` | `PATCH /api/tasks/:id/actions` | Change command / working dir / description / run level. **Replaces** the action rather than patching it, so `command` and `runLevel` are both required — read the current values first. Structured no-shell, same as create. |
| `delete_task` | `DELETE /api/tasks/:id` | **Permanent** — no trash, no restore. Only registered when `TASKHUB_MCP_ALLOW_DESTRUCTIVE=true`; otherwise the tool is **absent** from `tools/list`, not present-and-erroring. Prefer `set_task_status: DISABLED`. |

### Why `delete_task` is gated and the rest are not

The verbs that *mutate* real Task Scheduler entries do so under an **elevated** agent, and an MCP
host may call a tool with far less deliberation than a user clicking through the UI's confirm
dialog — so "the route already exists" is not on its own an argument for exposing it. The gate is
therefore **tiered**, not blanket:

- **Read-only** (`list_*`, `get_task_history`, `export_task`, `convert_schedule`) — always on.
- **Reversible** (`set_task_status`, `update_task_*`) — always on. `set_task_status` especially:
  it is the *safe* way to stop a task, and gating it would push a caller toward the unsafe
  workaround of cronning a task into silence ([#14](../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)).
  A gate that makes the safe path harder than the unsafe one is worse than no gate.
- **Irreversible** (`delete_task`) — off unless you opt in.

Why an **env var** and not a `confirm: true` parameter: the model fills a parameter in itself, so
it is the caller assuring itself it is sure — the exact deliberation that's missing. An env var is
**out of band**; the human sets it, and no amount of agent reasoning reaches it.

## Configuration

Set via environment (see [`.env.example`](.env.example)):

| Var | Required | Default | Notes |
|:---|:---:|:---|:---|
| `TASKHUB_TOKEN` | ✅ | — | A user JWT presented as `Authorization: Bearer <token>`. |
| `TASKHUB_API_URL` |  | `http://localhost:3000/api` | Backend REST base URL (include `/api`). |
| `TASKHUB_TIMEOUT_MS` |  | `15000` | Per-request timeout. |
| `TASKHUB_MCP_ALLOW_DESTRUCTIVE` |  | `false` | Register `delete_task`. Only an exact `true`/`1` opens it — a typo, an empty value, or an unexpanded `${…}` literal all fail **closed**, because a false negative costs one missing tool while a false positive hands an agent a deletion verb you never granted. When off, `delete_task` is **absent** from `tools/list`. |

> [!IMPORTANT]
> The server reads its **process environment only** — it does not load a `.env` file, so
> copying `.env.example` to `.env.local` accomplishes nothing on its own. Export
> `TASKHUB_TOKEN` in the environment your MCP host is **launched from**:
>
> ```powershell
> [Environment]::SetEnvironmentVariable('TASKHUB_TOKEN', '<jwt>', 'User')   # Windows, persistent
> ```
> ```bash
> export TASKHUB_TOKEN='<jwt>'                                              # POSIX
> ```
>
> On Windows a process inherits its environment from its parent, so a **already-open terminal
> won't see a newly set variable** — close it and open a fresh one, then relaunch the host.
> Restarting the host alone is not enough.

**Minting a token** (the same kind the frontend dev token is): run from `backend/` with the
backend's `JWT_SECRET` in scope —

```bash
node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
```

> ⚠️ The token is a real credential — keep it in your environment, never in a committed file.
> `.mcp.json` references it as `${TASKHUB_TOKEN}` precisely so the literal secret never lands
> in the repo. A per-user pairing flow replaces this hand-minted token once the Go-public
> account system lands (see the roadmap).

## Build & run

```bash
npm install
npm test           # vitest — no backend or token needed
npm run build      # tsc → dist/
npm start          # runs dist/index.js over stdio (expects TASKHUB_TOKEN in env)
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

The backend must be running and reachable at `TASKHUB_API_URL`.

**Claude Code**

```bash
claude mcp add taskhub \
  --env TASKHUB_TOKEN=<your-jwt> \
  --env TASKHUB_API_URL=http://localhost:3000/api \
  -- node /absolute/path/to/taskhub/mcp-server/dist/index.js
```

**Claude Desktop / any JSON-config host** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "taskhub": {
      "command": "node",
      "args": ["D:/AI_Agents/Projects/Mikes_AI_Lab/Repos/Live_Apps/taskhub/mcp-server/dist/index.js"],
      "env": {
        "TASKHUB_TOKEN": "<your-jwt>",
        "TASKHUB_API_URL": "http://localhost:3000/api"
      }
    }
  }
}
```

**This repo (dogfooding)**

The root [`.mcp.json`](../.mcp.json) — seeded from
[`.mcp.json.example`](../.mcp.json.example) — carries a `taskhub` entry alongside the dev
tooling (context7, playwright, …), so a Claude Code session in this repo can drive a running
TaskHub while building it:

```json
"taskhub": {
  "type": "stdio",
  "command": "node",
  "args": ["./mcp-server/dist/index.js"],
  "env": {
    "TASKHUB_TOKEN": "${TASKHUB_TOKEN}",
    "TASKHUB_API_URL": "http://localhost:3000/api"
  }
}
```

The `${TASKHUB_TOKEN}` reference is deliberate: the config is committed, the secret is not.
It also means the entry is **inert until you export the variable** — see the Configuration
note above, and [troubleshooting #8](../docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)
for what an unset variable looks like from the outside.

> [!NOTE]
> Two different MCP surfaces share that one file. The other servers are **dev tooling** for
> *building* TaskHub; `taskhub` is a **product component** for *using* it. Only the latter
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
│   ├── tools.ts     # the 7 tool registrations
│   └── __tests__/   # vitest — `npm test` (75 tests, no backend needed)
├── .env.example
├── package.json
└── tsconfig.json
```
