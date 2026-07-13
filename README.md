<a id="readme-top"></a>

<p align="center">
  <a href="docs/README.md">
    <img src="images/TaskHub-Images/logos/dark/landscape-01-command-grid.svg" alt="TaskHub — one control plane for scheduled tasks" width="720">
  </a>
</p>

<p align="center">
  <em>The ultimate unified dashboard to view, trigger, and manage every scheduled job you own —<br>Windows Task Scheduler, AI assistants, and cron, all in one place.</em>
</p>

<p align="center">
  <a href="docs/README.md"><strong>Explore the docs »</strong></a>
</p>

<p align="center">
  <a href="https://github.com/michaelschecht/taskhub/issues">Report Bug</a>
  ·
  <a href="https://github.com/michaelschecht/taskhub/issues">Request Feature</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-MVP_Prototype-F59E0B?style=for-the-badge" alt="Status: MVP Prototype">
  <a href="docs/ROADMAP.md"><img src="https://img.shields.io/badge/plan-ROADMAP-8B5CF6?style=for-the-badge" alt="Roadmap"></a>
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
Jenkins) are built for data engineers. TaskHub's angle is cross-domain unification,
**mobile-first triggering**, and AI-native task creation.

## 🔌 What it connects to

| Platform | How it connects | Status |
|:---|:---|:---|
| **🪟 Windows Task Scheduler** | A lightweight local agent on your machine — outbound-only, never accepts incoming connections. | ✅ Functional |
| **⚡ TaskHub-native** | HTTP jobs (webhooks, health checks) that TaskHub schedules and runs itself — no OS task needed. | ✅ Functional |
| **🤖 Claude Code Routines** | Natural-language routines through the Anthropic API. | 🧪 Experimental |
| **💬 ChatGPT · Gemini · Jules** | Quick links straight to their native scheduling screens. | 🔗 Quick links |

## 🔍 How It Works

TaskHub has three pieces. A small **agent** runs on your Windows machine and opens an
outbound connection to the **backend** (it never accepts incoming connections). The agent
pushes your Task Scheduler list up to the backend, which stores it and keeps the **web
dashboard** in sync. When you click **Run Now**, the dashboard tells the backend, and the
backend relays the command back down to the agent — which runs the task locally. Schedules
are normalized to standard cron internally and translated to each platform's native format,
so what you see is consistent no matter where a task actually lives.

## 📊 Features

| Capability | What it gives you |
|:---|:---|
| **Unified dashboard** | Every synced task in one view, with platform and status badges, across grid / list / kanban / schedule layouts. |
| **Trigger from anywhere** | Hit **Run Now** on any Windows task from your desk or phone — the request relays down to the agent on your machine. |
| **Live sync** | The local agent keeps TaskHub in step with Windows Task Scheduler automatically, and self-heals if the connection drops. |
| **TaskHub-native tasks** | Create HTTP jobs (webhooks, health checks) that TaskHub schedules and runs itself — no OS task needed. |
| **Template library** | 40 ready-to-use script starters and use-case patterns — including the **Developer Pack** and AI CLI packs for Claude Code + Codex; fill in the blanks and TaskHub creates a real scheduled task. Backed by a versioned, hosted [template registry](docs/reports/templates/Registry_Schema_v1.md) so the catalog updates independently of the app. **Grow it without a reseed**: export/import templates as JSON, or **Save as template** straight from a real task. |
| **Run history** | Per-task history (status, time, duration, log snippet); failed runs are flagged right on the dashboard. |
| **Search & organize** | Free-text search plus local categories to keep a big task list navigable. |
| **Dark & light themes** | Dark by default, with light and system-follow modes persisted per device. |


## 🎨 Screenshots

<details open>
<summary><b>📸 Dashboard, Templates, Settings, Views, and Themes</b> </summary>

<br>

<p align="center">
  <img src="images/screenshots/dashboard.png" alt="TaskHub unified dashboard — dark theme with platform filters, categories, and grid/list/kanban/schedule views" width="900">
</p>

| | |
|:---:|:---:|
| <img src="images/screenshots/templates.png" alt="TaskHub template library"><br><sub><b>Template library</b> — parameterized script starters</sub> | <img src="images/screenshots/apply-template-modal.png" alt="Apply Template modal"><br><sub><b>Apply Template</b> — fill in the blanks, get a real task</sub> |
| <img src="images/screenshots/task-detail.png" alt="TaskHub task detail modal"><br><sub><b>Task detail</b> — metadata, run history, Run Now</sub> | <img src="images/screenshots/new-task-modal.png" alt="New Task modal"><br><sub><b>New Task</b> — TaskHub-native or Windows, with cron presets</sub> |
| <img src="images/screenshots/list-view.png" alt="TaskHub list view"><br><sub><b>List view</b> — sortable columns and quick actions</sub> | <img src="images/screenshots/kanban-view.png" alt="TaskHub kanban view"><br><sub><b>Kanban view</b> — tasks grouped by status</sub> |
| <img src="images/screenshots/schedule-view.png" alt="TaskHub schedule view"><br><sub><b>Schedule view</b> — chronological by next run</sub> | <img src="images/screenshots/dashboard-light.png" alt="TaskHub dashboard in light theme"><br><sub><b>Light theme</b> — the same dashboard, light variant</sub> |

</details>

## ⚡ Quick Start

> [!TIP]
> The fastest path is Docker Compose — it brings up the database, backend, and frontend
> together. The Windows agent runs directly on your machine (see step 3).

1. Clone the repo:

   ```bash
   git clone https://github.com/michaelschecht/taskhub.git
   cd taskhub
   ```

2. Bring up the dev stack (Postgres + Redis + backend + frontend):

   ```bash
   docker compose up --build
   #   → frontend  http://localhost:5173
   #   → backend   http://localhost:3000   (GET /api/health to verify)
   ```

3. Start the Windows agent so your real Task Scheduler tasks appear (PowerShell **as Administrator**; must run on the Windows host, not in Docker):

   ```powershell
   cd agent
   Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-agent-startup.ps1
   ```

4. Open [localhost:5173](http://localhost:5173) — the **Windows Agent** status in the sidebar should read **Online** with your tasks imported.

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
npm run dev                 # http://localhost:5173

# Windows agent — in a third terminal (Windows only)
cd agent/TaskHub.Agent
dotnet run                  # connects out to the backend, pushes Task Scheduler tasks
```

See [Setup & configuration](docs/setup/README.md) for every option.

</details>

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## 🧱 Built With

| Layer | Technology |
|:---|:---|
| **Frontend** | React 19 + TypeScript + Vite + Tailwind CSS + TanStack Query |
| **Backend** | Node.js + Express 5 + Socket.io (TypeScript) |
| **Database** | PostgreSQL 16 + Prisma 6 ORM |
| **Windows agent** | .NET 10 (`TaskHub.Agent`) reading Windows Task Scheduler |
| **Hosting** | Runs locally — backend + agent on your machine; dev stack via Docker Compose |

## 📖 Documentation

Full documentation lives in **[`docs/`](docs/README.md)**. The main sections:

| Section | What's inside |
|:---|:---|
| [**📚 Documentation home**](docs/README.md) | The map to every guide, reference, and design doc. |
| [**⬇️ Installation**](docs/install/README.md) | Install TaskHub on Windows or macOS, or clone the repo. |
| [**⚙️ Setup & Configuration**](docs/setup/README.md) | Environment variables, Docker vs. manual, agent pairing. |
| [**🖥️ User Guides**](docs/user-guides/README.md) | Day-to-day guides for using TaskHub once it's running. |
| [**🧯 Troubleshooting**](docs/troubleshooting/README.md) | Symptom → cause → fix for problems we've actually hit. |
| [**🗺️ Roadmap**](docs/ROADMAP.md) | What's shipped and what's next, in priority order. |

And the key guides, one click away:

| Guide | Takes you through |
|:---|:---|
| [**📦 Clone the Repo**](docs/install/guides/Clone_Repo_Guide.md) | The first step for every install path, plus common prerequisites. |
| [**🪟 Windows Install**](docs/install/guides/Windows_Install_Guide.md) | The full experience — stack, agent, and auto-start at logon. |
| [**🍎 macOS Install**](docs/install/guides/macOS_Install_Guide.md) | Dashboard + backend on macOS (no Windows agent yet). |
| [**🖥️ UI User Guide**](docs/user-guides/guides/UI_User_Guide.md) | Navigating the dashboard, categorizing tasks, applying templates. |
| [**🤖 Windows Agent Setup**](docs/user-guides/guides/Agent_Setup_Guide.md) | Installing, verifying, and troubleshooting the local agent. |

## 🤝 Contributing

TaskHub is a private MVP-stage repository. If you're working on it, start with
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CLAUDE.md`](CLAUDE.md), and track work on the
[Roadmap](docs/ROADMAP.md). Recent changes are logged in [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

---

<p align="center">
  Part of the <a href="https://mikesailab.com">mikesailab.com</a> ecosystem ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a>
</p>

<p align="center">
  <sub>© 2026 Michael Schecht · Private repository · All rights reserved</sub>
</p>
