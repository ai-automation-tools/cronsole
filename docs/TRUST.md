<a id="trust-top"></a>

<h1 align="center">🛡️ What Cronsole Can Do On Your Machine</h1>

<p align="center">
  <em>The elevated process, the exact list of what it can and cannot do, and how to remove it.</em>
</p>

<p align="center">
  <a href="PRIVACY.md"><img src="https://img.shields.io/badge/see_also-what_leaves_your_machine-8B5CF6?style=for-the-badge" alt="Privacy"></a>
  <a href="../SECURITY.md"><img src="https://img.shields.io/badge/reporting-SECURITY.md-2ea44f?style=for-the-badge" alt="Security policy"></a>
  <a href="README.md"><img src="https://img.shields.io/badge/↩-documentation-6B7280?style=for-the-badge" alt="Docs"></a>
</p>

---

## The short version

Cronsole asks for a lot: it runs a **background process with administrator rights** that can
create, change, run and delete scheduled tasks on your computer. That is not a footnote — it is
the product. A task manager that cannot manage tasks would be a picture of one.

Cronsole ships as **source**. There is no installer, no signed binary, no download — you clone the
repository and build it, which means the thing asking for elevation is something you can read
before you run it. That is the trade this project made deliberately
([the argument](ROADMAP.md#open-decisions)), and this page exists because *"read the source"* is
only an honest answer if something tells you **what to read**.

So: below is what the agent can do, stated as the complete list rather than a summary; what it
cannot do, and what enforces that; and how to take all of it off your machine.

---

## 1. The agent, and why it is elevated

The **Cronsole agent** (`agent/Cronsole.Agent.exe`) is a small .NET program that talks to the
Windows Task Scheduler on Cronsole's behalf. It runs **as you, at the highest run level** —
administrator.

It is registered by `scripts/startup-task/Register-CronsoleStack.ps1` as:

```
\Cronsole-Stack\CronsoleStack    interactive user · RunLevel Highest · every 5 minutes
```

**Why elevation is genuinely required**, and not just convenient: Task Scheduler enumeration is
bounded by the token doing the enumerating, not by the machine. Unelevated, the agent cannot see
`\Microsoft\Windows\TPM\`, `\UpdateOrchestrator\`, `\Pluton\` and a dozen other ACL'd folders — on
one real machine that was **86 of 371 tasks**, invisible, with every layer of the stack reporting
success. A dashboard that silently cannot see a quarter of your scheduled tasks is worse than no
dashboard, because you would trust it
([the incident](troubleshooting/README.md#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy)).

Cronsole's response to that was not only to take the elevation. It was to make the agent **report
its own integrity level**, and to forbid retirement of any task from a view that might be narrowed —
*connected*, *answering* and *elevated* are three separate facts, and only the third one makes a
missing task mean anything.

---

## 2. What the agent can do — the complete list

This is not a summary. **Ten** of these are the whole of the agent's scheduler interface
([`ITaskScheduler.cs`](../agent/Cronsole.Agent/ITaskScheduler.cs)) — open that file and you have
seen everything the agent can ask Windows to do. The eleventh, reading a task's run history, goes
through a separate reader ([`TaskHistoryReader.cs`](../agent/Cronsole.Agent/TaskHistoryReader.cs))
and is listed here rather than left out because a page like this is worth nothing if it is only
*nearly* complete.

### Reads

| Verb | What it does |
|:---|:---|
| `ListTasks` | Every scheduled task it can see: path, state, last/next run, last result, missed runs, trigger, author, user, run level, and the actions each one runs |
| `ListFolders` | Every Task Scheduler folder that exists, including ones Cronsole will not write to |
| `ExportTaskXml` | One task's native Task Scheduler XML, byte-identical to what the Task Scheduler UI's own Export produces |
| *(task history)* | Windows' recorded run events for one task, when Windows' per-task history is switched on |

### Writes

| Verb | What it does |
|:---|:---|
| `CreateTask` | Registers a new scheduled task |
| `ImportTaskXml` | Registers a task from a whole XML definition — the only write that takes a complete task from outside |
| `UpdateTaskSchedule` | Replaces a task's trigger, preserving its actions and principal |
| `UpdateTaskActions` | Replaces a task's program, description and run level, preserving its triggers |
| `SetTaskStatus` | Enables or disables a task |
| `RunTask` | Starts a task now |
| `DeleteTask` | Removes a task |

**Say the consequential part out loud:** a task Cronsole registers runs **a program you named, with
the privileges you gave it, on a schedule**. `CreateTask` and `UpdateTaskActions` are therefore, in
the end, a way to make your computer run a program later. That is what a scheduler *is* — but it
means the honest description of the agent's power is not "it edits task metadata." It is: **anything
you can schedule by hand, Cronsole can schedule for you.**

What the agent will not do is *choose* the program. Every action is a structured
`{ executable, args[] }` pair — never a command string handed to a shell — so there is no
interpolation step in which a filename could become an extra command
([`ArgumentQuoting.cs`](../agent/Cronsole.Agent/ArgumentQuoting.cs)).

---

## 3. What the agent cannot do

Each of these is enforced in code, not by convention.

- **It has no file-write verb.** There is no "save this file", no "read that path". The agent is an
  elevated process reachable from a web backend; a general file-write primitive there would be a
  far larger gift to an attacker than the scheduler access itself. Exporting a task returns XML
  *over the socket* — nothing is written to disk.
- **It never accepts an incoming connection.** The agent always dials **out** to the backend and
  never binds a port or listens on one. Nothing on your network — or anyone else's — can connect
  *to* the agent, because there is nothing to connect to.
- **It will not touch `\Microsoft\`.** Windows' own tasks live there and a name collision would
  silently overwrite one. This is refused in the backend **and again, independently, in the agent**,
  so a bug or a forged command in one does not get past the other.
- **It creates only `\Cronsole`.** Two exceptions exist, both off by default, both carried *inside*
  the command's signature so they cannot be added in transit: a restore recreating your own folder
  tree, and a create placing a task in a folder you named. Every folder either one creates is
  reported back by name, including when the operation then fails.
- **It cannot be told to do something Cronsole did not sign.** Every state-changing command carries
  a per-session HMAC signature over a shared pairing secret, plus a timestamp and a nonce. The agent
  verifies the signature, rejects anything outside a 120-second freshness window, and accepts a
  given signature **once** — so a captured command frame cannot be replayed. Everything that widens
  a command's blast radius (the target folder, `overwrite`, `createFolders`, a restore's content
  hash) rides *inside* the signature rather than beside it
  ([`AgentAuthenticator.cs`](../agent/Cronsole.Agent/AgentAuthenticator.cs)).
- **It does not update itself.** There is no update channel and no self-replacing binary. An
  elevated process that rewrites its own executable is exactly the thing worth attacking; Cronsole's
  update mechanism is `git pull` followed by a rebuild you run.

---

## 4. What an AI assistant can do through Cronsole

Cronsole ships an [MCP server](user-guides/guides/MCP_Server_Guide.md) so an assistant like Claude
can drive it. The boundary there is deliberately **tighter** than the dashboard's:

- **No MCP verb can destroy anything on your machine.** `delete_task` only ever reaches
  Cronsole's own native jobs — it refuses every other platform, including Windows. Removing a
  Windows task through an assistant means `untrack_task`, which stops Cronsole watching it and
  **leaves the task itself running**.
- **`delete_task` is off unless you switch it on** (`CRONSOLE_MCP_ALLOW_DESTRUCTIVE`), and when
  off it is not merely refused — it is **absent from the tool list**, so an assistant cannot
  attempt it.
- **There are no bulk verbs.** Friction should scale with blast radius, and an assistant has no
  equivalent of the dashboard's typed confirmation.

---

## 5. What is running after you install it

A complete inventory, so nothing is a surprise later:

| What | Where | Notes |
|:---|:---|:---|
| `Cronsole.Agent.exe` | a host process | Elevated. Outbound WebSocket only |
| Backend + frontend | host Node processes, or Docker | Bound to **loopback** |
| Postgres + Redis | Docker containers | Bound to **loopback** |
| `\Cronsole-Stack\CronsoleStack` | Scheduled Task | Elevated · every 5 min · restarts anything that died |
| `\Cronsole-Stack\CronsoleRepublish` | Scheduled Task | Elevated · on demand · rebuilds the agent |
| `\Cronsole-Stack\CronsoleRestart` | Scheduled Task | Elevated · on demand · bounces the stack |
| `\Cronsole\…` | Scheduled Tasks | **Tasks you created.** Ordinary Windows tasks |

Nothing here is reachable from outside your machine unless you deliberately turn on
[remote access](user-guides/guides/Remote_Access_Guide.md), which is opt-in, binds to loopback, and
expects an access-gated tunnel in front of it.

---

## 6. How to remove it completely

**Read this part before you uninstall, because the obvious command does less than it looks like it
does.**

> ### ⚠️ `docker compose down -v` removes Cronsole's database, not the tasks Cronsole created.
>
> Deleting the volume deletes Cronsole's *view* — which tasks it tracked, your collections,
> favorites, run history, archives and stored job secrets. **The scheduled tasks themselves keep
> running.** They are ordinary Windows Task Scheduler entries and always were; Cronsole never owned
> them, which is the entire premise of the product turned around to face its own uninstall.
>
> This is correct behavior, and it is the thing nobody would guess.

A complete removal, in order:

```powershell
# 1. Stop the stack and delete its data volume.
cd <your cronsole clone>
docker compose down -v

# 2. Remove the three launcher tasks. These are the ones that would otherwise
#    restart everything within five minutes.
Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleStack'      -Confirm:$false
Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'  -Confirm:$false
Unregister-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'    -Confirm:$false

# 3. Decide what to do with the tasks you SCHEDULED. This is the step that
#    needs a human: they are your jobs, and they still run.
Get-ScheduledTask -TaskPath '\Cronsole\*'

# 4. Delete the clone.
```

Three things worth knowing while you do it:

- **Step 2 needs an elevated PowerShell.** The `\Cronsole-Stack\` folder and its tasks were created
  by an elevated process and carry an administrator ACE, so an ordinary prompt cannot remove them.
- **Step 3 is deliberately not automated.** Cronsole will not mass-delete your scheduled jobs on
  the way out; deciding which of your own tasks should stop running is not a decision an uninstaller
  gets to make.
- **Nothing is left anywhere else.** The agent stores its configuration in `appsettings.json` inside
  the clone, not in `AppData`, `ProgramData` or the registry. Deleting the folder is genuinely the
  end of it.

---

## 7. How to check any of this yourself

Everything above is a claim about code you have a copy of. The useful thing about shipping as
source is that you can settle it rather than believe it:

| To check… | Look at |
|:---|:---|
| The complete verb list | [`agent/Cronsole.Agent/ITaskScheduler.cs`](../agent/Cronsole.Agent/ITaskScheduler.cs) — if a verb is not in that interface, the agent cannot do it |
| That it only dials out | [`SocketIOWrapper.cs`](../agent/Cronsole.Agent/SocketIOWrapper.cs) — a client, with no listener anywhere in the project |
| Command signing and replay | [`AgentAuthenticator.cs`](../agent/Cronsole.Agent/AgentAuthenticator.cs) |
| What is actually registered right now | `Get-ScheduledTask -TaskPath '\Cronsole*'` |
| What the agent is doing | The **Diagnostics** screen, or `/doctor` |

Found something wrong? [`SECURITY.md`](../SECURITY.md) says where to send it, and what is in scope.

---

<p align="center">
  <a href="PRIVACY.md">What leaves your machine →</a> ·
  <a href="README.md">Documentation home</a> ·
  <a href="../SECURITY.md">Security policy</a>
</p>
