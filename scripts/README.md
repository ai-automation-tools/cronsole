<h1 align="center">🔧 Scripts</h1>

<p align="center">
  <em>Operational scripts for running TaskHub on your machine.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shell-PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white" alt="PowerShell">
</p>

---

Helper scripts that automate running TaskHub locally. Each subfolder has its own README with
the full details.

## 📂 In this folder

| Script | What it does |
|:---|:---|
| **`taskhub.ps1`** | **Single control surface** for the whole local stack — one command to bring it up, take it down, restart it, or see one combined status. Use this instead of hunting for which service is down. |
| [**🚀 startup-task/**](startup-task/README.md) | The logon **auto-start** launcher — brings up the entire local stack automatically at Windows logon via the `\Task-Hub\TaskHubAgent` scheduled task (re-runs every 10 min as a self-heal). It now delegates to `taskhub.ps1 up`, so boot and manual control share one code path. |

## 🎛️ Controlling the stack (`taskhub.ps1`)

The local stack is five pieces: **Postgres + Redis** (Docker, auto-restart), the
**backend** and **frontend** dev servers (host Node), and the **Windows agent**
(host `.exe` — it needs Task Scheduler access, so it can't be containerized).
`taskhub.ps1` controls and reports all of them at once:

```powershell
# from anywhere
pwsh scripts\taskhub.ps1 status     # one table: every service + an API health check
pwsh scripts\taskhub.ps1 up         # start whatever's down (idempotent — safe to re-run)
pwsh scripts\taskhub.ps1 restart    # stop the app tier, then bring it back
pwsh scripts\taskhub.ps1 down       # stop backend + frontend + agent (leaves db/redis up)
pwsh scripts\taskhub.ps1 down -All  # ...also stop the Docker db/redis containers
pwsh scripts\taskhub.ps1 logs       # tail the backend/frontend logs
```

`status` prints **ALL UP**, **PARTIAL (n/5)**, or **DOWN** so you can tell at a
glance. Docker db/redis carry `restart: unless-stopped`, so they recover from a
crash or reboot on their own; the backend/frontend recover on the next auto-start
self-heal (or immediately with `taskhub up`).

> [!IMPORTANT]
> Paths in these scripts are **machine-specific** — `Start-TaskHub.ps1` and the task XMLs
> hardcode this machine's Node, Docker, and repo paths (and the task XML embeds a user SID).
> Adjust them before using on another machine.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**⬇️ Installation**](../docs/install/README.md) | Where the auto-start launcher fits into full setup. |
| [**🤖 Windows Agent Setup**](../docs/user-guides/guides/Agent_Setup_Guide.md) | Registering just the agent (without the full-stack launcher). |
| [**⌨️ CLIs**](../docs/agent-tools/clis/README.md) | The command-line tools these scripts wrap. |

---

<p align="center">
  <a href="../README.md">← Repository Root</a> ·
  <a href="../docs/README.md">Documentation</a> ·
  <a href="startup-task/README.md">Auto-Start</a>
</p>
