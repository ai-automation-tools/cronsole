<a id="prompts-top"></a>

<h1 align="center">💬 Prompt Library</h1>

<p align="center">
  <em>Copy-paste prompts for driving Cronsole in natural language.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/for-users_&_agents-8B5CF6?style=for-the-badge" alt="For users and agents">
  <img src="https://img.shields.io/badge/style-copy--paste-2ea44f?style=for-the-badge" alt="Copy-paste">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-docs_home-6B7280?style=for-the-badge" alt="Docs home"></a>
</p>

---

Cronsole is built to be talked to. Whether you're asking an assistant to create a real
scheduled task, or asking one to help you work on Cronsole itself, the quality of what you get
back depends on the prompt. This library collects **ready-to-use prompts**, grouped by *how*
you're talking to Cronsole.

Every prompt here is an **example** — a starting point. Swap in your own paths, schedules, and
names. They're written to be pasted into an AI assistant (Claude Code, Cursor, Codex, Claude
Desktop, …) that has the matching surface available.

## 🧭 Pick your method

| Folder | You're talking to… | Reach for it when… |
|:---|:---|:---|
| [**🧩 mcp-server/**](mcp-server/README.md) | An assistant wired to the **Cronsole MCP server** (16 tools) | You want to **list, create, run, and manage real tasks** on your machine in plain English — the way most people will use Cronsole day to day. |
| [**🧠 skills/**](skills/README.md) | An assistant loaded with the **`cronsole` Agent Skill** | You're **working on Cronsole's codebase** — adding a template, touching the agent protocol, debugging a trap, changing the MCP server. |
| [**🌐 rest-api/**](rest-api/README.md) | An assistant driving the **REST API directly** (curl / scripts) | You have **no MCP host**, or you need a **REST-only operation** the MCP server doesn't expose (template import/export, save-as-template, sync, agent pairing). |

> [!NOTE]
> **The MCP server and the skill are the "two AI surfaces."** They sound similar but do
> opposite jobs: the MCP server lets an agent **use** a running Cronsole; the skill teaches an
> agent about the **codebase** so it can safely change it. If you just want to make a task,
> you want [**mcp-server/**](mcp-server/README.md).

## ⭐ Flagship examples

A taste of each surface — full sets live in the subfolders.

**Create a real scheduled task, no template** → [more](mcp-server/README.md#-create-tasks)
```text
Use the Cronsole MCP server to create a Windows Task Scheduler job that runs
D:\jobs\nightly-backup.ps1 every day at 2am my time (I'm on US Pacific).
Check the schedule conversion first and put it in the \Cronsole folder.
```

**Audit what actually ran** → [more](mcp-server/README.md#-inspect--audit)
```text
Using Cronsole, list my tasks whose last run failed, then show me the recent
run history for each so I can see what went wrong.
```

**Work on the codebase** → [more](skills/README.md#-understand-the-system)
```text
Using the cronsole skill, explain how a created Windows task's cron schedule
becomes a real Task Scheduler trigger, and where the conversion can go lossy.
```

**Do a REST-only operation** → [more](rest-api/README.md#-import--export-the-rest-only-operations)
```text
Using the Cronsole REST API at http://localhost:3000 with my JWT, export the
task <task-id> and save the XML, then import the template JSON in ./cleanup.json.
```

## 💡 Getting good results

- **State your timezone.** Cronsole stores every schedule as **UTC** and displays it in local
  time. When you say "7am", tell the assistant *where* — it converts for you, but only if it
  knows your zone. (See how this bit even a careful run in [task authoring](../../skills/cronsole/references/task-authoring.md#3-get-the-schedule-right).)
- **Ask it to verify.** "Then confirm it registered correctly" prompts the assistant to check
  the real trigger — a green status is *not* proof a command runs.
- **Be specific about the command.** "Run my script" is a template hunt; "run
  `powershell.exe -File C:\jobs\x.ps1`" is a direct create.
- **Destructive actions are gated.** Deleting a task over MCP only works if the operator
  enabled it (`CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`); otherwise the assistant will offer to
  **disable** instead. That's by design.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧩 MCP Server Guide**](../user-guides/guides/MCP_Server_Guide.md) | Wire the MCP server into your host, mint a token — before the prompts work. |
| [**✍️ Task authoring & management**](../../skills/cronsole/references/task-authoring.md) | The invariants behind a good task: UTC cron, no-shell commands, folders, verification. |
| [**🧠 The `cronsole` skill**](../../skills/README.md) | What the skill knows and how it's installed. |
| [**📄 Templates**](../reports/templates/README.md) | The catalog the "from a template" prompts draw on. |

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="mcp-server/README.md">MCP Server</a> ·
  <a href="skills/README.md">Skills</a> ·
  <a href="rest-api/README.md">REST API</a>
</p>

<p align="right">(<a href="#prompts-top">back to top</a>)</p>
