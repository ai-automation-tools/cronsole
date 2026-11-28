---
name: cronsole-windows-jobs
description: >-
  Design, register and verify a Windows Task Scheduler job by picking one of four proven archetypes —
  an unattended AI-agent CLI run, a wrapped maintenance script, a service watchdog or lifecycle task,
  or a plain command — then tracking it in Cronsole. Ships a runnable wrapper and registrar. Use
  whenever the user wants a new scheduled job, cron job, recurring task, nightly or weekly
  automation, watchdog, healthcheck, drive cleanup, doc refresh, or "run Claude Code on a schedule"
  on Windows; whenever an existing scheduled task needs re-scheduling, parking or debugging; and
  whenever a scheduled task reports success while doing nothing, stops notifying, or "ran" with no
  effect.
---

# Windows Task Scheduler jobs

Most scheduled jobs worth building are **one of four shapes**. Recognize the shape, fill in its
config, and let a registrar create the task — rather than hand-building a task definition and
discovering its defaults are wrong six weeks later.

> **The frame:** a scheduled task is code registered to run on a computer forever with nobody
> watching. The interesting failure is never a crash — it is a job that exits 0, reports green, and
> did nothing. Every rule below exists because that happened to someone.

This skill is transport-agnostic and path-agnostic. It ships two scripts you can use as-is or as a
starting point, and it assumes nothing about your folder layout beyond what you tell it.

---

## 1. The pattern: config + runner + registrar

**A scheduled job should be a config file plus a shared runner, never a hand-made task.**

```
<jobs-root>/
└── <job-name>/
    ├── job.json      what to run, how to classify it, when
    └── logs/         rotated transcripts, one per run
```

The scheduled task points at the **runner**, with `-Job <name>`. The runner launches the job's
script, captures what it printed, classifies the outcome, and hands the result to a notifier.

| Script | Does |
|:---|:---|
| [`scripts/Invoke-ScheduledJob.ps1`](scripts/Invoke-ScheduledJob.ps1) | Launch · capture transcript · classify by exit code and `warnOn` · notify · rotate logs |
| [`scripts/Register-ScheduledJob.ps1`](scripts/Register-ScheduledJob.ps1) | Register the task with the six non-default settings an unattended job needs |

```powershell
# set once, or pass -JobsRoot explicitly; defaults to ~\.claude\jobs
$env:SCHEDULED_JOBS_ROOT = "$HOME\.claude\jobs"

pwsh -File scripts\Invoke-ScheduledJob.ps1   -Job <name> -WhatIfChild   # dry run
pwsh -File scripts\Register-ScheduledJob.ps1 -Job <name> -WhatIf        # preview
pwsh -File scripts\Register-ScheduledJob.ps1 -Job <name>                # apply
```

**Why the indirection is worth it.** Pointing the task straight at your script is the obvious move
and it costs you three things silently: no transcript, so a failure a month ago is unknowable; no
classification, so "exited 0 having done nothing" looks identical to success; and no notification,
so a job that has been broken for six weeks is indistinguishable from one that had nothing to do.

**Already have a runner?** Use it. This pattern is what matters, not these two files — if you have
an equivalent, the rest of this skill still applies and §2's archetypes are the part to read.

---

## 2. Pick the archetype

| You were asked for… | Archetype | Read |
|:---|:---|:---|
| "Run Claude Code / an AI CLI on a schedule", "have an agent update X weekly", a prompt executed unattended with a completion notification | **A — agent run** | [`references/agent-job.md`](references/agent-job.md). The bypass always comes with a deny file (`--settings`) and a prompt that treats fetched content as data, per `automated-dev-pipeline` rule 11 |
| Clean up a drive, kill idle processes, prune logs, audit something, refresh docs by running an existing script | **B — maintenance** | [`references/maintenance-job.md`](references/maintenance-job.md) |
| Keep a local app alive, restart it, probe its health every N minutes, start it at logon, stop it on demand | **C — service** | [`references/service-jobs.md`](references/service-jobs.md) |
| One command, nothing to classify, no report needed | **D — plain command** | §4 below. The only one Cronsole's `create_task` should author. |

Archetypes A and B share a runner and blur at the edges — **an unattended agent session wrapped by
the maintenance runner is a common and correct shape**. The split that matters is not "is there an
agent" but:

> **Does this work need a git worktree and a pull request?**

- **Yes** — it edits a repo you care about → archetype A's isolated shape.
- **No** — it edits files in place, or runs a script that happens to call an agent CLI → archetype B.

Getting this wrong is expensive in one direction only: running repo work without isolation means an
unattended session editing the checkout you have open, on whatever branch you left it on.

---

## 3. What every archetype needs

`Register-ScheduledJob.ps1` sets these. They all differ from the Windows default, each for a reason.

| Setting | Value | Why |
|:---|:---|:---|
| **RunLevel** | `Limited` | `Highest` stamps an admin ACE on the task, and you then need elevation to delete your own task. Override with `"runLevel": "Highest"` only when a non-elevated run would quietly do **less** rather than fail — a cleanup whose Windows Temp and component-store targets are skipped with a note is the canonical case. |
| **LogonType** | `Interactive`, as you | A **user-scoped** environment variable — an API key for the notifier, most often — is invisible to SYSTEM. The job then works perfectly and the notification fails silently forever. |
| **StartWhenAvailable** | off; `"catchUp": true` in `job.json` turns it on | On, a run the machine slept through fires late at wake-up, possibly at a bad moment for a job that writes or sends. Off, a weekly job whose machine was asleep at 03:00 Sunday skips that week, so check `LastRunTime`, or turn catch-up on for a job where a late run is harmless. |
| **ExecutionTimeLimit** | from `executionTimeLimitHours` | Bounded well under the cadence, so a hung run cannot still be going when the next one starts. The Windows default is **72 hours**. |
| **Batteries** | allowed | The default both refuses to start on battery *and* stops a running task when you unplug. Both are wrong on a laptop. |
| **MultipleInstances** | `IgnoreNew` | One run at a time. |

### Two encoding rules that cost real hours

- **Keep `.ps1` files ASCII, no BOM.** Windows PowerShell 5.1 reads a BOM-less `.ps1` as ANSI and
  turns one stray em-dash into a wall of bogus parse errors. PowerShell 7 does not — so the bug only
  appears on whichever shell you did not test in.
- **`shell` is per job, and `powershell.exe` is often right.** The runner may be pwsh 7; that must
  not change what the child runs under. A script written against 5.1 carries 5.1-specific
  workarounds and breaks under 7.

### Stagger the schedule

Check what is already registered before picking a slot. Two concurrent unattended sessions is fine;
five is not. A workable convention is one lane per kind — agent runs late evening, one per weekday;
maintenance in a single early-morning block on the half hour.

---

## 4. Archetype D — a plain command

Only when there is genuinely nothing to report: one command, no transcript, no classification, no
notification. This is the shape **Cronsole's own `create_task` should author**, and Cronsole's
`cronsole` skill (`cronsole/references/task-authoring.md`) is the authority there. Three things bite:

- The command is **tokenized into a no-shell `{executable, args[]}`** — pipes, `>`, `&&` and `%VAR%`
  do not work until you invoke `cmd.exe /c` or `powershell.exe -Command` explicitly. That
  explicitness is the point: a shell you opted into is auditable.
- The schedule is **5-field cron in UTC**. Run `convert_schedule` first and **read the returned
  trigger, not the score** — an unrecognized expression is replaced with a hard-coded **hourly**
  trigger, so `0 4 1 1 *` ("once a year") becomes 8,760 runs a year. Never encode "don't run" in a
  cron; **disable** the task instead.
- The default folder is `\Cronsole`, the only folder Cronsole creates. Any other folder must already
  exist unless you pass `createFolder: true`.

If while writing it you find yourself wanting the output logged or a failure reported — it is not
archetype D. Go back to §2.

---

## 5. Where the task goes

Folder layout is yours to choose, but **choose one and keep to it**, because every audit, sweep and
backup you write later will select by path.

A layout that has held up: one root per purpose (`\<Org>-Maintenance\`, `\<Org>-Projects\`,
`\<Org>-Tools\`), with a subfolder per kind or per app. Set it in `job.json` with `taskPath`.

Two rules that are not stylistic:

- **`\Microsoft\` is refused**, here and in Cronsole's backend and agent independently.
  `RegisterTaskDefinition` **silently overwrites** a same-named task there, and a scheduled task
  often runs elevated — so a collision destroys a real Windows task with no error.
- **Whatever roots you pick, keep every job inside them.** A task registered outside the paths your
  audit sweeps is a task your audit will never report on.

---

## 6. Track it in Cronsole

[Cronsole](https://github.com/ai-automation-tools/cronsole) **observes** these jobs; it does not
author them. This step is optional — the job works without it — but it is what gives you one pane
over Task Scheduler, native jobs and hosted agents together.

1. `sync_tasks` — naming a folder is the gesture that starts tracking it.
2. `list_tasks` / `get_task_health` — confirm the schedule Cronsole read back matches what you
   registered. A disagreement is a UTC-conversion issue, not a display bug.
3. `set_task_status: DISABLED` is how you **park** a job — never an exotic cron (§4).
4. `untrack_task` tidies the dashboard while leaving the real task running.
5. **No MCP verb can delete a Windows task.** `delete_task` is native-only and 400s here by design;
   deleting one needs a human in the UI.

What Cronsole's `lastRunStatus` means on Windows is narrow: its agent observed the task **started**.
A command that hangs forever reports `SUCCESS`. Real Windows outcomes live in `lastTaskResult`.
Details, and what every other reading means, in
[`references/register-and-verify.md`](references/register-and-verify.md).

---

## 7. Checklist

1. **Recognize the archetype** (§2). About to write a new runner? Check whether the pattern in §1
   already covers it.
2. **Read a sibling job's config** before writing one.
3. **Write `job.json`**, not the task. ASCII, absolute paths, `shell` chosen deliberately.
4. **Write the prompt** if an agent is involved — and do not copy one from another job. Nearly every
   disappointing agent run is a prompt that never said what "done" means *here*.
5. **Pick a free schedule slot** (§3).
6. **Dry-run**: `Invoke-ScheduledJob.ps1 -Job <name> -WhatIfChild`.
7. **Register**: `Register-ScheduledJob.ps1 -Job <name> -WhatIf` first.
8. **Run it once for real** and read the transcript — not the exit code.
9. **Verify from outside** → [`references/register-and-verify.md`](references/register-and-verify.md).
10. **Track it in Cronsole** and confirm it reads back the schedule you intended.

---

## 8. Anti-patterns

- **Pointing the task at the job's script instead of the runner.** Silently removes the transcript,
  the classification and the notification — the three things the wrapper exists for.
- **Copying a prompt between agent jobs.** The runner is generic; the prompt is not.
- **`RunLevel Highest` "to be safe".** It is not safe: it makes the task need elevation to delete.
- **Registering as SYSTEM.** A user-scoped key vanishes and every notification fails, silently.
- **Encoding "don't run yet" in the cron.** An unrecognized expression becomes *hourly*. Disable it.
- **Trusting exit 0.** An agent reports a problem in prose and exits clean; that is what `warnOn` is
  for.
- **Trusting a `SUCCESS` from the scheduler.** It means the task *started*.
- **Registering a task outside the roots your audit sweeps.** It will never be reported on.
- **Leaving a test task registered.** It is a real scheduled task and will fire forever.

---

## Related

| For | See |
|:---|:---|
| Scheduled **cloud** agent routines, not local ones | the `cronsole-claude-routines` skill |
| Cronsole's own create/schedule/manage rules | Cronsole's `cronsole` skill → `cronsole/references/task-authoring.md` |
| Sending the notification as email | the `html-email-templates` skill |
| Choosing a model tier for an agent job | the `task-router` skill |
