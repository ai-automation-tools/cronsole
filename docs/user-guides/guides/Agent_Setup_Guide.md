<h1 align="center">🤖 Windows Agent Setup Guide</h1>

<p align="center">
  <em>Install, register and run the local .NET agent — the process that lets Cronsole
  read and control real Windows Task Scheduler entries on your machine.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="Platform: Windows">
  <img src="https://img.shields.io/badge/runtime-.NET_10-512BD4?style=for-the-badge&logo=.net&logoColor=white" alt="Runtime: .NET 10">
  <img src="https://img.shields.io/badge/connection-outbound_WebSocket-2ea44f?style=for-the-badge" alt="Connection: outbound WebSocket">
</p>

---

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
1. **Stops Any Running Agent**: Kills any running `Cronsole.Agent` process (and the pre-rename `TaskHub.Agent`) first, so the publish step never fails on a locked `.exe`. The script is safe to re-run at any time (e.g. after pulling agent code changes).
2. **Compiles Headlessly**: Publishes the C# Agent project in `Release` mode targeting `win-x64`. Since the project's `<OutputType>` is configured as `WinExe`, it runs silently in the background without opening any console/terminal window.
3. **Retires the Legacy Task**: Scans Windows Task Scheduler for any leftover `CronsoleAgent` registration (at the root `\` or in subfolders) and unregisters it. **The agent is no longer its own scheduled task** — see the note below.
4. **Checks the Launcher**: Confirms `\Cronsole-Stack\CronsoleStack` is registered. That task runs `cronsole.ps1 up` at logon and every 5 minutes, and starting the agent is one of the things `up` does. If it is missing, the script tells you the one elevated command that registers it.
5. **Starts the Stack**: Runs `cronsole.ps1 up`, which brings up Docker, Postgres, Redis, the backend, the frontend and the agent — whichever of them are not already running.

> [!IMPORTANT]
> **The agent is not a scheduled task any more** (changed 2026-08-25). It used to be registered
> here as `\Cronsole-Stack\CronsoleAgent` — but `Register-CronsoleStack.ps1` also registered
> **that same name** with a completely different action, so the two scripts fought over one task
> name and whichever ran last won. On the definition that shipped, the documented
> `Stop-ScheduledTask` / `Start-ScheduledTask` bounce did **nothing at all**, while reporting
> success. One owner per task name; the agent's owner is `CronsoleStack`. See
> [troubleshooting #86](../../troubleshooting/README.md#86-stop-scheduledtask-on-a-launcher-task-reports-success-and-stops-nothing).
>
> To **rebuild** the agent later, use `CronsoleRepublish` rather than re-running this script — it
> is elevated, so it can stop an agent running at `RunLevel Highest` and overwrite its locked exe.
> To **restart** it, use `CronsoleRestart`.

---

## 🔍 Verification & Monitoring

### 1. Task Scheduler Check
Open the Windows **Task Scheduler** (`taskschd.msc`):
- Expand the **Task Scheduler Library** folder.
- Locate the **`Cronsole-Stack`** folder.
- You should see **`CronsoleStack`**, **`CronsoleRepublish`** and **`CronsoleRestart`** listed inside.

> [!NOTE]
> **All three will read `Ready`, never `Running` — that is correct and is not a problem.** Each
> launches through `run-hidden.vbs`, which is fire-and-forget, so the task instance ends within a
> second while the processes it started run on independently. A task in this folder tells you
> nothing about whether the stack is up; ask the stack instead:
>
> ```powershell
> pwsh scripts\cronsole.ps1 status
> ```

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
    Start-ScheduledTask -TaskPath "\Cronsole-Stack\" -TaskName "CronsoleRestart"
    ```

---

<p align="center">
  <a href="../README.md">← User Guides</a> ·
  <a href="../../README.md">Docs home</a> ·
  <a href="../../troubleshooting/README.md">Troubleshooting</a>
</p>

