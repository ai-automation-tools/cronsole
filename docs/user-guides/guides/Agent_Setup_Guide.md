# Cronsole Windows Agent Setup Guide

This guide details how to install, register, and run the **Cronsole C# Agent** on Windows. 

The agent runs as a headless (windowless) background process that connects to the Cronsole server via WebSockets. It syncs scheduled tasks and listens for "Run Now" execution requests from the Cronsole Dashboard.

---

## 🛠️ Requirements

- **Windows 10 or 11**
- **.NET 10 SDK** (to build the C# project — the agent targets `net10.0`)
- **Administrator Privileges** (required to register tasks with high privileges in Windows Task Scheduler)

---

## ⚡ Quick Setup (Automated)

The repository provides an automation script, [setup-agent-startup.ps1](../../../agent/setup-agent-startup.ps1), that compiles the agent and registers it in Windows Task Scheduler under a dedicated folder.

1. Open **PowerShell** as **Administrator**.
2. Navigate to the agent directory (inside your clone of the repo):
   ```powershell
   cd path\to\cronsole\agent
   ```
3. Execute the registration script:
   ```powershell
   Set-ExecutionPolicy Bypass -Scope Process -Force; .\setup-agent-startup.ps1
   ```

### What the Script Does:
1. **Stops Any Running Agent**: Stops the `CronsoleAgent` scheduled task and kills any running `Cronsole.Agent` process first, so the publish step never fails on a locked `.exe`. The script is safe to re-run at any time (e.g. after pulling agent code changes).
2. **Compiles Headlessly**: Publishes the C# Agent project in `Release` mode targeting `win-x64`. Since the project's `<OutputType>` is configured as `WinExe`, it runs silently in the background without opening any console/terminal window.
3. **Cleans Up Legacy Tasks**: Scans Windows Task Scheduler for any existing `CronsoleAgent` registrations (whether at the root `\` or in subfolders) and unregisters them to prevent duplicate executions.
4. **Registers in dedicated Folder**: Creates and registers a new task named `CronsoleAgent` inside the `\Cronsole-Stack\` Task Scheduler folder.
5. **Logon Trigger**: Configures the task to trigger automatically whenever you log into Windows, using the current user context with highest privileges.
6. **Settings that keep it running**:
   - **No execution time limit** — Task Scheduler's default is 72 hours, which would silently kill the long-running agent after 3 days (restart-on-failure does not apply to time-limit kills).
   - Allows execution on battery power and prevents stopping when going on battery.
   - Set to automatically restart up to 3 times (every 1 minute) if it encounters an unexpected exit.
7. **Launches Background Agent**: Starts the scheduled task immediately.

---

## 🔍 Verification & Monitoring

### 1. Task Scheduler Check
Open the Windows **Task Scheduler** (`taskschd.msc`):
- Expand the **Task Scheduler Library** folder.
- Locate the **`Cronsole-Stack`** folder.
- You should see the **`CronsoleAgent`** task listed inside, with the status **Running**.

> [!NOTE]
> Since the agent is a persistent background daemon, its status in Task Scheduler should remain permanently as **Running**.

### 2. Process Check
To confirm the agent process is running silently in the background:
- Open **Task Manager** and look for `Cronsole.Agent.exe` in the Details tab.
- Alternatively, check via PowerShell:
  ```powershell
  Get-Process -Name Cronsole.Agent
  ```

### 3. Connection Check
To verify that the agent has connected to the Cronsole server:
- Open the Cronsole Dashboard ([http://localhost:7373/](http://localhost:7373/)).
- **Windows Task Scheduler** in the dashboard's source rail should carry a green dot (**Online**).
- Verify that your local Windows scheduled tasks are successfully imported/synchronized.

---

## 🔧 Manual Build & Run (For Development)

If you are developing or debugging the agent and want to run it directly inside a visible terminal:

1. Open a standard terminal window.
2. Navigate to the project folder:
   ```bash
   cd agent/Cronsole.Agent
   ```
3. Run the project:
   ```bash
   dotnet run
   ```
   *(This starts the agent in the foreground, showing log output like `Connecting to server...` and `Connected to Cronsole server!`)*

---

## 💡 Troubleshooting

### Error: "Access is denied"
*   **Cause**: The PowerShell prompt running the script does not have Administrator privileges.
*   **Solution**: Close PowerShell, right-click the PowerShell shortcut, choose **Run as Administrator**, and rerun the script.

### Rebuilding while Agent is running locks files
*   **Cause**: The operating system locks the compiled `.exe` while it is active.
*   **Solution**: `setup-agent-startup.ps1` now stops the running agent automatically before publishing. For manual `dotnet build`/`publish` runs, stop the process yourself first:
    ```powershell
    Stop-Process -Name "Cronsole.Agent" -Force
    ```

### Agent shows Offline after the backend restarts
*   **Cause (historical)**: The socket library only retries reconnection ~10 times before giving up permanently, so a backend outage longer than about a minute used to leave the agent silently disconnected until manually restarted.
*   **Current behavior**: The agent runs a 30-second watchdog that re-attempts the connection indefinitely — it recovers on its own within ~30s of the backend coming back, including when the agent starts at logon before the backend is running. If the agent stays Offline for minutes, verify the backend is actually listening on port 3000 and that the `Cronsole.Agent` process exists (see Verification above), then restart the scheduled task as a last resort:
    ```powershell
    Start-ScheduledTask -TaskPath "\Cronsole-Stack\" -TaskName "CronsoleAgent"
    ```
