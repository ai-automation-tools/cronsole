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
| **`VITE_DEV_TOKEN`** | frontend | Dev/MVP auth token the dashboard sends as `Authorization: Bearer` for **live** mode (there is no committed default — a real login flow replaces this pre-launch). Sign one with the backend's `JWT_SECRET` for the placeholder user; see `frontend/.env.example`. Not needed in demo mode (which never calls the backend). |
| **`DATABASE_URL`** | backend | PostgreSQL 16 connection string. Required when running the backend outside Docker Compose. |
| **`JWT_SECRET`** | backend | Signing secret for user auth tokens. Must be **≥ 16 chars**; the backend **fails to start** on a missing or weak secret. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| **`ENCRYPTION_KEY`** | backend | AES-256-GCM key that encrypts `PlatformConnection.config` (API keys, agent IDs, pairing secrets) **at rest**. Must be **exactly 32 characters**; the backend **fails to start** otherwise. |
| **`AGENT_PAIRING_SECRET`** | backend + agent | Shared secret for the agent's WebSocket handshake. The backend **fails to start** without it; the agent must set the same value as `TASKHUB_PAIRING_SECRET`. Use a long random string (`openssl rand -hex 24`). |
| **`ALLOWED_ORIGINS`** | backend | Comma-separated browser origins allowed to open a Socket.IO connection. Empty by default (only the non-browser agent connects today). |
| **`TASKHUB_SERVER_URL`** | agent | Backend URL the agent connects to (WSS-capable, e.g. `wss://taskhub.example.com`). Defaults to `http://localhost:3000`. Overrides `serverUrl` in appsettings.json. |
| **`TASKHUB_PAIRING_SECRET`** | agent | Must equal the backend's `AGENT_PAIRING_SECRET`. Required **unless** set via `appsettings.json` — the agent exits if neither provides it. Overrides the file. |
| **`TASKHUB_AGENT_ID`** | agent | Stable identifier for this agent. Defaults to the machine name. Overrides `agentId` in appsettings.json. |

> [!IMPORTANT]
> Secrets never belong in committed code. Copy `backend/.env.example` → `backend/.env` and
> `frontend/.env.example` → `frontend/.env.local` and fill in real values (both are gitignored).
> See the security conventions in [`CLAUDE.md`](../../CLAUDE.md) (§9) for how config is handled
> and encrypted at rest.

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
incoming connections. The connection is **authenticated**: the agent proves it holds the
shared pairing secret via an HMAC handshake (the backend rejects any socket that can't), and
the backend signs every task command so the agent only executes commands it can verify.

Configure the agent one of two ways (env vars **override** the file, so a deployment can set
them without editing anything):
- **`agent/TaskHub.Agent/appsettings.json`** (recommended for local dev) — copy
  `appsettings.example.json` to `appsettings.json` and set `pairingSecret` (and optionally
  `serverUrl`/`agentId`). This file is gitignored so the secret isn't committed, and you
  don't have to re-export anything each run.
- **Environment variables** — `TASKHUB_SERVER_URL` (WSS-capable), `TASKHUB_PAIRING_SECRET`,
  `TASKHUB_AGENT_ID`.

Either way the secret must match the backend's `AGENT_PAIRING_SECRET`. A per-user **pairing-code flow**
(vs. today's single shared secret) is tracked on the [Roadmap](../ROADMAP.md) go-public
checklist.

For installing, registering, verifying, and troubleshooting the agent itself, see the
[**🤖 Windows Agent Setup Guide**](../user-guides/guides/Agent_Setup_Guide.md).

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
