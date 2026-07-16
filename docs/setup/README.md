<h1 align="center">⚙️ Setup & Configuration</h1>

<p align="center">
  <em>Environment variables and options that control how TaskHub runs.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/config-env_vars-F97316?style=for-the-badge" alt="Config">
</p>

---

Already installed? This page covers the settings that point TaskHub at the right backend,
authenticate the dashboard, and connect the agent. If you haven't installed yet, start with
[**⬇️ Installation**](../install/README.md).

## 🔑 Key environment variables

| Variable | Where | Purpose |
|:---|:---|:---|
| **`VITE_API_URL`** | frontend | Default origin the dashboard calls for the API. Defaults to `http://localhost:3000`. Users can override it at runtime in **Settings → About → API origin**; the override is saved in that browser. |
| **`VITE_DEV_TOKEN`** | frontend | **Optional dev/E2E fallback** auth token. As of 2026-07-16 the dashboard has a real **login screen** (single-user local login) and stores the login token per-browser; this env token is only used when no one has logged in — a convenience for local dev and the E2E suite. A real login token always wins. No committed default; sign one with the backend's `JWT_SECRET` for the placeholder user if you want to skip the login screen. See `frontend/.env.example`. |
| **`DATABASE_URL`** | backend | PostgreSQL 16 connection string. Required when running the backend outside Docker Compose. |
| **`TEST_DATABASE_URL`** | backend (tests) | Postgres URL for the integration suite (`npm run test:integration`). Defaults to `postgresql://taskhub:password@localhost:5432/taskhub_test` — the suite **creates, migrates, and truncates** this database, so point it at a throwaway DB, never a real one. Unit tests (`npm test`) don't use it. |
| **`JWT_SECRET`** | backend | Signing secret for user auth tokens. Must be **≥ 16 chars**; the backend **fails to start** on a missing or weak secret. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. |
| **`ENCRYPTION_KEY`** | backend | AES-256-GCM key that encrypts `PlatformConnection.config` (API keys, agent IDs, pairing secrets) **at rest**. Must be **exactly 32 characters**; the backend **fails to start** otherwise. |
| **`AGENT_PAIRING_SECRET`** | backend + agent | Shared secret for the agent's WebSocket handshake. The backend **fails to start** without it; the agent must set the same value as `TASKHUB_PAIRING_SECRET`. Use a long random string (`openssl rand -hex 24`). |
| **`DISABLE_AUTH_RATE_LIMIT`** | backend | Optional. Set to `true` to disable the login/setup rate-limiter (per-IP, on `/api/auth/login` + `/setup`). The limiter is already skipped under `NODE_ENV=test`; this is an escape hatch for local load testing. Leave unset in normal use. |
| **`ALLOWED_ORIGINS`** | backend | Comma-separated browser origins allowed to open a Socket.IO connection. Set this to the frontend origin (e.g. `http://localhost:5173`) to enable **browser live updates** — the dashboard's push channel that refreshes the task list on agent syncs / scheduled runs instead of polling. Empty = agent-only. |
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

> [!IMPORTANT]
> `docker-compose.yml` bakes in **DEV-ONLY default secrets** (`JWT_SECRET`,
> `ENCRYPTION_KEY`, `AGENT_PAIRING_SECRET`) so `docker compose up` boots out of the box.
> Those defaults **won't match** a `frontend/.env.local` dev token or an agent pairing
> secret you generated against a rotated `backend/.env` — the dashboard then gets
> `403 Invalid or expired token` and the agent handshake is rejected. To align them,
> create a **root `.env`** (gitignored, next to `docker-compose.yml`) mirroring the
> secret values from `backend/.env`; Compose interpolates it automatically. Recreate the
> backend after changing it: `docker compose up -d --force-recreate backend`.

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

### Changing the backend URL from the dashboard

`VITE_API_URL` is only the default. In the running app, open **Settings → About → API origin**
to point the dashboard at another backend without rebuilding the frontend. TaskHub stores that
browser-local override in `localStorage`, updates REST calls and the live `/ui` Socket.IO
channel immediately, and **Reset** returns to the `VITE_API_URL` default.

## 🎛️ Controlling the stack (one command)

The local stack is five pieces — Postgres + Redis (Docker), the backend and
frontend dev servers (host), and the Windows agent (host `.exe`). Rather than
starting/checking each one, use the single control script:

```powershell
pwsh scripts\taskhub.ps1 status   # one table: every service + API health, ALL UP / PARTIAL / DOWN
pwsh scripts\taskhub.ps1 up       # start whatever's down (idempotent)
pwsh scripts\taskhub.ps1 restart  # bounce the app tier
pwsh scripts\taskhub.ps1 down     # stop backend + frontend + agent
```

Postgres/Redis carry `restart: unless-stopped`, so they self-heal after a crash
or reboot; the auto-start scheduled task re-runs `taskhub up` every 10 minutes to
recover the rest. See [`scripts/README.md`](../../scripts/README.md) for details.

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
- Dashboard reading live data: it shows **your** tasks once the agent has synced.
- Agent connected: the sidebar **Windows Agent** status reads **Online**.

> [!TIP]
> Something not coming up? Check [**🧯 Troubleshooting**](../troubleshooting/README.md) — it
> has symptom → cause → fix entries for the boot/auth issues we've hit (crash-looping
> backend, `403 Invalid or expired token`, ports that look alive but don't respond).

---

<p align="center">
  <a href="../install/README.md">← Installation</a> ·
  <a href="../user-guides/README.md">Next: User Guides →</a>
</p>
