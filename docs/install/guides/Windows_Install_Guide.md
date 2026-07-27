<h1 align="center">🪟 Windows Install Guide</h1>

<p align="center">
  <em>The full experience — dashboard, backend, and the local agent that mirrors your Windows Task Scheduler.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Windows 10/11">
  <img src="https://img.shields.io/badge/Docker-recommended-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker recommended">
  <img src="https://img.shields.io/badge/.NET-10_SDK-512BD4?style=for-the-badge&logo=.net&logoColor=white" alt=".NET 10 SDK">
</p>

---

This is the complete setup: the web dashboard, the backend, **and** the local agent that
syncs your Windows Task Scheduler into TaskHub and lets you trigger tasks remotely.

> [!IMPORTANT]
> Haven't cloned the repo yet? Start with the
> [**📦 Clone the Repo guide**](Clone_Repo_Guide.md), then come back here.

## Prerequisites

- **Windows 10/11**
- **Docker Desktop** *(recommended)* — or a self-managed PostgreSQL 16 instance
- **.NET 10 SDK** — compiles the agent
- **Administrator rights** — required to register the agent's scheduled task

## 1. Bring up the stack

From the repo root:

```bash
docker compose up --build
#   → frontend  http://localhost:7373
#   → backend   http://localhost:3000   (GET /api/health to verify)
```

## 2. Install and start the Windows agent

The agent must run on the Windows host (not in Docker) to reach the Task Scheduler COM
interfaces.

Open **PowerShell as Administrator** and run the automated setup:

```powershell
cd agent
Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-agent-startup.ps1
```

This compiles the agent headlessly (Release, `win-x64`), registers it under the
`\Task-Hub\` Task Scheduler folder to launch on logon, and starts it. Full details,
verification steps, and troubleshooting are in the
[**🤖 Windows Agent Setup Guide**](../../user-guides/guides/Agent_Setup_Guide.md).

## 3. (Optional) Auto-start the whole stack at logon

To have Docker, the backend, the frontend, *and* the agent come up automatically when you
sign in — not just the agent — use the
[**🔧 logon launcher**](../../../scripts/startup-task/README.md).

## 4. Verify

> [!TIP]
> Open [localhost:7373](http://localhost:7373) — the **Windows Agent** status in the
> sidebar should read **Online** with your tasks imported.

- Backend healthy: `GET http://localhost:3000/api/health` → `{ "status": "ok", ... }`.
- Your real Task Scheduler tasks appear on the dashboard.

Next: tune environment variables and options in
[**⚙️ Setup & Configuration**](../../setup/README.md).

---

<p align="center">
  <a href="../README.md">← Installation home</a> ·
  <a href="Clone_Repo_Guide.md">Clone the Repo</a> ·
  <a href="../../setup/README.md">Next: Setup & Configuration →</a>
</p>
