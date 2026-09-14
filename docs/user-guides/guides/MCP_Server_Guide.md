<h1 align="center">🧩 MCP Server Guide</h1>

<p align="center">
  <em>Drive Cronsole in natural language from Claude, Codex, Cursor, or any MCP host —
  list, run, and create scheduled tasks without leaving your assistant.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/component-mcp--server-8B5CF6?style=for-the-badge" alt="Component: mcp-server">
  <img src="https://img.shields.io/badge/transport-stdio-2ea44f?style=for-the-badge" alt="Transport: stdio">
  <img src="https://img.shields.io/badge/status-shipped-2ea44f?style=for-the-badge" alt="Status: shipped">
</p>

---

## What it is

The **Cronsole MCP server** ([`mcp-server/`](../../../mcp-server/README.md)) is a
[Model Context Protocol](https://modelcontextprotocol.io) server that exposes Cronsole's REST
API as a set of tools an AI assistant can call. Ask Claude *"what scheduled tasks do I have
that failed recently?"* or *"create a daily database backup from the backup template at 2am"*
and it calls straight through to your running Cronsole backend.

It's a **thin wrapper** — it holds no logic of its own. Every tool is a call to a backend
route, so all of Cronsole's guarantees (per-user scoping, no-shell command structuring, signed
agent commands, cron→trigger conversion) stay server-side where they're already tested. It
speaks MCP over **stdio** and authenticates as **one user** via a token you provide.

> [!NOTE]
> This is the same "single pane of glass" you get in the dashboard, reached through your AI
> assistant instead of the browser. Anything the MCP server can do, your Cronsole user account
> can do.

## The tools

| Tool | What you'd ask for | Backend route |
|:---|:---|:---|
| **`list_tasks`** | "List my Windows tasks", "which tasks failed?", "show tasks in the Backup category" | `GET /api/tasks` |
| **`run_task`** | "Run the nightly backup now", "run my disk check and tell me what it found" | `POST /api/tasks/:id/run` |
| **`list_templates`** | "What backup templates are there?", "show AI agent templates" | `GET /api/templates` |
| **`list_folders`** | "Which Task Scheduler folders can I create a task in?" | `GET /api/tasks/folders` |
| **`create_task`** | "Run `C:\jobs\nightly.ps1` every weekday at 6am" — any command you already know | `POST /api/tasks` |
| **`create_task_from_template`** | "Create a daily repo digest from the Claude Code template at 7am, in the Dev folder" | `POST /api/templates/:id/apply` |
| **`create_native_task`** | "Ping my health endpoint every 15 minutes and POST this JSON to the webhook" | `POST /api/tasks/native` |
| **`create_native_program_task`** | "Run my cleanup script every night at 2am and tell me if it fails" | `POST /api/tasks/native` |
| **`create_native_script_task`** | "Write me a script that prunes old logs and run it nightly" | `POST /api/tasks/native` |
| **`create_native_check_task`** | "Check every 5 minutes that my API returns healthy, and alert me if not" | `POST /api/tasks/native` |
| **`convert_schedule`** | "Will `0 9 * * 1` convert cleanly to a Windows trigger?", "when will this actually run?" | `POST /api/tasks/preview` |
| **`get_task_history`** | "Did last night's backup work?" — runs **Cronsole** performed | `GET /api/tasks/:id/executions` |
| **`create_gemini_trigger`** | "Every Monday, summarise my repos and email me" — creates a scheduled Gemini agent; reports back anything Cronsole's prompt preflight noticed | `POST /api/tasks` |
| **`list_platform_runs`** | "Why did my scheduled task fail?" — runs the **platform** recorded, which on Gemini, GitHub, Vercel and Windows is where they all are | `GET /api/tasks/:id/platform-runs` |
| **`get_run_output`** | "What did that run actually do?" — the output and the **step list**, one run at a time | `GET /api/tasks/:id/platform-runs/:runId/output` |
| **`export_task`** | "Show me exactly what that task is registered to run", "back this task up" — or **"set this task up on my other machine"**, which asks for the *portable* format instead. Two formats: `native` (default — Task Scheduler XML, or Cronsole JSON) is the faithful backup; `format: 'template'` is portable, **drops platform-specific settings so it is not a backup**, and is the only one that works with the agent offline or on a **Claude routine** | `GET /api/tasks/:id/export[?format=]` |
| **`import_task`** | "Set that task up on this machine too" — recreates a **Cronsole-native** task from a `.json` you exported. Windows tasks are `.xml` and go through Tools → Restore in the app | `POST /api/tasks/import` |
| **`list_task_archives`** | "What have I deleted recently?" — the definitions Cronsole kept when tasks were deleted, and whether each can be rebuilt | `GET /api/tools/task-archives` |
| **`restore_task_archive`** | "Bring back the nightly digest I deleted" — rebuilds it as a **new** task on its old schedule. The old run history does not come back | `POST /api/tools/task-archives/:id/restore` |
| **`list_task_secrets`** | "Why won't that task run?" — which secrets a Cronsole-native job needs and which are actually set, **by name only**. No Cronsole API returns a secret's value, and no MCP tool can set one | `GET /api/tasks/:id/secrets` |
| **`set_task_status`** | "Disable the nightly backup for now", "turn it back on" | `PATCH /api/tasks/:id/status` |
| **`update_task_schedule`** | "Move the digest to 7am on weekdays" | `PATCH /api/tasks/:id/schedule` |
| **`update_task_action`** | "Point that task at the new script path" | `PATCH /api/tasks/:id/actions` |
| **`update_native_job`** | "Point that Cronsole-native task at the new URL", "make it run my script instead" — for native tasks; Windows uses `update_task_action` | `PATCH /api/tasks/:id/job` |
| **`rename_task`** | "Call that one 'Nightly report' instead" — renames it **in Cronsole only**; Task Scheduler still shows the original name | `PATCH /api/tasks/:id` |
| **`untrack_task`** | "Stop showing all those Microsoft tasks", "I imported that folder by mistake" — removes it from Cronsole, **leaves the scheduled task running**. Not for Claude routines — disconnect those | `POST /api/tasks/:id/untrack` |
| **`list_platforms`** | "What can Cronsole actually do with Windows?" — per platform, whether it is a **controller** or a read-only **observer**, then which actions work here, which are untested, and which are impossible | `GET /api/tools/platforms` |
| **`list_claude_routines`** | "Can you manage my Claude routines?" — reports whether this install can reach the full routines API, plus any routines connected with their own token | `GET /api/tools/platforms/claude/routines` |
| **`create_claude_routine`** | "Every weekday at 7am, review yesterday's PRs in my repo and post a summary" — creates a real Claude Code routine. Needs you signed into the Claude Code CLI on the machine running Cronsole | `POST /api/tasks` |
| **`connect_claude_routine`** | "Add my nightly PR review routine" — stores its id and token so you can trigger it. For routines that already exist, and the only path when Cronsole can't read your Claude Code session | `POST /api/tools/platforms/claude/routines` |
| **`edit_claude_routine`** | "I pasted the wrong routine id" — fixes it **without asking for the token again** | `PATCH /api/tools/platforms/claude/routines/:id` |
| **`disconnect_claude_routine`** | "Forget that routine" — removes it and its task from Cronsole; **it keeps running at claude.ai**. The only way to take a Claude task off the dashboard | `DELETE /api/tools/platforms/claude/routines/:id` |
| **`sync_tasks`** | "Import my Backups folder", "refresh everything" — importing needs the category named; a bare refresh adds nothing new. The result says what the sync **covered**, not only what it kept, so "nothing imported" can be told apart from "nothing seen" | `POST /api/tasks/sync` |
| **`get_diagnostics`** | "Why isn't this working?" — checks Cronsole itself: the agent, the database, the scheduler, the catalog, token expiry. Ask before `get_task_health`, which assumes Cronsole can see your tasks at all | `GET /api/tools/diagnostics` |
| **`get_task_health`** | "What's broken?" — every task scored and ranked worst-first, with the evidence for each verdict | `GET /api/tools/task-health` |
| **`list_run_history`** | "What failed this month?" — across all tasks, unlike the per-task history | `GET /api/tools/history` |
| **`delete_task`** ⚠️ | "Delete the old test task" — **Cronsole-native tasks only**, backed up first, and **off by default**; see below | `DELETE /api/tasks/:id/native` |

**`run_task` reports two different kinds of bad news, and they mean opposite things.** A
Cronsole-native job runs *inside* the request, so if it executes and fails — a check whose endpoint
is down, a script that exits non-zero — that comes back as a **normal result** saying the run
failed, with the measurement that failed it. That is a finding about your system, and re-running it
will not change anything. A **tool error** means the run could not be started at all: the agent is
offline, the routine is paused, the id is wrong. Only the second one is worth retrying, and only the
first one means the thing you were monitoring is actually broken. (Windows and Claude tasks can only
produce the second kind — Cronsole hands the task to them and does not wait, so what it reports is
whether the handoff worked. Use `get_task_history` for what a Windows task actually did.)

**`create_task` vs. `create_task_from_template`:** use `create_task` when you already know the
command to run — it's the direct path, and it's what the dashboard's New Task modal has always
done. Use the template version when you want a *tested recipe* for a known use case (database
backup, git fetch, webhook ping), including a sane default schedule and declared parameters.
Asking for "a task that runs this script" through a template means inventing a template to fit,
which is backwards.

**Filing a task in a folder that doesn't exist yet.** By default Cronsole refuses: it creates only
its own `\Cronsole` folder, because the agent runs **elevated** and a folder it creates needs
administrator rights to delete again. If you genuinely want a new folder, `create_task` and
`create_task_from_template` both take **`createFolder: true`**, and the reply names every folder it
made — as does the **New folder…** row in the dashboard's *Task Scheduler folder* box, which is the
same opt-in. Two things worth knowing before
you ask for it: a **misspelled folder name becomes a real, permanent folder** (Cronsole never
removes it for you), and it does **not** let a task be filed under `\Microsoft\` — that stays
refused either way, so Windows' own scheduled tasks can't be overwritten. Ask your assistant to
list folders first if you're not sure what already exists.

**`platform` accepts `GITHUB_ACTIONS`** (2026-08-23) and **`VERCEL_CRON`** (2026-08-24) — two
**read-only** sources. Their tasks list, filter and report health like any other, and every verb
that would change one is refused with a `400`. `list_platforms` is the authority on that, as it is
for every platform; do not infer a capability from a task being listed.

**`VERCEL_CRON` never reports a last run result**, and that is permanent rather than pending:
Vercel publishes no run history for a cron job, so its tasks show a schedule and stay at `unknown`
health however well they are running. Read that as *no evidence*, not as a problem — and do not
suggest a sync or a reconnect to "fix" it, because nothing will.

**`platform` also accepts `GEMINI_TRIGGERS`** (2026-08-24), and it is the opposite case in every
respect — the **only hosted source that is not read-only**. Run, pause, create and delete all reach
real endpoints there, so an assistant that has learned "hosted means read-only" from the two above
will be wrong about this one. It reports real run outcomes too.

Three things about it are worth an assistant knowing before it explains a screen:

- **A `DISABLED` Gemini trigger may not have been disabled by a person.** Gemini pauses a trigger
  itself after repeated consecutive failures. `get_task_health` says which, and resuming it with
  `set_task_status` clears the pause and not the cause.
- **A trigger cannot be changed once it exists.** `update_task_schedule` and `update_task_action`
  are both refused with a 400: the preview API's update endpoint takes a trigger's status and
  display name and nothing else, so a schedule is fixed at the moment of creation. Do not offer to
  move one — the only path is `delete_task` plus a fresh `create_task`, and that produces a **new**
  task rather than the same one rescheduled. Say that plainly rather than quietly recreating.
- **Creating one takes a prompt, not a command.** `create_task` with `platform: "GEMINI_TRIGGERS"`
  reads `command` as the instruction the agent runs. The trigger is created with **no network
  allowlist**, so its agent can reach nothing outside its sandbox — say so rather than letting
  someone assume it can reach their repository.

`list_tasks` and `list_templates` accept optional filters (`platform`, `status`, `category`,
`search`) and are bounded (default 50 results, with an honest "showing N of M" note). A task's
`status` can be **`MISSING`** — tracked by Cronsole but gone from the platform on the last sync
(a native delete, or an offline agent / unreadable folder — the same from here); it self-heals
to ACTIVE/DISABLED when the task reappears, so `list_tasks(status: "MISSING")` answers "what did
I lose?".
`create_task_from_template` fills the template's `{{placeholder}}` parameters from the values
you pass. `create_task` is gated to the platforms a **command line** can be scheduled on
(**Windows Task Scheduler** + **Cronsole-native**); `create_task_from_template` also accepts
**`CLAUDE_CODE`** and **`GEMINI_TRIGGERS`**, because on both a template's "command" is a
*prompt*. Applying a Claude one creates a real Claude Code routine, with optional
**`repositoryUrls`** for the repositories it may check out. That one needs a Claude Code session
on the machine running the backend; without one the call returns a `400` saying so, so ask your
assistant to check `list_claude_routines` → `session.mode` first.
A **Gemini** template is a prompt *plus a grant*: it carries **`agentTools`**, the reach the
created trigger keeps for as long as it exists, and `list_templates` returns it so your assistant
can tell you what it will be able to do before it creates anything. Where a tool names a
**saved MCP server** (`preset`), the credential lives on your Gemini connection and is sent to
Google at create time — the template never holds one, and a name you have not saved is refused
with the list of the ones you have rather than creating a trigger that cannot authenticate. A
Gemini trigger cannot be edited afterwards; changing its prompt or schedule is **Recreate with
changes** on the task. Their optional **`folder`** chooses the
real Task Scheduler folder the task lands in — default `\Cronsole`, and it becomes the task's
category in Cronsole. Any *other* folder must already exist: removing a Task Scheduler folder
needs elevation, so Cronsole won't leave behind one you'd have to delete by hand. **`list_folders`
is how your assistant finds one** — it shows every real folder, its task count, and whether a
task can be created there. Folders it can't use (like `\Microsoft\…`) are shown as *not
writable* rather than hidden, so you get "that one's refused" instead of a confusing silence.

> [!NOTE]
> **Stopping a task: disable it, don't re-schedule it.** If your assistant offers to "pause" a
> task by giving it a rare cron (once a year, Feb 30), don't let it — a cron Cronsole can't
> express natively is replaced with an **hourly** trigger, so that makes it run *more*, not
> less. `set_task_status` with `DISABLED` is the honest way, and it's fully reversible.

> [!NOTE]
> **What you still can't do over MCP.** Importing/exporting *templates*, saving a task as a
> template, syncing, and pairing an agent are dashboard/REST only. Task **management** —
> enable/disable, re-schedule, edit, history, export, delete — is now covered by the tools above.

> [!IMPORTANT]
> **`\Microsoft\` and its descendants are refused.** Windows keeps its own scheduled tasks
> there, and registering a same-named task in the same folder **silently overwrites** the
> existing one — so a plausible-sounding request could destroy a real system task with no
> error. The refusal is enforced in the backend *and* independently in the agent, which is the
> process that holds the elevation.

> [!IMPORTANT]
> **No AI tool can set a secret, and that is deliberate.**
> A Cronsole-native job keeps its credentials in an encrypted per-task store and refers to them by
> name — `${secret.API_TOKEN}` in a URL, a header value, a request body, a program argument or an
> environment value. Your assistant can **write the reference** when it creates a task, and can ask
> `list_task_secrets` which ones are still unset. It cannot store the value: a tool call goes through
> the model's context and into your AI host's history file, which is exactly where a credential
> should not be. **Enter values in Cronsole** — open the task → Edit → Secrets. Until one is set the
> task refuses to start rather than running with a blank credential, and every create, import and
> restore says so by name. See [Secrets](UI_User_Guide.md#secrets).

> [!IMPORTANT]
> **What's safe, what's real, and what's off by default.**
> - **Read-only, call freely:** `list_*`, `get_task_history`, `list_platform_runs`, `get_run_output`, `export_task`, `convert_schedule`.
> - **`import_task` and `restore_task_archive` create a task, and both are on by default.** That is
>   the mirror of the rule below: deleting is behind a flag, undoing a delete is not — a switch that
>   protects you from a bad delete should not also stop you fixing one. Each makes a **new** task
>   rather than reviving the old one, so nothing is overwritten and importing the same file twice
>   leaves you with two tasks.
> - **Real effects on your machine:** `run_task`, `create_task`, `create_native_task`, `create_native_program_task`, `create_native_script_task`, `create_native_check_task`,
>   `create_task_from_template` (running / registering tasks) and `set_task_status`,
>   `update_task_schedule`, `update_task_action` (changing them). Same guardrails as clicking
>   **Run Now**, **Apply**, or **Edit** in the dashboard — and all of them are reversible.
> - **`untrack_task` removes a task from Cronsole but not from your machine.** The scheduled task
>   stays where it is and keeps running; Cronsole just stops tracking it (and forgets its Cronsole
>   run history). Use this to tidy a cluttered dashboard or undo an import you didn't mean to do
>   — importing that folder again brings it back.
> - **`delete_task` cannot touch a Windows task at all.** It deletes **Cronsole-native** tasks
>   only — the HTTP and script jobs Cronsole itself runs — and refuses anything else. So your
>   assistant can never destroy a scheduled task on your machine, no matter how it's asked. To get
>   a Windows task off the dashboard it has `untrack_task` (which leaves it running); to genuinely
>   delete one, you do it yourself in the Cronsole UI.
> - **And what it *can* delete, it backs up first.** Cronsole saves the task's full definition and
>   its last 20 runs before deleting, and **refuses to delete at all if that backup fails** —
>   leaving the task untouched. You can list and read those backups later, so a native task deleted
>   by mistake can be rebuilt.
> - **`delete_task` is still OFF unless you turn it on.** Set
>   `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true` in your host's environment to expose it; otherwise your
>   assistant won't even see the tool. That switch is deliberately *yours* — a tool parameter
>   like "confirm: true" would just be the assistant reassuring itself.

> [!TIP]
> **A `SUCCESS` in `get_task_history` means "Cronsole dispatched it and it reported success"** —
> a task that hangs forever reports exactly the same thing. If you suspect a hang, check
> Windows' own `LastTaskResult` rather than trusting Cronsole's report of itself. Equally, an
> **empty** history doesn't mean the task never ran: Cronsole records manual runs and native
> fires, while a Windows task firing on its own trigger is recorded by Windows.

## Prerequisites

- A **running Cronsole backend** reachable over HTTP (local dev default `http://localhost:3000`).
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
| `CRONSOLE_TOKEN` | ✅ | — | A user JWT sent as `Authorization: Bearer <token>`. |
| `CRONSOLE_API_URL` |  | `http://localhost:3000/api` | Backend REST base URL (include `/api`). |
| `CRONSOLE_TIMEOUT_MS` |  | `15000` | Per-request timeout. |
| `CRONSOLE_MCP_ALLOW_DESTRUCTIVE` |  | `false` | Expose the **`delete_task`** tool. It deletes **Cronsole-native tasks only** and backs each one up first, so it can't reach a Windows task — but it's still off unless you set this to exactly `true` (anything else, including a typo, leaves it off). When off, your assistant doesn't see the tool at all. Prefer disabling a task to deleting it. |

> [!IMPORTANT]
> The server reads its **process environment only** — it loads no `.env` file, so copying
> `.env.example` to `.env.local` does nothing by itself. Either set the vars in your host's
> `env` block (below), or export `CRONSOLE_TOKEN` in the environment you launch the host from:
>
> ```powershell
> [Environment]::SetEnvironmentVariable('CRONSOLE_TOKEN', '<jwt>', 'User')   # Windows, persistent
> ```
> ```bash
> export CRONSOLE_TOKEN='<jwt>'                                              # POSIX
> ```
>
> **On Windows, a fresh terminal is required** — a process inherits its environment from its
> parent, so an already-open terminal keeps handing the *old* environment to everything it
> launches. Restarting your MCP host inside that terminal won't pick up a newly set variable.

### Getting a token

The MCP server acts as one Cronsole user, authenticating with a JWT. Issue one from the dashboard —
no signing secret, no database lookup, no Node.

**1. Open Settings → Account → API tokens** and click **New API token**.

**2. Name it, pick a lifetime, confirm with your password.**

| Field | Notes |
|:---|:---|
| **Name** | What it is for — *"Claude Code on my desktop"*. It is how you will recognise it later when deciding what to revoke. |
| **Expires** | **30 / 60 / 90 days, or never.** 30 days is the default. |
| **Password** | Required even though you are already signed in. This mints a credential that can outlive every session, so a borrowed open tab must not be enough to create one. |

**3. Copy the token immediately.** It is shown **once**. Nothing stores it — only its `jti`, which
is what makes revocation possible — so there is no reveal endpoint and cannot be one.

**4. Export it** as `CRONSOLE_TOKEN` in the environment your MCP host launches from. On Windows a
newly-set variable needs a **fresh terminal** — a process inherits its parent's environment.

> [!TIP]
> **Prefer "never expires" for a machine you control, and revoke rather than rotate.** An expired
> token makes the MCP server *refuse to start*, so its tools go **missing** rather than erroring —
> which reads as "the integration is broken" rather than "my credential lapsed"
> ([troubleshooting #8](../../troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)).
> A never-expiring token removes that failure mode entirely, and is only safe to offer *because*
> you can revoke it: **Settings → Account → API tokens → Revoke** kills one token immediately,
> without touching any other client.

> [!WARNING]
> The token is a real credential — keep it in your environment or your host's env block, never in a
> committed file. The list shows each token's last-used date, so an unfamiliar one that is being
> used is worth revoking.

**These are separate from your browser session**, which stays at 24h (`JWT_EXPIRES_IN`) regardless.
That separation is the point: a long-lived credential for a client that cannot re-authenticate, and
a short one for a tab that can.

<details>
<summary>Alternative: a long-lived login token via <code>JWT_EXPIRES_IN</code></summary>

`JWT_EXPIRES_IN` in `backend/.env` sets how long a **login** token lasts (default `24h`, accepts a
duration or a plain number of seconds). Raising it also works for the MCP server — log in with
`curl` and use the returned `token` — but it lengthens *every* browser session too, including on a
phone if you use [remote access](Remote_Access_Guide.md), and those tokens carry no `jti` so they
**cannot be revoked** individually. Prefer an API token.

</details>

<details>
<summary>Previously: hand-minting with <code>jsonwebtoken.sign</code></summary>

Until 2026-08-15 this guide told you to run:

```bash
node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
```

That required the **signing secret**, a `userId` read out of the database, Node, and a shell — and
it produced a token the product itself could not issue. Such tokens keep working until they expire
and **nothing tracks or revokes them**, so replace one with an API token above; the only way to kill
a hand-minted token is rotating `JWT_SECRET`, which signs out every client at once.

</details>

<details>
<summary>Previously: hand-minting with <code>jsonwebtoken.sign</code></summary>

Until 2026-08-15 this guide told you to run:

```bash
node -e "console.log(require('jsonwebtoken').sign({id:'<userId>',email:'<email>'}, process.env.JWT_SECRET, {expiresIn:'30d'}))"
```

That required the **signing secret**, a `userId` read out of the database, Node, and a shell — and
it produced a token the product itself could not issue, since `expiresIn` was hardcoded to `24h`.
It is recorded here only so anyone still holding such a token knows where it came from. **Replace
it via the login flow above**; hand-minted tokens keep working until they expire, and nothing
tracks or revokes them.

</details>

## Wire it into your assistant

The backend must be running and reachable at `CRONSOLE_API_URL`.

### Claude Code

```bash
claude mcp add cronsole \
  --env CRONSOLE_TOKEN=<your-jwt> \
  --env CRONSOLE_API_URL=http://localhost:3000/api \
  -- node /absolute/path/to/cronsole/mcp-server/dist/index.js
```

### Claude Desktop / any JSON-config host

Add to `claude_desktop_config.json` (or the host's MCP config):

```json
{
  "mcpServers": {
    "cronsole": {
      "command": "node",
      "args": ["/absolute/path/to/cronsole/mcp-server/dist/index.js"],
      "env": {
        "CRONSOLE_TOKEN": "<your-jwt>",
        "CRONSOLE_API_URL": "http://localhost:3000/api"
      }
    }
  }
}
```

### Codex / Cursor / other MCP hosts

Any host that launches a stdio MCP server works — point it at
`node .../mcp-server/dist/index.js` with the same two env vars. The tools appear under the
`cronsole` server once it connects.

### Working inside the Cronsole repo

If you're developing Cronsole itself, the root `.mcp.json` (seeded from
[`.mcp.json.example`](../../../.mcp.json.example)) already carries a `cronsole` entry pointing at
`./mcp-server/dist/index.js`, with `CRONSOLE_TOKEN` referenced as `${CRONSOLE_TOKEN}` so the
committed config never holds the secret. Build the server, export the variable, and open a
**fresh terminal** — then the tools appear automatically.

> [!NOTE]
> That file mixes two different MCP surfaces. The other servers (context7, playwright, …) are
> **dev tooling** for *building* Cronsole. `cronsole` is a **product component** for *using* it —
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
- *"Create a task from `dev-git-fetch-prune` for `C:\repos\cronsole`, hourly."* →
  `create_task_from_template(templateId: "dev-git-fetch-prune", parameters: { repoPath: "C:\\repos\\cronsole" }, schedule: "0 * * * *")`

The assistant discovers a template's required parameters from `list_templates` (each template
lists its params, required ones marked) before calling `create_task_from_template`.

> [!TIP]
> **Ask it to check the schedule first.** `convert_schedule` shows the trigger your cron
> actually becomes — *"Weekly at 09:00 on Monday, Tuesday, …"* — which is worth reading, not
> just the confidence number next to it. A cron Cronsole can't express as a native Windows
> trigger is **replaced** with an hourly one rather than rejected, and that arrives as a
> mild-sounding warning. Rare schedules are the ones this bites.
>
> Since 2026-07-31 it also prints **the actual run times**, and both lists when they disagree
> (*"You asked for: 2027-01-01… / It will ACTUALLY run: 2026-07-31T13:00, 14:00, 15:00…"*).
> That is the version nobody misreads. The same comparison is available in the app without an
> agent host — **Tools → Schedule tester**.

## Troubleshooting

| Symptom | Likely cause / fix |
|:---|:---|
| `CRONSOLE_TOKEN is not set` on startup | The env var is missing in the host's config for this server. |
| `CRONSOLE_TOKEN was passed through unexpanded as the literal "${CRONSOLE_TOKEN}"` | Your host resolved `${CRONSOLE_TOKEN}` against an environment where it isn't set, so it forwarded the raw text. Export it and start the host from a **fresh terminal**. See [troubleshooting #8](../../troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token). |
| **The `cronsole` tools don't appear at all** | The server exited on startup — almost always the unexpanded-token case above. A host drops a server that fails to boot, so the symptom is *absence*, not an error. Check your host's MCP status (`/mcp` in Claude Code) for the message. |
| `HTTP 403: Invalid or expired token` | Check the token is *real* before assuming it expired: an unexpanded `${CRONSOLE_TOKEN}` literal produces this same 403. If it is a real JWT, it's wrong, expired, or signed with a different `JWT_SECRET` than the running backend — re-mint. |
| `HTTP 403: This account no longer exists` | A **different** failure with a different fix. The signature verified — `JWT_SECRET` is fine — and the user the token names is not in the backend's database. Either the backend is pointed at a different database than the one the token was minted against, or the account was deleted. Re-mint against a `User.id` that exists. |
| `Could not reach the Cronsole backend … ECONNREFUSED` | The backend isn't running, or `CRONSOLE_API_URL` is wrong (remember the `/api` suffix). |
| `HTTP 409` when creating | A Windows task with that name already exists — pass a different `name`. |
| `HTTP 400: Schedule cannot be converted…` | The cron isn't Windows-convertible; check it with `convert_schedule` first. |
| Tool returns an error but nothing crashes | By design — every tool returns a readable error (`isError`) instead of throwing. |

## How it fits together

```
Your AI assistant  ──MCP/stdio──►  cronsole mcp-server  ──HTTP(Bearer JWT)──►  Cronsole backend
   (Claude/Codex/…)                 (list/run/create/convert)                  (routes → agent / native scheduler)
```

For the package internals (source layout, design notes, `npm run inspect`), see the
[**mcp-server README**](../../../mcp-server/README.md).

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**💬 MCP prompt library**](../../prompts/mcp-server/README.md) | What to actually say once it's connected — grouped by what you're trying to do. |
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
