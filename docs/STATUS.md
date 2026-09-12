<h1 align="center">📍 Status</h1>

<p align="center">
  <em>What actually works today, where it runs, and what isn't built yet.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/status-MVP_Prototype-F59E0B?style=for-the-badge" alt="Status: MVP Prototype">
  <a href="ROADMAP.md"><img src="https://img.shields.io/badge/plan-ROADMAP-8B5CF6?style=for-the-badge" alt="Roadmap"></a>
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-repository_root-6B7280?style=for-the-badge" alt="Repository root"></a>
</p>

---

Cronsole is **pre-1.0** and honest about it. Per-source capability is in
[**What it connects to**](../README.md#-what-it-connects-to) — that table is the same declaration
the app's own **Platforms** tab renders (`backend/src/services/platformCapabilities.ts`), so if it
and the app ever disagree, the app is right and the table is the bug. What that table does *not*
answer is the two questions a new reader actually has.

## 🖥️ Will it run on my machine?

| | |
|:---|:---|
| **Windows 10 / 11** | ✅ Fully supported — the agent talks to Task Scheduler directly |
| **macOS / Linux** | 🟡 Partial. The backend, database and dashboard run anywhere Docker does, and every source that is reached over HTTP works normally. What is missing is the **agent**: nothing yet drives launchd, cron or systemd timers. One POSIX agent covering all three is the next major piece of work |
| **Phone / tablet** | ✅ The dashboard is mobile-first. Reaching it from another device is [opt-in remote access](user-guides/guides/Remote_Access_Guide.md), never a public URL |

## 🚧 What isn't there yet

Listed because finding out later is worse than reading it now:

| | |
|:---|:---|
| **No installer — by design** | Cronsole ships as **source**: clone the repo, or run the Docker stack. There will be no MSI and no downloadable binary. A signed installer would mean a code-signing certificate and a release channel to defend; for a tool whose whole claim is that it runs on your machine and tells you the truth, *"read the source you are running"* is the stronger answer. **The cost is real:** you need git, Docker (or Node + PostgreSQL + the .NET SDK), and a PowerShell prompt as Administrator. If that is not you, Cronsole is not yet for you |
| **Single user** | One owner account, created on first run. No password reset, no refresh tokens, no roles — and, by design, no open registration |
| **Local-first, no hosted version** | There is no cloud Cronsole to sign up for, and that is a decision rather than a gap. Your data stays on your machine |
| **No release channel yet** | Pre-1.0: fixes land on `main`, and there are no back-ported release branches |
| **Backups are yours to run** | Nothing backs up the database for you. It holds Cronsole's *view* — tracked rows, collections, run history, and the pre-delete archives that are the **only** copy of a task you removed — so losing it loses the dashboard rather than your jobs, which keep running on their own platforms. One `pg_dump` covers it, and it can be scheduled as a Cronsole job: [**Backup & Restore**](user-guides/guides/Backup_Restore_Guide.md) |
| **Removing Cronsole does not remove your tasks** | `docker compose down -v` deletes Cronsole's database. The scheduled tasks it created keep running — they are ordinary Windows tasks and Cronsole never owned them. The full sweep is in [**Trust**](TRUST.md#6-how-to-remove-it-completely) |

Full detail, dated and prioritized, is in the [**Roadmap**](ROADMAP.md). What *is* built is in
[**Features**](FEATURES.md).

---

<p align="center">
  <a href="README.md">← Docs home</a> ·
  <a href="FEATURES.md">Features</a> ·
  <a href="ROADMAP.md">Next: Roadmap →</a>
</p>
