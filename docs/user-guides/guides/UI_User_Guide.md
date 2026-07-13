# TaskHub UI User Guide

Welcome to the **TaskHub** interface! This guide provides a comprehensive overview of how to navigate the dashboard, manage your scheduled tasks, and use advanced features like categorization and templates.

---

## 1. The Dashboard

The Dashboard is your "one pane of glass" for monitoring every scheduled task in your ecosystem.

### Task Cards
Each task is represented by a card showing:
- **Platform Badge:** Identifies where the task lives (e.g., Windows, Claude, or TaskHub-native).
*   **Status Indicator:** A green dot for `ACTIVE` tasks and a gray dot for `DISABLED` tasks.
*   **Local Category:** A folder icon showing the TaskHub-specific category.
*   **External ID:** The native path or ID used by the source platform.
*   **Last Updated:** The last time TaskHub synced state for this task.

### Quick Actions
- **Run Now (Play Icon):** Manually triggers the task immediately. This requires a confirmation dialog to prevent accidental triggers.
- **Clone (Copy Icon):** Duplicates a task as a starting point for a new one.
- **View Details:** Clicking anywhere on the card (except the action icons) opens the **Task Details** modal (see §2).

### Views, Search & Filters
- **View modes:** Switch between **Grid**, **List**, **Kanban** (active vs. disabled columns), and **Schedule** (sorted by next run) using the toggle on the right.
- **Search:** The search box filters by task name, category, path, command, and schedule. Press `/` to jump to it and `Esc` to clear; a match counter shows how many tasks matched.
- **Active Only:** Toggle to hide disabled tasks.
- **Category & platform chips:** Filter to a single category or platform. These chips are **faceted** — they only show categories/platforms that actually have tasks *under the current filters* (with a live count), so turning on **Active Only** or a platform filter drops any now-empty tags instead of showing zero-count noise.

---

## 2. Task Details

Clicking a task card opens the **Task Details** modal, which has two tabs.

### Overview
Instead of raw data, the Overview parses the task's synced configuration into readable panels:
- **Summary:** Status, last result (success/failure), next run, and last run.
- **Schedule:** A human-readable description (e.g. *"Daily at 9:00 AM UTC"*) alongside the underlying cron expression. Schedules are stored in UTC. If TaskHub can't express the trigger as cron (boot, logon, event, or on-demand tasks), it says so honestly rather than guessing.
- **Action:** What the task actually runs — an HTTP request for TaskHub-native tasks, or the executable/arguments/working directory for Windows tasks. If your agent build doesn't yet report a task's action, the panel says so rather than showing a blank.
- **Settings:** Scheduler state, whether the task is enabled, the account it runs as, run level, logon type, author, and description — shown when the agent reports them.
- **Raw platform metadata:** The full untouched sync payload is still available under a collapsible section at the bottom.

### Run History
The second tab lists recorded runs with their status, timestamp, duration, and a log snippet — so you can answer "did it actually run, and did it work?"

### Editing a schedule
The modal footer shows **Edit Schedule** for TaskHub-native tasks and Windows tasks whose trigger can be represented as a cron expression. TaskHub-native edits update the backend scheduler immediately; Windows edits require the local agent because TaskHub changes the real Task Scheduler trigger first. Boot, logon, event, and on-demand Windows triggers stay read-only until TaskHub has a dedicated safe editor for those trigger types.

### Deleting a task
The modal footer has a **Delete** button for TaskHub-native and Windows tasks:
- **TaskHub-native:** removes the task and its run history from TaskHub (nothing exists outside TaskHub).
- **Windows:** removes the real Task Scheduler entry via the local agent first, then the TaskHub record — TaskHub never claims a task is gone while it still exists on your machine. If the agent is offline, the delete is refused and the task stays.
- Some Windows tasks were registered by an elevated process and carry admin-only permissions; TaskHub will tell you when a task can only be deleted from an elevated Task Scheduler (or by running the agent elevated).

> **Note on schedule times:** the recurring clock time in the Schedule panel follows your **Settings → Behavior → schedule-time display** choice — your local time by default, or UTC. Absolute timestamps (next/last run) are always shown in your local time.

---

## 3. Task Categorization & Organization

TaskHub allows you to organize tasks into local folders (categories).

### Automatic Initial Categorization
When you first sync with a platform (like Windows Task Scheduler), TaskHub **automatically imports the existing folder structure**. 
- A Windows task at `\Microsoft\Windows\UpdateOrchestrator\Reboot` will be automatically placed in the `Microsoft\Windows\UpdateOrchestrator` category.
- This gives you an organized starting point that mirrors your current environment.

### Local Overrides
Your categorization in TaskHub is **local and persistent**. 
- If you move a task to a "Critical" category in TaskHub, it will **stay there** even after subsequent syncs. 
- TaskHub will not overwrite your manual categorization with the source platform's folder structure once the task is imported.

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
- Each card shows its target platforms, script type, intended schedule (UTC), and the command it will run.
- Click **"Apply Template"** to open the creation flow. For starters, you'll fill in the required parameters (validated as you go). TaskHub then registers the new task on your machine via the local agent (Windows) or the relevant API.
- **Task name:** prefilled with the template's name but yours to edit — give each applied task its own name if you reuse a template. A name that matches a task TaskHub already created is **rejected** (instead of Windows silently overwriting the existing task), and names with characters Windows forbids (`\ / : * ? " < > |`, trailing dots) are refused with a clear message.
- **Schedule:** quick preset chips fill common crons, and a plain-language preview under the field ("Runs daily at 8:00 AM UTC" — or your local time, per Settings) confirms what the cron means before you create anything. Conversion warnings appear when a cron can't map cleanly onto a native Windows trigger.
- The created task appears on the Dashboard immediately — no need to wait for a sync.

---

## 5. System Status & Connections

- **Sidebar:** Shows a live per-platform health summary (Online / Degraded / Offline) driven by real connection checks, plus a "synced N ago" indicator.
- **Settings → Connections:** A fuller view of each platform's state, reason, and last sync, with a **Check now** button to refresh on demand.
- **Settings → About → API origin:** Shows the backend URL the dashboard is using. You can override it in the browser when testing a different backend; **Reset** returns to the configured `VITE_API_URL` default.
- **Sync vs. Import:** **Sync Now** re-pulls status and schedules for categories you already track; **Import** opens the discovery picker to add new tasks.

---

*Last Updated: July 13, 2026*
