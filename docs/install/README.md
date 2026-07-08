<h1 align="center">⬇️ Installation</h1>

<p align="center">
  <em>Get TaskHub running on your machine — from cloning the repo to a live dashboard.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-full_support-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows">
  <img src="https://img.shields.io/badge/macOS-partial-6B7280?style=for-the-badge&logo=apple&logoColor=white" alt="macOS partial">
  <img src="https://img.shields.io/badge/Docker-recommended-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker">
</p>

---

TaskHub has three parts: a **frontend** (the dashboard), a **backend** (API + database),
and a **Windows agent** that syncs your local Task Scheduler. The frontend and backend run
anywhere Docker does; the agent is Windows-only today.

Pick your path below, then head to [**⚙️ Setup & Configuration**](../setup/README.md) to
tune environment variables.

## 🧭 Choose your path

| Path | Use this when… |
|:---|:---|
| [**🪟 Windows (full experience)**](#-windows--full-experience) | You want live Windows Task Scheduler sync and remote triggering. |
| [**🍎 macOS (dashboard + backend only)**](#-macos--dashboard--backend-only) | You want to run and explore TaskHub, minus the Windows agent. |
| [**📦 Clone the repo**](#-clone-the-repo) | Any OS — the first step for every path. |

## 📦 Clone the repo

```bash
git clone https://github.com/michaelschecht/taskhub.git
cd taskhub
```

Requirements common to every path:

- **Node.js LTS** and **npm** — frontend and backend.
- **Docker Desktop** *(recommended)* — brings up Postgres + Redis + backend + frontend
  together. Without it, you'll run a PostgreSQL 16 instance yourself.

## 🪟 Windows — full experience

The complete setup: dashboard, backend, **and** the local agent that mirrors your Windows
Task Scheduler into TaskHub.

**1. Bring up the stack** (from the repo root):

```bash
docker compose up --build
#   → frontend  http://localhost:5173
#   → backend   http://localhost:3000
```

**2. Install and start the Windows agent.** The agent must run on the Windows host (not in
Docker) to reach the Task Scheduler COM interfaces. Requirements: **Windows 10/11**, the
**.NET 10 SDK**, and **Administrator** rights to register the scheduled task.

Open **PowerShell as Administrator** and run the automated setup:

```powershell
cd agent
Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-agent-startup.ps1
```

This compiles the agent headlessly (Release, `win-x64`), registers it under the
`\Task-Hub\` Task Scheduler folder to launch on logon, and starts it. Full details,
verification steps, and troubleshooting are in the
[**🤖 Windows Agent Setup Guide**](../user-guides/Agent_Setup_Guide.md).

**3. (Optional) Auto-start the whole stack at logon.** To have Docker, the backend, the
frontend, *and* the agent come up automatically when you sign in — not just the agent — use
the [**logon launcher**](../../scripts/startup-task/README.md).

> [!TIP]
> Verify everything is connected: open [localhost:5173](http://localhost:5173), and the
> **Windows Agent** status in the sidebar should read **Online** with your tasks imported.

## 🍎 macOS — dashboard + backend only

> [!NOTE]
> The Windows agent is **Windows-only** today, so on macOS you can run the dashboard and
> backend and explore the UI, but live OS-level task sync isn't available yet. A macOS
> agent (launchd) is on the [Roadmap](../ROADMAP.md) under **P3 — Expansion**.

```bash
# From the repo root
docker compose up --build
#   → frontend  http://localhost:5173
#   → backend   http://localhost:3000
```

You can still use **TaskHub-native tasks** (HTTP jobs the backend runs itself) and the
**template library** on macOS. To browse the interface without any backend at all, just
visit the [public demo](https://taskhub.mikesailab.com).

## 🐳 Prefer to run each piece manually?

If you'd rather not use Docker, run the backend, frontend, and agent yourself. That path —
including the PostgreSQL and `DATABASE_URL` requirements — is documented in
[**⚙️ Setup & Configuration**](../setup/README.md#run-it-manually-no-docker).

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="../setup/README.md">Next: Setup & Configuration →</a>
</p>
