<a id="windows-top"></a>

<h1 align="center">🪟 Windows Task Scheduler</h1>

<p align="center">
  <em>The scheduler your machine already has, reached through the local Cronsole agent.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-controller-0078D4?style=for-the-badge" alt="Controller">
  <img src="https://img.shields.io/badge/needs-local_agent-F59E0B?style=for-the-badge" alt="Needs the agent">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

Windows has had a scheduler since NT. Cronsole does not replace it — it reads and writes the real
thing through a small .NET agent running on your machine.

**The tasks are genuine Task Scheduler entries.** They exist without Cronsole, they keep running when
Cronsole is off, and they run as your Windows user with whatever privileges that account has. Of the
six sources, this is the one to use for anything that must survive Cronsole being down.

## 🔌 Connecting

There is nothing to paste. Windows connects when the agent dials in, which is why its card on
*Available* has an explanation and no **Connect** button — nothing you could type would connect it.

1. Install and register the agent — [**Windows Agent Setup Guide**](../guides/Agent_Setup_Guide.md).
2. Start it. It opens the WebSocket to the backend; the server never connects in.
3. The Sources tab flips to **Connected** within a few seconds.

> [!IMPORTANT]
> **Run the agent elevated.** Started from an ordinary shell it cannot enumerate the ACL-protected
> folders — `\Microsoft\Windows\UpdateOrchestrator\`, `\TPM\`, `\Pluton\`, `\WindowsUpdate\` and a
> dozen more. On a real machine that is around 86 of 371 tasks, invisible with nothing erroring.
> Cronsole will not retire tasks it cannot see, so nothing breaks — but you are looking at a smaller
> machine than you have. `\Cronsole-Stack\CronsoleStack` starts it at `RunLevel: Highest`.

## 📥 Getting your tasks in

Windows is the one source with a discovery step, because a machine has hundreds of tasks and almost
none of them are yours.

**Dashboard → Add tasks from this machine.** The agent enumerates every folder it can see and you
pick which to track. A folder is the unit — pick `\AI-Maintenance\` and you get everything in it,
now and later.

**Sync afterwards** refreshes what you already track. It creates rows for new tasks inside tracked
folders, and it will not adopt a folder you never picked. Those are two different requests on
purpose: naming a folder is the gesture that starts tracking it, and a routine refresh that quietly
adopted new folders would undo a deliberate removal.

## 🎛️ What Cronsole can do here

The fullest set of any source. All of it needs the agent online — it is the only thing that can touch
Task Scheduler.

| Verb | What it does |
|:---|:---|
| **Sync** | Refresh tracked folders: new tasks, changed schedules, enabled state, last result. |
| **Run now** | Ask the agent to start the task. Signed per session with an HMAC. |
| **Create** | A real Task Scheduler entry, cron converted to a native trigger, action structured as `{executable, args[]}` — no shell unless you invoke one. |
| **Enable / disable** | Flips the task's own enabled state on the machine. |
| **Edit schedule** | Rewrites the trigger. Cronsole warns when a cron cannot be expressed natively. |
| **Edit action** | Changes what it runs. |
| **Export** | Task Scheduler XML (exact fidelity) or a portable template. |
| **Restore** | Plans from read-only reads first, so `dryRun` is a real preview. |
| **Delete** | Removes the real task, after writing a pre-delete archive. |
| **Run history** | The Operational event log, grouped into runs, with exit codes. |

## 📅 Schedules, and where they get lossy

Cronsole stores every schedule as **5-field cron in UTC**. Windows triggers are richer than cron in
some places and poorer in others, so the conversion is where surprises live.

- **A cron Windows cannot express natively is replaced with an hourly trigger** and Cronsole says so
  in a warning. It only ever runs *more* often than you asked — never less — but read the warning
  rather than the confidence score.
- **Across a daylight-saving change a Windows task keeps its local clock time.** A Cronsole-native
  task shifts by an hour, because Cronsole runs the stored UTC expression directly. Same cron, two
  behaviours, and the difference is real.
- Clock times in the app follow **Settings → Behavior → Schedule timezone**. Each cron field prints
  the stored UTC beside it, so you can always see both.

## 🕐 Reading run history

Two lists, never summed:

**Runs Cronsole performed** — your *Run now* clicks. A Windows task firing on its own schedule writes
nothing here, by design: this log means "Cronsole did this".

**Runs on the platform** — read live from the machine's own event log, including every scheduled run
Cronsole never triggered. Click one for its events and the action's exit code.

> [!WARNING]
> **Task history is a machine-wide switch and it is off by default on some installs.** A disabled log
> returns zero events — identical on screen to a task that has never run. Cronsole reports the
> difference as a third state rather than collapsing them, and says plainly that turning it on is
> **not retroactive**: the run you came to read is gone. Enable it in Task Scheduler → *Enable All
> Tasks History*.

A truncated oldest run is normal — the log is a ring buffer, so its opening event ages out. Cronsole
groups those leftovers as **one** partial run rather than inventing three.

## ⚠️ Things that surprise people

- **A folder is a category.** A task at `\Monitoring\Logs\Rotate` lands in `Monitoring`. Re-label the
  category in Cronsole and it stays re-labelled, but **nothing moves on the machine** — the two have
  then deliberately forked.
- **Renaming is a Cronsole label, not a rename on disk.** The real name is the last path segment, and
  that path is how every command addresses the task. Once the two differ, the task modal keeps
  showing the real path underneath.
- **"It ran successfully" from a manual run means "the agent accepted the start".** Whether the work
  *worked* is in `lastTaskResult` and the platform run history, not in that toast.
- **Cronsole only ever creates `\Cronsole`.** Two carve-outs exist — restore's `createFolders` and
  create's `createFolder` — both off by default, both signed, both naming every folder they made. A
  folder the elevated agent creates carries an administrator ACE, so *you* will need admin rights to
  delete it again. `\Microsoft\` is refused outright, in the backend and independently in the agent.
- **Untracking is not deleting.** *Remove from Cronsole* takes the row off your dashboard and writes
  an exclusion so the next sync does not bring it back. The task keeps running. **Delete from
  Windows** is the irreversible one and it is styled red.
- **Exported XML is UTF-16 LE with a BOM, always.** That is what Task Scheduler accepts; it is not a
  quirk you should normalize away.
- **Bulk export reads the machine, not your tracked subset.** `\Microsoft\` is excluded by default and
  **counted out loud**, so you can see what was left behind.

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| Dozens of tasks flip to MISSING in one sync, agent healthy | [#74 — the agent is unelevated](../../troubleshooting/README.md#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy) |
| Run history shows more runs than happened, or no exit code | [#85 — ring buffer and localized messages](../../troubleshooting/README.md#85-one-windows-task-shows-three-runs-that-never-happened-all-of-them-undated) |
| "Agent connected but not responding" over an agent that answers instantly | [#62 — the timeout that never cancelled](../../troubleshooting/README.md#62-windows-reports-not-responding-15-seconds-after-every-successful-request) |
| Sidebar says online and synced while every request times out | [#40 — a cached verdict](../../troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out) |

Before debugging your own setup, run **`/doctor`** or open **Tools → System diagnostics**. Three of
the four agent-health incidents in this repo's history were the *readout* lying rather than the agent
failing.

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Cronsole_Native.md">Next: Cronsole-native →</a>
</p>

<p align="right">(<a href="#windows-top">back to top</a>)</p>
