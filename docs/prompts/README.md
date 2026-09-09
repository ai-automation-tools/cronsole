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

Cronsole is built to be talked to. Whether you're asking an assistant to create a real scheduled
task or asking one to help you work on Cronsole itself, what you get back depends on the prompt.
This library collects **ready-to-use prompts**, grouped first by *how* you're talking to
Cronsole and then by *what you're trying to do*.

Everything here is an **example**. Swap in your own paths, schedules and names, and paste it into
an assistant that has the matching surface available.

## 🧭 Pick your surface

| Folder | You're talking to… | Reach for it when… |
|:---|:---|:---|
| [**🧩 mcp-server/**](mcp-server/README.md) | An assistant wired to the **Cronsole MCP server** (36 tools) | You want to **list, create, run and manage real tasks** in plain English — the way most people use Cronsole day to day. |
| [**🧠 skills/**](skills/README.md) | An assistant loaded with the **`cronsole` Agent Skill** | You're **working on Cronsole's codebase** — adding a template, touching the agent protocol, debugging a trap. |
| [**🌐 rest-api/**](rest-api/README.md) | An assistant driving the **REST API** with curl or a script | You have **no MCP host**, or you need a **REST-only operation**: import/export, bulk actions, analytics, pairing. |

> [!NOTE]
> **The MCP server and the skill are the two AI surfaces.** They sound alike and do opposite
> jobs: the MCP server lets an agent **use** a running Cronsole; the skill teaches an agent about
> the **codebase** so it can safely change it. If you just want to make a task, you want
> [**mcp-server/**](mcp-server/README.md).

## 🎯 Or start from what you want to do

| I want to… | Go to |
|:---|:---|
| [**Schedule a script on my own machine**](mcp-server/windows-tasks.md) | Windows tasks — the agent registers a real Task Scheduler entry |
| [**Have a coding agent update a repo overnight**](mcp-server/ai-agent-jobs.md) | AI agent jobs — headless Claude Code / Codex, fenced properly |
| [**Schedule a specific CLI I already use**](mcp-server/ai-agent-jobs.md#-one-prompt-per-cli) | One prompt per CLI — Gemini, opencode, Cursor, Antigravity, Aider |
| [**Ping a URL or fire a webhook on a schedule**](mcp-server/native-tasks.md#-create-an-http-task) | Cronsole-native HTTP tasks — no agent needed |
| [**Run a script and get a real exit code**](mcp-server/native-tasks.md#-create-a-script-task) | Cronsole-native script tasks — the backend runs it |
| [**Schedule a Claude agent in the cloud**](mcp-server/claude-routines.md) | Claude routines — runs whether or not my machine is on |
| [**Schedule a prompt on Google's agent**](mcp-server/gemini-triggers.md) | Gemini triggers — hosted, sandboxed, and immutable once created |
| [**Watch schedules I manage elsewhere**](mcp-server/observers.md) | GitHub Actions and Vercel Cron — read-only, on the same dashboard |
| [**See why a scheduled job failed**](mcp-server/inspect-and-audit.md#the-other-half-runs-the-platform-recorded-itself) | The platform's own run history — where the runs actually are |
| [**Use a recipe instead of writing a command**](mcp-server/templates.md) | Templates — 66 in the catalog, 8 packs |
| [**Find out what's failing**](mcp-server/inspect-and-audit.md) | Inspect & audit — health, run history, idle reports |
| [**Change a task I already have**](mcp-server/manage-tasks.md) | Manage — run now, park, reschedule, repoint, rename |
| [**Get something off my dashboard**](mcp-server/cleanup-and-removal.md) | Cleanup — untrack, disconnect, delete, and which is which |
| [**Back up or move my tasks**](rest-api/README.md#-import--export-the-rest-only-operations) | REST API — export, import, save-as-template |
| [**Work on Cronsole's code**](skills/README.md) | Skill prompts — the invariants come loaded |

## ⭐ Flagship examples

**A headless coding agent, on a schedule** → [more](mcp-server/ai-agent-jobs.md#-update-a-local-repo-on-a-schedule)
```text
Use the Cronsole MCP server to create a Windows task that runs Claude Code
headlessly against D:\AI_Agents\Projects\my-app at 3am Pacific: print mode,
--permission-mode dontAsk, tools scoped to Read,Edit,Write,Grep,Glob and
Bash(git add *),Bash(git commit *), --max-turns 10, output captured to
C:\logs\my-app-fix.log. The prompt: fix lint and type errors, run the tests, and
commit only if they pass. Don't touch anything outside src/, and don't push.
```

**A real scheduled task, no template** → [more](mcp-server/windows-tasks.md#-run-a-script-on-a-schedule)
```text
Use the Cronsole MCP server to create a Windows Task Scheduler job that runs
D:\jobs\nightly-backup.ps1 every day at 2am my time (I'm on US Pacific). Check
the schedule conversion first and put it in the \Cronsole folder.
```

**An HTTP job with no agent involved** → [more](mcp-server/native-tasks.md#-create-an-http-task)
```text
Using Cronsole, create a native task that POSTs to
https://api.example.com/admin/reindex at 2am Pacific with a Bearer token header
and a JSON body of {"scope":"all"}.
```

**A script the backend runs, with a real exit code** → [more](mcp-server/native-tasks.md#-create-a-script-task)
```text
Using Cronsole, create a native script task that runs
git -C "D:\AI_Agents\Projects\my-app" pull --ff-only every six hours, with a
five-minute timeout. I want the real exit code in the history.
```

**Audit what actually ran** → [more](mcp-server/inspect-and-audit.md#-whats-broken)
```text
Using Cronsole, list my tasks whose last run failed, then show me the recent run
history for each so I can see what went wrong.
```

**Work on the codebase** → [more](skills/README.md#-understand-the-system)
```text
Using the cronsole skill, explain how a created Windows task's cron schedule
becomes a real Task Scheduler trigger, and where the conversion can go lossy.
```

## 💡 Getting good results

- **State your timezone.** Cronsole stores every schedule as **UTC** and shows it in local time.
  When you say "7am", say *where* — it converts for you, but only if it knows.
- **Ask it to check the conversion, then verify the result.** A Windows cron the converter can't
  express natively is **replaced** with an hourly trigger, and a green status is not proof a
  command ran.
- **Be specific about the command.** "Run my script" is a template hunt;
  `powershell.exe -File C:\jobs\x.ps1` is a direct create.
- **Know which machine you mean.** A Windows task runs on your desktop. A Cronsole-native task
  runs wherever the backend runs — inside the container on a Dockerized stack. A Claude routine
  runs in Anthropic's cloud and can't see your disk at all.
- **Destructive actions are deliberately awkward.** No MCP tool can destroy a task on your
  machine; delete is native-only, gated, and archives first. If an assistant offers to work
  around that, it's wrong.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧩 MCP Server Guide**](../user-guides/guides/MCP_Server_Guide.md) | Wire the server into your host and mint a token — before any of this works. |
| [**✍️ Task authoring & management**](../../skills/cronsole/references/task-authoring.md) | The invariants behind a good task: UTC cron, no-shell commands, folders, verification. |
| [**🧠 The `cronsole` skill**](../../skills/README.md) | What the skill knows and how it's installed. |
| [**📄 Templates**](../reports/templates/README.md) | The catalog the "from a template" prompts draw on. |
| [**🖥️ UI User Guide**](../user-guides/guides/UI_User_Guide.md) | The same operations, done by hand in the dashboard. |

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="mcp-server/README.md">MCP Server</a> ·
  <a href="skills/README.md">Skills</a> ·
  <a href="rest-api/README.md">REST API</a>
</p>

<p align="right">(<a href="#prompts-top">back to top</a>)</p>
