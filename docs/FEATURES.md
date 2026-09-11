<h1 align="center">📊 Features</h1>

<p align="center">
  <em>What Cronsole actually does, once your tasks are in it.</em>
</p>

<p align="center">
  <a href="STATUS.md"><img src="https://img.shields.io/badge/what_works-STATUS-F59E0B?style=for-the-badge" alt="Status"></a>
  <a href="ROADMAP.md"><img src="https://img.shields.io/badge/plan-ROADMAP-8B5CF6?style=for-the-badge" alt="Roadmap"></a>
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-repository_root-6B7280?style=for-the-badge" alt="Repository root"></a>
</p>

---

Which of these work on which platform is a separate question, answered by
[**What it connects to**](../README.md#-what-it-connects-to) and, per source, by the app's own
**Platforms** tab. What is not built yet is in [**Status**](STATUS.md).

| Capability | What it gives you |
|:---|:---|
| **Unified dashboard** | Every synced task in one view, with platform and status badges, across grid / list / kanban / schedule / calendar layouts. Each card says **when the task runs** in plain words — *"Daily at 8:00 AM PDT"*, read in your own timezone — so you don't have to open a task to find out, and the **calendar** puts a month or a week of actual firings on a grid. |
| **Favorites & collections** | Star the handful of tasks you actually watch — **Favorites** is a row on the source rail, so it *composes* with whatever view is lit (Failures + Favorites is your failing starred tasks) rather than replacing it. A **collection** goes further: it stores *the tasks themselves*, not a filter, so you can name a set containing two Claude routines and two Windows tasks that share no property any filter could match. Neither ever narrows the dashboard behind your back — a bare URL opens on everything. |
| **Trigger from anywhere** | Hit **Run Now** on any Windows task from your desk or phone — the request relays down to the agent on your machine. Cronsole is local-first, so reaching it from a phone is an opt-in step: [**Remote Access**](user-guides/guides/Remote_Access_Guide.md) ships a single-origin reverse proxy you put behind Tailscale or a Cloudflare Tunnel, keeping the dashboard off the public internet. |
| **Live sync** | The local agent keeps Cronsole in step with Windows Task Scheduler automatically, and self-heals if the connection drops. |
| **Cronsole-native tasks** | Jobs Cronsole runs itself, no OS scheduler involved: call an **HTTP** endpoint, run an **existing program**, run a **script you write here** (PowerShell · pwsh · Bash · sh · Python · Node — the body is stored in Cronsole, so it needs nothing on disk), or run a **check** that asserts an endpoint, port, file freshness or disk space is what you expect. A check's failure is a fact about your system rather than a bug in a script, which is what makes it worth alerting on. |
| **Template library** | 90+ ready-to-use script starters and use-case patterns, in 9 downloadable packs — including the **Developer Pack** and AI CLI packs for Claude Code + Codex; fill in the blanks and Cronsole creates a real scheduled task. Backed by a versioned, hosted [template registry](reports/templates/Registry_Schema_v1.md) so the catalog updates independently of the app. **Grow it without a reseed**: export/import templates as JSON, or **Save as template** straight from a real task. |
| **AI-native control (MCP)** | Drive Cronsole from Claude, Codex, or Cursor in plain language — list, run, and create tasks through the [MCP server](user-guides/guides/MCP_Server_Guide.md), a thin wrapper over the same API the dashboard uses. |
| **Honest platform status** | A health strip on the dashboard says whether each platform is reachable, how long ago your task list was **really** synced, and what the last command Cronsole sent did — including when it failed. The **Platforms** tab goes further: every capability reads *verified* (it has worked on this machine, with the timestamp), *declared* (never tried here) or *unsupported*. Nothing claims a capability it hasn't demonstrated. |
| **Diagnose it in the app** | When something looks wrong, **Diagnose** on the dashboard checks Cronsole itself — the agent connection, the database, the scheduler, the template catalog, token expiry — and shows **the evidence behind each verdict** rather than a colour. *"Agent offline"* is one sentence covering four different situations; this tells you which, down to when a request last timed out and which one. Read-only: it diagnoses, it never silently "fixes" things. |
| **Run history** | Per-task history (status, time, duration, log snippet); failed runs are flagged right on the dashboard. |
| **Search & organize** | Free-text search plus local categories to keep a big task list navigable. Windows' own `\Microsoft\` tasks — which outnumber yours roughly 3:1 on a real machine — are hidden by default, and the filter tells you how many it's holding back. |
| **Back up & restore** | Save every scheduled task on the machine as native Task Scheduler XML — including the ones you never imported, which are the ones nothing else is holding — then put them back. Restore **shows you a plan first**: what it would create, replace, skip, or refuse, checked against what is really on the machine, before anything is written. |
| **Import & recover a task** | Recreate a Cronsole-native task from a `.json` you exported — on another machine, or on this one after deleting it. Cronsole archives a native task's definition **before** deleting it and refuses the delete if it cannot, so a deleted task can be rebuilt from the Tools tab. What you get back is a **new** task on the same schedule, not the old one revived — its run history stays with the archive. |
| **Remove without destroying** | **Remove from Cronsole** takes a task off your dashboard and leaves it running on the machine; **Delete from Windows** is the separate, clearly-marked verb that actually destroys the scheduled task. Undoing an over-broad import never costs you an automation. |
| **Dark & light themes** | Dark by default, with light and system-follow modes persisted per device. |

---

<p align="center">
  <a href="README.md">← Docs home</a> ·
  <a href="STATUS.md">Status</a> ·
  <a href="ROADMAP.md">Next: Roadmap →</a>
</p>
