<h1 align="center">⚙️ Setup & Configuration</h1>

<p align="center">
  <em>Environment variables and options that control how TaskHub runs.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/config-env_vars-F97316?style=for-the-badge" alt="Config">
  <img src="https://img.shields.io/badge/mode-demo_or_live-8B5CF6?style=for-the-badge" alt="Mode">
</p>

---

Already installed? This page covers the settings that make TaskHub read **live data** vs.
demo fixtures, point at the right backend, and connect the agent. If you haven't installed
yet, start with [**⬇️ Installation**](../install/README.md).

## 🔑 Key environment variables

| Variable | Where | Purpose |
|:---|:---|:---|
| **`VITE_DEMO_MODE`** | frontend | When `true`, the dashboard renders built-in sample tasks and **Run Now** is a no-op (this drives the public demo). Leave it **unset** locally to read live data. |
| **`VITE_API_URL`** | frontend | Origin the dashboard calls for the API. Defaults to `http://localhost:3000`. Set this if the backend runs elsewhere. |
| **`DATABASE_URL`** | backend | PostgreSQL 16 connection string. Required when running the backend outside Docker Compose. |
| **`JWT_SECRET`** | backend | Signing secret for auth tokens. |

> [!IMPORTANT]
> Secrets never belong in committed code. Use `backend/.env` / `.env.local` for local
> development. See the security conventions in [`CLAUDE.md`](../../CLAUDE.md) (§9) for how
> config is handled and encrypted at rest.

## 🐳 Docker vs. manual

- **Docker Compose (recommended)** — `docker compose up --build` from the repo root brings
  up Postgres, Redis, the backend, and the frontend with sane defaults. Best for getting
  running fast.
- **Manual** — run each service yourself when you're developing or debugging a single
  layer. See below.

### Run it manually (no Docker)

```bash
# Backend — needs a PostgreSQL 16 instance + DATABASE_URL in backend/.env
cd backend
npm install
npx prisma migrate dev      # create the schema
npm start                   # http://localhost:3000

# Frontend — second terminal
cd frontend
npm install
npm run dev                 # http://localhost:5173  (uses VITE_API_URL, default :3000)

# Windows agent — third terminal (Windows only)
cd agent/TaskHub.Agent
dotnet run                  # connects out to the backend
```

## 🤝 Agent connection & pairing

The Windows agent opens an **outbound** WebSocket to the backend — it never accepts
incoming connections. Today it connects to `http://localhost:3000`; a configurable server
URL (with WSS) and a per-user **pairing flow** are tracked on the
[Roadmap](../ROADMAP.md) (**P0 — Security hardening** and the go-public checklist).

For installing, registering, verifying, and troubleshooting the agent itself, see the
[**🤖 Windows Agent Setup Guide**](../user-guides/Agent_Setup_Guide.md).

## ✅ Verify your configuration

- Backend healthy: `GET http://localhost:3000/api/health` → `{ "status": "ok", ... }`.
- Live mode active: the dashboard shows **your** tasks (not the demo samples) — confirm
  `VITE_DEMO_MODE` is unset.
- Agent connected: the sidebar **Windows Agent** status reads **Online**.

---

<p align="center">
  <a href="../install/README.md">← Installation</a> ·
  <a href="../user-guides/README.md">Next: User Guides →</a>
</p>
