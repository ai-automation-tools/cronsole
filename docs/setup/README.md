<h1 align="center">⚙️ Setup & Configuration</h1>

<p align="center">
  <em>Environment variables and options that control how Cronsole runs.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/config-env_vars-F97316?style=for-the-badge" alt="Config">
</p>

---

Already installed? This page covers the settings that point Cronsole at the right backend,
authenticate the dashboard, and connect the agent. If you haven't installed yet, start with
[**⬇️ Installation**](../install/README.md).

## 🔑 Key environment variables

| Variable | Where | Purpose |
|:---|:---|:---|
| **`VITE_API_URL`** | frontend | Default origin the dashboard calls for the API. Defaults to `http://localhost:3000`. Users can override it at runtime in **Settings → About → API origin**; the override is saved in that browser. **Set it to `same-origin`** to resolve the API against `window.location` instead — the single-origin reverse-proxy deployment, where one build is correct at every address it is served from and no per-device override is needed. `npm run build:remote` does this for you. It is a build-time value only: the Settings field refuses to *store* it, since a saved value that resolves against the page would freeze whichever address it was saved at. See [Remote Access](../user-guides/guides/Remote_Access_Guide.md). |
| **`VITE_DEV_TOKEN`** | frontend | **Optional dev/E2E fallback** auth token, used only when no one has logged in (the dashboard has had a real single-user login since 2026-07-16, and a login token always wins). No committed default. <br><br>⚠️ **It must never reach a build, and since 2026-08-15 it structurally cannot.** Vite loads `.env.local` in *every* mode and inlines `VITE_*` references as literals, so this variable was being compiled into `dist/` as a valid owner JWT — every built copy of the dashboard arrived **already authenticated**, making the login screen decorative. The reference is now gated on `import.meta.env.DEV` (statically `false` in a build, so it folds away), and `npm run check:bundle` fails the build if a credential-shaped literal reappears. **The general rule: a `VITE_*` variable is compiled into the bundle and served to every visitor — the prefix means "safe to publish", not "available to the frontend".** ([troubleshooting #55](../troubleshooting/README.md#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in)) |
| **`DATABASE_URL`** | backend | PostgreSQL 16 connection string. Required when running the backend outside Docker Compose. |
| **`TEST_DATABASE_URL`** | backend (tests) | Postgres URL for the integration suite (`npm run test:integration`). Defaults to `postgresql://taskhub:password@localhost:5432/taskhub_test` — the suite **creates, migrates, and truncates** this database, so point it at a throwaway DB, never a real one. Unit tests (`npm test`) don't use it. |
| **`JWT_SECRET`** | backend | Signing secret for user auth tokens. **Generated on first boot** when empty and written to `backend/.env`. If you set your own it must be **≥ 16 chars**; the backend fails to start on a weak one. A value Cronsole once published in `docker-compose.yml` is treated as empty and replaced. |
| **`JWT_EXPIRES_IN`** | backend | Optional. How long an issued token lives; defaults to **`24h`**, so a browser session is unchanged unless you set it. Accepts a duration (`24h`, `30d`) or a plain number of **seconds** — a bare number is read as seconds, not the milliseconds `ms` would otherwise infer, so `3600` means an hour rather than 3.6 seconds. The backend **probe-signs at boot** and refuses to start on a value that cannot produce a usable token, instead of failing at the first login where the symptom (403 on everything) points at the token rather than the config. Set it for the **MCP server**, a long-lived stdio client that cannot re-authenticate ([guide](../user-guides/guides/MCP_Server_Guide.md#getting-a-token)). **Caveat: one value for all tokens** — raising it also lengthens browser sessions, including on a phone if you use remote access. |
| **`ENCRYPTION_KEY`** | backend | AES-256-GCM key that encrypts stored credentials (API keys, tokens, per-job secrets) **at rest**. **Generated on first boot** when empty and the database holds nothing encrypted yet. If you set your own it must be **exactly 32 characters**. **Do not change it afterwards** — data stored under the old key becomes unreadable — and back it up with the database. An install that already has data under the old published default keeps that key and warns at every boot. |
| **`AGENT_PAIRING_SECRET`** | backend + agent | Shared secret for the agent's WebSocket handshake. **Generated on first boot** when empty and written to `backend/.env`; `agent\setup-agent-startup.ps1` copies it into the agent's `appsettings.json`. The agent must hold the same value (`CRONSOLE_PAIRING_SECRET` or `appsettings.json`). |
| **`DISABLE_AUTH_RATE_LIMIT`** | backend | Optional. Set to `true` to disable the login/setup rate-limiter (per-IP, on `/api/auth/login` + `/setup`). The limiter is already skipped under `NODE_ENV=test`; this is an escape hatch for local load testing. Leave unset in normal use. |
| **`BIND_HOST`** | backend | Interface the API listens on. Defaults to **`127.0.0.1`**, so nothing off the machine can reach `:3000`; the agent, the dashboard and the bundled proxy on Docker Desktop all use loopback. Set `0.0.0.0` only when something off-box must connect directly. **Linux Docker Engine is that case for the proxy**: `host.docker.internal` is the bridge address there, not loopback, so the proxy answers `502` until this is set. The boot line states which it is. |
| **`ALLOWED_ORIGINS`** | backend | Comma-separated browser origins allowed to reach the backend — it gates **both** the REST API's CORS headers and the Socket.IO handshake. Set it to the frontend origin (e.g. `http://localhost:7373`); that also enables **browser live updates**, the dashboard's push channel that refreshes the task list on agent syncs / scheduled runs instead of polling. **Empty = agent-only sockets *and* a REST API any origin can read** — the backend warns at boot when that's the case. Non-browser callers (the MCP server, `curl`) send no `Origin` and are unaffected. A **refused** browser origin is logged once, naming the origin and the allowed list ([troubleshooting #31](../troubleshooting/README.md#31-the-dashboard-loads-but-every-api-call-fails-with-a-cors-error)). |
| **`TRUST_PROXY`** | backend | Optional, **off by default**, and only for the single-origin reverse proxy. Makes Express read the client address from `X-Forwarded-For` (`1` = trust one hop). **The test is not "is there a proxy" but "can the caller also reach `:3000`".** Behind a Cloudflare Tunnel — where only `proxy:80` is routed — **set it**, or every request appears to come from the proxy and the login rate-limiter collapses to one global bucket, so ten wrong passwords from anywhere lock you out. On **Tailscale, leave it unset**: the tailnet exposes the whole machine, so `:3000` is directly addressable and a trusted header is forgeable by anything on it. The same proxy yields opposite answers on the two paths. |
| **`CRONSOLE_BACKEND_UPSTREAM`** | proxy | Optional. Where the bundled Caddy proxy forwards `/api` and `/socket.io`. Defaults to `host.docker.internal:3000`, which suits the normal host-run stack; set it to `backend:3000` when running the containerized `--profile docker` variant. A wrong value shows up as `502` on every API call. |
| **`CLOUDFLARE_TUNNEL_TOKEN`** | tunnel | Optional. Connector token from the Cloudflare Zero Trust dashboard, read by the `remote` Compose profile. Put it in the **repo-root `.env`** — it is a credential that authenticates a route into your machine. Deliberately declared with an empty default rather than as a required variable: Compose interpolates the whole file before selecting a profile, so a required one breaks *every* compose command, including starting Postgres ([troubleshooting #54](../troubleshooting/README.md#54-a-compose-profile-you-never-start-breaks-every-compose-command)). An unset token surfaces in `docker compose logs tunnel`. |
| **`CRONSOLE_SERVER_URL`** | agent | Backend URL the agent connects to (WSS-capable, e.g. `wss://cronsole.example.com`). Defaults to `http://localhost:3000`. Overrides `serverUrl` in appsettings.json. |
| **`CRONSOLE_PAIRING_SECRET`** | agent | Must equal the backend's `AGENT_PAIRING_SECRET`. Required **unless** set via `appsettings.json` — the agent exits if neither provides it. Overrides the file. |
| **`CRONSOLE_AGENT_ID`** | agent | Stable identifier for this agent. Defaults to the machine name. Overrides `agentId` in appsettings.json. |

> [!IMPORTANT]
> Secrets never belong in committed code. Copy `backend/.env.example` → `backend/.env` and
> `frontend/.env.example` → `frontend/.env.local` and fill in real values (both are gitignored).
> See the security conventions in [`AGENTS.md`](../../AGENTS.md) (§9) for how config is handled
> and encrypted at rest.

## 🐳 Docker vs. manual

- **Docker Compose (recommended)** — `docker compose --profile docker up --build` from the repo
  root brings up Postgres, the backend, and the frontend with sane defaults. Best for
  getting running fast. **Migrations apply themselves** on every boot (`predev`/`prestart` run
  `prisma migrate deploy`), so a fresh clone needs no schema step
  ([#90](../troubleshooting/README.md#90-a-fresh-clones-docker-quick-start-dies-with-the-table-publicuser-does-not-exist)).
- **Manual** — run each service yourself when you're developing or debugging a single
  layer. See [Run it manually](#run-it-manually-no-docker) below. This is the only page that
  writes the manual path out; the install guides, `CONTRIBUTING.md` and the root README link here.

> [!IMPORTANT]
> **`--profile docker` is not optional.** Backend and frontend sit behind an opt-in profile
> (`profiles: ["docker"]` in `docker-compose.yml`), so a plain `docker compose up` starts
> **Postgres only** and nothing answers on `:7373`. Omit the profile only when you
> intend to run the backend and frontend as host processes — the manual path below. *(This is
> the canonical copy of this warning; other docs link here rather than repeat it.)*

> [!IMPORTANT]
> **The three secrets generate themselves.** Leave `JWT_SECRET`, `ENCRYPTION_KEY` and
> `AGENT_PAIRING_SECRET` empty and the backend creates each on first boot, writes it to
> `backend/.env` and says so in its log. That holds for the Docker stack too:
> `docker-compose.yml` carries no default values, and `./backend` is mounted into the
> container, so the file lands in your checkout. A value in the host environment or a
> root `.env` still wins over the file. Until 2026-11-11 Compose shipped published
> default values instead; the backend now replaces those wherever it finds them.

### Run it manually (no Docker)

The backend and frontend run as host Node processes; only the database needs to come from
somewhere. This is the same shape `scripts/cronsole.ps1 up` runs on Windows
([below](#-controlling-the-stack-one-command)) — once steps 1–3 are done, that script can
start and keep everything up for you.

**1. A PostgreSQL 16 database.** Either your own instance, or the one in Compose — without
the profile, `docker compose up -d` starts just Postgres:

```bash
docker compose up -d          # db on localhost:5432 (role + database: taskhub)
```

**2. Backend secrets.** The backend **refuses to start** without them, so this step is not
optional:

```bash
cd backend
cp .env.example .env
```

Then fill in `backend/.env` (the [table above](#-key-environment-variables) has every variable):

| Variable | Rule | Generate |
|:---|:---|:---|
| `DATABASE_URL` | Already points at the Compose database; change it for your own instance. | — |
| `JWT_SECRET` | Leave empty to have it generated on first boot. Your own: ≥ 16 chars | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `ENCRYPTION_KEY` | Leave empty to have it generated on first boot. Your own: **exactly** 32 chars | `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |
| `AGENT_PAIRING_SECRET` | Leave empty to have it generated on first boot. Your own: ≥ 16 chars; the agent must use the same value | `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |

**3. Run each piece**, one terminal each:

```bash
# Backend
cd backend
npm install                 # postinstall runs `prisma generate`
npm run dev                 # http://localhost:3000 — `predev` applies migrations first

# Frontend
cd frontend
npm install
npm run dev                 # http://localhost:7373 (calls VITE_API_URL, default :3000)

# Windows agent (Windows only) — first copy appsettings.example.json to
# appsettings.json and set pairingSecret to the backend's AGENT_PAIRING_SECRET
cd agent/Cronsole.Agent
dotnet run                  # connects out to the backend
```

- `npm run dev` is what both `cronsole.ps1` and the Compose backend run. **`npm start` is the
  compiled build** (`node dist/index.js`, with `prestart` migrating) and needs `npm run build`
  first — on a fresh clone there is no `dist/` and it fails.
- `npx prisma migrate dev` is only for **authoring** a new migration from a `schema.prisma`
  change; `deploy` never generates one. Prisma 7's `migrate dev` no longer regenerates the
  client, so follow it with `npx prisma generate`.
- `frontend/.env.local` is optional: copy `frontend/.env.example` only to change
  `VITE_API_URL`. Leave `VITE_DEV_TOKEN` empty — the first load asks you to create the owner
  account.
- Agent configuration (file vs. env vars) is under [Agent connection & pairing](#-agent-connection--pairing).

### Changing the backend URL from the dashboard

`VITE_API_URL` is only the default. In the running app, open **Settings → About → API origin**
to point the dashboard at another backend without rebuilding the frontend. Cronsole stores that
browser-local override in `localStorage`, updates REST calls and the live `/ui` Socket.IO
channel immediately, and **Reset** returns to the `VITE_API_URL` default.

## 🎛️ Controlling the stack (one command)

The local stack is four pieces — Postgres (Docker), the backend and
frontend dev servers (host), and the Windows agent (host `.exe`). Rather than
starting/checking each one, use the single control script:

```powershell
pwsh scripts\cronsole.ps1 status   # one table: every service + API health, ALL UP / PARTIAL / DOWN
pwsh scripts\cronsole.ps1 up       # start whatever's down (idempotent)
pwsh scripts\cronsole.ps1 restart  # bounce the app tier
pwsh scripts\cronsole.ps1 down     # stop backend + frontend + agent
```

Postgres carries `restart: unless-stopped`, so it self-heals after a crash
or reboot; the auto-start scheduled task re-runs `cronsole up` every 5 minutes to
recover the rest. See [`scripts/README.md`](../../scripts/README.md) for details.

## 🤝 Agent connection & pairing

The Windows agent opens an **outbound** WebSocket to the backend — it never accepts
incoming connections. The connection is **authenticated**: the agent proves it holds the
shared pairing secret via an HMAC handshake (the backend rejects any socket that can't), and
the backend signs every task command so the agent only executes commands it can verify.

Configure the agent one of two ways (env vars **override** the file, so a deployment can set
them without editing anything):
- **`agent/Cronsole.Agent/appsettings.json`** (recommended for local dev) — copy
  `appsettings.example.json` to `appsettings.json` and set `pairingSecret` (and optionally
  `serverUrl`/`agentId`). This file is gitignored so the secret isn't committed, and you
  don't have to re-export anything each run.
- **Environment variables** — `CRONSOLE_SERVER_URL` (WSS-capable), `CRONSOLE_PAIRING_SECRET`,
  `CRONSOLE_AGENT_ID`.

Either way the secret must match the backend's `AGENT_PAIRING_SECRET`. A per-user **pairing-code flow**
(vs. today's single shared secret) is tracked on the [Roadmap](../ROADMAP.md) go-public
checklist.

For installing, registering, verifying, and troubleshooting the agent itself, see the
[**🤖 Windows Agent Setup Guide**](../user-guides/guides/Agent_Setup_Guide.md).

## ✅ Verify your configuration

- Backend healthy: `GET http://localhost:3000/api/health` → `{ "status": "ok", ... }`.
- Dashboard reading live data: it shows **your** tasks once the agent has synced.
- Agent connected: **Windows Task Scheduler** in the dashboard's source rail carries a green dot.

> [!TIP]
> Something not coming up? Check [**🧯 Troubleshooting**](../troubleshooting/README.md) — it
> has symptom → cause → fix entries for the boot/auth issues we've hit (crash-looping
> backend, `403 Invalid or expired token`, ports that look alive but don't respond).

---

<p align="center">
  <a href="../install/README.md">← Installation</a> ·
  <a href="../user-guides/README.md">Next: User Guides →</a>
</p>
