# Cronsole UI User Guide

Welcome to the **Cronsole** interface! This guide provides a comprehensive overview of how to navigate the dashboard, manage your scheduled tasks, and use advanced features like categorization and templates.

---

## 1. The Dashboard

The Dashboard is your "one pane of glass" for monitoring every scheduled task in your ecosystem.

### The health strip

A single line under the title, answering *"is anything wrong, and what did Cronsole last do?"* —
so deciding what to do next doesn't mean reading the sidebar. Three facts:

- **Connection.** *"All 2 platforms online"*, or the platform that isn't, with the reason. It
  names a platform only when something is wrong with it.
- **Last sync.** How long ago Cronsole last pulled your task list. This is a **real sync**, never
  a heartbeat: if the agent is alive but nothing has synced since yesterday, it says *"Synced 19h
  ago"*, and adds *"agent replied 2m ago"* so both facts are visible. **Never synced** is a
  legitimate answer and appears as those words.
- **Last command.** The most recent thing Cronsole asked a platform to do and how it went —
  including when it **failed**, in red with the platform's reason. Before anything has been run
  it says *"No commands run yet"* rather than showing a tick it hasn't earned.

### Task Cards
Each task is represented by a card showing:
- **Platform Badge:** Identifies where the task lives (e.g., Windows, Claude, or Cronsole-native).
*   **Favorite star:** Star a task to pin it to the dashboard's opening view — see *Favorites* below.
*   **Status Indicator:** A green dot for `ACTIVE` tasks and a gray dot for `DISABLED` tasks.
*   **Local Category:** A folder icon showing the Cronsole-specific category.
*   **External ID:** The native path or ID used by the source platform.
*   **Schedule:** When the task runs, in plain words — *"Daily at 8:00 AM PDT"* — read in your
    **schedule timezone** (Settings › Schedule timezone), the same reading the details modal gives.
    Two other things it may say, both facts rather than gaps: a **raw cron expression**, when the
    schedule is a shape Cronsole won't put into words rather than guess at it; and **"No cron
    schedule"**, when the task runs on a trigger cron can't express at all (boot, logon, an event,
    or on demand only). Hover for the stored UTC cron behind the reading.
*   **Last Updated:** The last time Cronsole synced state for this task.

### Quick Actions
- **Run Now (Play Icon):** Manually triggers the task immediately. This requires a confirmation dialog to prevent accidental triggers.
- **Clone (Copy Icon):** Duplicates a task as a starting point for a new one.
- **View Details:** Clicking anywhere on the card (except the action icons) opens the **Task Details** modal (see §2) — hovering the card names this in its footer. By keyboard, Tab to the task's **title** and press Enter; the title is the card's real control, so the dashboard's main action is not mouse-only.

### Saved views
Across the top of the dashboard is a row of **views** — named filter combinations, so the question
you actually ask ("what's failing?", "what runs today?") is one click instead of four filters
rebuilt from scratch on every visit. Six ship built in:

| View | Shows |
|---|---|
| **Favorites** | Only the tasks you've starred (see *Favorites* below). Deliberately ignores every other lens — a starred task shows even if it's disabled, missing, or one of Windows' own. |
| **My jobs** | Your active tasks. Hides Windows' own tasks and anything disabled or missing. The default *until you star something*. |
| **Failures** | Tasks the health check rates *critical* or *needs attention*. |
| **Due today** | Tasks whose next run falls on today's date, in your **schedule timezone** (Settings › Schedule timezone) so it agrees with the times printed on the cards. |
| **Disabled** | Only the tasks you've parked. Note this **isolates** them — it is not the same as *Filters › Status › All statuses*, which merely stops hiding them. |
| **System** | Only the tasks Windows itself owns under `\Microsoft\`, which the dashboard hides by default. |

- **Saving your own:** change any filters and the row shows a **Custom** chip plus **Save view**. Name it and it becomes a chip of its own, with a count, kept between visits. Delete one with the `×` on its chip — that only removes the name; the tasks and the filters you're currently looking at are untouched.
- **Every view is a link.** The URL carries the view (`?view=failures`) or the individual filters, so you can bookmark one or paste it to another machine. A link to a saved view *someone else* made falls back to the normal dashboard rather than showing you nothing.
- **The counts are honest about what they don't know.** *Failures* is answered by the health check (the same one on the Tools tab), which has to read every task first. Until it finishes, the chip shows **`–`, not `0`** — because `0` would claim nothing is failing, and the app hasn't looked yet. A banner above the list says the same thing while it loads. A task with no run evidence at all counts as *unmeasured*, not as passing.
- **Changing a filter drops you to Custom.** The chip goes dark on purpose: once you narrow "Failures" to one category, the list is no longer what that label says it is.

### Favorites
Click the **star** on any task — on a card, a list row, a kanban card, the Schedule timeline, or in
the task's own detail modal — to mark it a favorite. Stars are yours alone and change nothing on the
platform, so starring works fine with the agent offline.

- **The dashboard opens on your favorites** once you have at least one. With none, it opens on your
  normal defaults, exactly as before — so this stays invisible until you use it.
- **It says so when it does.** Opening filtered is something you didn't ask for, so a banner names
  the filter, says how many tasks it's holding back, and offers **Show the full dashboard**. You
  won't see that banner when you pick *Favorites* from the view bar yourself — there, you know.
- **It can't trap you.** Click any other view, chip or filter and the dashboard stays where you put
  it; the favorites default only applies to a "clean" visit with no filters in the URL.
- **A star outranks every other filter.** *Favorites* shows a starred task even when it's disabled,
  missing, or one of Windows' own — you starred it deliberately, so nothing hides it by default.
- **Un-tracking or deleting a task takes its star with it.** Starring is a preference about a task
  Cronsole tracks, not a record that outlives it (unlike a **removed** task, which Cronsole
  remembers so sync doesn't re-import it).

### Views, Search & Filters
- **View modes:** Switch between **Grid**, **List**, **Kanban** (active vs. disabled columns), and **Schedule** (sorted by next run) using the toggle on the right. The layout is **not** part of a saved view — picking a view changes which tasks you see, never how they're drawn.
- **Search:** The search box filters by task name, category, path, command, and schedule. Press `/` to jump to it and `Esc` to clear; a match counter shows how many tasks matched.
- **The Filters button** holds status, ownership, platform and category. The number on it is how many filters are set, so a closed menu can never hide *that* you're filtered. Inside:
  - **Status** — *Active only* (the default), *All statuses*, or **isolate** just the *Disabled* or just the *Missing* ones. Isolating is not the same as including: it shows you **less**, and an isolated state appears as its own pill outside the menu so it can't be mistaken for normal.
  - **Ownership** — Windows keeps hundreds of its own scheduled tasks under `\Microsoft\`; on a typical machine they outnumber yours roughly 3:1, so Cronsole hides them by default. This is **independent of Status**, so the normal view is *yours **and** active* — either can be opened up without touching the other. The choice is remembered between visits, and the section only appears if you've actually imported some.
  - **Platform** and **Category** — both **faceted**: each option shows a live count *under the filters already applied*, and options with nothing under them drop out rather than showing zero-count noise.
- **What a filter is hiding is never inside the menu.** Two of these lenses are defaults you didn't pick today, and they hold rows back while looking like a neutral starting state — so they say so on the toolbar itself: `189 system hidden`, `10 inactive hidden`. Each is also the button that undoes it. Category and platform don't need this: they appear as **pills** you can read and dismiss (`Backups ×`), which tells you the rest is elsewhere without needing a number.
- **Counts describe the view you're in, not the whole dashboard.** A count beside a filter is a promise about what clicking it will reveal, so it's taken over everything the *other* filters allow. On the Favorites view with two stars, the status filter counts against those two — not against all 269.

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

Bulk changes live in one place: **Mass actions**, on the [Tools tab](#mass-actions). There are no
checkboxes on the dashboard — a selection can't be checked once it's more than a handful of rows
(*"254 selected"* tells you nothing you can verify), and it couldn't act on more than 100 tasks
anyway. Mass actions works the other way round: you say *what* you want to change, then *which*
tasks, and you see exactly which ones before anything happens.

To change a single task, open it and use the buttons in the task modal.

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
Categories live under **Filters › Category** on the Dashboard toolbar:
- **"All":** every task the other filters allow.
- **Dynamic list:** each category with matching tasks appears with a live count. Categories with nothing under the current filters drop out rather than showing a zero.
- Picking one puts a **pill** on the toolbar (`Backups ×`) so you can see and clear it without reopening the menu.

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

### Mass actions

The one place Cronsole changes many tasks at once. It works in two steps, in that order:

1. **What do you want to do?** A list of four actions, each saying what it does and what it leaves
   alone:
   - **Enable tasks** — turn them back on so they run on their schedules again.
   - **Disable tasks** — stop them running, without deleting anything. Reversible.
   - **Move to a category** — relabel them in Cronsole. Nothing moves on your machine.
   - **Remove from Cronsole** — stop tracking them here; they keep running on their platform.
2. **Which tasks?** Opens on **By category** — the way your tasks are already organised, and a
   deliberately narrow starting point rather than "everything". Switch to **all tasks**, or narrow
   by **platform**, **status** or **health** instead. The card then lists exactly which tasks would
   change, before anything happens. **All actions** takes you back.

- **Windows' own tasks are excluded unless you ask for them**, and the number kept out is printed
  next to the checkbox. On a typical machine that is most of them.
- **The count is what would actually change**, never the scope size. A scope of 80 tasks where 70
  are already running gives you *Enable 10*, and says so: *"80 in scope, 70 need no change"*.
- **Big changes must be typed, not clicked.** At 25 tasks or more the confirmation asks you to type
  the number. This is the point of the whole surface: a dialog you can dismiss with the same click
  in the same place stops being a decision once you have seen it a few times.
- **The confirmation names the scope in words** — *"Scope: the Backups category"* — because a bare
  count is not something you can check.
- **Large runs are split into batches of 100** and reported as they go. If the agent disappears
  partway, the run stops and everything after that point is listed as not attempted rather than
  silently dropped. Re-running the same scope is safe: anything already done comes back as
  *already so*.
- **Enable and disable can be undone** with one click, which puts back exactly the tasks that
  changed. Removing from Cronsole is undone by re-importing, and recategorizing cannot be undone —
  so the card says that instead of offering a button that would not work.

Exporting in bulk stays in **Back up scheduled tasks** below, and importing stays on the Dashboard,
where task discovery lives.

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

## 6. Platforms — what Cronsole can actually do

The **Platforms** tab answers one question per platform: *what will happen if I click this?*

Each connected platform gets a row with its connection state, how many tasks Cronsole tracks
there, its last real sync, and ten capability chips — Sync, List folders, Run now, Create,
Enable/disable, Edit schedule, Edit action, Export, Restore, Delete. **Show the evidence behind
each capability** expands the row into a table with, per verb, its state, when it last succeeded,
and when it last failed and why.

**The three states, and why the middle one exists:**

| State | Means |
|:--|:--|
| **Verified** | This has actually worked on *this machine*. The row carries the timestamp that proved it. |
| **Declared** | Cronsole will attempt it, but it has never been observed to succeed here. **Not a promise.** |
| **Unsupported** | Cronsole cannot do this on this platform — the request would be refused. Shown struck through. |

A fresh install shows almost everything as *Declared*, and that is correct rather than pessimistic:
nothing has been tried yet. Use a verb once and its chip turns *Verified* with a timestamp. This is
deliberate — a table that claimed capabilities from the code rather than from your machine would be
a specification, and you already have one of those.

**Quick links** below the matrix are bookmarks to schedulers Cronsole has no connector for
(Claude, ChatGPT, Gemini, and any you add). Nothing is read or written through them.

## 7. System Status & Connections

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

*Last Updated: August 12, 2026*
