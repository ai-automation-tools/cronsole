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
| **`setup-skill-links.ps1`** · **`.sh`** | Link the tracked [**🧠 skills/**](../skills/README.md) into `.claude/skills/` so Claude Code loads them. **Run once per fresh clone**; idempotent. See below. |
| **`Republish-Agent.ps1`** | **Rebuild + republish the .NET agent** (stop → `dotnet publish` → relaunch). The agent never hot-reloads, so run this after **any** `agent/` change or you'll debug a stale agent ([troubleshooting #7](../docs/troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished)). Needs elevation — or register the on-demand task below and skip that. Logs to `%TEMP%\taskhub-republish.log`. |
| **`publish-registry.ps1`** | Mirror the generated `registry/` + `registry-site/` to the public `taskhub-registry` repo (GitHub Pages). Does **not** regenerate — run `npm run registry:build` in `backend/` first. |
| **`publish-landing.ps1`** | Mirror `landing-site/` to the public `taskhub-site` repo. |
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

## 🧠 Linking the skills (`setup-skill-links.ps1` / `.sh`)

The TaskHub Agent Skill lives canonically at the repo-root [**`skills/`**](../skills/README.md)
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
> **Each linked skill needs a `.gitignore` line** (`/.claude/skills/<name>/`). taskhub
> **tracks** `.claude/skills/`, so git follows the junction and would commit the skill content
> **twice** — once under `skills/`, again under `.claude/skills/`. The script checks this and
> warns if an entry is missing. Sibling repos don't hit this because they ignore their whole
> CLI tree.

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
