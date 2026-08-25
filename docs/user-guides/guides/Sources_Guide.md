<a id="sources-guide-top"></a>

<h1 align="center">🧭 Sources Guide</h1>

<p align="center">
  <em>One section per source — what Cronsole can do with each, what it deliberately will not,
  and why the two are different things.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shapes-controller_·_observer_·_quick_link-8B5CF6?style=for-the-badge" alt="Shapes: controller, observer, quick link">
  <img src="https://img.shields.io/badge/read--only_sources-GitHub_·_Vercel-2ea44f?style=for-the-badge" alt="Read-only sources: GitHub Actions and Vercel Cron">
  <a href="../../contributing/Adding_A_Source.md"><img src="https://img.shields.io/badge/extend-add_a_source-0078D4?style=for-the-badge" alt="Add a source"></a>
</p>

---

Cronsole shows tasks from more than one system, and those systems are not the same shape.
A Windows task lives on your machine and keeps running whether or not Cronsole is up. A
Cronsole-native task *is* a row in Cronsole's database. A Claude routine lives at claude.ai
and Cronsole can only knock on its door. A GitHub Actions workflow or a Vercel cron job Cronsole
can only *watch*.

This guide has one section per source: what it is, **what Cronsole can and can't do with it**,
and the things that surprise people. It is what the **?** buttons in the app link to.

> **Where to find this in the app:** the **Sources** section of the sidebar lists one row per
> source you have, with **Explore sources** and **Manage sources** beneath it. The **Sources**
> tab shows the same systems from the other direction, in three views — **Connected**,
> **Available** and **Quick links** — covering what each one is capable of, what has been
> *proven* to work on your machine, and everything you have not added yet.

---

## What a source is

A **source** is where a task comes from — the first question you ask about a task, before
"is it failing?". It is the Dashboard's outermost lens, which is why it is the sidebar rail
rather than a row inside the Filters drawer.

**A source is finer than a platform.** A *platform* is what Cronsole talks to: one connector,
one row on the Sources tab, one connection. A *source* is what you navigate by, and the two
stopped matching when Cronsole-native gained a second kind of job — an HTTP call and a script
are the same platform and genuinely different things to look at. So the rail splits them and
the Sources tab does not.

Three behaviours worth knowing:

- **A source composes with views instead of replacing them.** Pick *Windows Task Scheduler*,
  click *Failures*, and both stay lit — you are looking at failing Windows tasks and the two
  chips say so together. Every other filter drops the view to *Custom*; source is the one
  exception, and it is allowed only because both constraints are visible at once.
- **The counts are scoped to what you would see.** With a source selected, every view count is
  taken *inside* it — `My jobs 1` means one, not "88 across everything".
- **A source can read `0`.** It means you have tasks from that source but none survive your
  current view. The button stays so you can always click back out. It disappears only when you
  have no tasks from that source at all.

---

## Choosing which sources you see

A fresh install shows **two**: Windows Task Scheduler and Cronsole-native. Claude Code, GitHub
Actions, Vercel Cron and Gemini API Triggers are supported, and are **not** shown until you ask for
them — a first run listing six platforms of which two are real teaches you that most of the product
is broken.

Both halves of that live on the **Sources** tab, and the sidebar's **Sources** section links
straight into them:

- **Explore sources** — everything Cronsole can connect to, including what you have not added
  and the schedulers it can only bookmark. This is where a hidden source is found again, which
  is what makes hiding one safe in the first place.
- **Manage sources** — the sources you already have: their capabilities, their connection, and
  a switch to show or hide each one.

### The three views

The tab itself is three views, and they split on **whether a source is connected** — not on
whether your sidebar lists it. The two are different facts and the screen shows both.

| View | Holds | What you do here |
|---|---|---|
| **Connected** | Sources with a working connection | Read what each can do and the evidence behind it; show or hide it in the sidebar |
| **Available** | Everything not connected | Set up a source you have added; add one you have not; open a pull request for a source Cronsole has no connector for |
| **Quick links** | Bookmarks to schedulers with no connector | Add, open and remove links. Nothing is read or written |

**Available is in two groups, and the first one is the point.** *Added to your sidebar* holds
sources you asked for that have nothing connected behind them — a real, common, half-finished
state. Each one says what would actually connect it, and the answer is one of two shapes:

- **Composed by hand** — Claude Code, GitHub Actions and Vercel Cron have something to fill in, so *Set up*
  opens that panel right there.
- **Connects itself** — Windows connects when the Cronsole agent is running; Cronsole-native
  connects whenever the backend is up. There is no button, because nothing you could type would
  connect them, and a *Connect* button that cannot connect is worse than the sentence saying so.

*Not added* holds the rest. Adding one lists it in the sidebar and moves it into the group above
so it has somewhere to be set up from — **adding connects nothing on its own.**

Two rules hold whichever you use:

- **A source holding tasks is never hidden.** Hiding is for an empty row you do not want, never
  for tasks you would then be unable to find. The switch on a source with tasks says so.
- **Connecting a source shows it.** You never have to do both, and Cronsole never asks you to
  confirm something it can infer from what you just did.

Which sources you show is a **preference, so it follows your account** rather than this browser —
the same install reached at `localhost` and over a Tailscale name shows you the same sidebar.

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
things to look at, and the Sources tab does not because they have identical capabilities.

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
  whatever you set explicitly in the job's **Environment** field — not Cronsole's own variables,
  which include the key that encrypts your stored platform credentials. One `NAME=value` per
  line, and a value may be a `${secret.NAME}`; see
  [UI User Guide › Environment variables](UI_User_Guide.md#environment-variables).
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
  in the job's **Environment** field —
  [UI User Guide › Environment variables](UI_User_Guide.md#environment-variables).

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
enable/disable and edit-schedule show as *Unsupported* on the Sources tab, which is that tab
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
  **Disconnect routine** (in the task modal, and on the Sources tab) removes the declaration
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

**Scheduled workflows in the repositories you watch.** Connect on the **Sources** tab: paste a
GitHub personal access token, then add repositories by URL or `owner/name`. Sync brings in every
workflow in them that has an `on: schedule` trigger.

**This source is read-only, and that is the design rather than a first version.** Every mutating
capability on its Sources row reads *Unsupported*. Cronsole tells you what is scheduled, when it
claims to run, and how the last runs actually went — running, pausing and editing a workflow happen
on GitHub.

Two of the three refusals have APIs behind them and are still refused, deliberately:

- **Create** would mean committing a workflow file to your default branch. That is a code change,
  not a scheduler feature, and not one a *New Task* button should be able to make.
- **Run now** would be a `workflow_dispatch` run, which is not the scheduled run you came to check.
- **Enable / disable** changes repository state, and belongs behind its own scopes and its own
  confirmation rather than slipping in behind a read.

**What would change that.** Of the three, only *Enable / disable* is a candidate: it is the one
whose GitHub API (`PUT …/actions/workflows/:id/disable`) does exactly what the Cronsole verb claims,
with no second meaning. Unlocking it is not a flag — it needs a token scope you have granted on
purpose, a confirmation that names the repository, and the capability cell to stop saying
*Unsupported* only once both exist. Until then, read-only here is a decision that has been made,
not a version that has not been finished.

### What Cronsole can do here

**Sync** and **health**, plus **Remove from Cronsole** on an individual workflow. Everything else
shows as *Unsupported* on the Sources tab — which is that tab stating a boundary, not waiting for
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

## Vercel Cron

**The cron jobs declared by the projects you watch.** Connect on the **Sources** tab: paste a Vercel
access token, then pick projects from the list Cronsole reads for you — it shows how many cron jobs
each one has before you commit to any of them. A project past the first page, or one under a team the
token cannot list, can still be added by pasting its dashboard URL.

**This source is read-only, and — like GitHub Actions — that is the design rather than a first
version.** Every mutating capability on its Sources row reads *Unsupported*. Cronsole tells you what
is scheduled and when it claims to run; adding, editing, running and pausing a cron all happen on
Vercel.

The three refusals, and why each one is a boundary rather than a gap:

- **Create** would mean adding a `crons` entry to your project's `vercel.json` and deploying it.
  That is a code change, not a scheduler feature.
- **Run now** looks possible — a cron path is a plain HTTP endpoint anyone can call — and is refused
  because calling it yourself **is not the scheduled invocation**. It bypasses your `CRON_SECRET`
  check, Vercel never records it as a cron run, and Cronsole would be reporting a success for
  something the scheduler never did. Use the project's Cron Jobs tab, or `vercel crons run`.
- **Enable / disable** is refused because Vercel has no per-cron switch to expose: crons are turned
  on and off for a **whole project** at once. A per-task toggle would be inventing a control the
  platform does not have.

### The one thing this source cannot tell you

**Vercel publishes no run history for a cron job.** Invocations show up in the project's function
logs, behind no stable API, so Cronsole has nothing to score with — and every Vercel task sits at
**unknown** health, permanently, however well it is actually running.

That is worth stating plainly because it is the one place this source gives *less* than GitHub
Actions, which reports a real `success` / `failure` / `timed_out` per run. Cronsole could easily
report "enabled, therefore healthy" instead and it would be a lie: **configured** and **working** are
different claims, and only the first is knowable here. Absence of evidence is `unknown`, never `ok`.

### What Cronsole can do here

**Sync** and **health**, plus **Remove from Cronsole** on an individual cron job. Everything else
shows as *Unsupported* on the Sources tab — that tab stating a boundary, not waiting for evidence.

### Things that surprise people

- **You watch a project, not a cron job.** The project name is the category, so adding one brings in
  every cron it declares and *Stop watching* takes them all back out. To drop a single cron while
  keeping the rest, use **Remove from Cronsole** on that task — the ordinary untrack path works here,
  and the next sync will not bring it back.
- **These crons need no conversion at all.** Vercel documents cron expressions as UTC with no
  timezone support, which is exactly how Cronsole stores every schedule. Like GitHub Actions, this
  source has no conversion layer and none of the DST asymmetry a Windows trigger carries.
- **Reading a project's crons is one request, unlike GitHub's.** A GitHub workflow keeps its cron in
  a file, so Cronsole has to fetch and parse each one. A Vercel project hands over every cron
  definition on the project object itself — which is why the picker can tell you a project has three
  cron jobs before you add it, and why the count Cronsole reports is exact rather than an upper bound.
- **Disabled is a fact about the project, not the cron.** Vercel turns crons on and off as a unit, so
  when a project's crons are off *every* cron in it shows as Disabled, with that reason attached.
- **Two crons on the same path are one row.** Vercel lets a project declare the same path twice with
  different schedules. Cronsole stores one schedule per task, so the row shows the first and carries
  the rest — rather than being quietly wrong about when it runs, or splitting into two rows fighting
  over one identity.
- **There is no next-run time, on purpose.** Vercel queues cron invocations on a best-effort basis —
  on Hobby, documented as within the hour of the scheduled time. A time computed from the cron would
  disagree with what actually happens, with nothing on screen to say which was right.
- **A team project looked up by name will 404.** A bare name resolves against your *personal*
  account, so a project owned by a team is genuinely not there. Paste the dashboard URL instead — it
  carries the team — and Cronsole's error says so rather than sending you to check the spelling.
- **Renaming a project on Vercel re-keys its rows.** The project name is the category and it is part
  of each task's identity, so a rename retires the old tasks and brings in new ones under the new
  name. Cronsole warns on the sync that first sees it; re-add the project to follow the rename.
- **The token is stored encrypted and never shown again.** Vercel cannot re-display an access token
  either, so there is no reveal button and rotating means pasting a new one. Cronsole verifies a
  token against Vercel before saving it, so a bad paste fails at the click rather than inside a sync
  days later.
- **Health here comes from your syncs, not from a probe.** The same rule every source follows:
  `getHealth` runs every 45 seconds per open tab, so probing would spend your rate limit on a
  question sync already answers. Sync is your probe.

---

## Seeing why a task failed

Every task's **Run History** tab has two lists. *Runs Cronsole performed* is Cronsole's own log —
your **Run now** clicks, and native jobs it executed itself. *Runs on the platform* is read live
from the source each time you open the tab, and it is where a task's own scheduled runs appear.

**Click a run to see what it produced**, including why it failed. What you get depends on what the
source publishes, and the differences are real rather than gaps in the product:

| Source | What a failed run shows |
|:---|:---|
| **Windows Task Scheduler** | Task Scheduler's own messages, the exit code, and which action produced it. Requires the agent published on or after 2026-08-25 — Cronsole says so if yours is older |
| **Cronsole-native** | The job's own output, already captured, with any `${secret.NAME}` values stripped out |
| **Gemini API Triggers** | The agent's full output and the tools it used. There is no Google page for this — Cronsole is the only place to read it |
| **GitHub Actions** | The failing step by name, plus a link to github.com for the raw console log |
| **Vercel Cron** | Nothing. Vercel publishes no cron run history at all, so this section is absent rather than empty |

> [!NOTE]
> **Windows records task history only if it is switched on.** It is a machine-wide setting and it is
> off by default on some installs. Cronsole tells you which — an empty list and a switched-off log
> are different answers. Turn it on in Task Scheduler under **Action › Enable All Tasks History**.
> It is not retroactive: runs from before you enabled it are gone.

> [!TIP]
> **Read the step list, not just the status.** A run can finish cleanly having skipped the part you
> cared about — an agent asked to email a report will complete successfully having only written a
> file, because its sandbox has no mail access. The status cannot show that; the steps can.

## Gemini API Triggers

**Scheduled prompts Google runs on its own agents in the cloud.** Connect on the **Sources** tab:
paste a Gemini API key, and that is the whole setup. There are no repositories or projects to name —
a key is scoped to one Google Cloud project and sees every trigger in it, so everything it can reach
arrives on the first sync under a single **Gemini** category.

**This is the first hosted source Cronsole can act on rather than only read**, and that is worth
saying out loud, because the two hosted sources before it are read-only and it would be reasonable to
assume the pattern holds. It does not. Cronsole runs, pauses, resumes, creates and deletes triggers
here, and reads how their runs actually went. The one thing it cannot do is **change an existing
trigger** — see *A trigger's schedule is fixed once it exists* below.

### Why *Run now* works here and is refused on the other two

GitHub Actions and Vercel Cron both refuse *Run now* even though each has an endpoint that could be
called, because in both cases what comes back is a lookalike: a `workflow_dispatch` run is a
different event from the scheduled one, and calling a Vercel cron path yourself is an ordinary HTTP
request the scheduler never records.

Gemini's is not a lookalike. Running a trigger runs **its own agent, with its own prompt, in its own
sandbox**, and the run appears on the same execution list the scheduled runs appear on. Google's own
documentation notes that pausing a trigger stops its *scheduled* executions while leaving manual ones
alone — which is the platform stating that the two are one mechanism with two doors.

### The signal this source gives you that the others cannot

**A trigger that keeps failing is paused by Google, not by you.** After a number of consecutive
failures — five by default — Gemini sets the trigger to `disabled` itself and stops running it.

Cronsole surfaces that as its own health warning with the failure count attached, rather than folding
it into the ordinary *this task is disabled* note. The difference matters: a task somebody
deliberately parked and an agent that has been dead for a week look identical on a dashboard, and
only one of them is something you need to know. **Resuming clears the pause and not the cause** — the
message says so, because a trigger that resumes and fails five more times is back where it started.

### What Cronsole can do here

**Sync · Run now · Enable / disable · Edit schedule · Create · Delete**, plus real run outcomes
feeding task health. **Edit action** is the one thing it cannot do: a trigger's payload is an agent, a
prompt, an environment and a network allowlist, and Cronsole has no form that can hold one honestly
yet. It shows as *Unsupported* on the Sources tab — edit the prompt in Google AI Studio.

### Things that surprise people

- **The action is a prompt, not a command.** The unit of work here is a sentence for an agent, so the
  create form asks for one. There is no executable to fall back on, and a create with no prompt is
  refused rather than sent.
- **A trigger Cronsole creates can reach nothing outside its sandbox.** Gemini lets a trigger declare
  a network allowlist, including domains carrying credentials in a header. Cronsole creates the
  plainest environment the API accepts and never guesses one — widening what an autonomous agent may
  reach is not a default a task manager gets to pick for you. Add domains in Google AI Studio.
- **The agent id is a setting, and it has a date in it.** `antigravity-preview-05-2026` is what
  Google's docs name today, and a preview id with a date is one that will be replaced. It lives in
  the connection panel rather than in Cronsole's source, so the day creates start failing the fix is
  a text field. Clearing it goes back to the shipped default.
- **Gemini stores a time zone and Cronsole stores UTC.** A trigger carries a cron *and* an IANA zone.
  Everything Cronsole writes is `UTC`, so a schedule that goes through Cronsole round-trips exactly.
  A trigger created elsewhere in a real zone is converted on the way in, with the platform's original
  cron and zone kept on the task — a shifted field always prints what it was shifted from.
- **A schedule Cronsole will not convert reads as unavailable, with the reason.** Some expressions
  have no honest UTC equivalent: one that pins a day of the month and crosses midnight in the shift,
  or one whose hour field names several hours. Cronsole says which rather than emitting a plausible
  cron that fires on the wrong day. The sync warns, and the original is on the task.
- **Zones that observe DST are converted at today's offset.** A 09:00 New York trigger is 13:00 UTC
  in summer and 14:00 in winter, and no single cron says both. Cronsole stores the current one — the
  same bargain it already makes when you type a schedule in your own zone.
- **Run history lives in two lists, and the second one is the real one here.** A task's **Run
  History** tab shows *Runs Cronsole performed* — which on this source is usually just your own
  *Run now* clicks — and below it *Runs on the platform*, read live from Gemini each time you open
  the tab. A trigger firing on its own schedule appears only in the second. Click a run to see the
  agent's output, what it cost, and **what it actually did**: the tools it reached for, in order.
  That last list is worth reading, because a run can finish cleanly having skipped the part you
  cared about — an agent asked to email a report completes `completed` having only written a file,
  since its sandbox has no mailer, and it will say so in its own output rather than failing.
- **There is no Google web page for any of this.** Gemini API Triggers are managed entirely through
  the API; Google's own documentation for them is programmatic only, and the Gemini app's
  scheduled-actions page is a different product. Cronsole is where you see them.
- **A trigger's schedule is fixed once it exists.** *Edit schedule* is unavailable on a Gemini task,
  and that is the preview API's boundary rather than a missing feature: its update endpoint accepts a
  trigger's status and display name and rejects the schedule outright. To move a trigger, change it
  in Google AI Studio, or delete it here and create it again — a new trigger gets a new id, so
  Cronsole treats it as a new task rather than the same one on a new schedule. The same is true of
  the prompt, which is why *Edit action* is unavailable too.
- **Deleting is real, and disconnecting is not.** *Delete* on a task removes the trigger from Gemini.
  *Disconnect* on the source forgets the key and the tracked rows, and leaves every trigger running
  exactly as before.
- **There is one category, and it is not a limitation.** A trigger has no repository, project or
  folder — a key sees a flat list. Grouping by agent id instead would put a dated preview string into
  your sidebar and into any saved view keyed on it.
- **The key is stored encrypted and never shown again.** Cronsole verifies it against Gemini before
  saving — by listing your triggers, which is the same request the source exists to make — so a bad
  paste fails at the click rather than inside a sync days later. Rotating means pasting a new one.
- **This API is a preview.** Triggers are part of the Gemini API's Managed Agents preview and the row
  is marked *Experimental* for that reason. It is a statement about the API underneath, not about how
  much of the connector is finished.
- **Health here comes from your syncs, not from a probe.** The same rule every source follows:
  `getHealth` runs every 45 seconds per open tab, so probing would spend a metered quota on a
  question sync already answers. Sync is your probe.

---

## Quick links — schedulers with no connector

The **Sources** tab has a *Quick links* view: bookmarks to ChatGPT, the Gemini app, Jules, and any
you add yourself. **Nothing is read or written through them**, and no task from one appears in your
dashboard.

> The **Gemini app**'s scheduled actions and **Gemini API Triggers** are two different things, and
> only the second has an API. A scheduled action you set up by talking to the Gemini app is reachable
> from the bookmark and nowhere else; a trigger created through the API is a real source above. They exist so the schedulers Cronsole *cannot* reach are still one click away rather
than invisible, and they get their own view rather than a place among the real sources, because a
bookmark that looks like a connector reads as a broken one.

Each link shows its host rather than its whole URL — the part that identifies it, instead of a
line that truncates into an ellipsis at tile width — and the remove control is **always
rendered**, not revealed on hover, so it is reachable on a phone.

They are a preference, so your links follow your account rather than the browser you added them in.

**Re-check these rather than assuming.** Gemini sat on this list for the whole of 2026 and shipped a
full CRUD trigger API four weeks before anyone looked again. As of 2026-08-24: ChatGPT Tasks grew a
better UI and no API; Grok Automations has no automation API; and Jules has both a public API *and*
scheduled tasks in the product, with no schedules resource joining them — the closest of the three to
changing.

A link graduates to a connector when it can do something a bookmark cannot — which needs a public
API for reading scheduled work, and is the first question in
[Adding a source](#adding-a-source). A connector that only *reads* is a finished thing, not a
stalled one: it says plainly which half it is.

---

## Adding a source

Every source is a **connector**: one class per platform implementing one interface
(`PlatformConnector`), compiled into the backend. There is no plugin folder and nothing to drop in
at runtime — deliberately. A connector holds credentials, issues commands to your machine and
decides what a sync is allowed to retire, which is not a thing to load off disk unreviewed.

So **adding a source means a pull request** to
[the repository](https://github.com/michaelschecht/cronsole), and the honest version of that
sentence is: open one, and you will get an answer about whether it fits. Some proposals do not, and
the reasons are written down rather than delivered in a reply to your PR.

> **Writing one? Read [Adding a source](../../contributing/Adding_A_Source.md)** — the contributor
> document. It has the build order file by file, which connector to copy, the full contract, and a
> five-minute proposal issue to open *before* you write anything, so that *"this should be a quick
> link"* costs you a paragraph rather than a weekend. The rest of this section is the short version:
> what the shapes are, and what gets declined.

### First: is it a source at all?

Three shapes, and picking the wrong one is the usual reason a connector stalls half-built.

| Shape | When it fits | What it costs |
|:--|:--|:--|
| **Controller** | The platform has an API to read *and* change scheduled work — run, enable/disable, edit, delete. | The most work, and the most trust. Windows Task Scheduler and Cronsole-native are the two. |
| **Observer** | It can be read but should not be written, or cannot be. | Much less, and it is a **finished** state rather than a stalled one. GitHub Actions and Vercel Cron are the worked examples. |
| **Quick link** | No public API for scheduled work exists at all. | A bookmark, added from the Sources tab in ten seconds by anyone. |

An observer is the right default for a hosted platform. Cronsole says plainly which half a
connector is, so shipping a read-only source is not an apology.

### What a connector has to answer

- **A 5-field cron in UTC**, for every task it reports. That is the storage contract everywhere in
  Cronsole. If the platform's schedule cannot be expressed as one, the conversion is lossy and the
  connector has to say so — an approximation that goes unmentioned is the one outcome ruled out.
- **A schedule it could not read is `null` with a reason**, never a guessed cron. "Cronsole could
  not read this" and "this has no schedule" are different facts and get different rows.
- **Its own boundaries, as a list.** Verbs the platform genuinely cannot support go in
  `unsupportedVerbs`, which turns an attempt into a refusal (`400`) instead of a failure (`502`).
  Optional verbs you simply do not implement are unsupported by their absence — do not state the
  same boundary twice.
- **Health as evidence, never as a precondition.** No side effects: a health check that *fires* the
  thing it is checking is not a health check. Having no verdict is `UNKNOWN`, which is not a
  synonym for healthy.
- **A stable `externalId`**, unique within the platform. It is the identity every row is keyed on
  and every command addressed to.
- **A sync that fails loudly.** If *every* source in a sync failed, throw — returning an empty list
  reads as "the platform no longer has these tasks" and retires the lot. A partial failure returns
  what it got.

### Where the code goes

Ten files, in a fixed order — backend connector, Prisma enum and migration, capability descriptor,
then the frontend labels, palette and panel, then the records. The full list with the reason behind
each step is in [Adding a source](../../contributing/Adding_A_Source.md#3-build-it-in-this-order),
kept in one place because it is exactly the sort of list that goes stale when it is written twice.

Two rules from it are worth stating here because they are what review sends a PR back for:
**no platform-specific logic lives outside the connector layer** — a `switch` on the platform in a
route or a component — and **credentials go in `PlatformConnection.config`**, which is encrypted at
the application layer and never logged decrypted.

### What will not be accepted

- **A connector for a platform with no public scheduled-task API.** It renders as a row of
  *Unsupported* cells that say strictly less than a bookmark does. Add a quick link instead.
- **A write verb that is really a different action wearing the verb's name.** GitHub Actions refuses
  *Run now* even though `workflow_dispatch` exists, because a dispatched run is not the scheduled
  run you came to check.
- **Anything that makes the agent write files.** The Windows agent is elevated and local, and gets
  no file-write verb for that reason.

### Opening the PR

Say which of the three shapes it is and why, list the verbs you are *not* supporting and whether
that is "cannot" or "not yet", include the auth surface it needs, and say whether the platform
reports run outcomes at all. [Adding a source](../../contributing/Adding_A_Source.md#6-open-the-pr)
has the full list and the commands to run first;
[`CONTRIBUTING.md`](../../../CONTRIBUTING.md) has the commit format and branch roles.

**A connector with an honest capability matrix and half the verbs beats a complete-looking one that
guesses.**

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

*Last Updated: August 24, 2026*

<p align="right"><sub><a href="#sources-guide-top">back to top</a></sub></p>

---

<p align="center">
  <a href="../README.md">← User Guides</a> ·
  <a href="../../README.md">Docs home</a> ·
  <a href="../../contributing/Adding_A_Source.md">Adding a source →</a>
</p>

