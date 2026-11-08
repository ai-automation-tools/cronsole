<a id="native-top"></a>

<h1 align="center">⚡ Cronsole-native</h1>

<p align="center">
  <em>Jobs Cronsole schedules and runs itself — no operating system entry, no agent.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-controller-8B5CF6?style=for-the-badge" alt="Controller">
  <img src="https://img.shields.io/badge/job_types-4-2ea44f?style=for-the-badge" alt="Four job types">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

A native task **is** a row in Cronsole's database. Nothing is registered with an operating system, so
there is no agent to install and nothing to go stale — and the flip side is the thing to understand
before you use it: **when Cronsole is down, a native task does not run.** For work that must survive
that, use [Windows Task Scheduler](Windows_Task_Scheduler.md).

---

## 🗺️ At a glance

| Capability | What it gives you | Section |
|:---|:---|:---|
| **Four job types** | Call a URL, run a program, run a script written in the task, or check something and compare it | [The four job types](#-the-four-job-types) |
| **Send a message** | A Discord, Slack, ntfy or webhook post, filled in for you, with the address kept as a secret | [Sending a message](#-sending-a-message) |
| **Time limits** | A program or script may run up to 24 hours (default 5 minutes) | [Run settings](#-run-settings) |
| **Retries** | A scheduled run that fails is tried again, up to 5 more times, 1 to 60 minutes apart | [Run settings](#-run-settings) |
| **Overlap** | If a run is still going when the next is due: skip it, or queue one behind it | [Run settings](#-run-settings) |
| **Catch-up** | One run when Cronsole is back, if it was down at a due time | [Run settings](#-run-settings) |
| **Side by side** | Every due task starts on its own; a slow job never holds up another | [Run settings](#-run-settings) |
| **Chaining** | Start a task when another succeeds, fails, or either | [Chaining tasks](#-chaining-tasks) |
| **On demand** | No schedule at all; runs only from Run now, a chain, a phone shortcut or MCP | [Chaining tasks](#-chaining-tasks) |
| **Secrets** | `${secret.NAME}`, stored encrypted per task and hidden in the run log | [Secrets](#-secrets--store-a-reference-never-the-value) |
| **Pass through** | Hand a variable already set where Cronsole runs (`GH_TOKEN`) to a job by name | [Passing a variable through](#passing-a-variable-through) |
| **Full run history** | Every run, scheduled or not, with its start time, duration, attempt and output | [Run history](#-run-history) |

Everything here is also reachable over MCP: the `create_native_*` tools and `update_native_job` take
the run settings (`timeoutMs`, `retries`, `retryDelayMinutes`, `overlap`, `catchUp`), chaining
(`runAfterTaskId`, `runAfterWhen`) and `passEnv`.

---

## 🧭 When to use it, and when not to

Native is the easiest source to start with, which makes it the easiest to over-use. Three facts
decide almost every case: it runs **only while Cronsole is running**, it runs **on the backend's
host as the backend's account**, and it starts **on a cron clock or when another native task
finishes**, never on a logon, an idle machine or a system event.

**The rule of thumb:** if it would matter that the job did not run while Cronsole was stopped, it is
not a native job.

### ✅ Good fits

| Job | Why native suits it |
|:---|:---|
| Calling a URL or firing a webhook on a schedule | An HTTP job needs nothing installed, and the status code is the verdict. |
| Watching something: an endpoint is up, a port answers, a backup is fresh, a disk has room | That is what [Checks](#-checks--measure-something-and-compare-it) are for. A failure is a fact about your system, and the log records the measurement. |
| A short script you want kept with the task | The body lives in the task, so it travels with an export, the pre-delete archive and a template. No file on disk to lose. |
| A job that needs an API key or token | `${secret.NAME}` is stored encrypted and redacted out of the run log. See [Secrets](#-secrets--store-a-reference-never-the-value). |
| Anything you want a full run history for | Cronsole performs every run, scheduled ones included, so every run is logged with its output. |
| A job that should try again when it fails | [Retries](#-run-settings) are a setting, and each attempt is in the run history with its output. |
| A message to Discord, Slack or ntfy | [Send a message](#-sending-a-message) fills in the request; the webhook address is kept as a secret. |
| One job that should start when another finishes | [Chaining](#-chaining-tasks) is a setting, on success, on failure, or either. Task Scheduler has no clean way to do this. |
| A tool that reads a token already set on the machine, like `gh` and `GH_TOKEN` | [Pass it through](#passing-a-variable-through) by name; its value stays out of the database and the log. |
| A backend on Linux or in Docker, where there is no Windows | Native runs wherever the backend runs. |

### 🚫 Use something else

| If the job… | Use instead | Why |
|:---|:---|:---|
| Must run while Cronsole is stopped, updating or crashed (backups, nightly cleanup) | [Windows Task Scheduler](Windows_Task_Scheduler.md) | A native task is a database row. Nothing runs it when the backend is down. |
| Must run on time even while Cronsole is down | Windows Task Scheduler | [Catch up](#-run-settings) runs a missed job **once Cronsole is back**, which is late. A run that must happen at 3:00 sharp belongs in Windows. |
| Needs your Windows user: your profile, mapped drives, a desktop app, a window | Windows Task Scheduler | Native runs as whatever account runs the backend, and never in your desktop session. |
| Reads or writes files on your desktop while the backend runs in Docker | Windows Task Scheduler, or run the backend on the host | Inside a container, `D:\` is not your `D:\`. |
| Must fire at the same local time across a daylight-saving change | Windows Task Scheduler | Native runs the stored UTC cron, so it shifts by an hour. |
| Runs for more than a day | Windows Task Scheduler | A program or script can run for up to **24 hours** (set on the task; the default is 5 minutes). |
| Is a prompt for an AI agent to work on by itself | [Claude Code Scheduled Tasks](Claude_Code_Routines.md) or [Gemini API Triggers](Gemini_API_Triggers.md) | They run in the vendor's cloud with the model, tools and sandbox, and keep going when your machine is off. |
| Builds or tests code in a repository | [GitHub Actions](GitHub_Actions.md) | Runners, checkouts and logs are GitHub's job. Cronsole shows the schedule and the outcome. |
| Strings several services together with stored credentials | [n8n](n8n.md) | A workflow graph belongs in n8n. Cronsole reads it and can start it. |

Timing is to the half minute: Cronsole checks for due native tasks every 30 seconds. Each run starts
on its own, so a long job never delays another task. How long a run may take, whether a failed run
is retried, and what happens to a missed one are [run settings](#-run-settings) on each task.

---

## 🔌 Connecting

Nothing to connect. Native is up whenever the backend is, which is why its card has a sentence and no
button. It is one of the two sources a fresh install starts with.

---

## 🧰 The four job types

A type is a permanent rail row, so the bar for adding one is "a different *kind* of thing", not
"useful". These are the four, and the fourth is the one people miss.

### 🌐 HTTP — call a URL

A request on a schedule. Method, URL, headers, body. The most common shape is a webhook you want
poked nightly, or a health endpoint you want exercised.

Success is the HTTP status. A 500 is a failed run; a 200 is a successful one.

Created with **New Task › Cronsole › HTTP request**, or from a **Cronsole Native** template
(*Uptime Check* ships built in; *Monitor Heartbeat* is in the gallery). A template applied here
always makes a `GET` — a job that needs a method, headers or a body is a full spec, so use New Task.

**You can change the URL later.** *Edit* on the Action panel of the task modal rewrites the whole
job: URL, method, headers and body. Headers can be pasted as `Name: value` lines straight out of an
API's docs, or as JSON.

#### 💬 Sending a message

An empty HTTP job offers **Send a message to: Discord · Slack · ntfy · Other webhook**. Each one
fills in a `POST` with a sample message in the shape that service expects, so you only edit the text:

| Preset | URL | Body | Secret to set |
|:---|:---|:---|:---|
| **Discord** | `${secret.DISCORD_WEBHOOK_URL}` | `{"content": "…"}` | The channel's webhook URL |
| **Slack** | `${secret.SLACK_WEBHOOK_URL}` | `{"text": "…"}` | The incoming-webhook URL |
| **ntfy** | `https://ntfy.sh/${secret.NTFY_TOPIC}` | Plain text, with a `Title` header | The topic name |
| **Other webhook** | `${secret.WEBHOOK_URL}` | `{"message": "…"}` | The URL |

The address goes in a secret because for these services **the address is the password**: anyone
holding a Discord or Slack webhook URL can post to the channel. Set it under **Secrets** on the same
form. Pair a message with [chaining](#-chaining-tasks) to say something when another task fails.

### 🖥️ Programs (EXEC) — run something already on the host

Structured `{executable, args[]}`, **no shell**. Pipes, redirection and `&&` are not implied — invoke
a shell explicitly (`cmd.exe /c "..."` or `/bin/sh -c "..."`) if you need them. That is a deliberate
opt-in, not an oversight: a shell that appears by accident is how an argument becomes a command.

Its exit code, duration and output are recorded. Created with **New Task › Cronsole › Run a
program**, or from a **Cronsole Native** template — *Run a Program* ships built in, with Node, Python
and `git pull` starters in the gallery.

**Use a Windows task instead** for anything that must run as your logged-in user, needs your user's
privileges, or has to keep running while Cronsole is down. The agent is the thing that unambiguously
means *your machine*; the backend is not.

> [!IMPORTANT]
> **A native job runs where the *backend* runs.** On a Dockerized stack that is inside the container —
> a different filesystem from your desktop. The same spec then fails as "executable not found" for a
> file you can plainly see. The New Task form tells you which host you are targeting; read it before
> typing a `D:\` path.

### 📝 Scripts — write the body in Cronsole

The script itself lives in the task, so there is no file to keep in sync and nothing to lose track
of. A fixed interpreter allowlist decides what can run it. This is the type to reach for when the
work is five lines and inventing a file on disk is the annoying part.

Created with **New Task › Cronsole › Write a script**. The interpreters are a fixed list:
PowerShell, PowerShell 7, Bash, sh, Python and Node.

- **This is the one job type where a shell is expected.** You picked the interpreter and wrote the
  body, so `|`, `&&` and redirection all behave normally. That is not a hole in the no-shell rule —
  that rule bans an *implicit* shell wrapped around a command you typed. Here nothing is re-parsed,
  and **the interpreter is a fixed list, never a path you type**.
- **The interpreter has to exist where the backend runs.** `node` always does — Cronsole itself runs
  on it — which makes it the safe choice inside a container. PowerShell and Python may not be there,
  and the run log says so by name rather than reporting a missing file.
- **The script travels with the task.** You can read and edit it in the app, it is included in an
  export and in the pre-delete archive, and a template carrying one works on a fresh install. None of
  that is true of a program job pointing at a path.
- **Whitespace is preserved exactly.** The body is not trimmed the way a form field is — leading
  indentation matters in Python, and a trailing newline is what makes a shell script's last line run.
- **The temporary file is deleted afterwards**, including when the script times out and is killed,
  and it is written so only the account running the backend can read it.

### ✅ Checks — measure something and compare it

The only type whose **failure is a fact about your system rather than a bug in your script**. A check
measures something — a file's age, a URL's response, a disk threshold — and compares it to what you
expect.

That distinction is load-bearing. A check that correctly finds a problem is the check **working**:
it returns HTTP 200 with `success: false`, not a 502, and it does not mark the platform broken. Only
"could not start at all" is a failure of the verb. It is also why these are the runs worth pointing
failure notifications at, and the ones whose history is worth reading.

Created with **New Task › Cronsole › Check something**. Four kinds:

| Check | What it measures | Fails when |
|:---|:---|:---|
| **Endpoint** | An HTTP request | Status outside the range you set, or the body missing text / a JSON field you require |
| **Port** | A TCP connection | Nothing accepts a connection within 15s |
| **File freshness** | A file's last-modified time | Older than your limit — **or missing** |
| **Disk space** | Free space on a volume | Below your floor |

- **A 200 is not the same as healthy**, which is why an endpoint check is not just an HTTP job. It
  can require the response body to contain a string, or a dotted JSON path (`status.db`) to equal a
  value. An HTTP *job* only asks whether the request was accepted — the right test for firing a
  webhook, the wrong one for monitoring.
- **A missing field and a changed field are reported differently.** `status.db is "up", expected
  "down"` and `status.cache is not present` are different facts about an API, and the run log says
  which.
- **File and disk checks measure the *backend's* filesystem** — the container's, on a Dockerized
  stack, not yours. The form names the execution host before you save, because a check that passes
  against the wrong disk is worse than no check at all.
- **A missing file fails the freshness check** rather than being skipped. The check exists to notice
  that a backup stopped being written; a backup that was never written is the same problem in its
  worst form.
- **The log always states the measurement**, not just a verdict: `D:\backups\nightly.zip last
  modified 3.0h ago (limit 60m)`. The number is the reason you ran the check.

---

## 🎛️ What Cronsole can do here

The same list for all four job types: **Run now · Create · Enable/disable · Edit schedule · Edit what
it runs · Export · Delete.** No agent, no round trip, nothing that can refuse — the write *is* the
change. That is also why the Sources tab shows native as one card while the Source rail splits it into
four rows: they are different things to look at with identical capabilities.

---

## ⏱️ Run settings

Every native task has these, under **Run settings** on the New Task and Edit forms, or as arguments
on the MCP create tools. All are optional, and a task that sets none behaves as it always did.

| Setting | What it does | Default |
|:---|:---|:---|
| **Time limit** | Stops a program or script that runs longer than this. Up to 24 hours. | 5 minutes |
| **If still running when due** | *Skip that run*, or *Run it after this one*. Queuing holds one run, never a backlog. | Skip |
| **Retries after a failure** | Runs a scheduled job again, up to 5 more times, 1 to 60 minutes apart, when it ran and failed. | 0 |
| **Catch up a missed run** | If Cronsole was down when the task was due, runs it once when Cronsole is back, however many due times were missed. | Off |
| **Also run after** | Starts this task when another native task finishes: when it succeeds, when it fails, or either way. See [Chaining tasks](#-chaining-tasks). | None |

Three rules decide when a retry happens, and each one is there to stop a retry from hiding a real
problem:

- **Only a run that ran and failed is retried.** A run that could not start, such as one with a
  missing secret, would fail the same way every time.
- **A check never retries.** Its failure is a measurement, and measuring again until it passes would
  make a real outage look fine. The form leaves the field out on a check.
- **Run now is never retried**, and is refused while the task is already running. You are watching
  it, so you decide what happens next.

Each attempt is its own line in the run history (*attempt 2 of 3*). Only the last one sends a
notification, so one failure is one alert. A retry that is waiting when the backend restarts is
dropped; the next scheduled run still happens.

The reasoning is in [ADR 0004](../../adr/0004-native-run-policy.md).

---

## 🔗 Chaining tasks

A native task can start when another one finishes. Build the report, then mail it. Take the backup,
then check the file it wrote. If the sync fails, post to Slack.

1. Open the second task's **Run settings** and pick the first task under **Also run after**.
2. Choose when: **Succeeds**, **Fails**, or **Finishes either way**.
3. Keep its own schedule, or tick **No schedule of its own** on New Task (or *No schedule (run on
   demand)* on Edit) so the first task is the only thing that starts it.

| Rule | Why |
|:---|:---|
| **Only a native task can be waited on.** | Its runs are the only ones Cronsole sees finish. A Windows task that runs on its own schedule tells Cronsole nothing. |
| **The chain moves on the final verdict.** | With retries, a run that fails and then succeeds on its second attempt counts as a success. |
| **Run now counts.** | Clicking Run now on the first task starts its followers too, the same as a scheduled run. |
| **A loop is refused when you save.** | A → B → A would run forever. So would a task that runs after itself. |
| **Each link keeps its own history, retries and secrets.** | A chain is several tasks, not one job with steps, so each one can be read, retried and edited on its own. |

If the first task is deleted, its followers stay but nothing starts them: the form shows *A task that
no longer exists* until you pick another or clear it.

Over MCP, pass `runAfterTaskId` (the first task's id) and `runAfterWhen` (`success`, `failure` or
`always`) to a `create_native_*` tool, and leave out `schedule` for a task with none of its own.

---

## 🔐 Secrets — store a reference, never the value

A scheduled job usually needs a credential. Native tasks hold a **reference** to one, never the
credential itself.

1. Open the task → **Edit** → **Secrets**.
2. Give the value a name (`API_TOKEN`) and paste it.
3. Refer to it from the job as `${secret.API_TOKEN}`.

Legal in a **url**, a **header value**, a **body**, an **arg** and an **env value**. Refused by name
in an `executable`, an `interpreter` or a check's assertion — those decide *what runs*, and a secret
that could redirect them is a different kind of thing.

The value is AES-256-GCM encrypted in its own table. **No route returns it** — that is the absence of
a read path rather than a filter someone could forget. It is not in the job spec (a job edit replaces
that), not in the export, not in the archive, and it cascades away with the task.

**Optional references — `${secret.NAME?}`.** A trailing `?` marks a credential the job can do
without (an image key that only adds a cover image). Unset, it resolves to an **empty string** and
the run goes ahead; set, it is substituted and redacted like any other. The Secrets section shows it
as *Optional · not set* rather than as a problem, and it is never listed as missing. Use it only for
a credential that *enables* something — a required one should fail loudly, because a blank
`Authorization` header comes back as a 401 that reads like an expired token.

**A reference with nothing behind it fails at run time, not create time** — `ran: false`, with the
name in the message. Import, restore and template-apply all legitimately produce that state, so every
write reports which secrets are missing rather than refusing the whole thing (template-apply returns
`missingSecrets` and the new `taskId`).

> [!NOTE]
> **Save-as-template refuses a secret-bearing job outright.** A template is for sharing; a job that
> references `${secret.X}` would arrive somewhere with nothing behind the name.

---

## 🌱 Environment variables

Programs and Scripts both take an **Environment** field — one `NAME=value` per line, or JSON. `#`
comments and blank lines are dropped, so pasting a `.env` block works.

**A native child gets an allowlist, never the backend's own environment.** This process holds the key
that encrypts every stored platform credential; an inheriting script could read it out through the
same UI that created the task.

`${secret.NAME}` is legal in a value and **unrepresentable in a name** — the parser will not let you
type the illegal case, rather than accepting it and refusing at 3am.

### Passing a variable through

Some tools read a credential that is already set on the machine, such as `GH_TOKEN` for the GitHub
CLI. Instead of copying its value into a secret, name it under **Pass through from Cronsole**
(`GH_TOKEN, OPENAI_API_KEY`), and the job gets that variable from the environment Cronsole itself runs
in.

| Rule | Why |
|:---|:---|
| **Only the names you list are passed.** | The rest of Cronsole's environment still never reaches the job. |
| **Cronsole's own settings are refused by name.** | `ENCRYPTION_KEY`, `DATABASE_URL`, `JWT_SECRET`, anything starting `CRONSOLE_`, and every other setting in `backend/.env.example`. Passing the encryption key would hand over every stored credential. |
| **The values are hidden in the run log**, shown as `${env.NAME}`. | The same protection secrets get. |
| **A name that is not set stops the run before it starts**, and the log says which. | A job told it has `GH_TOKEN` should not run without it and fail somewhere confusing. |
| **The job's own Environment wins** over a passed value with the same name. | It is the more specific instruction. |

The variable has to be set **where the backend runs**. Under the default stack that is your Windows
user, so a user environment variable works after Cronsole restarts; inside Docker it is the
container's environment.

---

## 📅 Schedules

Stored as 5-field cron in UTC, like every source. Native is the one that runs that expression
directly, which produces the one asymmetry worth remembering: **across a daylight-saving change a
native task shifts by an hour** while a Windows task keeps its local clock time.

---

## 🕐 Run history

Native is the source where `ExecutionLog` is complete: Cronsole performs every run, so every run is
recorded — scheduled ones included. Because Cronsole makes the call itself, the status and duration
describe the actual run, unlike a Windows manual run. Output is stored, and `${secret.NAME}` values are **redacted out
of the log** at the single point every job type funnels through, as are passed-through variables
(shown as `${env.NAME}`).

The time on each row is **when the run started**, and the duration says how long it took. Each log
line starts with what started it:

| Label | Meaning |
|:---|:---|
| `[scheduled]` | Its cron time came due |
| `[scheduled · attempt 2 of 3]` | A retry after a failed attempt. Every attempt is its own row. |
| `[queued]` | It came due while the last run was still going, and the task is set to queue |
| `[catch-up]` | Cronsole was down at a due time and the task is set to catch up |
| `[after "Backup"]` | Another task finished and this one is chained to it |
| *(no label)* | Run now |

---

## ⚠️ Things that surprise people

- **The row used to be called Scripts and now says Programs.** It never took a script — it runs a
  program that must already exist on the host. The type that actually carries a script is Scripts.
  Presentation only (renamed 2026-08-15): no stored job changed.
- **Changing a job's type replaces the job, it does not patch it.** Switching an HTTP job to a script
  discards the URL, method, headers and body — the two kinds share no fields, and a leftover `url`
  inside a script job is something nothing reads and nobody can explain later. The form says exactly
  what will be discarded *before* you click. The task keeps its name, schedule, category and run
  history either way.
- **A check that fails is not an outage.** See above. If the Sources tab ever blames the platform for
  your own missing file, that is [#77](../../troubleshooting/README.md#77-the-sources-tab-says-a-verb-failed-and-names-your-own-broken-file).
- **Delete really deletes.** There is no machine to leave it running on, so the task modal's button
  is just **Delete** — it removes the task and its run history. A pre-delete archive is written first.
- **Export gives you a portable bundle, not an OS artifact.** Native has no XML equivalent; the
  export is Cronsole's own format, and **Tools → Import a task** is what reads it back.

---

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| A check that correctly finds a problem is reported as "could not run" | [#59](../../troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check) |
| Save blocked on a script or check over a command field that is not there | [#76](../../troubleshooting/README.md#76-save-is-blocked-on-a-script-task-over-a-command-field-that-does-not-exist) |
| A task refuses to start and names a secret | [#71](../../troubleshooting/README.md#71-a-native-task-refuses-to-start-and-names-a-secret) |
| A task refuses to start and names a variable it *passes through* | The variable is not set where the backend runs. Set it there and restart Cronsole, or remove the name. See [Passing a variable through](#passing-a-variable-through). |
| Run now says the task *is already running* | It is. Wait for that run to finish; the refused click is not recorded. |
| A failed Run now was not retried | Retries apply to scheduled runs only. See [Run settings](#-run-settings). |
| `ssh` (or `git` over SSH) exits 255 with no output | The job's environment lacked `PROGRAMDATA`. Fixed 2026-11-07; on an older backend, pass it through. [#104](../../troubleshooting/README.md#104-a-native-job-that-runs-ssh-exits-255-and-prints-nothing) |
| MCP `run_task` says *Still running* | The job outlasted the 2-minute wait. Its verdict lands in the run history when it ends. [#105](../../troubleshooting/README.md#105-mcp-run_task-says-the-backend-is-unreachable-and-the-job-ran-fine) |
| A chained task did not run | Check the first task's verdict against **when** (success, failure, either), and that the chained task is enabled. The chain moves on the final attempt. |
| Runs in the history appear later than they started | Fixed 2026-11-07: rows written before then show when the run *finished*. |

---

## 📦 Templates

Templates for this source are prebuilt HTTP calls, programs, scripts and checks. Applying one makes a
native task you can edit afterwards.

| Where | What you get |
|:---|:---|
| [**🌐 Gallery: Cronsole-native templates**](https://cronsole.ai-automation-tools.dev/#/browse?target=cronsole-native) | The public catalog, already filtered to this source. |
| **In the app** | **Templates** tab, then **Apply** and pick *Cronsole* as the target. |

---

## 🔗 References

Native has no vendor of its own. These are the documents behind it.

| Resource | What it covers |
|:---|:---|
| [**ADR 0002: native job types**](../../adr/0002-native-job-types.md) | Why there are four job types, and what it takes to add a fifth. |
| [**ADR 0004: how a native task runs**](../../adr/0004-native-run-policy.md) | Time limits, retries, overlap and catch-up, and why checks never retry. |
| [**ADR 0003: per-job secrets**](../../adr/0003-per-job-secrets.md) | How `${secret.NAME}` is stored, substituted and redacted. |
| [**crontab.guru**](https://crontab.guru/) | Checking what a 5-field cron expression means. Remember Cronsole stores it in UTC. |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Windows_Task_Scheduler.md">Next: Windows Task Scheduler →</a>
</p>

<p align="right">(<a href="#native-top">back to top</a>)</p>
