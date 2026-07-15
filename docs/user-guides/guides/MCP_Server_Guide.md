<h1 align="center">🧩 MCP Server Guide</h1>

<p align="center">
  <em>Drive TaskHub in natural language from Claude, Codex, Cursor, or any MCP host —
  list, run, and create scheduled tasks without leaving your assistant.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/component-mcp--server-8B5CF6?style=for-the-badge" alt="Component: mcp-server">
  <img src="https://img.shields.io/badge/transport-stdio-2ea44f?style=for-the-badge" alt="Transport: stdio">
  <img src="https://img.shields.io/badge/status-shipped-2ea44f?style=for-the-badge" alt="Status: shipped">
</p>

---

## What it is

The **TaskHub MCP server** ([`mcp-server/`](../../../mcp-server/README.md)) is a
[Model Context Protocol](https://modelcontextprotocol.io) server that exposes TaskHub's REST
API as a set of tools an AI assistant can call. Ask Claude *"what scheduled tasks do I have
that failed recently?"* or *"create a daily database backup from the backup template at 2am"*
and it calls straight through to your running TaskHub backend.

It's a **thin wrapper** — it holds no logic of its own. Every tool is a call to a backend
route, so all of TaskHub's guarantees (per-user scoping, no-shell command structuring, signed
agent commands, cron→trigger conversion) stay server-side where they're already tested. It
speaks MCP over **stdio** and authenticates as **one user** via a token you provide.

> [!NOTE]
> This is the same "single pane of glass" you get in the dashboard, reached through your AI
> assistant instead of the browser. Anything the MCP server can do, your TaskHub user account
> can do.

## The tools

| Tool | What you'd ask for | Backend route |
|:---|:---|:---|
| **`list_tasks`** | "List my Windows tasks", "which tasks failed?", "show tasks in the Backup category" | `GET /api/tasks` |
| **`run_task`** | "Run the nightly backup now" | `POST /api/tasks/:id/run` |
| **`list_templates`** | "What backup templates are there?", "show AI agent templates" | `GET /api/templates` |
| **`list_folders`** | "Which Task Scheduler folders can I create a task in?" | `GET /api/tasks/folders` |
| **`create_task`** | "Run `C:\jobs\nightly.ps1` every weekday at 6am" — any command you already know | `POST /api/tasks` |
| **`create_task_from_template`** | "Create a daily repo digest from the Claude Code template at 7am, in the Dev folder" | `POST /api/templates/:id/apply` |
| **`convert_schedule`** | "Will `0 9 * * 1` convert cleanly to a Windows trigger?" | `POST /api/tasks/preview` |

**`create_task` vs. `create_task_from_template`:** use `create_task` when you already know the
command to run — it's the direct path, and it's what the dashboard's New Task modal has always
done. Use the template version when you want a *tested recipe* for a known use case (database
backup, git fetch, webhook ping), including a sane default schedule and declared parameters.
Asking for "a task that runs this script" through a template means inventing a template to fit,
which is backwards.

`list_tasks` and `list_templates` accept optional filters (`platform`, `status`, `category`,
`search`) and are bounded (default 50 results, with an honest "showing N of M" note).
`create_task_from_template` fills the template's `{{placeholder}}` parameters from the values
you pass. Both create tools are gated to the platforms TaskHub can actually create on today
(**Windows Task Scheduler** + **TaskHub-native**), and their optional **`folder`** chooses the
real Task Scheduler folder the task lands in — default `\TaskHub`, and it becomes the task's
category in TaskHub. Any *other* folder must already exist: removing a Task Scheduler folder
needs elevation, so TaskHub won't leave behind one you'd have to delete by hand. **`list_folders`
is how your assistant finds one** — it shows every real folder, its task count, and whether a
task can be created there. Folders it can't use (like `\Microsoft\…`) are shown as *not
writable* rather than hidden, so you get "that one's refused" instead of a confusing silence.

> [!NOTE]
> **What you can't do over MCP yet.** Enable/disable, re-schedule, edit a command, delete, run
> history, and export are **not** tools today — use the dashboard or the REST API. If your
> assistant offers to "disable" a task by changing its schedule, don't let it: a cron TaskHub
> can't express natively is replaced with an **hourly** trigger, so that makes it run *more*,
> not less. Expanding this surface is on the roadmap.

> [!IMPORTANT]
> **`\Microsoft\` and its descendants are refused.** Windows keeps its own scheduled tasks
> there, and registering a same-named task in the same folder **silently overwrites** the
> existing one — so a plausible-sounding request could destroy a real system task with no
> error. The refusal is enforced in the backend *and* independently in the agent, which is the
> process that holds the elevation.

> [!IMPORTANT]
> `list_*` and `convert_schedule` are read-only and safe to call freely. **`run_task`**,
> **`create_task`**, and **`create_task_from_template`** cause real effects on your machine
> (running / registering Windows tasks) — the same guardrails as clicking **Run Now** or
> **Apply** in the dashboard.

## Prerequisites

- A **running TaskHub backend** reachable over HTTP (local dev default `http://localhost:3000`).
  See [Setup](../../setup/README.md) or the [Quick Start](../../../README.md#-quick-start).
- **Node.js** (the same LTS the backend uses) to run the server.
- A **user JWT** for the account whose tasks you want to manage (below).

## Configure & build

From the repo root:

```bash
cd mcp-server
npm install
npm run build      # tsc → dist/
```

Configuration is via environment variables (see [`mcp-server/.env.example`](../../../mcp-server/.env.example)):

| Variable | Required | Default | Purpose |
|:---|:---:|:---|:---|
| `TASKHUB_TOKEN` | ✅ | — | A user JWT sent as `Authorization: Bearer <token>`. |
| `TASKHUB_API_URL` |  | `http://localhost:3000/api` | Backend REST base URL (include `/api`). |
| `TASKHUB_TIMEOUT_MS` |  | `15000` | Per-request timeout. |

> [!IMPORTANT]
> The server reads its **process environment only** — it loads no `.env` file, so copying
> `.env.example` to `.env.local` does nothing by itself. Either set the vars in your host's
> `env` block (below), or export `TASKHUB_TOKEN` in the environment you launch the host from:
>
> ```powershell
> [Environment]::SetEnvironmentVariable('TASKHUB_TOKEN', '<jwt>', 'User')   # Windows, persistent
> ```
> ```bash
> export TASKHUB_TOKEN='<jwt>'                                              # POSIX
> ```
>
> **On Windows, a fresh terminal is required** — a process inherits its environment from its
> parent, so an already-open terminal keeps handing the *old* environment to everything it
> launches. Restarting your MCP host inside that terminal won't pick up a newly set variable.

### Minting a token

The MCP server acts as one TaskHub user — mint a JWT the same way the frontend dev token is
minted. From `backend/` (with the backend's `JWT_SECRET` in scope):

```bash
node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
```

> [!WARNING]
> The token is a real credential — keep it in your environment or your host's env block,
> never in a committed file. A proper per-user pairing flow replaces this hand-minted token
> once the account system lands (see the [Roadmap](../../ROADMAP.md) › Go-public).

## Wire it into your assistant

The backend must be running and reachable at `TASKHUB_API_URL`.

### Claude Code

```bash
claude mcp add taskhub \
  --env TASKHUB_TOKEN=<your-jwt> \
  --env TASKHUB_API_URL=http://localhost:3000/api \
  -- node /absolute/path/to/taskhub/mcp-server/dist/index.js
```

### Claude Desktop / any JSON-config host

Add to `claude_desktop_config.json` (or the host's MCP config):

```json
{
  "mcpServers": {
    "taskhub": {
      "command": "node",
      "args": ["/absolute/path/to/taskhub/mcp-server/dist/index.js"],
      "env": {
        "TASKHUB_TOKEN": "<your-jwt>",
        "TASKHUB_API_URL": "http://localhost:3000/api"
      }
    }
  }
}
```

### Codex / Cursor / other MCP hosts

Any host that launches a stdio MCP server works — point it at
`node .../mcp-server/dist/index.js` with the same two env vars. The tools appear under the
`taskhub` server once it connects.

### Working inside the TaskHub repo

If you're developing TaskHub itself, the root `.mcp.json` (seeded from
[`.mcp.json.example`](../../../.mcp.json.example)) already carries a `taskhub` entry pointing at
`./mcp-server/dist/index.js`, with `TASKHUB_TOKEN` referenced as `${TASKHUB_TOKEN}` so the
committed config never holds the secret. Build the server, export the variable, and open a
**fresh terminal** — then the tools appear automatically.

> [!NOTE]
> That file mixes two different MCP surfaces. The other servers (context7, playwright, …) are
> **dev tooling** for *building* TaskHub. `taskhub` is a **product component** for *using* it —
> the only entry that needs a running backend and a token, and so the only one that can fail
> to start.

## Try it

Once connected, natural-language prompts map onto the tools:

- *"List my scheduled tasks that are disabled."* → `list_tasks(status: "DISABLED")`
- *"Which of my tasks last failed?"* → `list_tasks` then filters on the last-run status.
- *"Show me the Developer Pack templates."* → `list_templates(search: "dev")`
- *"Does `*/15 9-17 * * 1-5` convert cleanly for Windows?"* → `convert_schedule(...)`
- *"Run `C:\jobs\nightly.ps1` every weekday at 6am."* →
  `create_task(name: "Nightly", command: "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"C:\\jobs\\nightly.ps1\"", schedule: "0 13 * * 1-5")`
  — note the cron is **UTC**; 6am local is a different number.
- *"Create a task from `dev-git-fetch-prune` for `C:\repos\taskhub`, hourly."* →
  `create_task_from_template(templateId: "dev-git-fetch-prune", parameters: { repoPath: "C:\\repos\\taskhub" }, schedule: "0 * * * *")`

The assistant discovers a template's required parameters from `list_templates` (each template
lists its params, required ones marked) before calling `create_task_from_template`.

> [!TIP]
> **Ask it to check the schedule first.** `convert_schedule` shows the trigger your cron
> actually becomes — *"Weekly at 09:00 on Monday, Tuesday, …"* — which is worth reading, not
> just the confidence number next to it. A cron TaskHub can't express as a native Windows
> trigger is **replaced** with an hourly one rather than rejected, and that arrives as a
> mild-sounding warning. Rare schedules are the ones this bites.

## Troubleshooting

| Symptom | Likely cause / fix |
|:---|:---|
| `TASKHUB_TOKEN is not set` on startup | The env var is missing in the host's config for this server. |
| `TASKHUB_TOKEN was passed through unexpanded as the literal "${TASKHUB_TOKEN}"` | Your host resolved `${TASKHUB_TOKEN}` against an environment where it isn't set, so it forwarded the raw text. Export it and start the host from a **fresh terminal**. See [troubleshooting #8](../../troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token). |
| **The `taskhub` tools don't appear at all** | The server exited on startup — almost always the unexpanded-token case above. A host drops a server that fails to boot, so the symptom is *absence*, not an error. Check your host's MCP status (`/mcp` in Claude Code) for the message. |
| `HTTP 403: Invalid or expired token` | Check the token is *real* before assuming it expired: an unexpanded `${TASKHUB_TOKEN}` literal produces this same 403. If it is a real JWT, it's wrong, expired, or signed with a different `JWT_SECRET` than the running backend — re-mint. |
| `Could not reach the TaskHub backend … ECONNREFUSED` | The backend isn't running, or `TASKHUB_API_URL` is wrong (remember the `/api` suffix). |
| `HTTP 409` when creating | A Windows task with that name already exists — pass a different `name`. |
| `HTTP 400: Schedule cannot be converted…` | The cron isn't Windows-convertible; check it with `convert_schedule` first. |
| Tool returns an error but nothing crashes | By design — every tool returns a readable error (`isError`) instead of throwing. |

## How it fits together

```
Your AI assistant  ──MCP/stdio──►  taskhub mcp-server  ──HTTP(Bearer JWT)──►  TaskHub backend
   (Claude/Codex/…)                 (list/run/create/convert)                  (routes → agent / native scheduler)
```

For the package internals (source layout, design notes, `npm run inspect`), see the
[**mcp-server README**](../../../mcp-server/README.md).

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧩 mcp-server README**](../../../mcp-server/README.md) | Package internals, tool source, and the MCP Inspector. |
| [**🖥️ UI User Guide**](UI_User_Guide.md) | The same actions in the dashboard. |
| [**📄 Templates**](../../reports/templates/README.md) | The catalog `create_task_from_template` draws on. |
| [**🗺️ Roadmap**](../../ROADMAP.md) | Where the MCP server sits (P3) and what's next. |

---

<p align="center">
  <a href="../README.md">← User Guides</a> ·
  <a href="../../README.md">Docs home</a> ·
  <a href="../../../mcp-server/README.md">mcp-server README</a>
</p>
