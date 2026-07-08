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

Every path starts by cloning the repo, then follows the guide for your OS. When you're
done, head to [**⚙️ Setup & Configuration**](../setup/README.md) to tune environment
variables.

## 🧭 Choose your path

| Guide | Use this when… |
|:---|:---|
| [**📦 Clone the Repo**](guides/Clone_Repo_Guide.md) | Any OS — the first step for every path, plus the common prerequisites. |
| [**🪟 Windows Install Guide**](guides/Windows_Install_Guide.md) | You want the full experience — live Windows Task Scheduler sync and remote triggering. |
| [**🍎 macOS Install Guide**](guides/macOS_Install_Guide.md) | You want to run and explore TaskHub, minus the Windows agent. |

> [!TIP]
> Just want a look around first? The [**public demo**](https://taskhub.mikesailab.com)
> runs the full dashboard against sample data with zero setup.

## 🐳 Prefer to run each piece manually?

If you'd rather not use Docker, run the backend, frontend, and agent yourself. That path —
including the PostgreSQL and `DATABASE_URL` requirements — is documented in
[**⚙️ Setup & Configuration**](../setup/README.md#run-it-manually-no-docker).

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🤖 Windows Agent Setup Guide**](../user-guides/guides/Agent_Setup_Guide.md) | Installing, verifying, and troubleshooting the local agent in depth. |
| [**🔧 Auto-start launcher**](../../scripts/startup-task/README.md) | Have the whole stack come up automatically at logon. |

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="guides/Windows_Install_Guide.md">Windows</a> ·
  <a href="guides/macOS_Install_Guide.md">macOS</a> ·
  <a href="../setup/README.md">Next: Setup & Configuration →</a>
</p>
