# Cronsole Sources Guide

Cronsole shows tasks from more than one system, and those systems are not the same shape.
A Windows task lives on your machine and keeps running whether or not Cronsole is up. A
Cronsole-native task *is* a row in Cronsole's database. A Claude routine lives at claude.ai
and Cronsole can only knock on its door. A GitHub Actions workflow Cronsole can only *watch*.

This guide has one section per source: what it is, **what Cronsole can and can't do with it**,
and the things that surprise people. It is what the **?** buttons in the app link to.

> **Where to find this in the app:** the **Source** bar sits above the saved views on the
> Dashboard, with one button per source you actually have tasks from. The **Platforms** tab
> shows the same systems from the other direction — what each one is capable of, and what has
> been *proven* to work on your machine.

---

## What a source is

A **source** is where a task comes from — the first question you ask about a task, before
"is it failing?". It is the Dashboard's outermost lens, which is why it has its own bar
rather than a row inside the Filters drawer.

**A source is finer than a platform.** A *platform* is what Cronsole talks to: one connector,
one row on the Platforms tab, one connection. A *source* is what you navigate by, and the two
stopped matching when Cronsole-native gained a second kind of job — an HTTP call and a script
are the same platform and genuinely different things to look at. So the Source bar splits
them and the Platforms tab does not.

Three behaviours worth knowing:

- **Source composes with views instead of replacing them.** Pick *Windows Task Scheduler*,
  click *Failures*, and both stay lit — you are looking at failing Windows tasks and the two
  chips say so together. Every other filter drops the view to *Custom*; source is the one
  exception, and it is allowed only because both constraints are visible at once.
- **The counts are scoped to what you would see.** With a source selected, every view count is
  taken *inside* it — `My jobs 1` means one, not "88 across everything".
- **A source can read `0`.** It means you have tasks from that source but none survive your
  current view. The button stays so you can always click back out. It disappears only when you
  have no tasks from that source at all.

---

## Windows Task Scheduler

**The scheduler your machine already has.** Cronsole reads and writes it through a small agent
running locally — see the [Windows Agent Setup Guide](Agent_Setup_Guide.md).

The tasks are real Task Scheduler entries. They exist without Cronsole, they keep running when
Cronsole is off, and they run as your Windows user with whatever privileges that account has.
**This is the source to use for anything that must survive Cronsole being down.**

### What Cronsole can do here

Sync · Run now · Create · Enable/disable · Edit schedule · Edit action · Export · Restore ·
Delete · List folders — the fullest set of any source. All of it needs the agent online; the
agent is the only thing that can touch Task Scheduler.

### Things that surprise people

- **A folder is a category.** A Windows task's Cronsole category is its top-level Task
  Scheduler folder — a task at `\Monitoring\Logs\Rotate` lands in `Monitoring`. Re-label the
  category in Cronsole and it stays re-labelled, but **nothing moves on the machine**; the two
  have then deliberately forked.
- **Renaming is a Cronsole label, not a rename on the machine.** A Windows task's real name is
  the last segment of its path, and that path is how Cronsole (and every command it sends)
  addresses the task. Renaming it here changes what you see and nothing else — so once the two
  differ, the task modal keeps showing the real Task Scheduler path underneath.
- **"It ran successfully" from a manual run means "the agent accepted the start".** Cronsole
  fires the task and Windows takes it from there; the run's real outcome is Windows'
  `lastTaskResult`, which is what the **Task health** panel reads. Use Task health, not Run
  History, to answer *did it actually work?*
- **A scheduled run is not recorded by Cronsole at all.** Cronsole's run history covers runs
  *Cronsole performed*. A task firing on its own schedule at 3am leaves no row — an empty run
  history means Cronsole triggered nothing, not that nothing ran.
- **Cronsole creates exactly one folder: `\Cronsole`.** It won't invent others, because the
  agent runs elevated and a folder it creates can only be deleted by an administrator. Create
  the folder in Task Scheduler yourself and it appears in the picker. `\Microsoft\` is refused
  outright — a name collision there would silently overwrite a real system task.
- **Windows' own tasks are hidden by default.** There are usually a few hundred under
  `\Microsoft\`, roughly 3:1 against yours. Every count that hides them says so.
- **Across a daylight-saving change a Windows task keeps its local clock time**, because the
  agent converted the schedule to a local trigger when it registered the task.

---

## Cronsole (HTTP)

**Call a URL on a schedule.** Webhooks, health checks, poking a deploy hook, kicking an n8n
flow. Created with **New Task › Cronsole › HTTP request**, or from a **Cronsole Native**
template (*Uptime Check* ships built in; *Monitor Heartbeat* is in the gallery). A template
applied here always makes a `GET` — a job that needs a method, headers or a body is a full
spec, so use New Task.

These are *Cronsole-native*: the database row **is** the task. Nothing appears in Windows Task
Scheduler, the agent is not involved, and it runs whether or not the agent is connected — but
only while **the Cronsole backend is running**.

### What Cronsole can do here

Run now · Create · Enable/disable · Edit schedule · Edit what it runs · Export · Delete.
No agent, no round trip, nothing that can refuse — the write *is* the change.

### Things that surprise people

- **You can change the URL now.** *Edit* on the Action panel of the task modal rewrites the
  whole job: URL, method, headers and body. Headers can be pasted as `Name: value` lines
  straight out of an API's docs, or as JSON.
- **The job is replaced, not patched.** Switching an HTTP job to a script discards the URL,
  method, headers and body — because the two kinds share no fields, and a leftover `url`
  sitting inside a script job is something nothing reads and nobody can explain later. The
  form says exactly what will be discarded *before* you click. The task keeps its name,
  schedule, category and run history either way.
- **The run history is real.** Cronsole makes the request itself, so the status and duration
  describe the actual call — unlike a Windows manual run.
- **There is no "Remove from Cronsole".** The row *is* the task, so there is nothing to leave
  behind; the button is just **Delete**.
- **Across a daylight-saving change a native task shifts by an hour**, because Cronsole
  evaluates the stored UTC schedule directly. This is the opposite of the Windows behaviour
  above, and both are stated in the app where the schedule is edited.

---

## Cronsole (Programs)

**Run a program that already exists on the backend's machine**, with its exit code, duration
and output recorded. Created with **New Task › Cronsole › Run a program**, or from a **Cronsole
Native** template — *Run a Program* ships built in, with Node, Python and `git pull` starters
in the gallery.

> **This row was called *Scripts* until 2026-08-15**, which promised more than it delivered:
> the script has to be on disk already and Cronsole never sees it. The name now belongs to
> [Cronsole (Scripts)](#cronsole-scripts), which stores the script itself. Nothing about your
> existing tasks changed — only the label.

Same platform as *Cronsole (HTTP)* — the Source rail separates them because they are different
things to look at, and the Platforms tab does not because they have identical capabilities.

### What Cronsole can do here

The same list as *Cronsole (HTTP)*: run, create, enable/disable, edit schedule, edit what it
runs, export, delete.

### Things that surprise people

- **There is no shell.** The command line is split into a program and its arguments, so `&&`,
  `|` and `>` are ordinary characters rather than operators. If you need them, name the shell
  yourself: `cmd.exe /c "…"` or `/bin/sh -c "…"`.
- **It runs wherever the *backend* runs, and the app tells you which.** Normally that is your
  machine. If you run the backend in Docker, the task runs **inside the container**, against a
  filesystem that is not yours — so a path you can see in Explorer fails as *"executable not
  found"*. The New Task and Edit job forms both state the execution host before you click.
- **It does not inherit Cronsole's environment.** The program gets the OS essentials plus
  whatever you set explicitly — not Cronsole's own variables, which include the key that
  encrypts your stored platform credentials.
- **Use a Windows task instead** for anything that must run as your logged-in user, needs your
  user's privileges, or has to keep running while Cronsole is down. The agent is the thing that
  unambiguously means *your machine*; the backend is not.

---

## Cronsole (Scripts)

**Write the script here and Cronsole runs it on your schedule**, under an interpreter you pick
from a fixed list: PowerShell, PowerShell 7, Bash, sh, Python, or Node. Created with **New Task
› Cronsole › Write a script**.

The difference from *Cronsole (Programs)* is where the script lives. A program job names a file
that must already exist on the machine the backend runs on; a script job stores the **body**, so
there is nothing to put on disk first.

### What Cronsole can do here

The same list as every other Cronsole-native job: run, create, enable/disable, edit schedule,
edit what it runs, export, delete.

### Things that surprise people

- **This is the one job type where a shell is expected.** You picked the interpreter and wrote
  the body, so `|`, `&&` and redirection all behave normally. That is not a hole in the no-shell
  rule — that rule bans an *implicit* shell wrapped around a command you typed. Here nothing is
  re-parsed, and **the interpreter is a fixed list, never a path you type**.
- **The interpreter has to exist where the backend runs.** `node` always does — Cronsole itself
  runs on it — which makes it the safe choice inside a container. PowerShell and Python may not
  be there, and the run log says so by name rather than reporting a missing file.
- **The script is stored, so it travels with the task.** You can read and edit it in the app, it
  is included in an export and in the archive taken before a delete, and a template carrying one
  works on a fresh install. None of that is true of a program job pointing at a path.
- **Whitespace is preserved exactly.** The body is not trimmed the way a form field is — leading
  indentation matters in Python, and a trailing newline is what makes a shell script's last line
  run.
- **The temporary file is deleted afterwards**, including when the script times out and is
  killed, and it is written so only the account running the backend can read it.
- **It does not inherit Cronsole's environment**, exactly like a program job. Set what you need
  explicitly.

---

## Cronsole (Checks)

**Measure something and compare it to what you expect.** Four kinds:

| Check | What it measures | Fails when |
|---|---|---|
| **Endpoint** | An HTTP request | Status outside the range you set, or the body missing text / a JSON field you require |
| **Port** | A TCP connection | Nothing accepts a connection within 15s |
| **File freshness** | A file's last-modified time | Older than your limit — **or missing** |
| **Disk space** | Free space on a volume | Below your floor |

Created with **New Task › Cronsole › Check something**.

### What Cronsole can do here

The same list as every other Cronsole-native job: run, create, enable/disable, edit schedule,
edit what it runs, export, delete.

### Things that surprise people

- **A failure here means something.** This is the point of the type. A failed script is usually a
  bug in your script; a failed check is the thing you actually wanted to know about — so these
  are the runs worth pointing failure notifications at, and the ones whose history is worth
  reading.
- **A 200 is not the same as healthy**, which is why an endpoint check is not just an HTTP job.
  It can require the response body to contain a string, or a dotted JSON path
  (`status.db`) to equal a value. An HTTP *job* only asks whether the request was accepted — the
  right test for firing a webhook, the wrong one for monitoring.
- **A missing field and a changed field are reported differently.** `status.db is "up", expected
  "down"` and `status.cache is not present` are different facts about an API, and the run log
  says which.
- **File and disk checks measure the *backend's* filesystem** — the container's, on a Dockerized
  stack, not yours. The form names the execution host before you save, because a check that
  passes against the wrong disk is worse than no check at all.
- **A missing file fails the freshness check** rather than being skipped. The check exists to
  notice that a backup stopped being written; a backup that was never written is the same
  problem in its worst form.
- **The log always states the measurement**, not just a verdict: `D:\backups\nightly.zip last
  modified 3.0h ago (limit 60m)`. The number is the reason you ran the check.

---

## Claude Code routines

**Prompts Anthropic runs on a schedule, in the cloud, against the repositories you attach.**
Added with **New Task › Claude**, or by applying a **Claude Routines** template.

**What Cronsole can do here depends on your install**, and this is the one source where that is
true. There are two ways in:

| | **Signed in to the Claude Code CLI** on the machine running Cronsole | **Not signed in** |
|---|---|---|
| Sync | Real: names, schedules, enabled state, next run | Returns the routines *you declared* |
| Create | Yes — including from a template | No; create at claude.ai, then connect |
| Enable / disable, edit schedule | Yes | No — do it at claude.ai |
| Run now | Yes, no token needed | Needs the routine's own API token |

Cronsole reads the session from the CLI's credentials at the moment it needs it, and **never
stores or refreshes it** — refreshing would rotate the CLI's own token and could sign you out of
Claude Code from a background poll. Nothing to configure: sign in with `/login` and sync.

### What Cronsole can do here

Signed in: **sync · run now · create · enable/disable · edit schedule**, plus connect, edit and
disconnect the declaration. Not signed in: **run now** and the declaration verbs; create,
enable/disable and edit-schedule show as *Unsupported* on the Platforms tab, which is that tab
answering about *this install* rather than about the product.

**Delete is impossible either way** — neither Claude API exposes one. Cronsole can pause a
routine and forget it; removing it happens at claude.ai.

### Things that surprise people

- **Applying a Claude template creates a real routine.** The "command" is a prompt, so the Apply
  screen says *Resolved prompt* and offers a **Repositories** box. A routine with no repository
  still runs — it just has no checkout — so Cronsole never guesses one for you: a routine can
  commit, and the wrong repo is not a mistake you can see before it happens.
- **Without a session, your list of routines is your own declaration.** Nothing is fetched, so
  "sync" returns the routines you typed in and a routine deleted at claude.ai still lists until
  its next run fails.
- **The token is shown once, by claude.ai.** Get it from the routine → *Edit* → *Add another
  trigger* → *API* → *Generate token*; generating a new one revokes the old. Cronsole stores it
  encrypted and never shows it again — there is no reveal button, because claude.ai cannot
  re-display it either. Mistyped the id? **Edit** the routine and Cronsole keeps the token.
  Signed in to the CLI, you do not need a token at all.
- **The next-run time comes from Anthropic, not from the cron.** Routine runs carry a few
  minutes of scheduling jitter, so a locally computed time would disagree with claude.ai forever
  with nothing on screen to say which was right. Without a session there is no schedule to show,
  and the card shows none rather than a guess.
- **"Remove from Cronsole" is refused here — use *Disconnect routine*.** On Windows, untracking
  means "don't re-import this"; here there is nothing on a machine to be re-imported from, so
  the row would simply come back on the next sync while the exclusion table read empty.
  **Disconnect routine** (in the task modal, and on the Platforms tab) removes the declaration
  *and* the tracked tasks together.
  - It also **forgets the API token**, which claude.ai will not show you again — so the
    confirmation says so. That is why the two are separate buttons: a control labelled
    *"Remove from Cronsole"* must not quietly spend a credential.
  - **The routine itself keeps running at claude.ai.** Disconnecting is a Cronsole action, not
    an Anthropic one.
- **Health here comes from your runs, not from a probe.** Without a session the only endpoint
  *fires your routine*, so a health check would eat into its daily cap; with one, a read exists
  but `getHealth` polls every 45 seconds per open tab, so probing would put a steady stream of
  requests on Anthropic for a question **sync already answers**. Sync is your probe, on every
  source.
- **This connector is experimental**, and specifically: the documented endpoint is a research
  preview behind a dated beta header, and the API that makes create/list/pause possible is
  undocumented and beta-gated. If it changes, Cronsole falls back to the declared-routine path
  rather than breaking — which is why that path is kept rather than retired.

---

## GitHub Actions

**Scheduled workflows in the repositories you watch.** Connect on the **Platforms** tab: paste a
GitHub personal access token, then add repositories by URL or `owner/name`. Sync brings in every
workflow in them that has an `on: schedule` trigger.

**This source is read-only, and that is the design rather than a first version.** Every mutating
capability on its Platforms row reads *Unsupported*. Cronsole tells you what is scheduled, when it
claims to run, and how the last runs actually went — running, pausing and editing a workflow happen
on GitHub.

Two of the three refusals have APIs behind them and are still refused, deliberately:

- **Create** would mean committing a workflow file to your default branch. That is a code change,
  not a scheduler feature, and not one a *New Task* button should be able to make.
- **Run now** would be a `workflow_dispatch` run, which is not the scheduled run you came to check.
- **Enable / disable** changes repository state, and belongs behind its own scopes and its own
  confirmation rather than slipping in behind a read.

### What Cronsole can do here

**Sync** and **health**, plus **Remove from Cronsole** on an individual workflow. Everything else
shows as *Unsupported* on the Platforms tab — which is that tab stating a boundary, not waiting for
evidence. A connector that only reads is a finished thing; it just says plainly which half it is.

### Things that surprise people

- **You watch a repository, not a workflow.** `owner/repo` is the category, so adding one brings in
  every scheduled workflow it has, and *Stop watching* takes them all back out. To drop a single
  workflow while keeping the rest, use **Remove from Cronsole** on that task — the ordinary untrack
  path works here, and the next sync will not bring it back.
- **These crons need no conversion at all.** GitHub documents `on: schedule` as UTC with no timezone
  support, which is exactly how Cronsole stores every schedule. This is the one source with no
  conversion layer, no lossy-trigger warning and none of the DST asymmetry a Windows trigger carries.
- **The run outcomes here are real outcomes.** GitHub reports whether a run succeeded, failed, timed
  out or was cancelled — the result of the work. A Windows task can only tell Cronsole that the agent
  *accepted a start*, so health scoring is actually better founded on the source Cronsole cannot
  touch than on the one it controls most.
- **GitHub disables scheduled workflows after 60 days of repository quiet.** It does this silently.
  Cronsole surfaces it as its own health signal with GitHub's reason attached, which is usually the
  first anyone hears that a "nightly" workflow stopped two months ago.
- **There is no next-run time, on purpose.** GitHub queues scheduled runs on a best-effort basis and
  delays them under load. A time computed from the cron would disagree with what actually happens,
  with nothing on screen to say which was right — so the card shows the cron and no prediction.
- **A private repository that 404s is usually a scope, not a typo.** GitHub answers `404` rather than
  `403` for anything a token cannot see, so "not found" is the *expected* symptom of a token missing
  the `repo` scope. Cronsole says so in the error rather than sending you to check the spelling.
- **A workflow with several `cron:` entries shows the first one.** Cronsole stores one schedule per
  task, so the rest travel with the task and the card says how many there are — rather than the row
  being quietly wrong about when it runs.
- **A workflow whose file Cronsole cannot read keeps its row and says why.** "Could not read this"
  and "this has no schedule" are different facts and need different actions, so they never render the
  same.
- **The token is stored encrypted and never shown again.** GitHub cannot re-display a PAT either, so
  there is no reveal button and rotating means pasting a new one. Cronsole verifies a token against
  GitHub before saving it, so a bad paste fails at the click rather than inside a sync days later.
- **Health here comes from your syncs, not from a probe.** `getHealth` runs every 45 seconds per open
  tab against a 5,000-requests-an-hour rate limit, so probing would spend your budget on a question
  sync already answers. Sync is your probe, on every source.

---

## Quick links — schedulers with no connector

Below the capability matrix on the **Platforms** tab is a list of bookmarks: ChatGPT, Gemini,
Jules, and any you add yourself. Nothing is read or written through them — they exist so the
schedulers Cronsole *cannot* reach are still one click away rather than invisible.

A link graduates to a connector when it can do something a bookmark cannot. A connector that
only *reads* is a finished thing, not a stalled one: it says plainly which half it is.

---

## What's coming

The next source is a **POSIX agent** covering launchd, cron and systemd timers. They are the
same shape as Windows Task Scheduler — a local OS scheduler — so one agent covers all three on
the protocol that already exists, rather than one OAuth surface and one rate limit per cloud
scheduler. See [ROADMAP.md](../../ROADMAP.md) › Sources.

---

*See also: the [UI User Guide](UI_User_Guide.md) for the rest of the interface, the
[prompt library](../../prompts/README.md) for creating any of these sources by asking an
assistant, and the [troubleshooting log](../../troubleshooting/README.md) when something behaves
unexpectedly.*

*Last Updated: August 23, 2026*
