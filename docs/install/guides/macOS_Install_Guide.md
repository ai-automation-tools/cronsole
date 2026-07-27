<h1 align="center">🍎 macOS Install Guide</h1>

<p align="center">
  <em>Run the dashboard and backend on macOS — everything except the Windows agent.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/macOS-partial_support-6B7280?style=for-the-badge&logo=apple&logoColor=white" alt="macOS partial">
  <img src="https://img.shields.io/badge/Docker-recommended-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker recommended">
</p>

---

On macOS you can run the dashboard and backend and explore the full UI — but the Windows
agent is **Windows-only** today, so live OS-level task sync isn't available yet.

> [!NOTE]
> A macOS agent (launchd) is on the [Roadmap](../../ROADMAP.md) under **P3 — Expansion**.

> [!IMPORTANT]
> Haven't cloned the repo yet? Start with the
> [**📦 Clone the Repo guide**](Clone_Repo_Guide.md), then come back here.

## 1. Bring up the stack

From the repo root:

```bash
docker compose up --build
#   → frontend  http://localhost:7373
#   → backend   http://localhost:3000   (GET /api/health to verify)
```

## 2. What you can do without the agent

| Works on macOS | What it gives you |
|:---|:---|
| **TaskHub-native tasks** | HTTP jobs (webhooks, health checks) the backend schedules and runs itself — no OS task needed. |
| **Template library** | Browse the catalog and apply templates targeting other platforms. |
| **Full dashboard UI** | All four views, categories, search, run history, themes. |

Next: tune environment variables and options in
[**⚙️ Setup & Configuration**](../../setup/README.md).

---

<p align="center">
  <a href="../README.md">← Installation home</a> ·
  <a href="Clone_Repo_Guide.md">Clone the Repo</a> ·
  <a href="../../setup/README.md">Next: Setup & Configuration →</a>
</p>
