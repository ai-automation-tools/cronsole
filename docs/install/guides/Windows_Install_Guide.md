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
syncs your Windows Task Scheduler into Cronsole and lets you trigger tasks remotely.

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

This compiles the agent headlessly (Release, `win-x64`) and starts the stack, agent included.
Full details, verification steps, and troubleshooting are in the
[**🤖 Windows Agent Setup Guide**](../../user-guides/guides/Agent_Setup_Guide.md).

> [!NOTE]
> **The agent is not its own scheduled task** (changed 2026-08-25). It is started by
> `\Cronsole-Stack\CronsoleStack`, which runs `cronsole.ps1 up` at logon and every 5 minutes — so
> starting the agent is one of the things that task does, and step 3 is what registers it. Until
> you do step 3, nothing starts the agent at logon.

## 3. Auto-start the stack at logon

This registers `\Cronsole-Stack\CronsoleStack`, which brings up Docker, Postgres, Redis, the
backend, the frontend **and the agent** at logon, then re-checks every 5 minutes and restarts
whatever died. From an **Administrator** PowerShell, once:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-CronsoleStack.ps1
```

Two on-demand companions are worth registering at the same time — both run elevated, so
afterwards you can rebuild or restart the stack from an ordinary prompt with no UAC prompt:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-RepublishTask.ps1
powershell -ExecutionPolicy Bypass -File scripts\startup-task\Register-RestartTask.ps1
```

Details, the security trade behind those two, and how to verify are in the
[**🔧 launcher tasks guide**](../../../scripts/startup-task/README.md).

## 4. Verify

> [!TIP]
> Open [localhost:7373](http://localhost:7373) — the **Windows Agent** status in the
> source rail should show **Windows Task Scheduler** with a green dot and your tasks imported.

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
