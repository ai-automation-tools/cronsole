# TaskHub UI User Guide

Welcome to the **TaskHub** interface! This guide provides a comprehensive overview of how to navigate the dashboard, manage your scheduled tasks, and use advanced features like categorization and templates.

---

## 1. The Dashboard

The Dashboard is your "one pane of glass" for monitoring every scheduled task in your ecosystem.

### Task Cards
Each task is represented by a card showing:
- **Platform Badge:** Identifies where the task lives (e.g., Windows or Claude).
*   **Status Indicator:** A green dot for `ACTIVE` tasks and a gray dot for `DISABLED` tasks.
*   **Local Category:** A folder icon showing the TaskHub-specific category.
*   **External ID:** The native path or ID used by the source platform.
*   **Last Updated:** The last time TaskHub synced state for this task.

### Quick Actions
- **Run Now (Play Icon):** Manually triggers the task immediately. This requires a confirmation dialog to prevent accidental triggers.
- **View Details:** Clicking anywhere on the card (except the Play icon) opens the **Task Modal** for deeper metadata inspection.

---

## 2. Task Categorization & Organization

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
At the top of the Dashboard, you'll see a horizontal tab bar:
- **"All":** Shows every task from every platform.
- **Dynamic Tabs:** Each unique category (imported or custom) will automatically appear as a filterable tab.

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

## 3. Applying Templates

The **Templates** tab contains prebuilt automation patterns (e.g., "Daily Database Backup").

- **Browsing:** Each template shows its target platforms, intended schedule, and the command it will execute.
- **Applying:** Click **"Apply Template"** to open the creation flow. TaskHub will attempt to register this new task on your machine via the local agent or API.

---

## 4. System Status

The **Sidebar** provides a live summary of your infrastructure health:
- **Windows Agent:** Shows "Online" if your local machine is currently connected via WebSocket.
- **Claude API:** Shows "Healthy" if your API credentials are valid and responding.

---

*Last Updated: June 2, 2026*
