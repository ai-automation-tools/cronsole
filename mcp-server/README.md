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
| `list_tasks` | `GET /api/tasks` | List tracked tasks with schedule, status, next run, last result. Optional `platform` / `status` / `category` / `search` filters. |
| `run_task` | `POST /api/tasks/:id/run` | Trigger a task now by its TaskHub id (Windows → signed agent run; native → backend runs it). |
| `list_templates` | `GET /api/templates` | Browse the catalog with each template's id, tags, target platforms, default schedule, and declared `{{placeholder}}` parameters. |
| `create_task_from_template` | `POST /api/templates/:id/apply` | Create a real task from a template — server fills placeholders from `parameters`, converts the cron, and registers it. Only Windows + TaskHub-native are creatable today. |
| `convert_schedule` | `POST /api/tasks/preview` | Validate/convert a 5-field UTC cron to a platform-native trigger; returns a confidence score (0–1) + lossy-conversion warnings. |

## Configuration

Set via environment (see [`.env.example`](.env.example)):

| Var | Required | Default | Notes |
|:---|:---:|:---|:---|
| `TASKHUB_TOKEN` | ✅ | — | A user JWT presented as `Authorization: Bearer <token>`. |
| `TASKHUB_API_URL` |  | `http://localhost:3000/api` | Backend REST base URL (include `/api`). |
| `TASKHUB_TIMEOUT_MS` |  | `15000` | Per-request timeout. |

**Minting a token** (the same kind the frontend dev token is): run from `backend/` with the
backend's `JWT_SECRET` in scope —

```bash
node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
```

> ⚠️ The token is a real credential. Keep it in a gitignored `.env.local` or the host's env
> block — never commit it. A per-user pairing flow replaces this hand-minted token once the
> Go-public account system lands (see the roadmap).

## Build & run

```bash
npm install
npm run build      # tsc → dist/
npm start          # runs dist/index.js over stdio (expects TASKHUB_TOKEN in env)
npm run inspect    # open the MCP Inspector against the server
```

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

> This server is **not** wired into the repo's root [`.mcp.json`](../.mcp.json) on purpose —
> that file is Claude Code's *dev tooling* for building TaskHub (context7, playwright, …),
> whereas this is a *product component* that end users point their own MCP host at. Adding it
> there would fail to start whenever a token/backend isn't present.

## Design notes

- **Honest errors.** The client normalizes an API failure into the backend's own message +
  status (`Task not found`, `HTTP 409 …`), and every tool returns `isError: true` on failure
  instead of throwing — the model sees a readable reason, not a stack trace.
- **stdout is sacred.** All logging goes to `stderr` (`console.error`); stdout is the
  JSON-RPC stream.
- **Read/preview vs. side-effecting.** `list_*` and `convert_schedule` are safe to call
  freely; `run_task` and `create_task_from_template` cause real effects on the user's machine
  (running / registering Windows tasks) — same guardrails as the dashboard.

## Layout

```
mcp-server/
├── src/
│   ├── index.ts     # stdio bootstrap
│   ├── client.ts    # thin axios client over the REST API + error normalization
│   └── tools.ts     # the 5 tool registrations
├── .env.example
├── package.json
└── tsconfig.json
```
