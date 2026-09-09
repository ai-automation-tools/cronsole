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
  <a href="https://cronsole.mikesailab.com/">🌐 Website &amp; Template Gallery</a>
  ·
  <a href="docs/ROADMAP.md">🗺️ Roadmap</a>
</p>

<p align="center">
  <a href="https://github.com/ai-automation-tools/cronsole/issues">Report Bug</a>
  ·
  <a href="https://github.com/ai-automation-tools/cronsole/issues">Request Feature</a>
</p>

<p align="center">
  <a href="https://cronsole.mikesailab.com/"><img src="https://img.shields.io/badge/website-cronsole.mikesailab.com-2ea44f?style=for-the-badge&logo=githubpages&logoColor=white" alt="Website: cronsole.mikesailab.com"></a>
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


## 💡 Why it exists

No existing tool unifies AI-assistant schedulers with your operating system's scheduler.
Desktop utilities are Windows-only or abandoned; heavyweight orchestrators (Airflow, n8n,
Jenkins) are built for data engineers. Cronsole's angle is cross-domain unification,
**mobile-first triggering**, and AI-native task creation.

## 🔌 What it connects to

| Platform | How it connects | Status |
|:---|:---|:---|
| **🪟 Windows Task Scheduler** | A lightweight local agent on your machine — outbound-only, never accepts incoming connections. | ✅ Functional |
| **⚡ Cronsole-native** | Four kinds of job that Cronsole schedules and runs itself, with no OS task involved: **HTTP** calls, an **existing program**, a **script you write in Cronsole**, and **checks** that assert something is true. | ✅ Functional |
| **🤖 Claude Code Routines** | Natural-language routines through the Anthropic API. With a readable Claude Code session Cronsole lists, creates, reschedules, pauses and fires them; without one it can fire the routines you declared. **Deleting always happens in claude.ai** — no API exposes it. | 🧪 Experimental |
| **✨ Gemini API Triggers** | Scheduled prompts on Google's managed agents. One API key, and Cronsole can run, pause, reschedule, create and delete them — plus read how their runs actually went. | 🧪 Experimental |
| **🌿 GitHub Actions** | Scheduled workflows in the repositories you watch, read through a PAT. **Read-only by design** — Cronsole shows their crons and real run outcomes, and changes nothing. | 👁️ Observer |
| **▲ Vercel Cron** | Cron jobs declared by the projects you watch. **Read-only by design**, and Vercel publishes no run history, so their health stays honestly unknown. | 👁️ Observer |
| **💬 ChatGPT · Grok · Jules · Open Claw · Hermes** | Quick links straight to their native scheduling screens — none of them exposes a public scheduled-task API to build on. Add your own, too. | 🔗 Quick links |

## 🔍 How It Works

Cronsole has three pieces. A small **agent** runs on your Windows machine and opens an
outbound connection to the **backend** (it never accepts incoming connections). The agent
pushes your Task Scheduler list up to the backend, which stores it and keeps the **web
dashboard** in sync. When you click **Run Now**, the dashboard tells the backend, and the
backend relays the command back down to the agent — which runs the task locally. Schedules
are normalized to standard cron internally and translated to each platform's native format,
so what you see is consistent no matter where a task actually lives.

## 📊 Features

| Capability | What it gives you |
|:---|:---|
| **Unified dashboard** | Every synced task in one view, with platform and status badges, across grid / list / kanban / schedule / calendar layouts. Each card says **when the task runs** in plain words — *"Daily at 8:00 AM PDT"*, read in your own timezone — so you don't have to open a task to find out, and the **calendar** puts a month or a week of actual firings on a grid. |
| **Favorites & collections** | Star the handful of tasks you actually watch — **Favorites** is a row on the source rail, so it *composes* with whatever view is lit (Failures + Favorites is your failing starred tasks) rather than replacing it. A **collection** goes further: it stores *the tasks themselves*, not a filter, so you can name a set containing two Claude routines and two Windows tasks that share no property any filter could match. Neither ever narrows the dashboard behind your back — a bare URL opens on everything. |
| **Trigger from anywhere** | Hit **Run Now** on any Windows task from your desk or phone — the request relays down to the agent on your machine. Cronsole is local-first, so reaching it from a phone is an opt-in step: [**Remote Access**](docs/user-guides/guides/Remote_Access_Guide.md) ships a single-origin reverse proxy you put behind Tailscale or a Cloudflare Tunnel, keeping the dashboard off the public internet. |
| **Live sync** | The local agent keeps Cronsole in step with Windows Task Scheduler automatically, and self-heals if the connection drops. |
| **Cronsole-native tasks** | Jobs Cronsole runs itself, no OS scheduler involved: call an **HTTP** endpoint, run an **existing program**, run a **script you write here** (PowerShell · pwsh · Bash · sh · Python · Node — the body is stored in Cronsole, so it needs nothing on disk), or run a **check** that asserts an endpoint, port, file freshness or disk space is what you expect. A check's failure is a fact about your system rather than a bug in a script, which is what makes it worth alerting on. |
| **Template library** | 90+ ready-to-use script starters and use-case patterns, in 9 downloadable packs — including the **Developer Pack** and AI CLI packs for Claude Code + Codex; fill in the blanks and Cronsole creates a real scheduled task. Backed by a versioned, hosted [template registry](docs/reports/templates/Registry_Schema_v1.md) so the catalog updates independently of the app. **Grow it without a reseed**: export/import templates as JSON, or **Save as template** straight from a real task. |
| **AI-native control (MCP)** | Drive Cronsole from Claude, Codex, or Cursor in plain language — list, run, and create tasks through the [MCP server](docs/user-guides/guides/MCP_Server_Guide.md), a thin wrapper over the same API the dashboard uses. |
| **Honest platform status** | A health strip on the dashboard says whether each platform is reachable, how long ago your task list was **really** synced, and what the last command Cronsole sent did — including when it failed. The **Platforms** tab goes further: every capability reads *verified* (it has worked on this machine, with the timestamp), *declared* (never tried here) or *unsupported*. Nothing claims a capability it hasn't demonstrated. |
| **Diagnose it in the app** | When something looks wrong, **Diagnose** on the dashboard checks Cronsole itself — the agent connection, the database, the scheduler, the template catalog, token expiry — and shows **the evidence behind each verdict**, not just a colour. *"Agent offline"* is one sentence covering four different situations; this tells you which, down to when a request last timed out and which one. Read-only: it diagnoses, it never silently "fixes" things. |
| **Run history** | Per-task history (status, time, duration, log snippet); failed runs are flagged right on the dashboard. |
| **Search & organize** | Free-text search plus local categories to keep a big task list navigable. Windows' own `\Microsoft\` tasks — which outnumber yours roughly 3:1 on a real machine — are hidden by default, and the filter tells you how many it's holding back. |
| **Back up & restore** | Save every scheduled task on the machine as native Task Scheduler XML — including the ones you never imported, which are the ones nothing else is holding — then put them back. Restore **shows you a plan first**: what it would create, replace, skip, or refuse, checked against what is really on the machine, before anything is written. |
| **Import & recover a task** | Recreate a Cronsole-native task from a `.json` you exported — on another machine, or on this one after deleting it. Cronsole archives a native task's definition **before** deleting it and refuses the delete if it cannot, so a deleted task can be rebuilt from the Tools tab. What you get back is a **new** task on the same schedule, not the old one revived — its run history stays with the archive. |
| **Remove without destroying** | **Remove from Cronsole** takes a task off your dashboard and leaves it running on the machine; **Delete from Windows** is the separate, clearly-marked verb that actually destroys the scheduled task. Undoing an over-broad import never costs you an automation. |
| **Dark & light themes** | Dark by default, with light and system-follow modes persisted per device. |


## 📍 Status — what actually works

Cronsole is **pre-1.0** and honest about it. Per-source capability is in
[What it connects to](#-what-it-connects-to) above — that table is the same declaration the app's own
**Platforms** tab renders (`backend/src/services/platformCapabilities.ts`), so if it and the app ever
disagree, the app is right and the table is the bug. What that table does *not* answer is the two
questions a new reader actually has:

### Will it run on my machine?

| | |
|:---|:---|
| **Windows 10 / 11** | ✅ Fully supported — the agent talks to Task Scheduler directly |
| **macOS / Linux** | 🟡 Partial. The backend, database and dashboard run anywhere Docker does, and every source that is reached over HTTP works normally. What is missing is the **agent**: nothing yet drives launchd, cron or systemd timers. One POSIX agent covering all three is the next major piece of work |
| **Phone / tablet** | ✅ The dashboard is mobile-first. Reaching it from another device is [opt-in remote access](docs/user-guides/guides/Remote_Access_Guide.md), never a public URL |

### What isn't there yet

Listed because finding out later is worse than reading it now:

| | |
|:---|:---|
| **No installer** | Clone the repo and run Docker Compose. An MSI needs a code-signing certificate first, or Windows SmartScreen warns every person who runs it |
| **Single user** | One owner account, created on first run. No password reset, no refresh tokens, no roles — and, by design, no open registration |
| **Local-first, no hosted version** | There is no cloud Cronsole to sign up for, and that is a decision rather than a gap. Your data stays on your machine |
| **No release channel yet** | Pre-1.0: fixes land on `main`, and there are no back-ported release branches |

Full detail, dated and prioritized, in the [**Roadmap**](docs/ROADMAP.md).


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
> The fastest path is Docker Compose — it brings up the database, backend, and frontend
> together. The Windows agent runs directly on your machine (see step 3).

1. Clone the repo:

   ```bash
   git clone https://github.com/ai-automation-tools/cronsole.git
   cd cronsole
   ```

2. Bring up the dev stack (Postgres + Redis + backend + frontend):

   ```bash
   docker compose --profile docker up --build
   #   → frontend  http://localhost:7373
   #   → backend   http://localhost:3000   (GET /api/health to verify)
   ```

   > [!IMPORTANT]
   > The `--profile docker` is not optional. Backend and frontend are opt-in profiles, so a
   > plain `docker compose up` starts **Postgres and Redis only** and nothing answers on
   > `:7373`. Omit the profile when you want to run the backend and frontend as host
   > processes instead (the manual path below).

3. Start the Windows agent so your real Task Scheduler tasks appear (PowerShell **as Administrator**; must run on the Windows host, not in Docker):

   ```powershell
   cd agent
   Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-agent-startup.ps1
   ```

4. Open [localhost:7373](http://localhost:7373). The first load asks you to create the owner account — that is the only account-creation path there is, and it works once. After that, the **Windows Agent** status in the sidebar should read **Online** with your tasks imported.

<details>
<summary><b>Prefer to run each piece manually (no Docker)?</b></summary>

<br>

```bash
# Backend — needs a PostgreSQL 16 instance
cd backend
cp .env.example .env        # then set DATABASE_URL + secrets (JWT_SECRET,
                            # ENCRYPTION_KEY, AGENT_PAIRING_SECRET) — the backend
                            # fail-fasts without them; see docs/setup/README.md
npm install
npx prisma migrate dev      # create the schema
npm start                   # http://localhost:3000

# Frontend — in a second terminal
cd frontend
cp .env.example .env.local  # set VITE_DEV_TOKEN so the dashboard can reach the backend
npm install
npm run dev                 # http://localhost:7373

# Windows agent — in a third terminal (Windows only)
cd agent/Cronsole.Agent
dotnet run                  # connects out to the backend, pushes Task Scheduler tasks
```

See [Setup & configuration](docs/setup/README.md) for every option.

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 🧱 Built With

| Layer | Technology |
|:---|:---|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query + React Router |
| **Backend** | Node.js + Express 5 + Socket.io (TypeScript) |
| **Database** | PostgreSQL 16 + Prisma 6 ORM |
| **Windows agent** | .NET 10 (`Cronsole.Agent`) reading Windows Task Scheduler |
| **Hosting** | Runs locally — backend + agent on your machine; dev stack via Docker Compose |

## 📖 Documentation

Full documentation lives in **[`docs/`](docs/README.md)**. The main sections:

| Section | What's inside |
|:---|:---|
| [**📚 Documentation home**](docs/README.md) | The map to every guide, reference, and design doc. |
| [**⬇️ Installation**](docs/install/README.md) | Install Cronsole on Windows or macOS, or clone the repo. |
| [**⚙️ Setup & Configuration**](docs/setup/README.md) | Environment variables, Docker vs. manual, agent pairing. |
| [**🖥️ User Guides**](docs/user-guides/README.md) | Day-to-day guides for using Cronsole once it's running. |
| [**💬 Prompt Library**](docs/prompts/README.md) | Copy-paste prompts for driving Cronsole in plain English — scheduled scripts, headless coding-agent runs, HTTP jobs, audits. |
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
| [**🧩 MCP Server**](docs/user-guides/guides/MCP_Server_Guide.md) | Wiring Cronsole into Claude / Codex / Cursor to manage tasks in natural language. |
| [**🌐 Remote Access**](docs/user-guides/guides/Remote_Access_Guide.md) <sub>· optional</sub> | Reaching your own instance from your phone — one HTTPS origin behind Tailscale or a Cloudflare Tunnel, with nothing on the public internet. |
| [**💬 Prompts to start with**](docs/prompts/mcp-server/README.md) | What to actually say once the MCP server is connected, grouped by what you're trying to do. |
| [**🔥 Smoke Test**](docs/testing/manual-testing/runbooks/Smoke_Test.md) | Verifying your stack is actually alive and the agent is talking — in about 10 minutes. |

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

> [!NOTE]
> **Skill vs. MCP server** — easy to conflate. The [**skill**](skills/README.md) teaches an
> agent to *work on* Cronsole's codebase. The [**MCP server**](docs/user-guides/guides/MCP_Server_Guide.md)
> lets an agent *use* a running Cronsole — list, run, and create tasks in natural language.

## 🤝 Contributing

Cronsole is an MVP-stage project. If you're working on it, start with
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CLAUDE.md`](CLAUDE.md), and track work on the
[Roadmap](docs/ROADMAP.md). Recent changes are logged in [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

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
  <sub>© 2026 Michael Schecht · Licensed under <a href="LICENSE">Apache-2.0</a> · Local-first, pre-public MVP</sub>
</p>
