<a id="native-top"></a>

<h1 align="center">🖥️ Cronsole-Native Task Prompts</h1>

<p align="center">
  <em>HTTP calls and scripts run by the Cronsole backend itself — no agent, no OS scheduler,
  and a real exit code in the history.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Cronsole--native-2ea44f?style=for-the-badge" alt="Cronsole-native">
  <img src="https://img.shields.io/badge/agent-not_required-6B7280?style=for-the-badge" alt="No agent required">
</p>

---

A Cronsole-native task has no counterpart on your machine — the database row **is** the task,
and Cronsole's own scheduler fires it. That buys three things a Windows task can't give you:

- **It works with no agent installed**, which matters on macOS and on a fresh clone.
- **The cron is used exactly as written.** No trigger conversion, so none of the lossiness that
  can turn a monthly job into an hourly one.
- **The run history is real.** Exit code, duration and captured output land in the task
  history, where a Windows task can only tell you the agent accepted the start.
- **"It failed" and "it wouldn't run" are different answers.** A native job runs inside the
  request, so when you ask an assistant to run one, a job that executed and **failed** comes
  back as a normal result reporting the failure and what caused it — that is a finding about
  your system, and re-running changes nothing. An *error* means it could not be started at all.
  Only the second is worth retrying. (This is why a failing check is worth asking for by name:
  "run my disk check and tell me what it found" gets you the measurement, not a shrug.)

There are **four** job types and they share nothing, which is the one thing to keep straight:
**HTTP**, **Programs** (`EXEC`), **Scripts** (`SCRIPT`, added 2026-08-15 — the body lives in
Cronsole) and **Checks** (`CHECK`, same date — a probe plus an assertion). The two newest have no
prompt section of their own here yet; the tools are `create_native_script_task` and
`create_native_check_task`, and [ADR 0002](../../adr/0002-native-job-types.md) describes what each
is for.

## 🌐 Create an HTTP task

The job is a request: ping a health endpoint, fire a webhook, poke a deploy hook.

```text
Using Cronsole, create a native task that GETs https://my-service.example.com/health
every 15 minutes so I find out when it goes down.
```

```text
Using Cronsole, create a native HTTP task called "Nightly Reindex" that POSTs to
https://api.example.com/admin/reindex at 2am Pacific with an Authorization
header reading Bearer $REINDEX_TOKEN and a JSON body of {"scope":"all"}. Set the
Content-Type header too.
```

```text
Using Cronsole, set up a heartbeat: hit https://hc-ping.com/abc-123 every five
minutes as a native task, category "Monitoring".
```

```text
Using Cronsole, create a native task that PUTs to my staging cache-clear endpoint
every morning at 6am Pacific. Show me the full job spec — method, headers, body —
before you create it.
```

> [!NOTE]
> `create_task` with `platform: TASKHUB_NATIVE` also works and is shorter, but it only takes a
> **URL** and always makes it a GET. The moment you need a method, a header or a body, it's
> `create_native_task` — ask for that by name if your assistant reaches for the short form.

## 📜 Create a script task

The job is a program. The command is tokenized server-side and run with **no shell**, the same
guarantee the Windows path has.

```text
Using Cronsole, create a native script task named "Reconcile" that runs
python /srv/scripts/reconcile.py --full every night at 1am UTC, working directory
/srv/scripts, and kill it if it runs longer than 15 minutes.
```

```text
Using Cronsole, create a native task that runs
git -C "D:\AI_Agents\Projects\my-app" pull --ff-only every six hours. I want the
real exit code recorded so I can tell a failed pull from a skipped one.
```

```text
Using Cronsole, schedule node /srv/tools/digest.js as a native task at 6am UTC
daily. Give it a 10-minute timeout and put it in the "Reports" category.
```

```text
Using Cronsole, run my backup script as a native task nightly, then show me the
last three runs with their exit codes and captured output so I can confirm it's
actually working rather than just being scheduled.
```

Timeouts default to **5 minutes** and cap at **60**. A job that needs longer than an hour
belongs on the Windows agent, which doesn't wait around for it.

## 📍 Where does it actually run?

This is the question that decides whether a native script task works at all. It runs wherever
**the backend** runs — your own machine on a normal local install, and **inside the container**
on a Dockerized stack, against a filesystem that is not yours. A path you can see in Explorer
may simply not exist there, and the failure reads as "executable not found".

```text
Using Cronsole, list the platforms and tell me the execution host for
Cronsole-native tasks on this install. If it's a container, say so before we
schedule anything that touches a local path.
```

```text
Using Cronsole, I want to run D:\scripts\report.ps1 on a schedule. Check whether
the backend can even see that path — if it's containerized, create this as a
Windows task instead and explain why.
```

Two more properties worth knowing, because they surprise people:

- **The child process gets an allowlist, not the backend's environment.** It inherits PATH,
  HOME and the OS essentials plus whatever the job sets explicitly. That's deliberate: the
  backend process holds the database URL, the JWT secret and the key that encrypts every stored
  platform credential, and a scheduled script should never be able to read them.
- **Native tasks don't hold local wall-clock time across a daylight-saving change.** The stored
  UTC cron is evaluated forever, so a 2am Pacific job becomes 3am when the clocks move. A
  Windows task keeps the wall-clock hour. If that matters, say so and put it on Windows.

## ✏️ Change what a native task runs

```text
Using Cronsole, the native task "Nightly Reindex" points at the wrong endpoint.
Show me its current job spec, then repoint it at the v2 admin URL and keep the
headers as they are.
```

```text
Using Cronsole, change my uptime check from a GET to a HEAD request — same URL,
same schedule.
```

> [!WARNING]
> `update_native_job` **replaces** the job, it does not merge. HTTP jobs and script jobs share
> no fields, so switching type discards everything from the old one — a URL doesn't survive a
> change to a script job, it just stops being read. Ask the assistant to tell you what a type
> switch throws away *before* it makes it.

## 🗑️ Deleting one

Native is the **only** platform an MCP assistant can delete on, and that's not a limitation to
work around — it's the point. Where delete is allowed, the row is the task, so nothing is left
orphaned on your machine. Windows removal over MCP is
[untrack](cleanup-and-removal.md), which leaves the real task running.

```text
Using Cronsole, delete the native task "MCP Test - Webhook Ping". It was a
one-off check.
```

The route archives the definition and the last 20 runs before it destroys anything, and refuses
the delete outright if that archive write fails. You can read it back:

```text
Using the Cronsole REST API, list my deleted-task archives
(GET /api/tools/task-archives) and show me the definition of the one I removed
this morning.
```

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🪟 Windows task prompts**](windows-tasks.md) | When the job must run as you, on your desktop, or outlive Cronsole. |
| [**🧹 Cleanup & removal**](cleanup-and-removal.md) | Untrack vs. disconnect vs. delete, and which one you actually want. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Reading exit codes and output — the thing native tasks are good at. |
| [**⚙️ Setup & configuration**](../../setup/README.md) | Docker vs. host stack, which decides the execution host above. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="windows-tasks.md">Windows tasks</a> ·
  <a href="claude-routines.md">Next: Claude routines →</a>
</p>

<p align="right">(<a href="#native-top">back to top</a>)</p>
