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

## 🔌 Connecting

Nothing to connect. Native is up whenever the backend is, which is why its card has a sentence and no
button. It is one of the two sources a fresh install starts with.

## 🧰 The four job types

A type is a permanent rail row, so the bar for adding one is "a different *kind* of thing", not
"useful". These are the four, and the fourth is the one people miss.

### 🌐 HTTP — call a URL

A request on a schedule. Method, URL, headers, body. The most common shape is a webhook you want
poked nightly, or a health endpoint you want exercised.

Success is the HTTP status. A 500 is a failed run; a 200 is a successful one.

### 🖥️ Programs (EXEC) — run something already on the host

Structured `{executable, args[]}`, **no shell**. Pipes, redirection and `&&` are not implied — invoke
a shell explicitly (`cmd.exe /c "..."`) if you need them. That is a deliberate opt-in, not an
oversight: a shell that appears by accident is how an argument becomes a command.

> [!IMPORTANT]
> **A native job runs where the *backend* runs.** On a Dockerized stack that is inside the container —
> a different filesystem from your desktop. The same spec then fails as "executable not found" for a
> file you can plainly see. The New Task form tells you which host you are targeting; read it before
> typing a `D:\` path.

### 📝 Scripts — write the body in Cronsole

The script itself lives in the task, so there is no file to keep in sync and nothing to lose track
of. A fixed interpreter allowlist decides what can run it. This is the type to reach for when the
work is five lines and inventing a file on disk is the annoying part.

### ✅ Checks — measure something and compare it

The only type whose **failure is a fact about your system rather than a bug in your script**. A check
measures something — a file's age, a URL's response, a disk threshold — and compares it to what you
expect.

That distinction is load-bearing. A check that correctly finds a problem is the check **working**:
it returns HTTP 200 with `success: false`, not a 502, and it does not mark the platform broken. Only
"could not start at all" is a failure of the verb.

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

**A reference with nothing behind it fails at run time, not create time** — `ran: false`, with the
name in the message. Import, restore and template-apply all legitimately produce that state, so every
write reports which secrets are missing rather than refusing the whole thing.

> [!NOTE]
> **Save-as-template refuses a secret-bearing job outright.** A template is for sharing; a job that
> references `${secret.X}` would arrive somewhere with nothing behind the name.

## 🌱 Environment variables

Programs and Scripts both take an **Environment** field — one `NAME=value` per line, or JSON. `#`
comments and blank lines are dropped, so pasting a `.env` block works.

**A native child gets an allowlist, never the backend's own environment.** This process holds the key
that encrypts every stored platform credential; an inheriting script could read it out through the
same UI that created the task.

`${secret.NAME}` is legal in a value and **unrepresentable in a name** — the parser will not let you
type the illegal case, rather than accepting it and refusing at 3am.

## 📅 Schedules

Stored as 5-field cron in UTC, like every source. Native is the one that runs that expression
directly, which produces the one asymmetry worth remembering: **across a daylight-saving change a
native task shifts by an hour** while a Windows task keeps its local clock time.

## 🕐 Run history

Native is the source where `ExecutionLog` is complete: Cronsole performs every run, so every run is
recorded — scheduled ones included. Output is stored, and `${secret.NAME}` values are **redacted out
of the log** at the single point every job type funnels through.

## ⚠️ Things that surprise people

- **The row used to be called Scripts and now says Programs.** It never took a script — it runs a
  program that must already exist on the host. The type that actually carries a script is Scripts.
  Presentation only: no stored job changed.
- **A check that fails is not an outage.** See above. If the Sources tab ever blames the platform for
  your own missing file, that is [#77](../../troubleshooting/README.md#77-the-sources-tab-says-a-verb-failed-and-names-your-own-broken-file).
- **Delete really deletes.** There is no machine to leave it running on, so the task modal's button
  is just **Delete** — it removes the task and its run history. A pre-delete archive is written first.
- **Export gives you a portable bundle, not an OS artifact.** Native has no XML equivalent; the
  export is Cronsole's own format, and **Tools → Import a task** is what reads it back.

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| A check that correctly finds a problem is reported as "could not run" | [#59](../../troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check) |
| Save blocked on a script or check over a command field that is not there | [#76](../../troubleshooting/README.md#76-save-is-blocked-on-a-script-task-over-a-command-field-that-does-not-exist) |
| A task refuses to start and names a secret | [#71](../../troubleshooting/README.md#71-a-native-task-refuses-to-start-and-names-a-secret) |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Windows_Task_Scheduler.md">Windows Task Scheduler</a> ·
  <a href="Claude_Code_Routines.md">Next: Claude Code Routines →</a>
</p>

<p align="right">(<a href="#native-top">back to top</a>)</p>
