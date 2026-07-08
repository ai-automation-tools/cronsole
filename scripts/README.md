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
| [**🚀 startup-task/**](startup-task/README.md) | The logon **auto-start** launcher — brings up the entire local stack (Docker db + redis, backend, frontend, agent) automatically at Windows logon via the `\Task-Hub\TaskHubAgent` scheduled task. Includes the launcher script and the scheduled-task definitions (applied + rollback). |

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
