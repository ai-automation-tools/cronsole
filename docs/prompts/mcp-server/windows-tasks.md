<h1 align="center">🪟 Windows Task Scheduler Prompts</h1>

<p align="center">
  <em>Ask an assistant for a real Task Scheduler job — scripts, backups, maintenance —
  and get one registered on your machine through the local agent.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows_Task_Scheduler-0078D4?style=for-the-badge" alt="Windows Task Scheduler">
  <img src="https://img.shields.io/badge/needs-local_agent-F59E0B?style=for-the-badge" alt="Needs the local agent">
</p>

---

These prompts create tasks that Windows itself runs — on your desktop, as you, whether or not
Cronsole is up. The MCP tool behind almost all of them is `create_task` with
`platform: WINDOWS_TASK_SCHEDULER`, which hands the job to the elevated local agent over a
signed command.

Two things decide whether a prompt here works:

- **The agent has to be online.** Cronsole cannot register a Windows task on its own. If it's
  offline the create fails with a 502 rather than half-succeeding — check the sidebar or the
  [Agent Setup Guide](../../user-guides/guides/Agent_Setup_Guide.md).
- **The folder has to exist already.** Cronsole creates only its own `\Cronsole` folder,
  because deleting a folder the elevated agent made needs administrator rights and Cronsole
  won't leave you one to clean up by hand.

## 🗓️ Check the schedule before you commit to it

Windows triggers can't express every cron. When the converter can't build one, it **replaces**
your expression with an hourly trigger — a job you wanted once a month runs about 8,760 times a
year instead. The warning it returns is mild-sounding, so make the assistant look at the actual
trigger.

```text
Using Cronsole, convert the cron "0 9 * * 1-5" to a Windows trigger. Tell me the
exact days and the local time it will fire, and say plainly whether anything was
approximated or replaced.
```

```text
Using Cronsole, I'm on US Pacific and I want this to run at 6:30am on weekdays.
Work out the UTC cron, run it through convert_schedule, and show me the resulting
trigger and the next five run times before you create anything.
```

```text
Using Cronsole, check "30 2 15 * *" as a Windows trigger. If it converts lossily,
suggest the closest expression that converts cleanly and explain what changes.
```

## 📜 Run a script on a schedule

```text
Use the Cronsole MCP server to create a Windows task named "Nightly Backup" that
runs D:\jobs\nightly-backup.ps1 every day at 2am Pacific. Put it in \Cronsole,
check the schedule conversion first, and confirm the registered action afterwards.
```

```text
Using Cronsole, create a Windows task that runs
C:\Python312\python.exe D:\scripts\reconcile.py --full
every weekday at 5pm Eastern. Name it "Daily Reconcile" and tell me the UTC cron
you used.
```

```text
Using Cronsole, schedule my Node maintenance script — node D:\tools\cleanup.js —
to run every six hours starting on the hour. Show me what the action looks like
after it registers.
```

> [!IMPORTANT]
> Commands are **tokenized with no shell**. `powershell.exe -File x.ps1` is an executable plus
> arguments, so `|`, `>`, and `&&` are ordinary characters rather than operators. If the job
> genuinely needs a shell, ask for one by name:
>
> ```text
> Using Cronsole, create a Windows task that runs
> cmd.exe /c "D:\jobs\export.exe > D:\logs\export.txt 2>&1"
> nightly at 11pm Pacific. I know that opts into a shell — I need the redirection.
> ```

## 🧹 Recurring maintenance

```text
Using Cronsole, create a Windows task called "Prune Docker" that runs
docker system prune -f every Sunday at 3am Pacific. Verify the trigger before
you finish.
```

```text
Using Cronsole, set up a weekly task that empties C:\temp of anything older than
14 days. Use PowerShell, keep it read-only about everything else, and log what it
deleted to C:\logs\temp-prune.log.
```

```text
Using Cronsole, I want my Downloads folder archived monthly. Create a Windows
task on the first of each month at 4am Pacific and tell me the trigger it built,
since day-of-month crons are the ones that convert badly.
```

## 📁 Folders and naming

```text
Using Cronsole, what Task Scheduler folders can I create a task in on this
machine? I want an existing one, not a new one — list which are writable.
```

```text
Using Cronsole, create "Weekly Report" in the \Work\Reports folder. If that
folder doesn't exist, stop and tell me rather than creating it.
```

```text
Using Cronsole, create "Repo Sync" in a new folder called \AI-Tools. I know
Cronsole normally refuses to create folders — I want this one, and I understand
I'll need administrator rights to remove it later.
```

> [!WARNING]
> `createFolder` is the one flag here you can't take back cheaply. The agent runs elevated, so
> a folder it creates carries an administrator ACE: deleting it later needs an elevated prompt,
> and Cronsole never removes it for you. A typo becomes a permanent folder. `\Microsoft\` is
> refused outright no matter what you set — Windows keeps its own tasks there and a name
> collision would overwrite one silently.

A duplicate name in the same folder returns a **409**, not a silent overwrite. That refusal is
deliberate; ask for a different name rather than trying to force it.

## ⚠️ What "success" means here

A Windows task's `SUCCESS` in Cronsole's run history means **the agent accepted the start** —
it's fire-and-forget, and the recorded duration times the round trip, not the job. A task that
hangs for six hours still shows green.

```text
Using Cronsole, run "Nightly Backup" now, then check its history. If Cronsole
only recorded that it started, say so — I want to know whether the script itself
finished, not just that the agent accepted it.
```

```text
Using Cronsole, show me the health scores for my Windows tasks worst-first, and
for each signal tell me which field it came from. I don't want a number without
its source.
```

And a Windows task firing on its **own** trigger writes nothing to Cronsole's run history at
all — Windows records that, in `lastTaskResult`. An empty history is not evidence the task
never ran, and a good assistant will say so.

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🤖 AI agent jobs**](ai-agent-jobs.md) | Headless Claude Code / Codex runs — the same platform, a much sharper blast radius. |
| [**🖥️ Cronsole-native tasks**](native-tasks.md) | When you'd rather the backend ran it and gave you a real exit code. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Checking what actually ran, and what's quietly failing. |
| [**🤖 Windows Agent Setup**](../../user-guides/guides/Agent_Setup_Guide.md) | Getting the agent online, which every prompt here depends on. |
| [**✍️ Task authoring**](../../../skills/cronsole/references/task-authoring.md) | The invariants behind all of this, written for an agent. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="ai-agent-jobs.md">AI agent jobs</a> ·
  <a href="native-tasks.md">Next: Cronsole-native →</a>
</p>
