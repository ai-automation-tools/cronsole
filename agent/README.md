<h1 align="center">🪟 Windows Agent</h1>

<p align="center">
  <em>The .NET service that reads and changes Windows Task Scheduler on Cronsole's behalf.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/.NET-10-512BD4?style=for-the-badge&logo=.net&logoColor=white" alt=".NET 10">
  <img src="https://img.shields.io/badge/connects-outbound_only-2ea44f?style=for-the-badge" alt="Outbound only">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-repository_root-6B7280?style=for-the-badge" alt="Repository root"></a>
</p>

---

The agent runs elevated on your machine and opens a WebSocket **to** the backend. It never listens
for connections and has no file-write verb. Every command it accepts is HMAC-signed for the session,
so the backend can only ask it to do what the signature covers.

It is a published exe and **never hot-reloads**. After any change in this folder, republish it
(below). Restarting the stack alone leaves the old binary running.

## 📂 What's in here

| Path | What it holds |
|:---|:---|
| **`Cronsole.Agent/`** | The service: socket client, authenticator, Task Scheduler COM wrapper, and the trigger builder and reader that convert between cron and Windows triggers. |
| **`Cronsole.Agent.Tests/`** | Unit tests, including the trigger round trips. |
| **`test-server/`** | A small Node stub of the backend's handshake and command signing, for driving the agent by hand. |
| **`setup-agent-startup.ps1`** | Builds the agent and hands it to the `\Cronsole-Stack\` launcher, which keeps it running. |

## ⚡ Commands

```powershell
dotnet build Cronsole.Agent.slnx
dotnet test Cronsole.Agent.slnx
# Swap in a new build of the running agent (elevated, logs to %TEMP%\cronsole-republish.log):
Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'
```

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🤖 Windows Agent Setup Guide**](../docs/user-guides/guides/Agent_Setup_Guide.md) | Installing, pairing, verifying and troubleshooting it. |
| [**🪟 Windows Task Scheduler**](../docs/user-guides/sources/Windows_Task_Scheduler.md) | What Cronsole can do with your tasks through the agent. |
| [**🛡️ Trust**](../docs/TRUST.md) | Every verb the elevated agent has, and how to remove it. |
| [**🔧 Auto-start launcher**](../scripts/startup-task/README.md) | The scheduled tasks that start and restart it. |

---

<p align="center">
  <a href="../README.md">← Repository root</a> ·
  <a href="../backend/README.md">Backend</a> ·
  <a href="../frontend/README.md">Frontend</a>
</p>
