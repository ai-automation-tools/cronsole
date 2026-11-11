<a id="readme-top"></a>

<p align="center">
  <a href="docs/README.md">
    <img src="images/Cronsole-Images/logos/dark/landscape-01-command-grid.svg" alt="Cronsole — one control plane for scheduled tasks" width="720">
  </a>
</p>

<p align="center">
  <em>The ultimate unified dashboard to view, trigger, and manage every scheduled job you own —<br>Windows Task Scheduler, AI assistants, and cron, all in one place.</em>
</p>

<p align="center">
  <a href="docs/README.md"><strong>Explore the docs »</strong></a>
</p>

<p align="center">
  <a href="https://cronsole-demo.ai-automation-tools.dev/">▶️ Try the live demo</a>
  ·
  <a href="https://cronsole.ai-automation-tools.dev/">🌐 Website &amp; Template Gallery</a>
  ·
  <a href="docs/ROADMAP.md">🗺️ Roadmap</a>
</p>

<p align="center">
  <a href="https://github.com/ai-automation-tools/cronsole/issues">Report Bug</a>
  ·
  <a href="https://github.com/ai-automation-tools/cronsole/issues">Request Feature</a>
</p>

<p align="center">
  <a href="https://cronsole-demo.ai-automation-tools.dev/"><img src="https://img.shields.io/badge/try_the-live_demo-8B5CF6?style=for-the-badge&logo=githubpages&logoColor=white" alt="Live demo"></a>
  <a href="https://cronsole.ai-automation-tools.dev/"><img src="https://img.shields.io/badge/website-template_gallery-2ea44f?style=for-the-badge&logo=githubpages&logoColor=white" alt="Website and template gallery"></a>
  <img src="https://img.shields.io/badge/status-MVP_Prototype-F59E0B?style=for-the-badge" alt="Status: MVP Prototype">
  <a href="docs/ROADMAP.md"><img src="https://img.shields.io/badge/plan-ROADMAP-8B5CF6?style=for-the-badge" alt="Roadmap"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-2ea44f?style=for-the-badge" alt="License: Apache 2.0"></a>
</p>


<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node.js-Express_5-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js + Express 5">
  <img src="https://img.shields.io/badge/.NET-10-512BD4?style=flat-square&logo=.net&logoColor=white" alt=".NET 10 agent">
  <img src="https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white" alt="PostgreSQL 16">
  <img src="https://img.shields.io/badge/theme-dark_by_default-111827?style=flat-square" alt="Dark theme by default">
</p>

---


## 💡 What it does

Your scheduled jobs are scattered across Windows Task Scheduler, scheduled AI agents, GitHub
Actions, and cron lines you half remember writing. Cronsole pulls them all into one dashboard —
see every job, run it, pause it, edit its schedule — without moving a single one off the
platform it already runs on.

## 🔌 What it connects to

Each source links to its own guide: how to connect it, what Cronsole can do there, and what catches people out. [**Sources**](docs/user-guides/sources/README.md) compares all of them in one table.

| Source | How it connects | Status |
|:---|:---|:---|
| [**⚡ Cronsole-native**](docs/user-guides/sources/Cronsole_Native.md) | Four kinds of job that Cronsole schedules and runs itself, with no OS task involved: **HTTP** calls, an **existing program**, a **script you write in Cronsole**, and **checks** that assert something is true. Each can retry a failed run, run for up to 24 hours, catch up after downtime, start when another task finishes, and post to Discord, Slack or ntfy. | ✅ Functional |
| [**🪟 Windows Task Scheduler**](docs/user-guides/sources/Windows_Task_Scheduler.md) | A lightweight local agent on your machine — outbound-only, never accepts incoming connections. | ✅ Functional |
| [**🤖 Claude Code Scheduled Tasks**](docs/user-guides/sources/Claude_Code_Routines.md) | Natural-language scheduled tasks (formerly routines) through the Anthropic API. With a readable Claude Code session Cronsole lists, creates, reschedules, pauses and fires them; without one it can fire the ones you declared. **Deleting always happens in claude.ai** — no API exposes it. | 🧪 Experimental |
| [**✨ Gemini API Triggers**](docs/user-guides/sources/Gemini_API_Triggers.md) | Scheduled prompts on Google's managed agents. One API key, and Cronsole can run, pause, create and delete them, and read how their runs actually went. A trigger's schedule and prompt are fixed once it exists, so changing either means **Recreate with changes**. | 🧪 Experimental |
| [**🔀 n8n**](docs/user-guides/sources/n8n.md) | Workflows on your own n8n instance, through its API key: every one with a Schedule Trigger, and by default the ones started some other way too. Cronsole reads real run outcomes and each run's steps, and can **Run now** through n8n's MCP server. You state the instance's time zone, because its API does not. | ✅ Functional |
| [**🐙 GitHub Actions**](docs/user-guides/sources/GitHub_Actions.md) | Scheduled workflows in the repositories you watch, read through a PAT. **Read-only by design** — Cronsole shows their crons and real run outcomes, and changes nothing. | 👁️ Observer |
| [**▲ Vercel Cron**](docs/user-guides/sources/Vercel_Cron.md) | Cron jobs declared by the projects you watch. **Read-only by design**, and Vercel publishes no run history, so their health stays honestly unknown. | 👁️ Observer |
| [**💬 ChatGPT · Grok · Jules · Open Claw · Hermes**](docs/user-guides/sources/README.md#-quick-links--schedulers-with-no-connector) | Quick links straight to their native scheduling screens — none of them exposes a public scheduled-task API to build on. Add your own, too. | 🔗 Quick links |

## 🎨 Screenshots

<details open>
<summary><b>📸 Dashboard, Templates, Settings, Views, and Themes</b> </summary>

<br>

<p align="center">
  <img src="images/screenshots/dashboard.png" alt="Cronsole unified dashboard — dark theme with platform filters, categories, and grid/list/kanban/schedule/calendar views" width="900">
</p>

| | |
|:---:|:---:|
| <img src="images/screenshots/templates.png" alt="Cronsole template library"><br><sub><b>Template library</b> — parameterized script starters</sub> | <img src="images/screenshots/apply-template-modal.png" alt="Apply Template modal"><br><sub><b>Apply Template</b> — fill in the blanks, get a real task</sub> |
| <img src="images/screenshots/task-detail.png" alt="Cronsole task detail modal"><br><sub><b>Task detail</b> — metadata, run history, Run Now</sub> | <img src="images/screenshots/new-task-modal.png" alt="New Task modal"><br><sub><b>New Task</b> — Cronsole-native or Windows, with cron presets</sub> |
| <img src="images/screenshots/list-view.png" alt="Cronsole list view"><br><sub><b>List view</b> — sortable columns and quick actions</sub> | <img src="images/screenshots/kanban-view.png" alt="Cronsole kanban view"><br><sub><b>Kanban view</b> — tasks grouped by status</sub> |
| <img src="images/screenshots/schedule-view.png" alt="Cronsole schedule view"><br><sub><b>Schedule view</b> — chronological by next run</sub> | <img src="images/screenshots/dashboard-light.png" alt="Cronsole dashboard in light theme"><br><sub><b>Light theme</b> — the same dashboard, light variant</sub> |

</details>

## ⚡ Quick Start

> [!TIP]
> The fastest path is Docker Compose: it brings up the database, backend, and frontend
> together. The Windows agent runs directly on your machine (step 3).

1. Clone the repo:

   ```bash
   git clone https://github.com/ai-automation-tools/cronsole.git
   cd cronsole
   ```

2. Bring up the dev stack (Postgres + backend + frontend). Keep `--profile docker`;
   without it only Postgres starts
   ([why](docs/setup/README.md#-docker-vs-manual)). Migrations apply themselves on boot.

   ```bash
   docker compose --profile docker up --build
   #   → frontend  http://localhost:7373
   #   → backend   http://localhost:3000   (GET /api/health to verify)
   ```

3. Start the Windows agent so your real Task Scheduler tasks appear (PowerShell **as Administrator**; must run on the Windows host, not in Docker):

   ```powershell
   cd agent
   Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-agent-startup.ps1
   ```

4. Open [localhost:7373](http://localhost:7373). The first load asks you to create the owner account — that is the only account-creation path there is, and it works once. After that, the **Windows Agent** status in the sidebar should read **Online** with your tasks imported.

Auto-start at logon, macOS, and the per-OS details are in [Installation](docs/install/README.md).
Running each piece yourself without Docker is in
[Setup › Run it manually](docs/setup/README.md#run-it-manually-no-docker).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 🧱 Built With

| Layer | Technology |
|:---|:---|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query + React Router |
| **Backend** | Node.js + Express 5 + Socket.io (TypeScript) |
| **Database** | PostgreSQL 16 + Prisma 7 ORM |
| **Windows agent** | .NET 10 (`Cronsole.Agent`) reading Windows Task Scheduler |
| **Hosting** | Runs locally — backend + agent on your machine; dev stack via Docker Compose |

## 📖 Documentation

Full documentation lives in **[`docs/`](docs/README.md)**. The main sections:

| Section | What's inside |
|:---|:---|
| [**📚 Documentation home**](docs/README.md) | The map to every guide, reference, and design doc. |
| [**📊 Features**](docs/FEATURES.md) | Everything Cronsole does today, and what each feature actually gives you. |
| [**🧭 Diagrams**](docs/diagrams/README.md) | The source data flow shown on the [homepage](https://cronsole.ai-automation-tools.dev/#sec-flow), interactive and linked to the code, the template catalogs the gallery reads, and how both stay in step with the code. |
| [**📍 Status**](docs/STATUS.md) | What's supported on which platform, what's pre-1.0, and what isn't built yet. |
| [**🛡️ Trust**](docs/TRUST.md) | Cronsole runs an elevated process on your machine. The complete list of what it can do, what it cannot, and how to remove it. |
| [**🔒 Privacy**](docs/PRIVACY.md) | Every outbound connection Cronsole can make — and how to verify that a default install makes none. |
| [**⬇️ Installation**](docs/install/README.md) | Install Cronsole on Windows or macOS, or clone the repo. |
| [**⚙️ Setup & Configuration**](docs/setup/README.md) | Environment variables, Docker vs. manual, agent pairing. |
| [**🖥️ User Guides**](docs/user-guides/README.md) | Day-to-day guides for using Cronsole once it's running. |
| [**🔌 Sources**](docs/user-guides/sources/README.md) | Every source in one table, with a guide for each: connecting it, what Cronsole can do there, and the traps. |
| [**💬 Prompt Library**](prompts/README.md) | Copy-paste prompts for driving Cronsole in plain English — scheduled scripts, headless coding-agent runs, HTTP jobs, audits. |
| [**🧯 Troubleshooting**](docs/troubleshooting/README.md) | Symptom → cause → fix for problems we've actually hit. |
| [**🧪 Testing**](docs/testing/README.md) | What to test and how to run it — functional, integration, regression, and UAT, plus step-by-step manual runbooks. |
| [**🗺️ Roadmap**](docs/ROADMAP.md) | What's shipped and what's next, in priority order. |

And the key guides, one click away:

| Guide | Takes you through |
|:---|:---|
| [**📦 Clone the Repo**](docs/install/guides/Clone_Repo_Guide.md) | The first step for every install path, plus common prerequisites. |
| [**🪟 Windows Install**](docs/install/guides/Windows_Install_Guide.md) | The full experience — stack, agent, and auto-start at logon. |
| [**🍎 macOS Install**](docs/install/guides/macOS_Install_Guide.md) | Dashboard + backend on macOS (no Windows agent yet). |
| [**🖥️ UI User Guide**](docs/user-guides/guides/UI_User_Guide.md) | Navigating the dashboard, categorizing tasks, applying templates. |
| [**🤖 Windows Agent Setup**](docs/user-guides/guides/Agent_Setup_Guide.md) | Installing, verifying, and troubleshooting the local agent. |
| [**🔌 MCP Server Setup**](docs/mcp-server.md) | The install line for each client, its environment, and every tool. |
| [**🧩 MCP Server**](docs/user-guides/guides/MCP_Server_Guide.md) | Wiring Cronsole into Claude / Codex / Cursor to manage tasks in natural language. |
| [**🌐 Remote Access**](docs/user-guides/guides/Remote_Access_Guide.md) <sub>· optional</sub> | Reaching your own instance from your phone — one HTTPS origin behind Tailscale or a Cloudflare Tunnel, with nothing on the public internet. |
| [**📱 Phone Shortcuts**](docs/user-guides/guides/Phone_Shortcuts_Guide.md) <sub>· optional</sub> | A home-screen icon that runs one task — with a token that can do nothing else. |
| [**🍳 Ready-made recipes**](https://github.com/ai-automation-tools/ai-automation-recipes) | Scheduled Claude Code automations (stories, digests, images, audio) packaged as Cronsole templates, with [live samples](https://ai-automation-recipes-demo.ai-automation-tools.dev) of what they make. |
| [**💬 Prompts to start with**](prompts/mcp-server/README.md) | What to actually say once the MCP server is connected, grouped by what you're trying to do. |
| [**💾 Backup & Restore**](docs/user-guides/guides/Backup_Restore_Guide.md) | Backing up the database, scheduling it as a Cronsole job, and testing the restore — which is the part that makes it real. |
| [**🔥 Smoke Test**](docs/testing/manual-testing/runbooks/Smoke_Test.md) | Verifying your stack is actually alive and the agent is talking — in about 10 minutes. |

## 🗂️ What's in the repo

| Folder | What it holds |
|:---|:---|
| [**🧩 backend/**](backend/README.md) | The API, every source connector, the agent channel and the native job scheduler. |
| [**🖥️ frontend/**](frontend/README.md) | The dashboard. |
| [**🪟 agent/**](agent/README.md) | The .NET Windows agent that reads and changes Task Scheduler. |
| [**🔌 mcp-server/**](mcp-server/README.md) | A thin MCP wrapper over the REST API, for driving Cronsole from an assistant. |
| [**📚 docs/**](docs/README.md) | Install, setup, user guides, troubleshooting, testing, the roadmap and the changelog. |
| [**💬 prompts/**](prompts/README.md) | Copy-paste prompts for the MCP server, the skill and the REST API. |
| [**🧠 skills/**](skills/README.md) | The `cronsole` skill for agents working on this codebase. |
| [**📦 registry/**](registry/README.md) | The generated template registry. Built from the catalog; never edited by hand. |
| [**🌐 registry-site/**](registry-site/README.md) | The homepage and template gallery, published with the registry. |
| [**🔧 scripts/**](scripts/README.md) | The `cronsole` stack control script, the logon auto-start tasks and the CI checks. |
| [**🖼️ images/**](images/README.md) | Logos, icons and the screenshots above. |

`proxy/` holds one Caddyfile for the opt-in [remote access](docs/user-guides/guides/Remote_Access_Guide.md) proxy; nothing runs from it by default.

## 🧠 The Cronsole Skill

Building Cronsole with an AI agent? The repo ships an **[Agent Skill](skills/README.md)** — a
briefing that gives Claude Code the project's mental model *before* it touches anything: the
architecture, the invariants that must never break (schedules are cron-UTC, `exec` is
never implicitly shelled, the registry is content-addressed), and the traps that quietly eat
an afternoon (a Dockerized backend that won't hot-reload; an agent that must be republished).

```powershell
# Windows — junctions, so no admin rights or Developer Mode needed
pwsh scripts/setup-skill-links.ps1
```

```bash
# macOS / Linux
./scripts/setup-skill-links.sh
```

Run **once per clone**, then restart your CLI — it activates automatically on Cronsole work.
The script links [`skills/cronsole/`](skills/cronsole/SKILL.md) into `.claude/skills/`, so the
agent reads the tracked source directly and **no second copy exists to drift**. The skill
routes to [`docs/`](docs/README.md) rather than restating it, for the same reason.

Two more Cronsole skills live in the org's skill library —
[**`agent-skills` › `skills/projects/cronsole/`**](https://github.com/ai-automation-tools/agent-skills/tree/main/skills/projects/cronsole).
They cover the other half: not how to work on Cronsole, but **how to design the jobs it
schedules** — the archetypes a Windows Task Scheduler job turns out to be, and the prompt contract
a Claude scheduled task needs. Install them over this clone with that repo's installer.

> [!NOTE]
> **Skill vs. MCP server** — easy to conflate. The [**skill**](skills/README.md) teaches an
> agent to *work on* Cronsole's codebase. The [**MCP server**](docs/user-guides/guides/MCP_Server_Guide.md)
> lets an agent *use* a running Cronsole — list, run, and create tasks in natural language.

## 🤝 Contributing

Cronsole is an MVP-stage project. If you're working on it, start with
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`AGENTS.md`](AGENTS.md), and track work on the
[Roadmap](docs/ROADMAP.md). Recent changes are logged in [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
Taking part means following the [Code of Conduct](CODE_OF_CONDUCT.md). Report a vulnerability
privately, as [`SECURITY.md`](SECURITY.md) describes, never in a public issue.

Before opening a PR, run the suites and — for anything touching the agent, real Task
Scheduler, or security — the relevant [manual runbook](docs/testing/manual-testing/README.md):

```bash
cd backend  && npm test && npm run test:integration
cd ../frontend && npm run lint && npm test
cd ../agent  && dotnet test
```

See [**🧪 Testing**](docs/testing/README.md) for what each layer covers and where the gaps are.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<p align="center">
  Part of the <a href="https://mikesailab.com">mikesailab.com</a> ecosystem ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

<p align="center">
  <sub>© 2026 Michael Schecht · Licensed under <a href="LICENSE">Apache-2.0</a> · Local-first, pre-1.0</sub>
</p>
