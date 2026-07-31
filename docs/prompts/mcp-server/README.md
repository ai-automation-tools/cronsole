<a id="mcp-prompts-top"></a>

<h1 align="center">🧩 MCP Server Prompts</h1>

<p align="center">
  <em>Drive a running Cronsole in natural language — list, create, run, and manage real tasks.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/surface-MCP_server-8B5CF6?style=for-the-badge" alt="MCP server">
  <img src="https://img.shields.io/badge/tools-15-2ea44f?style=for-the-badge" alt="15 tools">
</p>

---

These prompts are for an assistant (Claude Code, Cursor, Codex, Claude Desktop, …) that has the
**Cronsole MCP server** connected. The server is a thin wrapper over the REST API exposing
**15 tools** — so the assistant can operate your real Windows Task Scheduler and Cronsole-native
tasks by calling them for you.

> [!IMPORTANT]
> **Prerequisites** (one-time): the backend running, the MCP server built
> (`cd mcp-server && npm run build`), and `CRONSOLE_TOKEN` exported in the environment your host
> launched from. If every MCP call returns `403 Invalid or expired token`, the token isn't
> reaching the server — see the [**MCP Server Guide**](../../user-guides/guides/MCP_Server_Guide.md)
> and [troubleshooting #8](../../troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token).

**The toolbox these prompts drive:**

| Tier | Tools |
|:---|:---|
| **Read** | `list_tasks`, `list_templates`, `list_folders`, `get_task_history`, `export_task`, `convert_schedule` |
| **Create** | `create_task`, `create_native_task`, `create_task_from_template` |
| **Act** | `run_task` |
| **Manage** (reversible) | `set_task_status`, `update_task_schedule`, `update_task_action`, `untrack_task` |
| **Destroy** (gated) | `delete_task` — only if `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true` |

---

## 🔎 Inspect & audit

```text
Using Cronsole, show me all my scheduled tasks grouped by category, with each
one's schedule and last run result.
```

```text
Using Cronsole, list every task whose last run failed, then pull the recent run
history for each so I can see what went wrong.
```

```text
Using Cronsole, which of my tasks are currently disabled? For each, tell me its
schedule so I can decide whether to re-enable it.
```

```text
Using Cronsole, export the task called "Daily Portfolio Analysis" and show me
the exact command and trigger it's registered with.
```

```text
Using Cronsole, what Task Scheduler folders can I create tasks in on this
machine? I want one that already exists, not a new one.
```

## 🛠️ Convert & preview a schedule

Always worth doing *before* a create — a schedule the converter can't express natively gets
**replaced** with an hourly trigger, and it says so only in a mild warning.

```text
Using Cronsole, convert the cron "0 9 * * 1-5" to a Windows trigger and tell me
exactly which days and time (local) it will fire. I want weekdays at 9am.
```

```text
Using Cronsole, I want a job at 7am and 7pm US Pacific time. Work out the UTC
cron for each, check the conversion, and tell me the resulting triggers before
creating anything.
```

## ➕ Create tasks

**From a command you already know** (the direct path — no template needed):

```text
Use the Cronsole MCP server to create a Windows Task Scheduler job that runs
D:\jobs\nightly-backup.ps1 every day at 2am my time (US Pacific). Check the
schedule conversion first, put it in the \TaskHub folder, and confirm it
registered with a clean no-shell action.
```

```text
Using Cronsole, create a task named "Prune Docker" that runs
`docker system prune -f` every Sunday at 3am Pacific. Verify the trigger before
you finish.
```

**A real-world example** — the "clean up runaway Python processes" job (this exact request
built a logging cleanup script + two daily tasks):

```text
Use the Cronsole MCP server to create a Windows Task Scheduler job that
periodically kills leftover Python processes that are old AND still burning CPU
(so it won't touch fresh or idle jobs). Run it at 7am and 7pm Pacific, log every
kill, and dry-run the logic before scheduling it.
```

**From a template** (when you have a use case, not a command):

```text
Using Cronsole, list the available templates for database backups, then create a
task from the best fit — I run Postgres locally and want a nightly dump.
```

**A Cronsole-native HTTP job** (backend-run, no agent needed):

```text
Using Cronsole, create a native task that pings https://my-service.example.com/health
every 15 minutes so I get failure notifications when it goes down.
```

## ▶️ Run now

```text
Using Cronsole, run the "Sync AI Documents Repos" task right now and tell me
whether it succeeded.
```

```text
Using Cronsole, run "Weekly System Cleanup" now, then check its run history to
confirm it actually completed rather than just started.
```

## ⚙️ Manage existing tasks

```text
Using Cronsole, disable the task "Daily Market Summary" for now — I'll turn it
back on later. Don't change its schedule.
```

```text
Using Cronsole, re-schedule "Weekly PR Creator" to run weekdays at 6pm Pacific
instead of whenever it runs now. Check the conversion first.
```

```text
Using Cronsole, the command for "Update AI Lab Repos" points at the wrong
script. Show me its current action, then repoint it at
D:\AI_Agents\_maintenance\update-repos.ps1 — keep everything else the same.
```

> [!TIP]
> `update_task_action` **replaces** the action — it doesn't patch one field. Ask the
> assistant to read the current command first (it will), so it doesn't silently reset the run
> level.

## 🧹 Tidy the dashboard (without deleting anything)

```text
Using Cronsole, I imported the whole \Microsoft\ folder by mistake. Stop tracking
those in Cronsole — but do NOT delete any of them, they're Windows' own tasks.
```

```text
Using Cronsole, remove "SoftLandingDeferralTask" from my dashboard. I don't care
about it, but leave the scheduled task alone.
```

> [!TIP]
> `untrack_task` is the verb for *"get this out of my dashboard"*. It drops Cronsole's record
> and its Cronsole run history; the scheduled task stays on the machine and keeps running, and
> future syncs won't pull it back. Reversible — re-import that category in the dashboard to
> track it again. It is **ungated**, on purpose: gating deletion is only honest if there's a
> safe way to remove something without the gate, or the only tool for a tidy-up is the one that
> destroys real tasks.

## 🗑️ Delete (gated)

```text
Using Cronsole, delete the test task "MCP Test - Webhook Ping" — it was only for
a one-off check.
```

> [!NOTE]
> If `delete_task` isn't enabled (`CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`), the assistant won't
> see the tool at all and will offer to **disable** or **untrack** the task instead, or point
> you to the dashboard / REST. That's intentional — an irreversible verb stays behind an
> out-of-band switch the model can't flip for itself.
>
> **If you only want it off your dashboard, don't reach for delete at all** — that's
> `untrack_task` above, and it leaves the scheduled task running.

## 🧾 What the MCP server can't do

Some operations are **REST-only** — the assistant should say so rather than improvise a
substitute. For these, see [**rest-api/**](../rest-api/README.md):

- Template **import / export**
- **Save a task as a template**
- Registry **sync** and agent **pairing**

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🧩 MCP Server Guide**](../../user-guides/guides/MCP_Server_Guide.md) | Setup, token minting, host wiring, its own troubleshooting. |
| [**✍️ Task authoring & management**](../../../skills/cronsole/references/task-authoring.md) | The invariants behind these prompts — UTC cron, no-shell, folders, verification. |
| [**🌐 REST API prompts**](../rest-api/README.md) | The REST-only operations above. |

---

<p align="center">
  <a href="../README.md">← Prompt Library</a> ·
  <a href="../skills/README.md">Skills</a> ·
  <a href="../rest-api/README.md">REST API</a>
</p>

<p align="right">(<a href="#mcp-prompts-top">back to top</a>)</p>
