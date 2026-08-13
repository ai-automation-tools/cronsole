# Cronsole Sources Guide

Cronsole shows tasks from more than one system, and those systems are not the same shape.
A Windows task lives on your machine and keeps running whether or not Cronsole is up. A
Cronsole-native task *is* a row in Cronsole's database. A Claude routine lives at claude.ai
and Cronsole can only knock on its door.

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
flow. Created with **New Task › Cronsole › HTTP request**.

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

## Cronsole (Scripts)

**Run a program on a schedule**, with its exit code, duration and output recorded. Created
with **New Task › Cronsole › Run a program**.

Same platform as *Cronsole (HTTP)* — the Source bar separates them because they are different
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

## Claude Code routines

**Fire a routine that already exists at claude.ai.** Added with **New Task › Claude**, which
is titled *Connect a routine* rather than *New Task* — because that is what it is.

Anthropic exposes exactly one routines endpoint, and calling it **runs the routine**. There is
no create, no list, no pause, no read. Everything about this source follows from that.

### What Cronsole can do here

**Run now** — and connect, edit and disconnect the declaration. That is the whole list.
Create and enable/disable are marked *Unsupported* on the Platforms tab rather than
*Declared*, because no evidence for them can ever arrive.

### Things that surprise people

- **Your list of routines is your own declaration.** There is no endpoint to enumerate them,
  so "sync" here returns the routines you typed in. The registry *is* the platform.
- **The token is shown once, by claude.ai.** Get it from the routine → *Edit* → *Add another
  trigger* → *API* → *Generate token*; generating a new one revokes the old. Cronsole stores it
  encrypted and never shows it again — there is no reveal button, because claude.ai cannot
  re-display it either. Mistyped the id? **Edit** the routine and Cronsole keeps the token.
- **The card shows no schedule, on purpose.** The routine's cadence lives at claude.ai and is
  not readable through the one endpoint that exists. Cronsole shows what it knows rather than a
  guess. *Run now* works regardless.
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
- **Pausing stays in claude.ai.** Routines really can be paused — a paused routine is exactly
  what makes a fire request fail — so Cronsole can *observe* the paused state as a run failure
  while being unable to read or set it.
- **Health here comes from your runs, not from a probe.** A health check that called the
  endpoint would *fire your routine* and eat into its daily cap, so Cronsole reports what the
  last real run showed instead.
- **This connector is experimental** because Anthropic ships the endpoint as a research
  preview behind a dated beta header and says the shapes may change.

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

*See also: the [UI User Guide](UI_User_Guide.md) for the rest of the interface, and the
[troubleshooting log](../../troubleshooting/README.md) when something behaves unexpectedly.*

*Last Updated: August 12, 2026*
