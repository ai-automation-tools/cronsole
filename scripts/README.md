<h1 align="center">🔧 Scripts</h1>

<p align="center">
  <em>Operational scripts for running Cronsole on your machine.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shell-PowerShell-5391FE?style=for-the-badge&logo=powershell&logoColor=white" alt="PowerShell">
</p>

---

Helper scripts that automate running Cronsole locally. Each subfolder has its own README with
the full details.

## 📂 In this folder

| Script | What it does |
|:---|:---|
| **`cronsole.ps1`** | **Single control surface** for the whole local stack — one command to bring it up, take it down, restart it, or see one combined status. Use this instead of hunting for which service is down. |
| **`setup-skill-links.ps1`** · **`.sh`** | Link the tracked [**🧠 skills/**](../skills/README.md) into `.claude/skills/` so Claude Code loads them. **Run once per fresh clone**; idempotent. See below. |
| **`Republish-Agent.ps1`** | **Rebuild + republish the .NET agent** (stop → `dotnet publish` → relaunch). The agent never hot-reloads, so run this after **any** `agent/` change or you'll debug a stale agent ([troubleshooting #7](../docs/troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished)). Needs elevation — or register the on-demand task below and skip that. Logs to `%TEMP%\cronsole-republish.log`. |
| **`publish-registry.ps1`** | Mirror the generated `registry/` + `registry-site/` to the public `cronsole-registry` repo (GitHub Pages). Does **not** regenerate — run `npm run registry:build` in `backend/` first. |
| **`publish-frontdoor.ps1`** | Mirror the same `registry-site/` page to the public `cronsole-site` repo — Cronsole's front door at `cronsole.mikesailab.com`. One page, two hosts. Excludes `README.md` and `CNAME`, which the target repos own. |
| **`check-control-bytes.mjs`** | Fail on any literal control byte in a text file — tracked **and** untracked-but-not-ignored (a NUL once made a security-relevant file diff as binary; scanning only tracked files left new files invisible until the very commit that added them, see [#32](../docs/troubleshooting/README.md#33-a-rename-pass-silently-disables-the-back-compat-it-just-added--and-rewrites-the-tests-too)). Wired into CI as the `repo-hygiene` job. |
| **`check-doc-links.mjs`** | Fail on any markdown link pointing at a file or heading that does not exist — **1298 links across 147 files**. A broken doc link does not 404: GitHub serves the page scrolled to the top, so a renamed heading silently starts delivering the wrong section and nothing anywhere reddens. The TaskHub rename left **13** dead links across `CHANGELOG.md` and `troubleshooting/README.md` from 2026-07-31 to 2026-08-17, through every green CI run. Wired into the `repo-hygiene` job. **Distinct from [`docsLinks.test.ts`](../frontend/src/data/__tests__/docsLinks.test.ts)**, which checks the links the *app* sends users to (`help.ts`, `onboarding.ts`); this one checks doc → doc, which that test cannot see. |
| **`rename-stage1.mjs`** · **`rename-stage2.mjs`** | The scripted TaskHub → Cronsole rename (2026-07-31), kept so **stage 3 is a diff to a protection list rather than a fresh judgement call**. Stage 1 renamed in-repo identity only; stage 2 renamed what the machine points at. Each has an explicit `PROTECTED` list with a comment per entry explaining what would break. `--dry` reports without writing. |
| [**🚀 startup-task/**](startup-task/README.md) | The logon **auto-start** launcher — brings up the entire local stack automatically at Windows logon via the `\Cronsole-Stack\` scheduled tasks (`CronsoleAgent` fires once at logon; `CronsoleStack` re-runs `cronsole.ps1 up` **every 5 minutes** as a self-heal). It now delegates to `cronsole.ps1 up`, so boot and manual control share one code path. |

## 🎛️ Controlling the stack (`cronsole.ps1`)

The local stack is five pieces: **Postgres + Redis** (Docker, auto-restart), the
**backend** and **frontend** dev servers (host Node), and the **Windows agent**
(host `.exe` — it needs Task Scheduler access, so it can't be containerized).
`cronsole.ps1` controls and reports all of them at once:

```powershell
# from anywhere
pwsh scripts\cronsole.ps1 status     # one table: every service, and how it was checked
pwsh scripts\cronsole.ps1 up         # start whatever's down (idempotent — safe to re-run)
pwsh scripts\cronsole.ps1 restart    # stop the app tier, then bring it back
pwsh scripts\cronsole.ps1 down       # stop backend + frontend + agent (leaves db/redis up)
pwsh scripts\cronsole.ps1 down -All  # ...also stop the Docker db/redis (+ proxy) containers
pwsh scripts\cronsole.ps1 logs       # tail the backend/frontend logs

pwsh scripts\cronsole.ps1 remote on  # publish the dashboard through the proxy, and KEEP it published
pwsh scripts\cronsole.ps1 remote off # stop publishing it
pwsh scripts\cronsole.ps1 remote     # say which this machine is
```

**`remote` is the durability half of remote access.** The reverse proxy is opt-in by design
(compose profile `proxy`, [§9](../CLAUDE.md)), so nothing starts it by accident — but that also
means nothing restarted it after a `docker compose stop`, and `restart: unless-stopped` deliberately
does not undo a deliberate stop. `remote on` starts it *and* records the choice in `.cronsole-remote`
(gitignored, per-machine), which is what lets `up` — and therefore the 5-minute self-heal — bring it
back. Without that marker the tailnet URL stays 502 until a human notices, which took two days
([#70](../docs/troubleshooting/README.md#70-the-tailscale-url-is-dead-for-days-while-every-other-service-is-healthy)).
A machine that has opted in grows a **`Proxy :8080`** row in `status`; one that has not shows no row
at all, because a check with nothing to measure is omitted rather than rendered as a pass.

`status` prints **ALL UP**, **DEGRADED**, **PARTIAL (n/5** — n/6 once `remote` is on**)**, or **DOWN** so you can
tell at a glance. Docker db/redis carry `restart: unless-stopped`, so they recover
from a crash or reboot on their own; the backend/frontend recover on the next
auto-start self-heal (or immediately with `cronsole up`).

> [!IMPORTANT]
> **Every service is checked by asking the service, never by checking whether a port
> is bound** — `GET /api/health` for the backend, an HTTP `GET /` for the frontend,
> the docker healthcheck or `pg_isready` for Postgres, a RESP `PING` for Redis. The
> port is corroboration only, and each row prints **the signal it used**. A port
> check alone has been wrong in both directions here: it once reported a dead
> container's held port as *"backend already up"* and refused to start the real one
> ([#23](../docs/troubleshooting/README.md#23-network-error-after-a-reboot--the-database-system-is-starting-up)),
> and later reported four services **down** while all four were serving HTTP
> ([#23a](../docs/troubleshooting/README.md#23a-and-the-same-probe-reported-four-services-down-while-all-four-were-serving)).
> Where something is present but cannot be confirmed to be serving, `status` says
> **`WARN`** — not a confident UP or DOWN.

> [!IMPORTANT]
> Paths in these scripts are **machine-specific** — `Start-Cronsole.ps1` and the task XMLs
> hardcode this machine's Node, Docker, and repo paths (and the task XML embeds a user SID).
> Adjust them before using on another machine.

## 🧠 Linking the skills (`setup-skill-links.ps1` / `.sh`)

The Cronsole Agent Skill lives canonically at the repo-root [**`skills/`**](../skills/README.md)
(tracked). Claude Code, though, only loads skills from **`.claude/skills/`**. This script
bridges the two with a per-machine link, so the agent reads the tracked source directly and
**no second copy exists to drift**:

```powershell
pwsh scripts\setup-skill-links.ps1     # Windows  — junctions (no admin / Developer Mode needed)
```

```bash
./scripts/setup-skill-links.sh          # Linux / macOS — symlinks
```

Run it **once per fresh clone**, and again after adding a skill. It's idempotent, links only
folders that contain a `SKILL.md`, refuses to clobber a real directory, and leaves the other
skills committed under `.claude/skills/` alone.

> [!WARNING]
> **Each linked skill needs a `.gitignore` line** (`/.claude/skills/<name>/`). cronsole
> **tracks** `.claude/skills/`, so git follows the junction and would commit the skill content
> **twice** — once under `skills/`, again under `.claude/skills/`. The script checks this and
> warns if an entry is missing. Sibling repos don't hit this because they ignore their whole
> CLI tree.

## 🗄️ Backend-local scripts

A script that needs Prisma has to run from `backend/` (the generated client lives in its
`node_modules`), so those live in [**`backend/scripts/`**](../backend/scripts/) and are
invoked through npm:

```powershell
cd backend
npm run db:check      # read-only: what the database actually contains
```

`db:check` prints the generated-client currency **first** — a client missing an enum member
silently drops writes to it, which makes every count below it a claim rather than a fact
([#22](../docs/troubleshooting/README.md#22-deleted-a-windows-task-synced-and-cronsole-still-shows-it--while-reporting-missing-n))
— then task counts by platform and status, exclusions, template provenance (managed vs.
imported), and the run log. It writes nothing.

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
