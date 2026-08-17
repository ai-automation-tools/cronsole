# Cronsole UI User Guide

Welcome to the **Cronsole** interface! This guide provides a comprehensive overview of how to navigate the dashboard, manage your scheduled tasks, and use advanced features like categorization and templates.

> **In a hurry?** Every screen has **?** buttons next to the things that most often surprise
> people. Each one explains that control in place and links back here. See
> [In-app help](#8-in-app-help) for the full list.
>
> **Looking for one particular system?** The [Sources Guide](Sources_Guide.md) covers Windows
> Task Scheduler, Cronsole (HTTP), Cronsole (Scripts) and Claude Code one at a time — what
> Cronsole can and can't do with each.

---

## 1. The Dashboard

The Dashboard is your "one pane of glass" for monitoring every scheduled task in your ecosystem.

### The health strip

A single line under the title, answering *"is anything wrong, and what did Cronsole last do?"* —
so deciding what to do next doesn't mean hunting for it. Three facts:

- **Connection.** *"All 2 platforms online"*, or the platform that isn't, with the reason. It
  names a platform only when something is wrong with it.
- **Last sync.** How long ago Cronsole last pulled your task list. This is a **real sync**, never
  a heartbeat: if the agent is alive but nothing has synced since yesterday, it says *"Synced 19h
  ago"*, and adds *"agent replied 2m ago"* so both facts are visible. **Never synced** is a
  legitimate answer and appears as those words.
- **Last command.** The most recent thing Cronsole asked a platform to do and how it went —
  including when it **failed**, in red with the platform's reason. Before anything has been run
  it says *"No commands run yet"* rather than showing a tick it hasn't earned.

At the right-hand end sits **Diagnose**, which opens the same panel as *Run checks* on the Tools
tab — see [System diagnostics](#system-diagnostics). The strip gives you the verdict; the panel
gives you the evidence behind it, which is what says whether *"Windows offline"* means the agent
never connected or that one request timed out overnight.

### Task Cards
Each task is represented by a card showing:
- **Platform Badge:** Identifies where the task lives (e.g., Windows, Claude, or Cronsole-native).
*   **Favorite star:** Star a task so it shows under **Favorites** in the source rail — see *Favorites* below.
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

### Creating a Cronsole-native task

**New Task › Cronsole** creates a task that lives only inside Cronsole — nothing appears in Windows
Task Scheduler, and it runs whether or not the agent is connected. Two kinds:

- **HTTP request** — call a URL on a schedule. Webhooks, health checks, poking a deploy hook.
- **Run a program** — a script or executable, with its exit code, duration and output recorded in
  the run history. This is a **real** result, unlike a Windows task where a success only means the
  agent accepted the start.

Three things worth knowing about *Run a program*:

- **There is no shell.** The command is split into a program and its arguments, so `&&`, `|` and
  `>` are ordinary characters rather than operators. If you genuinely need them, name the shell
  yourself — `cmd.exe /c "…"` or `/bin/sh -c "…"`.
- **It says where it will run, before you click.** A native task runs wherever the Cronsole
  *backend* runs. Normally that is your machine — but if you run the backend in Docker, the task
  runs **inside the container**, where your paths and tools do not exist. The modal states which,
  so a task never fails as "executable not found" for a file you can see in Explorer.
- **Your Cronsole secrets are not passed to it.** The program gets a minimal environment plus
  anything you set explicitly — not Cronsole's own, which holds the key that encrypts your stored
  platform credentials.

**Use a Windows task instead** for anything that must run as your logged-in user, or keep running
when Cronsole is down.

Both kinds can be changed afterwards — including an HTTP job's URL — from the task modal's
Action panel. See [Editing a task](#editing-a-task).

### Source — where a task comes from

The **rail down the left of the dashboard** is where you navigate. It is a tree, two levels deep,
and it answers *where a task lives* before anything else asks *which slice of it you want*:

```
SOURCES
  All sources          269
  ★ Favorites            6
▾ ● Windows Task Scheduler  254
     AI-Maintenance         12
     AI-Tools                8
     Claude                  5
     Uncategorized          41
   ⃠ System tasks            HIDDEN   257
▸ ● Cronsole (Native)         12
      HTTP jobs               7
      Scripts                 5
▸ ● Claude Code                3
```

**Level 1 is the system.** *All sources* and **Favorites** lead, separated by a rule from the
platforms below — those two are scopes over everything rather than one system each. Then one row per
platform you have tasks from **or are
connected to**. The coloured dot is that platform's connection health — this is the same reading the
old sidebar's "System Status" panel used to give, moved next to the thing it describes.

**Level 2 is whatever that system groups by**, which is genuinely different per platform:

| Source | Level 2 is… |
|---|---|
| **Windows Task Scheduler** | your **Task Scheduler folders** — `\AI-Maintenance\`, `\AI-Tools\`, and the rest, exactly as they are on the machine |
| **Cronsole (Native)** | the **job type** — *HTTP jobs* and *Scripts*. These used to be two top-level sources; a platform sitting beside a job type was two levels of concept in one list. **Both are always listed**, empty or not: there are exactly two, always, so *Scripts* disappearing because you have not written a script task yet would read as a missing feature |
| **Claude Code** and others | the category label the task carries |

- **Moving around the rail never changes your view.** Pick *Failures*, then walk from Windows into
  `AI-Tools` and on to Claude — *Failures* stays lit the whole way, because navigating is not
  filtering. Both constraints are on screen: the rail row is lit, the page heading names the source,
  and the line under it is a breadcrumb (*Windows Task Scheduler › AI-Tools*).
- **Picking a source clears the folder.** A folder belongs to the system it came from, so switching
  to Claude cannot leave you inside a Windows folder that Claude has never heard of.
- **The counts are scoped to what you would actually see.** Every number is taken under all your
  *other* filters, so it predicts the click. That is also why a row can legitimately read `0`.
- **A row can read `0` for two different reasons**, and both are useful: nothing from that source
  survives your current view, or you are connected to it and have imported nothing yet. The row
  stays either way — it is navigation, and an empty destination still needs a route to it.
- **`\Microsoft\` is one collapsed *System tasks* group at the bottom**, not twenty folders mixed
  in with yours. Windows keeps ~257 of its own there and the dashboard hides them by default; a
  **HIDDEN** badge on the row says so while that is true, and the group states
  so in its own label and states the count, so nothing is quietly fenced off. Open it and pick a
  folder to look inside one. The group itself only expands — it is a disclosure, not a filter.

**Collapse it** with the button at the top of the rail. Collapsed, it becomes a narrow column of
icons — each system with its health dot and its count, names on hover — and the folder level is
**dropped rather than shrunk**, because a Task Scheduler folder name has nowhere to go at that
width and a column of tooltips is worse than admitting the tree needs room. The choice is
remembered between visits.

On a phone the rail is a drawer: tap **Sources** beside the page heading. The breadcrumb under the
heading is what tells you where you are while it is closed. The drawer always opens at full width —
an icons-only tree inside a panel you had to tap open would be two gestures to reach one folder.

The **?** at the top of the rail opens the same breakdown in the app, for the source you are on.
For what each source can actually do — and the things that catch people out on each one — see the
[Sources Guide](Sources_Guide.md).

### Saved views
Across the top of the dashboard is a row of **views** — named filter combinations, so the question
you actually ask ("what's failing?", "what runs today?") is one click instead of four filters
rebuilt from scratch on every visit. Six ship built in:

| View | Shows |
|---|---|
| **All** | Every task, with no lens at all — including the ones Windows owns and anything disabled or missing. The one click that means "stop hiding things". |
| **My jobs** | Your active tasks. Hides Windows' own tasks and anything disabled or missing. The default *until you star something*. |
| **Failures** | Tasks the health check rates *critical* or *needs attention*. |
| **Due today** | Tasks whose next run falls on today's date, in your **schedule timezone** (Settings › Schedule timezone) so it agrees with the times printed on the cards. |
| **Disabled** | Only the tasks you've parked. Note this **isolates** them — it is not the same as *Filters › Status › All statuses*, which merely stops hiding them. |
| **System** | Only the tasks Windows itself owns under `\Microsoft\`, which the dashboard hides by default. |

- **Saving your own:** change any filters and the row shows a **Custom** chip plus **Save view**. Name it and it becomes a chip of its own, with a count, kept between visits. Delete one with the `×` on its chip — that only removes the name; the tasks and the filters you're currently looking at are untouched.
- **Every view is a link.** The URL carries the view (`?view=failures`) or the individual filters, so you can bookmark one or paste it to another machine. A link to a saved view *someone else* made falls back to the normal dashboard rather than showing you nothing.
- **The counts are honest about what they don't know.** *Failures* is answered by the health check (the same one on the Tools tab), which has to read every task first. Until it finishes, the chip shows **`–`, not `0`** — because `0` would claim nothing is failing, and the app hasn't looked yet. A banner above the list says the same thing while it loads. A task with no run evidence at all counts as *unmeasured*, not as passing.
- **Changing a filter drops you to Custom — except the rail.** The chip goes dark on purpose: once you narrow "Failures" by a lens you cannot see, the list is no longer what that label says it is. **The source rail is the exception** — both of its levels are — because a rail selection is never hidden: the row is lit, the heading names the source and the breadcrumb names the folder. With *Windows Task Scheduler › AI-Tools* selected and *Failures* lit, all three constraints are on screen, so no chip is lying.

### Favorites
Click the **star** on any task — on a card, a list row, a kanban card, the Schedule timeline, or in
the task's own detail modal — to mark it a favorite. Stars are yours alone and change nothing on the
platform, so starring works fine with the agent offline.

- **Favorites is a row in the source rail**, second from the top, under *All sources*. It used to be
  a chip in the views bar; starred-is-a-place is where people look for it, and as a rail row it
  **composes with whichever view is lit** instead of replacing it — *Failures* + *Favorites* is your
  failing starred tasks, and both controls say so together.
- **The dashboard opens on *All*, not on your favorites.** It briefly opened on Favorites; showing
  you a subset you picked weeks ago, and then having to explain itself, turned out to be worse than
  simply showing everything.
- **A star still outranks the defaults.** A bare URL opens on **All** — every status, system
  included — so clicking Favorites from a fresh load shows every starred task, including disabled,
  missing and OS-owned ones. It narrows only if you have deliberately picked a narrowing view, and
  that view is lit on screen while it does.
- **Un-tracking or deleting a task takes its star with it.** Starring is a preference about a task
  Cronsole tracks, not a record that outlives it (unlike a **removed** task, which Cronsole
  remembers so sync doesn't re-import it).

### Collections
A **collection** is a set of tasks you pick by hand and give a name — "Morning checks", "Client
work", "View2". It appears as a row in the source rail above your platforms, with its own count.

**A collection is not a saved filter, and that distinction is the whole feature.** A view stores
*conditions* (active, failing, due today) and shows whatever matches them right now. A collection
stores *the tasks themselves*. That is the only way to group four things that have nothing in
common except that you care about them together — a Claude routine, two Windows tasks in different
folders, and a Cronsole-native check, one of them disabled. No filter can describe that set, because
there is no shared property to filter on.

- **Add a task from the bookmark button**, which sits next to the star wherever a task appears —
  every card in Grid, every row in List, every Kanban and Schedule entry, and the detail modal
  (where it is labelled *Add to collection* in full). It opens a checklist of your collections;
  ticking one adds the task immediately. **You can create a collection from there too**, with the
  task already in it — the moment you notice a task needs a home is the moment you want the home.
- **The button carries a number** once a task is in something, so you can see at a glance which
  tasks are already filed without opening anything.
- **A task can be in any number of collections.** That is why the control is a checklist rather than
  a star: one task, many sets.
- **Collections compose with your view**, exactly like Favorites. Selecting one keeps whichever view
  is lit, so *Failures* + your collection is the failing tasks in it. Selecting one also clears any
  source, folder or starred scope — a collection spans systems, so it cannot sit "inside" one.
- **Manage, rename and delete** from *Manage collections* at the bottom of the rail.
- **Deleting a collection never deletes tasks.** It removes the grouping; the tasks stay in Cronsole
  and keep running, and the confirmation says so with the count.
- **Removing a task from Cronsole takes it out of any collection holding it** — the same rule as the
  star. A membership is a preference about a task Cronsole tracks, not a record that outlives it.
- Collections are yours alone, change nothing on any platform, and work with the agent offline.

### Views, Search & Filters
- **View modes:** Switch between **Grid**, **List**, **Kanban** (active vs. disabled columns), and **Schedule** (sorted by next run) using the toggle on the right. The layout is **not** part of a saved view — picking a view changes which tasks you see, never how they're drawn.
- **Search:** The search box filters by task name, category, path, command, and schedule. Press `/` to jump to it and `Esc` to clear; a match counter shows how many tasks matched.
- **The Filters button** holds status and ownership. *(Neither source nor folder is in here — both are the **source rail** on the left. The button's count ignores them too, because a badge may only count what its own menu can clear.)* The number on it is how many filters are set, so a closed menu can never hide *that* you're filtered. Inside:
  - **Status** — *Active only* (the default), *All statuses*, or **isolate** just the *Disabled* or just the *Missing* ones. Isolating is not the same as including: it shows you **less**, and an isolated state appears as its own pill outside the menu so it can't be mistaken for normal.
  - **Ownership** — Windows keeps hundreds of its own scheduled tasks under `\Microsoft\`; on a typical machine they outnumber yours roughly 3:1, so Cronsole hides them by default. This is **independent of Status**, so the normal view is *yours **and** active* — either can be opened up without touching the other. The choice is remembered between visits, and the section only appears if you've actually imported some.
- **What a filter is hiding is never inside the menu.** Two of these lenses are defaults you didn't pick today, and they hold rows back while looking like a neutral starting state — so they say so on the toolbar itself: `189 system hidden`, `10 inactive hidden`. Each is also the button that undoes it. The rail's two dimensions don't need this: the rail shows its own selection, and the folder also appears as a **pill** you can read and dismiss (`Backups ×`) — which is what names it on a phone, where the rail is closed.
- **Counts describe the view you're in, not the whole dashboard.** A count beside a filter is a promise about what clicking it will reveal, so it's taken over everything the *other* filters allow. With Favorites selected and two stars, the status filter counts against those two — not against all 269.

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

### Editing a task

One **Edit** button in the modal footer opens everything editable about the task in a single
form: its name, its category, its schedule, and what it runs. *(Until 13 August 2026 those were
four separate controls in four places — a pencil by the title, a "Change" link on the category
card, an "Edit" in the Action panel and an "Edit Schedule" in the footer — each opening
something different.)*

The Edit button is **never disabled**, because name and category can be changed on every
source. Anything this particular task *cannot* change says so, in words, inside the form —
rather than being a greyed-out button with the explanation hidden in a tooltip you can't read
on a phone.

#### Saving: one button, reported part by part

Behind the one form there are still **three different writes**, and they do not fail alike:
the labels are Cronsole's own database row, while a Windows schedule or command change is a
request to the agent that Windows can refuse.

So **Save sends only what you changed, and each part reports its own result.** If the agent is
offline while you renamed a task and changed its schedule, the rename lands, the schedule
doesn't, and the form says exactly that — *"1 of 2 parts saved"* — keeping the failed part
filled in so pressing Save again retries only what's outstanding. Nothing is rolled back:
undoing the successful half would need the same agent that just failed.

Closing with unsaved changes asks first.

#### Name and category

Both are **Cronsole labels. Neither touches your machine.**

- A Windows task's real name is the last segment of its Task Scheduler path, and that path is
  how Cronsole addresses it — every command it sends, every sync that matches it. Renaming the
  path would make it a *different task*, so Cronsole doesn't. The editor says which name Task
  Scheduler will keep using, before you save.
- Once the two differ, the task modal says so too — *"Renamed in Cronsole — Task Scheduler
  still calls it X"* — and keeps the real path on screen. Otherwise you'd go looking in Task
  Scheduler for a name that was never there.
- Changing the category does **not** move the task to a different Task Scheduler folder.
- Both survive a sync: sync overwrites only platform facts (status, schedule, next run).
  *(Until 12 August 2026 sync wrote the name back on every pass, which is why renaming wasn't
  offered at all.)*
- Renames can't collide the way a *created* task's name can — the duplicate check exists
  because a new Windows task's name becomes its path, and a rename never touches the path.

#### Schedule

Editable for Cronsole-native tasks and for Windows tasks whose trigger can be represented as a
cron expression. Cronsole-native edits update the backend scheduler immediately; Windows edits
need the local agent, because Cronsole changes the real Task Scheduler trigger first. Boot,
logon, event and on-demand Windows triggers stay read-only until Cronsole has a dedicated safe
editor for those trigger types — the form says so instead of hiding the section.

#### What it runs

This does one of two quite different things.

**Windows tasks** — Cronsole asks the agent to rewrite the real Task Scheduler entry, and
records nothing until Windows confirms. The agent must be online, and the platform can refuse
(an admin-owned task will). Available for tasks with a single reported command; a multi-action
task, or one the agent hasn't described yet, says which of those it is.

**Cronsole-native tasks** — the row *is* the task, so the write *is* the change. Nothing can
refuse it and it works with the agent offline. You can change an HTTP job's URL, method,
headers and body, or a script job's command line and working directory — the URL in particular
used to require deleting the task and starting over, which threw away its run history.

Three things to know about the native side:

- **Headers take either form.** Paste `Authorization: Bearer …` lines straight out of an API's
  docs, or JSON. Something it can't read blocks the save rather than being quietly sent as no
  headers.
- **You can convert an HTTP job into a script job, and the other way round** — but the job is
  **replaced, not merged**. The two kinds share no fields, so switching discards the other
  type's: the form names exactly what goes before you click. The task keeps its name, schedule,
  category and run history.
- **A script job says where it will run** — your machine, or inside the container if you run
  the backend in Docker. Same statement as the New Task form, for the same reason.

A **Claude routine's** prompt is defined at claude.ai; Cronsole can schedule and fire it, not
rewrite it.

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
- **Not offered for Claude routines either** — see *Disconnecting a Claude routine* below.
  Clicking it there is refused with the reason, rather than appearing to work.

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

### Disconnecting a Claude routine

A Claude routine gets a third button instead: **Disconnect routine**. It is the only way to
take one off the dashboard, and *"Remove from Cronsole"* is refused for these on purpose.

The reason is that a routine is on your dashboard because **you declared it**. Anthropic
exposes no endpoint to list routines, so Cronsole's list is your own connection config — there
is no machine to be re-imported from, and no "don't re-import this" to remember. Removing the
row alone left the declaration in place, so the next sync brought the task straight back while
Cronsole's list of removed tasks read empty. *(If you hit that loop before 12 August 2026, that
was it — [troubleshooting #47](../../troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole).)*

**Disconnect routine** removes the declaration and the tracked task together, from either the
task modal or **Platforms › Claude**. Two things it also does, both stated in its confirmation:

- **It forgets the stored API token**, which claude.ai shows exactly once and will not show
  again. Reconnecting means generating a new token there. This is precisely why it isn't folded
  into "Remove from Cronsole" — a button may not spend something its label doesn't mention.
- **It changes nothing at claude.ai.** The routine still exists and still runs on its own
  schedule. You are disconnecting Cronsole from it, not deleting it.

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
1. **Directly on the Card** — a shortcut for the one-word change:
   - Hover over the **Folder Icon** or the category text.
   - Click the text to turn it into an input field.
   - Type your new category name and press **Enter** to save.
2. **In the task editor** — alongside everything else about the task:
   - Click a task card to open the modal, then **Edit**.
   - Change the **Category** field and press **Save changes**.

Neither moves the task to a different Task Scheduler folder — the category is a Cronsole
label. To change many tasks at once, use [Mass actions](#mass-actions) on the Tools tab, which
counts how many would be detached from their folder *before* you commit.

---

## 4. Templates

The **Templates** tab is a library of prebuilt automation patterns, organized into two groups:
- **Starters:** Parameterized building blocks (PowerShell / Python / shell script, HTTP ping, …). You fill in the blanks (script path, URL, arguments) when applying.
- **Use-case patterns:** Ready-made automations for common jobs (e.g., *Daily Database Backup*, *Morning News Digest*).

### Finding a template
- **Search:** Free-text search across name, description, command, category, and script type.
- **Type toggle:** Show **All**, only **Starters**, or only **Patterns**.
- **Target filter:** which system a template creates a task on — Windows, Cronsole, Claude Code, macOS. This is the first thing to filter by, and it is not the same as the OS row: a Cronsole-native job, a Claude routine and a git command are all *cross-platform*, and only the target says which of them you can actually create. A target Cronsole can't create on here is marked `*`.
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
- **Cronsole-native templates** (*Run a Program*, *Node Script*, *Uptime Check*, …) need no agent at all: Cronsole schedules and runs them itself. The trade-off is **where** they run — on the machine running the Cronsole backend, which on a Dockerized stack is *inside the container*, against a filesystem that is not your desktop. If a script must run as you, or keep running when Cronsole is stopped, use a Windows template instead.
- **Claude Code templates** are prompts, not commands. Applying one creates a real **routine** that Anthropic runs in the cloud on your schedule — so the Apply screen shows *Resolved prompt* rather than *Resolved command*, and offers a **Repositories** box for the repos the routine may check out (one URL per line; a routine with no repository still runs, it just has no checkout). This needs you to be signed in to the Claude Code CLI on the machine running Cronsole; if you aren't, the platform button is greyed out and the modal says what to do instead of failing when you click Create.
- **What's greyed out is about *your* install, not about the template.** The platform buttons and the "Compatible with" badges come from the same capability check the [Platforms tab](#6-platforms--what-cronsole-can-actually-do) shows, so a target that works here is offered here. While that check is still loading nothing is marked either way — Cronsole would rather say nothing for a moment than tell you a platform is unavailable and be wrong.
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
     Cronsole-native tasks and Claude routines are **refused individually and named** — for
     those two the Cronsole row *is* the task (or the declaration), so there is nothing to
     stop tracking. One refusal never halts the rest of the batch.
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

### System diagnostics

Answers *"is **Cronsole** working?"*, which is a different question from *"are my tasks working?"*
and has to be answered first — a wedged agent makes every Windows task look unhealthy, and the fix
is not in any of those tasks.

Open it from **Run checks** here, or from **Diagnose** at the right-hand end of the Dashboard's
health strip. Both open the same panel.

Each check gives you a verdict **and the evidence behind it**, because the evidence is the part
that tells you what to do. *"Windows offline"* is one sentence covering four different situations;
the panel shows which:

- **Backend process** — uptime, and the server's own clock in UTC. A backend whose clock has
  drifted fires everything at the wrong time while every stored schedule still looks correct.
- **Database** — that a real query round-trips, and how long it took.
- **Windows agent** — whether a socket exists, which machine the agent is on, when it connected,
  when it last said anything, and **when a request last timed out, naming the verb**. That last
  line is usually the answer: a timeout two minutes ago and one from nine hours ago produce the
  same status colour and mean entirely different things.
- **Task list freshness** — the last real sync per platform.
- **Cronsole-native scheduler** — whether the loop is running, when it last completed a tick, and
  how many native tasks are overdue past the grace window. A loop that exists but has stopped
  ticking reports as a problem, because "running" alone is not evidence that anything ran.
- **Template catalog** — where templates are being loaded from and whether the last sync worked. A
  failed catalog sync is deliberately non-fatal, which is exactly why it is otherwise invisible.
- **API tokens** — any that have expired or expire within a week. An expired token does not fail
  loudly at the tool using it: an MCP client reports its tools as *missing*.
- **Browser origins** — which origins may reach the API. Harmless when unset locally; it matters
  the moment you put Cronsole behind a tunnel.

Three things worth knowing about how to read it:

- **"Not measured" is not "OK".** A check that could not run says so, and the overall verdict ranks
  it *above* passing — a panel reporting "all clear" over something it never measured would be
  worse than one admitting the gap.
- **The panel names the machine it measured**, at the top. On a Dockerized stack the backend
  measures the *container* — its clock, its filesystem — not yours.
- **Nothing here changes anything.** Every check is a read; there are no repair buttons. That is
  deliberate rather than cautious: several past "the agent is down" alarms turned out to be the
  status readout itself being wrong, and a repair button would have been restarting a healthy agent
  and looking like it worked.

**What it cannot cover:** these checks run *inside* the Cronsole backend, so they can say nothing
about a backend, database or Docker engine that is not running. If the dashboard will not load at
all, nothing here can answer — that is what the `Cronsole-Stack` startup tasks are for. They run
from Windows Task Scheduler, outside the stack, and restart it without needing any of it to work.

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

- **Sidebar:** Shows a live per-platform health summary plus a "synced N ago" indicator. The four states mean different things, and the difference matters:
  - **Online** — the agent is connected and has not failed to answer.
  - **Degraded** — the agent is *connected but not answering*: a request to it timed out recently, and the reason names which one. This is the state that used to read as Online. An agent can be running, with a healthy-looking connection, and still be wedged — so if things that need the agent are failing while the dot is green, look here first, then restart the stack ([troubleshooting #40](../../troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)).
  - **Offline** — nothing is connected.
  - **Not checked** — Cronsole has no *current* evidence either way. **This is not a problem, and not a milder warning.** Two things produce it: a platform that has never been exercised (a Claude routine you have added but not yet run — Claude Code offers no way to check one without firing it), or a failure old enough that nothing since has confirmed or contradicted it.

    That second case is the common one, and it is worth understanding. Cronsole does not poll your agent in the background — deciding it is healthy costs a real request, and doing that on a timer would mean a synthetic request per open browser tab. So if a request timed out last night and you did not use Cronsole afterwards, *nothing has happened since* to tell Cronsole either way. It reports **Degraded** for the first 15 minutes, while that failure still describes the present, and **Not checked** after that.

    **To get a current answer, press Sync.** It is a read-only round trip and it replaces the stale verdict with a real one. Reach for restarting the stack only if Sync actually fails — a restart clears this state whether or not anything was wrong, which makes it look like a fix ([troubleshooting #48](../../troubleshooting/README.md#48-windows-sits-at-degraded-for-hours-while-the-agent-is-perfectly-healthy)).
- **"synced N ago" is about syncing, not about being connected.** It appears only once a sync has actually happened, so a freshly connected agent shows **no** indicator rather than "just now". If it is missing, nothing has been pulled from that platform yet — run **Sync Now**. Cronsole-native never shows one at all: its tasks live in Cronsole's own database, so there is nothing for it to sync *from*, and Settings shows its last sync as **Never** on purpose.
- **Settings → Connections:** A fuller view of each platform's state, reason, and last sync, with a **Check now** button to refresh on demand. **Check now** re-reads status; it does not sync, so it will not change "synced N ago".
- **Settings → About → API origin:** Shows the backend URL the dashboard is using. You can override it in the browser when testing a different backend; **Reset** returns to the configured `VITE_API_URL` default.
- **Sync vs. Import:** **Sync Now** re-pulls status and schedules for categories you already track; **Import** opens the discovery picker to add new tasks. **Sync Now cannot discover a folder you don't already track** — that's what Import is for.
- **"N tasks aren't imported":** because of the above, tasks can exist on your machine that Cronsole is deliberately ignoring. Sync Now now tells you when that's the case — *"Synced. 26 tasks in 2 folders aren't imported — use Import to add them."* Windows' own `\Microsoft\` tasks are excluded from that count (there are usually a few hundred, and counting them would make the message constant), so the number means *your* tasks. If you don't want them, Import is not required — the message is informational, and it disappears once nothing is outstanding.

---

## 8. In-app help

Cronsole explains itself in place. Two entry points, doing different jobs:

- **Help Center** — the button in the Dashboard header. The hub: a getting-started walkthrough,
  links to every guide, and a **Help by topic** index of everything below.
- **? buttons** — small circled question marks next to individual controls. Each opens the
  same modal on **one topic**: what the control is, the two or three things that surprise
  people about it, and a link to the section of the docs that covers it in full. Every topic
  view has *Browse all help* at the bottom, so a specific answer is never a dead end.

Where the **?** buttons are, and what each one answers:

| Where | Answers |
|:--|:--|
| Dashboard › **Source** bar | What a source is, and how each one differs → [Sources Guide](Sources_Guide.md) |
| Dashboard › **Views** row | Saved views, what a view is, why changing a filter drops you to *Custom* |
| Dashboard › **Filters** row | Status, ownership and category — and what the defaults are hiding |
| **New Task** › Platform | The selected platform, in place — the help changes as you switch between Cronsole, Windows and Claude |
| **New Task** › Schedule | Cron, your schedule timezone, and what is stored |
| **New Task** › Job type | HTTP request vs. Run a program |
| **New Task** › Command / Program | The no-shell rule, and where the job will actually run |
| **Task details** header | Rename, edit, remove, delete, disconnect — which button does what |
| **Templates** header | The catalog, starters vs. patterns, applying and saving |
| **Platforms** › each platform row | That source specifically, including what it cannot do |
| **Tools** › Mass actions | Scope-first bulk changes, and the typed confirmation |
| **Tools** › Task health | The four tiers, and why *Unknown* is not *Healthy* |
| **Import** | Import vs. Sync — the distinction that costs people the most time |

Every one of these links to a heading in this repo's docs. If you follow a link and it lands
somewhere unhelpful, that's a bug worth reporting — the links are checked by a test precisely
because a stale help link fails silently.

---

*Last Updated: August 12, 2026*
