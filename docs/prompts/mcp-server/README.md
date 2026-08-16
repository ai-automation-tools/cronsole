<a id="mcp-prompts-top"></a>

<h1 align="center">🧩 MCP Server Prompts</h1>

<p align="center">
  <em>Drive a running Cronsole in natural language — list, create, run, and manage real tasks.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/surface-MCP_server-8B5CF6?style=for-the-badge" alt="MCP server">
  <img src="https://img.shields.io/badge/tools-27-2ea44f?style=for-the-badge" alt="27 tools">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-prompt_library-6B7280?style=for-the-badge" alt="Prompt library"></a>
</p>

---

These prompts are for an assistant — Claude Code, Cursor, Codex, Claude Desktop — that has the
**Cronsole MCP server** connected. The server is a thin wrapper over the REST API, so asking it
to make a task makes a real one: a Task Scheduler entry on your machine, a job in Cronsole's own
scheduler, or a routine on your Claude account.

> [!IMPORTANT]
> **Prerequisites**, once: the backend running, the MCP server built
> (`cd mcp-server && npm run build`), and `CRONSOLE_TOKEN` exported in the environment your host
> launched from. If the tools are missing entirely, or every call returns
> `403 Invalid or expired token`, the token isn't reaching the server — see the
> [**MCP Server Guide**](../../user-guides/guides/MCP_Server_Guide.md) and
> [troubleshooting #8](../../troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token).

## 🗂️ The prompt sets

| Set | What you'll find |
|:---|:---|
| [**🪟 Windows tasks**](windows-tasks.md) | Real Task Scheduler jobs through the local agent — scripts, backups, maintenance, folders, and what "success" really means on Windows. |
| [**🤖 AI agent jobs**](ai-agent-jobs.md) | Headless coding-agent runs against a local repo — one prompt per CLI (Claude Code, Codex, Gemini, opencode, Cursor, Antigravity, Aider), the fencing each one offers, and how to update a checkout on a schedule. |
| [**🖥️ Cronsole-native tasks**](native-tasks.md) | HTTP calls and script jobs run by the backend itself — no agent, exact cron, and a real exit code. |
| [**🧠 Claude routines**](claude-routines.md) | Scheduled agent runs in Anthropic's cloud: create, connect, pause, disconnect — and which of the two API modes your install has. |
| [**📄 Templates**](templates.md) | Finding a catalog recipe and applying it, when you know the use case but not the command. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | What you have, what's failing, what hasn't run in months — and how much of that Cronsole can prove. |
| [**⚙️ Manage tasks**](manage-tasks.md) | Run now, park, reschedule, repoint the command, rename. The reversible half. |
| [**🧹 Cleanup & removal**](cleanup-and-removal.md) | Disable, untrack, disconnect, delete — four verbs and the question that picks between them. |

## ⭐ Start here

If you've just wired the server up, these four in order will tell you whether everything works
and teach you the shape of the rest.

```text
Using Cronsole, list the platforms and tell me what this install can actually do:
which capabilities are verified here, which are only declared, and whether the
Windows agent is online.
```

```text
Using Cronsole, show me all my scheduled tasks grouped by category, with each
one's schedule and last run result.
```

```text
Using Cronsole, convert the cron "0 9 * * 1-5" to a Windows trigger and tell me
exactly which days and local time it will fire. Say plainly whether anything was
approximated or replaced.
```

```text
Use the Cronsole MCP server to create a Windows task that runs
D:\jobs\nightly-backup.ps1 every day at 2am Pacific. Check the schedule
conversion first, put it in \Cronsole, and confirm the registered action.
```

## 🧰 The toolbox

26 tools are always present; `delete_task` appears only when the operator enabled it.

| Tier | Tools |
|:---|:---|
| **Read** | `list_tasks` · `list_templates` · `list_folders` · `list_platforms` · `list_claude_routines` · `get_task_history` · `list_run_history` · `get_task_health` · `export_task` · `convert_schedule` |
| **Create** | `create_task` · `create_native_task` · `create_native_program_task` · `create_native_script_task` · `create_native_check_task` · `create_task_from_template` · `create_claude_routine` |
| **Act** | `run_task` · `sync_tasks` |
| **Modify** (reversible) | `set_task_status` · `update_task_schedule` · `update_task_action` · `update_native_job` · `rename_task` · `untrack_task` |
| **Connect** | `connect_claude_routine` · `edit_claude_routine` · `disconnect_claude_routine` |
| **Destroy** (gated, native-only) | `delete_task` — needs `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true` |

Gating is tiered rather than blanket. Reversible verbs are ungated, including `set_task_status`
— parking a task is the recommended safe move, and putting a gate on the safe path pushes people
toward the unsafe one. Only the irreversible verb is gated, and it can't reach a Windows task at
all.

## 💡 Getting good results

- **Say where you are.** Cronsole stores every schedule as UTC. "7am" converts correctly only
  if the assistant knows which 7am you meant.
- **Ask it to check before it commits.** "Convert the schedule first and show me the trigger" is
  the difference between a monthly job and 8,760 runs a year.
- **Ask it to verify after.** A green status is not proof a command runs. On Windows it isn't
  even proof the command finished.
- **Be specific about the command.** "Run my script" sends it hunting through templates;
  `powershell.exe -File C:\jobs\x.ps1` is a direct create.
- **Let it refuse.** Cronsole's refusals — folder must exist, `\Microsoft\` denied, duplicate
  name 409, untrack not available for native — are load-bearing. An assistant working around one
  is doing you no favors.

## 🚧 What this surface can't do

Some operations are REST or dashboard only, and the assistant should say so rather than
improvise a substitute. See [**rest-api/**](../rest-api/README.md):

- Template **import / export**, and **save a task as a template**
- **Bulk** status, recategorize, and untrack
- **Analytics**, CSV export, and deleted-task archives
- **Favorites**, and agent **pairing**
- Deleting a real **Windows** task — that's the dashboard, per task

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🧩 MCP Server Guide**](../../user-guides/guides/MCP_Server_Guide.md) | Setup, token minting, host wiring, its own troubleshooting. |
| [**✍️ Task authoring & management**](../../../skills/cronsole/references/task-authoring.md) | The invariants behind these prompts, written for an agent. |
| [**🌐 REST API prompts**](../rest-api/README.md) | The operations listed above. |
| [**📦 mcp-server package**](../../../mcp-server/README.md) | The tool source and the MCP Inspector. |

---

<p align="center">
  <a href="../README.md">← Prompt Library</a> ·
  <a href="../skills/README.md">Skills</a> ·
  <a href="../rest-api/README.md">REST API</a>
</p>

<p align="right">(<a href="#mcp-prompts-top">back to top</a>)</p>
