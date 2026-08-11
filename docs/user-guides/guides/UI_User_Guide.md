# Cronsole UI User Guide

Welcome to the **Cronsole** interface! This guide provides a comprehensive overview of how to navigate the dashboard, manage your scheduled tasks, and use advanced features like categorization and templates.

---

## 1. The Dashboard

The Dashboard is your "one pane of glass" for monitoring every scheduled task in your ecosystem.

### Task Cards
Each task is represented by a card showing:
- **Platform Badge:** Identifies where the task lives (e.g., Windows, Claude, or Cronsole-native).
*   **Status Indicator:** A green dot for `ACTIVE` tasks and a gray dot for `DISABLED` tasks.
*   **Local Category:** A folder icon showing the Cronsole-specific category.
*   **External ID:** The native path or ID used by the source platform.
*   **Last Updated:** The last time Cronsole synced state for this task.

### Quick Actions
- **Run Now (Play Icon):** Manually triggers the task immediately. This requires a confirmation dialog to prevent accidental triggers.
- **Clone (Copy Icon):** Duplicates a task as a starting point for a new one.
- **View Details:** Clicking anywhere on the card (except the action icons) opens the **Task Details** modal (see §2).

### Saved views
Across the top of the dashboard is a row of **views** — named filter combinations, so the question
you actually ask ("what's failing?", "what runs today?") is one click instead of four filters
rebuilt from scratch on every visit. Five ship built in:

| View | Shows |
|---|---|
| **My jobs** | Your active tasks — the default. Hides Windows' own tasks and anything disabled or missing. |
| **Failures** | Tasks the health check rates *critical* or *needs attention*. |
| **Due today** | Tasks whose next run falls on today's date, in your **schedule timezone** (Settings › Schedule timezone) so it agrees with the times printed on the cards. |
| **Disabled** | Only the tasks you've parked. Note this **isolates** them — it is not the same as the *Showing All* toggle, which merely stops hiding them. |
| **System** | Only the tasks Windows itself owns under `\Microsoft\`, which the dashboard hides by default. |

- **Saving your own:** change any filters and the row shows a **Custom** chip plus **Save view**. Name it and it becomes a chip of its own, with a count, kept between visits. Delete one with the `×` on its chip — that only removes the name; the tasks and the filters you're currently looking at are untouched.
- **Every view is a link.** The URL carries the view (`?view=failures`) or the individual filters, so you can bookmark one or paste it to another machine. A link to a saved view *someone else* made falls back to the normal dashboard rather than showing you nothing.
- **The counts are honest about what they don't know.** *Failures* is answered by the health check (the same one on the Tools tab), which has to read every task first. Until it finishes, the chip shows **`–`, not `0`** — because `0` would claim nothing is failing, and the app hasn't looked yet. A banner above the list says the same thing while it loads. A task with no run evidence at all counts as *unmeasured*, not as passing.
- **Changing a filter drops you to Custom.** The chip goes dark on purpose: once you narrow "Failures" to one category, the list is no longer what that label says it is.

### Views, Search & Filters
- **View modes:** Switch between **Grid**, **List**, **Kanban** (active vs. disabled columns), and **Schedule** (sorted by next run) using the toggle on the right. The layout is **not** part of a saved view — picking a view changes which tasks you see, never how they're drawn.
- **Search:** The search box filters by task name, category, path, command, and schedule. Press `/` to jump to it and `Esc` to clear; a match counter shows how many tasks matched.
- **Active Only:** Toggle to hide disabled tasks. It shows how many it's holding back (`12 hidden`) — that count includes **missing** and unknown-state tasks too, not just disabled ones. If a saved view has *isolated* one state instead, the button says so (`Disabled only`) in a third colour rather than pretending to be one of its two normal states; clicking it then shows everything again.
- **Personal / Incl. System:** Windows keeps hundreds of its own scheduled tasks under `\Microsoft\` — on a typical machine they outnumber yours roughly 3:1 — so once they're imported they drown out everything you actually care about. Cronsole hides them by default and says how many (`257 system hidden`); click to include them. The choice is remembered between visits, and the button only appears if you've actually imported some. This is **independent of Active Only**, so the normal view is *personal **and** active* — either can be turned off without touching the other. The **System** view sets a third state (`System only`) for as long as you're in it; that is a lens you look through, not a new default, so leaving the view gives you your own dashboard back.
- **Category & platform chips:** Filter to a single category or platform. These chips are **faceted** — they only show categories/platforms that actually have tasks *under the current filters* (with a live count), so turning on **Active Only** or a platform filter drops any now-empty tags instead of showing zero-count noise.

---

## 2. Task Details

Clicking a task card opens the **Task Details** modal, which has two tabs.

### Overview
Instead of raw data, the Overview parses the task's synced configuration into readable panels:
- **Summary:** Status, last result (success/failure), next run, and last run.
- **Schedule:** A human-readable description (e.g. *"Daily at 9:00 AM PDT"*) alongside the underlying cron expression. Schedules are **stored** in UTC but **read and written in your own timezone** — Pacific by default, changeable under Settings → Behavior → Schedule timezone. If Cronsole can't express the trigger as cron (boot, logon, event, or on-demand tasks), it says so honestly rather than guessing.
- **Action:** What the task actually runs — an HTTP request for Cronsole-native tasks, or the executable/arguments/working directory for Windows tasks. If your agent build doesn't yet report a task's action, the panel says so rather than showing a blank.
- **Settings:** Scheduler state, whether the task is enabled, the account it runs as, run level, logon type, author, and description — shown when the agent reports them.
- **Raw platform metadata:** The full untouched sync payload is still available under a collapsible section at the bottom.

### Run History
The second tab lists recorded runs with their status, timestamp, duration, and a log snippet — so you can answer "did it actually run, and did it work?"

## Changing many tasks at once

Every task row in every view carries a checkbox, and the toolbar has **Select all N shown**.
Shift-click extends a range from the last row you clicked, in the order you are looking at
them. Once anything is selected, a bar appears with **Enable** and **Disable**.

Three things the bar tells you on purpose:

- **Each button names what it will actually change**, not how many you selected. Select twelve
  tasks of which nine are already enabled and the button reads *Enable 3*.
- **It says when part of your selection is off screen.** The Kanban view shows disabled tasks
  the other three views hide, so switching views can leave selected tasks invisible. They stay
  selected and are still acted on — the bar says `12 selected · 3 not visible here` rather than
  quietly dropping them.
- **The result is reported per task.** Windows applies each change through the local agent, and
  some tasks refuse: one registered by an administrator needs elevation, one that has gone
  missing since the last sync has nothing to toggle, and one already in the state you asked for
  was simply left alone. The toast names every outcome — *"9 disabled · 2 already disabled · 1
  failed"* — instead of a single number that would hide the difference. **Anything that failed
  stays selected**, so you can retry without hunting for it again.

If the agent goes offline partway through, the run stops rather than working through the rest
one timeout at a time, and the remaining tasks are reported as not attempted.

### Editing a schedule
The modal footer shows **Edit Schedule** for Cronsole-native tasks and Windows tasks whose trigger can be represented as a cron expression. Cronsole-native edits update the backend scheduler immediately; Windows edits require the local agent because Cronsole changes the real Task Scheduler trigger first. Boot, logon, event, and on-demand Windows triggers stay read-only until Cronsole has a dedicated safe editor for those trigger types.

### Removing a task — two very different buttons
The modal footer offers **two** ways to make a task go away, and they are not interchangeable.

**Remove from Cronsole** *(the safe one)* — takes the task off your dashboard and forgets its
Cronsole run history. **The scheduled task itself is not touched:** it stays on the machine and
keeps running on its own schedule. Use this when you imported a folder you didn't mean to, or
when you simply don't want to look at a task any more.
- Future syncs **won't** pull it back — Cronsole remembers that you removed it, so a routine
  **Sync Now** can't silently undo your choice.
- To get it back, run **Import** and re-select its category. The Import modal shows an amber
  **+N removed** badge on any category that would bring removed tasks back, so you see the
  number before you commit, and the toast afterwards tells you how many returned.
- Not offered for Cronsole-native tasks — those exist only inside Cronsole, so there's nothing
  left to keep.

**Delete from Windows** *(the irreversible one, styled red)* — deletes the real Task Scheduler
entry. The task stops existing and will never run again.
- The real entry goes **first**, via the local agent; the Cronsole record only goes once the
  platform confirms — Cronsole never claims a task is gone while it still exists on your machine.
  If the agent is offline the delete is refused and the task stays.
- Some Windows tasks were registered by an elevated process and carry admin-only permissions;
  Cronsole will tell you when a task can only be deleted from an elevated Task Scheduler (or by
  running the agent elevated).
- For a **Cronsole-native** task the button is just **Delete** — it removes the task and its run
  history, and nothing exists outside Cronsole to clean up.

> [!TIP]
> If your goal is a tidier dashboard, you almost always want **Remove from Cronsole**. Deleting
> to clean up a view destroys automation that may have been running for years.

> **Note on schedule times:** every clock time in the app — the Schedule panel, the cron fields you type into, the preset chips, and absolute next/last-run timestamps — follows **Settings → Behavior → Schedule timezone**. It defaults to **Pacific**; you can pick another zone, your machine's, or UTC.
>
> Schedules are still **stored** as UTC cron, which is what the API, the MCP tools and Windows Task Scheduler see, so each cron field prints the stored UTC expression beside it. Two cases are called out rather than guessed at: a schedule pinned to a specific date whose conversion crosses midnight can't be expressed in cron, so it stays in UTC and says so; and across a daylight-saving change a **Windows** task keeps its local clock time while a **Cronsole-native** task shifts by an hour, because Cronsole runs the stored UTC expression directly.

---

## 3. Task Categorization & Organization

Cronsole allows you to organize tasks into local folders (categories).

### Automatic Initial Categorization
When you first sync with a platform (like Windows Task Scheduler), Cronsole **automatically imports the existing folder structure**. 
- A Windows task at `\Microsoft\Windows\UpdateOrchestrator\Reboot` will be automatically placed in the `Microsoft\Windows\UpdateOrchestrator` category.
- This gives you an organized starting point that mirrors your current environment.

### Local Overrides
Your categorization in Cronsole is **local and persistent**. 
- If you move a task to a "Critical" category in Cronsole, it will **stay there** even after subsequent syncs. 
- Cronsole will not overwrite your manual categorization with the source platform's folder structure once the task is imported.

### Viewing Categories
At the top of the Dashboard, you'll see a horizontal chip bar:
- **"All":** Shows every task (within the current Active Only / platform filters).
- **Dynamic chips:** Each category that has matching tasks appears as a filterable chip with a count. Categories with no tasks under the current filters are hidden.

### Re-categorizing a Task (Two Ways)
1. **Directly on the Card:**
   - Hover over the **Folder Icon** or the category text.
   - Click the text to turn it into an input field.
   - Type your new category name and press **Enter** to save.
2. **Inside the Task Modal:**
   - Click a task card to open the modal.
   - Look for the **"Local Category"** section.
   - Click **"Change"**, type the new name, and press **Enter** or click **Save**.

---

## 4. Templates

The **Templates** tab is a library of prebuilt automation patterns, organized into two groups:
- **Starters:** Parameterized building blocks (PowerShell / Python / shell script, HTTP ping, …). You fill in the blanks (script path, URL, arguments) when applying.
- **Use-case patterns:** Ready-made automations for common jobs (e.g., *Daily Database Backup*, *Morning News Digest*).

### Finding a template
- **Search:** Free-text search across name, description, command, category, and script type.
- **Type toggle:** Show **All**, only **Starters**, or only **Patterns**.
- **OS & Tags filters:** Faceted chips (with counts) narrow by operating system and category tag. Like the Dashboard chips, they only show combinations that actually have templates, and collapse when a single choice remains. Use **Clear** to reset everything.

### Applying a template
- Each card shows its target platforms, script type, intended schedule — read in your schedule timezone, the same reading the Apply modal pre-fills — and the command it will run.
- Click **"Apply Template"** to open the creation flow. For starters, you'll fill in the required parameters (validated as you go). Cronsole then registers the new task on your machine via the local agent (Windows) or the relevant API.
- **Task name:** prefilled with the template's name but yours to edit — give each applied task its own name if you reuse a template. A name that matches a task Cronsole already created **in the same folder** is **rejected** (instead of Windows silently overwriting the existing task), and names with characters Windows forbids (`\ / : * ? " < > |`, trailing dots) are refused with a clear message.
- **Task Scheduler folder** *(Windows only)*: choose where the task actually lives in Windows Task Scheduler. The list is read from your machine and defaults to `\Cronsole`. **This is also the task's category in Cronsole** — for a Windows task the category *is* its top-level folder, which is why an imported task shows up under `Microsoft` or whatever folder it really lives in. Because the collision check is per folder, the same name in two different folders is fine: `\Cronsole\Backup` and `\Work\Backup` are genuinely different Windows tasks.
  - **Only folders that already exist are offered.** Cronsole creates exactly one folder — its own `\Cronsole`, which it also removes again once the last task in it is deleted. It won't create any other, because deleting a Task Scheduler folder needs admin rights: a folder Cronsole made would be permanent, and only *you* could clear it. To file tasks somewhere new, create the folder in Task Scheduler first and it'll appear in the list.
  - `\Microsoft\` isn't offered. Windows keeps its own scheduled tasks there, and creating one with a matching name would **silently overwrite** a real system task — no error, no warning. Cronsole refuses it rather than hand you that footgun.
  - If the agent is offline the list can't be read; you can still create in `\Cronsole`.
- **Other platforms** keep Cronsole's own categories — only Windows has a real folder hierarchy to point at.
- **Schedule:** the field is labelled with the zone it reads in (`Schedule (cron · PDT)`), quick preset chips fill common crons in that same zone, and a plain-language preview under the field ("Runs daily at 8:00 AM PDT") confirms what the cron means before you create anything. The stored UTC expression is printed underneath. Conversion warnings appear when a cron can't map cleanly onto a native Windows trigger.
- The created task appears on the Dashboard immediately — no need to wait for a sync.

---

## 5. Tools — health, analytics, backup and restore

The **Tools** tab holds the things that act across *all* your tasks rather than one of them.

### Task health

Answers *"which of my tasks need attention?"* — the question a few hundred rows can't answer by
scrolling. It always gives you an answer, including when the answer is "nothing".

By default you see only the **summary**: how many tasks are critical, need a look, are unmeasured,
and are healthy. **Show N tasks needing attention** opens the list, worst first; a **Collapse**
button appears at the bottom once you've opened the whole thing, so you don't have to scroll back
up to close what you scrolled down to read.

Expand any row to see the **signals** behind it, each with the evidence it came from — *"Windows
recorded exit code 2 for the run at 2026-07-27T03:00"*, *"Windows missed 2 scheduled starts as of
the sync at …"*. The score shown there ranks the list; it is not a grade, and it never appears
without the signals that produced it.

Four states, and the third one matters:

- **Critical** — the last run failed, several runs in a row failed, or the task has gone missing
  from the platform.
- **Attention** — missed starts, never run, overdue against its own schedule, a run stopped before
  it finished, or a native job suddenly taking much longer than usual.
- **Unknown** — Cronsole has **no evidence** about this task. Most often that means the Windows
  agent predates run-result reporting: republish it and the tasks become measurable. Unmeasured is
  deliberately not shown as healthy.
- **Healthy** — counted in the header, not listed.

Windows' own `\Microsoft\` tasks are **hidden by default**, the same way the dashboard's Personal
filter hides them, with the count shown so you can bring them back. A **disabled** task is never
counted as unhealthy — parking a task is a normal thing to do, and the card says so rather than
nagging about a task you switched off on purpose. **Open task** jumps straight to it on the
Dashboard.

---

### Execution analytics

Three questions the per-task history can't answer, in one card: **Failures**, **Duration**, and
**Idle**. Pick a period (7, 30 or 90 days) for the first two.

**Failures** shows the totals for the period and one bar per day, stacked succeeded / failed /
pending. Hover a bar — or tab to it — and the line above the chart names that day and its numbers.
Days with no runs are drawn as empty columns on purpose: a chart that skipped them would draw a
straight line across an outage.

Two things about this chart are worth knowing:

- **It counts runs Cronsole *performed*** — runs you started from the dashboard, and Cronsole-native
  jobs Cronsole runs itself. A Windows task firing on its own schedule isn't recorded, so an empty
  period means Cronsole triggered nothing, **not** that nothing ran. For "did this actually work?",
  use **Task health**, which reads Windows' own result.
- **The totals are always exact.** If a period has more runs than the chart can draw, the bars cover
  a shorter, complete stretch and the card says so — rather than showing a full-width chart with
  data missing from the middle.

**Duration** answers *"which tasks are getting slower?"* by comparing each task's recent runs against
its own earlier baseline (median, so one slow night isn't a trend). **Only Cronsole-native tasks
appear here.** For a Windows task, the recorded duration is how long the agent took to *accept* the
start — not how long the job took — so including them would rank handshakes instead of work. On a
Windows-only machine this list is legitimately empty, and the card says how many runs it left out
and why.

**Idle** lists scheduled tasks with no run in the last 30 days, each with the evidence behind it.
Windows tasks are judged from **Windows' own last-run time**, not from Cronsole's records — which is
why this works for tasks Cronsole has never triggered. Anything it can't judge is counted separately
rather than dropped:

- **Disabled** and **on demand** — not running is what these are supposed to do.
- **Never run** — a different fact from "ran, but a while ago", and a different fix.
- **No run data from the agent** — usually an agent that predates run reporting. Republish it.

`\Microsoft\` tasks are hidden by default with the count shown, the same as everywhere else.

---

### Back up scheduled tasks

Saves Windows Task Scheduler tasks as native XML — either every folder on the machine, or one
folder you pick.

- **It exports what is on the machine, not just what Cronsole imported.** The tasks most at risk of
  being lost are the ones nothing else is tracking, so those are exactly the ones a backup has to
  include.
- Windows' own `\Microsoft\` tasks are **excluded by default and counted out loud** — on a real
  machine they outnumber yours roughly 3:1 and would bury what you came for.
- On Chromium browsers you pick a destination folder and the export mirrors your Task Scheduler
  folder tree into it. Everywhere else it downloads as a single `.zip`. Both include a
  `_cronsole-export.json` manifest listing exactly what was saved — and what was skipped or failed.
- **The files contain each task's full command line and the account it runs as.** If any of your
  tasks pass secrets on the command line, treat the export like a password.

### Restore tasks from a backup

Puts them back. Feed it the `.zip`, the folder you exported to, or individual `.xml` files.

- **You always see a plan before anything is written.** Picking files runs a dry run: Cronsole works
  out what would happen to every file — *restore* / *replace* / *skip* / *refuse* — by checking what
  is really on your machine, and changes nothing. The button underneath then tells you how many
  tasks it will actually change.
- **Overwrite is off by default.** A task that already exists is left exactly as it is and reported
  as skipped. Turn on **Overwrite tasks that already exist** only when replacing the live task is
  what you mean — Windows replaces a same-named task without asking.
- **Recreate missing folders** is on by default, because the folder tree is part of what you backed
  up. Every folder it creates is listed in the plan. One thing worth knowing before you click:
  those folders are created by the agent, which runs with administrator rights, so **removing one
  later needs an elevated Task Scheduler**. The same is true of the restored tasks themselves —
  delete them through Cronsole (or an elevated Task Scheduler), not from a normal PowerShell prompt.
- Some files are refused rather than restored, and the plan says why: a task that belongs under
  `\Microsoft\` (Windows' own — a name collision there would silently destroy a real system task),
  a file that isn't a task definition, or two files that would land on the same task path.
- **Restoring a task does not add it to Cronsole.** It puts the task back on the machine; use
  **Import** on the Dashboard if you want Cronsole to track it too.

### Export run history

Downloads every recorded run across all your tasks as a CSV — the answer to *"what failed this
month?"*, which the per-task history (20 rows at a time) can't give you. Pick a period, optionally
narrow to failures, and the button tells you how many runs the file will hold before you download it.

**Read the `runKind` column before you read `status`.** The history covers runs **Cronsole
performed** — tasks you ran from the dashboard, and Cronsole-native jobs it runs itself:

- `native-execution` — Cronsole ran the job, so `status` and `durationMs` describe the actual work.
- `manual-trigger` — Cronsole asked the Windows agent to start the task. `SUCCESS` means Windows
  accepted the start; the task's own outcome isn't in that row, and the duration is the round trip.

A Windows task firing on its own schedule isn't recorded at all, so an empty period means Cronsole
triggered nothing — **not** that nothing ran. (For "did this actually work?", the **Task health**
panel below reads Windows' own result instead.)

### Connect an AI tool

Downloads a small instruction pack that teaches Claude, Codex, or Cursor how to drive *your*
Cronsole — see the [MCP Server Guide](MCP_Server_Guide.md) for the connection itself.

---

## 6. System Status & Connections

- **Sidebar:** Shows a live per-platform health summary plus a "synced N ago" indicator. The three states mean different things, and the difference matters:
  - **Online** — the agent is connected and has not failed to answer.
  - **Degraded** — the agent is *connected but not answering*: a request to it timed out, and the reason names which one. This is the state that used to read as Online. An agent can be running, with a healthy-looking connection, and still be wedged — so if things that need the agent are failing while the dot is green, look here first, then restart the stack ([troubleshooting #40](../../troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)).
  - **Offline** — nothing is connected.
- **"synced N ago" is about syncing, not about being connected.** It appears only once a sync has actually happened, so a freshly connected agent shows **no** indicator rather than "just now". If it is missing, nothing has been pulled from that platform yet — run **Sync Now**. Cronsole-native never shows one at all: its tasks live in Cronsole's own database, so there is nothing for it to sync *from*, and Settings shows its last sync as **Never** on purpose.
- **Settings → Connections:** A fuller view of each platform's state, reason, and last sync, with a **Check now** button to refresh on demand. **Check now** re-reads status; it does not sync, so it will not change "synced N ago".
- **Settings → About → API origin:** Shows the backend URL the dashboard is using. You can override it in the browser when testing a different backend; **Reset** returns to the configured `VITE_API_URL` default.
- **Sync vs. Import:** **Sync Now** re-pulls status and schedules for categories you already track; **Import** opens the discovery picker to add new tasks. **Sync Now cannot discover a folder you don't already track** — that's what Import is for.
- **"N tasks aren't imported":** because of the above, tasks can exist on your machine that Cronsole is deliberately ignoring. Sync Now now tells you when that's the case — *"Synced. 26 tasks in 2 folders aren't imported — use Import to add them."* Windows' own `\Microsoft\` tasks are excluded from that count (there are usually a few hundred, and counting them would make the message constant), so the number means *your* tasks. If you don't want them, Import is not required — the message is informational, and it disappears once nothing is outstanding.

---

*Last Updated: August 11, 2026*
