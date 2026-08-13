<h1 align="center">⚙️ Manage Existing Task Prompts</h1>

<p align="center">
  <em>Run one now, park one, move its schedule, repoint its command, rename it —
  the reversible half of the toolbox.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tools-reversible-2ea44f?style=for-the-badge" alt="Reversible tools">
  <img src="https://img.shields.io/badge/gating-none-6B7280?style=for-the-badge" alt="Ungated">
</p>

---

Everything here can be undone with another prompt, which is why none of it is gated. That's a
deliberate shape: if pausing a task were behind a switch, the path of least resistance would be
editing the cron to a time that never comes — a schedule nobody can read six months later, and
a worse outcome than the thing the gate was protecting against.

## ▶️ Run it now

```text
Using Cronsole, run the "Sync AI Documents Repos" task right now and tell me
whether it succeeded.
```

```text
Using Cronsole, run "Weekly System Cleanup" now, then check its run history to
confirm it actually completed rather than just started.
```

```text
Using Cronsole, I've just changed the script behind "Nightly Backup". Run it once
now so I find out tonight's failure this afternoon instead.
```

## ⏸️ Park and unpark

```text
Using Cronsole, disable "Daily Market Summary" for now — I'll turn it back on
later. Don't change its schedule.
```

```text
Using Cronsole, re-enable every task in the "Reports" category that I disabled
last month, and tell me when each one next runs.
```

```text
Using Cronsole, "Data Import" has failed four nights running. Disable it so it
stops filling my log, and show me the last failure before you do.
```

## 🗓️ Change the schedule

```text
Using Cronsole, re-schedule "Weekly PR Creator" to weekdays at 6pm Pacific.
Check the conversion first and show me the resulting trigger.
```

```text
Using Cronsole, my uptime check runs every minute and it's too chatty. Move it to
every five minutes.
```

```text
Using Cronsole, I want "Monthly Archive" on the last working day of the month.
Tell me honestly whether that converts to a Windows trigger cleanly — if it
doesn't, suggest the nearest thing that does rather than accepting a fallback.
```

That last one matters on Windows. An expression the converter can't express natively is
**replaced** with an hourly trigger, and the warning about it is easy to skim past. On
Cronsole-native tasks the cron is used exactly as written, so the question doesn't arise.

## ✏️ Change what it runs

```text
Using Cronsole, the command for "Update AI Lab Repos" points at the wrong script.
Show me its current action, then repoint it at
D:\AI_Agents\_maintenance\update-repos.ps1 — keep everything else the same.
```

```text
Using Cronsole, add --verbose to the arguments of "Nightly Reconcile". Read the
current action first so nothing else gets reset.
```

```text
Using Cronsole, my native HTTP check should POST rather than GET, with a JSON
body. Show me the current job spec, then update it and tell me what the change
discards.
```

> [!WARNING]
> Both edit verbs **replace** rather than patch. `update_task_action` rewrites the Windows
> action, and `update_native_job` replaces the whole native job spec — an HTTP job switched to a
> script job keeps nothing of its URL and headers. Always ask to see the current definition
> first; a good assistant will read it unprompted, and it costs one extra call to be sure.

The two are separate tools because they're separate operations. Editing a Windows action asks
the elevated agent to rewrite a task on your machine and records nothing until the platform
confirms. Editing a native job rewrites a database row that **is** the task — nothing can refuse
it, and it works with the agent offline.

## 🏷️ Rename

```text
Using Cronsole, rename "New Task (2)" to "Quarterly Invoice Export" on the
dashboard.
```

```text
Using Cronsole, rename these three imported tasks to something I'll recognize —
and confirm that renaming changes nothing on the machine itself.
```

A rename is a **Cronsole label only**. Nothing is renamed in Task Scheduler: a Windows task's
name is the last segment of its path, and the path is its identity, so renaming there would
produce a *different task* rather than a new name on this one. The dashboard keeps the real
path on screen once the two diverge, which is what stops you searching Task Scheduler for a name
that was never there.

## 🔄 Keep things in sync

```text
Using Cronsole, sync my tasks and tell me what changed since the last pass.
```

```text
Using Cronsole, I created a task in Task Scheduler by hand this morning. Sync and
import it into the \Work category so it shows up alongside the rest.
```

## 🧰 What's not on this surface

A few management actions are dashboard or REST only, on purpose:

| Action | Where | Why not MCP |
|:---|:---|:---|
| **Favorites** | Dashboard, REST | A star is a UI preference; the task list doesn't even carry it |
| **Bulk status / recategorize / untrack** | Dashboard, REST | Friction has to scale with blast radius, and past 25 tasks the UI asks you to type the count — a gesture a tool call has no equivalent for |
| **Agent pairing** | Setup, REST | It's how trust is established, not something to hand an assistant |

```text
Using Cronsole, I want to disable 40 tasks at once. Tell me why that isn't an MCP
operation and point me at the Mass Actions console instead.
```

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Working out what needs managing in the first place. |
| [**🧹 Cleanup & removal**](cleanup-and-removal.md) | When "manage" turns into "get rid of". |
| [**🖥️ UI User Guide**](../../user-guides/guides/UI_User_Guide.md) | Bulk actions, favorites, and the confirmations they carry. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="inspect-and-audit.md">Inspect & audit</a> ·
  <a href="cleanup-and-removal.md">Next: Cleanup & removal →</a>
</p>
