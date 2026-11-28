# Registering, verifying, and handing the job to Cronsole

> The last three steps of every archetype. Skipping them is how a job that was never going to work
> sits green for six weeks.

---

## 1. Register

```powershell
$env:SCHEDULED_JOBS_ROOT = "$HOME\.claude\jobs"    # or pass -JobsRoot every time

pwsh -File scripts\Invoke-ScheduledJob.ps1   -Job <name> -WhatIfChild   # print the command, run nothing
pwsh -File scripts\Register-ScheduledJob.ps1 -Job <name> -WhatIf        # preview the registration
pwsh -File scripts\Register-ScheduledJob.ps1 -Job <name>                # apply
```

The registrar is **idempotent** — re-running it is how you apply a schedule change you just made to
`job.json`. It should never be replaced by a hand edit in the Task Scheduler UI, because a hand edit
re-points the task at the raw script and silently removes the transcript, the classification and the
report.

> [!WARNING]
> **Registering uses `-Force`, which re-enables a task you had deliberately disabled.** If the job
> was parked, re-park it:
> `Disable-ScheduledTask -TaskPath '\MyOrg-Maintenance\Docs\' -TaskName 'Update Guides'`

Archetype C tasks are usually registered by the app's own setup script; archetype D by Cronsole's
`create_task`.

---

## 2. Preflight, before it ever fires

| Check | How | Why |
|:---|:---|:---|
| Every path in `job.json` exists | `Test-Path` each one | A missing path fails an hour into the run, or not until the job's quiet week ends. |
| The agent CLI is where you said | `Test-Path <cli>` | The most common break in archetype A, and the cheapest to catch. |
| Any CLI the job shells out to is authenticated | e.g. `gh auth status` | Better to fail at preflight than after spending a session. |
| A **user-scoped** env var the notifier needs is visible | `[Environment]::GetEnvironmentVariable('<NAME>','User')` | Invisible to SYSTEM. The job works and the notification dies silently. |
| The interpreter the notifier uses has its deps | e.g. `python -c "import requests"` | If it uses a system interpreter rather than a venv, that is the one that needs them. |
| The schedule slot is free | `Get-ScheduledTask \| ? TaskPath -like '\MyOrg-*' \| % { $_.TaskPath + $_.TaskName }` | Two concurrent unattended sessions is fine; five is not. |

---

## 3. Verify — the part everyone skips

**A registered task is not a working task, and `SUCCESS` is not evidence.** Both Windows' record and
Cronsole's report that the task *started*.

```powershell
$t = Get-ScheduledTask -TaskPath '\MyOrg-Maintenance\Docs\' -TaskName 'Update Guides'

$t.Actions   | Select-Object Execute, Arguments, WorkingDirectory
#   -> points at the RUNNER with -Job <name>, not at the raw script
$t.Principal | Select-Object UserId, RunLevel, LogonType
#   -> you / Limited / Interactive   (Highest only where job.json says so)
$t.Triggers  | Select-Object StartBoundary, DaysInterval, WeeksInterval, DaysOfWeek, Repetition
#   -> the local time you meant, not a round trip that moved it
$t.Settings  | Select-Object StartWhenAvailable, ExecutionTimeLimit,
                             DisallowStartIfOnBatteries, StopIfGoingOnBatteries, MultipleInstances

Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly
#   267009 = STILL RUNNING (hung). Flat CPU means blocked, not working.
```

Then get evidence **from outside the scheduler**, in this order of strength:

1. **A real side effect** — a file written, a row inserted, an HTTP hit, a PR that exists.
2. **The job's transcript** — `<jobs-root>\<job>\logs\`, plus the script's own deep log.
3. **The notification.** Read the **warnings** block, not just the `[OK]`.
4. `LastTaskResult`.

For an agent job, **read the step list, not the status**: a session asked to research and email a
report finishes `completed` having called only `write_file`, and no status anywhere can show that.

> **When you are testing the reporting layer's honesty, the reporting layer cannot be your witness.**

**Clean up after a test.** A test task is a real scheduled task and will fire forever if you leave
it. Delete it, and do not leave one on a schedule you picked for convenience.

---

## 4. Hand it to Cronsole

Optional — the job works without it. [Cronsole](https://github.com/ai-automation-tools/cronsole)
**observes** these tasks; it did not create them and it cannot delete them. What it buys you is one
pane over Task Scheduler, backend-run native jobs and hosted agent triggers together, plus health
scoring and cross-task run history.

```
sync_tasks                      # naming a folder is the gesture that starts tracking it
list_tasks  search: "<name>"    # schedule, status, nextRunTime, lastRunStatus
get_task_health <id>            # the tier, plus the evidence behind it
list_run_history                # cross-task; read runKind before status
```

| Reading | Means |
|:---|:---|
| **Does not appear after a sync** | Its folder is not tracked. Name the folder in the sync — that gesture is what starts tracking it, and it clears untrack exclusions inside it. |
| **`schedule` disagrees with your trigger** | A UTC-conversion issue, not a display bug. Cronsole stores 5-field cron in **UTC** and converts at the browser's edge only. |
| **`schedule: null`** | Correct for an on-demand task, and correct for a trigger shape Cronsole will not guess at. A schedule it could not read is `null` **with a reason**, never an assumed cron. |
| **`lastRunStatus: SUCCESS`** | Its agent observed the task **started**. Nothing more. Windows' real outcome is `lastTaskResult`. |
| **`health: unknown`** | The absence of a verdict, and it ranks **above** healthy. Not a defect. |
| **`status: MISSING`** | Tracked here, absent from the platform on the last sync — a real deletion, or an offline or permission-blinded agent. Indistinguishable from Cronsole's side; it self-heals when the task reappears. |

**Three verbs, three blast radii:**

| Goal | Verb | What survives |
|:---|:---|:---|
| Park it — stop it running, keep everything | `set_task_status: DISABLED` | the task, its schedule, its history |
| Tidy the dashboard, keep it running | `untrack_task` | the real scheduled task; Cronsole's history goes |
| Make it stop existing | **not available over MCP for Windows** | `delete_task` is native-only and 400s here |

That 400 is a boundary, not a missing feature: no MCP verb may destroy an artifact on the machine.
Deleting a Windows task needs a human in the UI, or your own removal path.

---

## 5. When a job goes quiet

Roughly in order of likelihood:

1. **Did it fire at all?** `Get-ScheduledTaskInfo` → `LastRunTime`. A job registered without
   `catchUp` skips a run the machine slept through; with `catchUp: true` (`StartWhenAvailable`) it
   runs **late**, not never.
2. **Did the *notification* fail rather than the job?** Check that a user-scoped key is visible and
   that the task runs as you, Interactive. A SYSTEM run works perfectly and tells nobody.
3. **Is the status filtered out?** If `notifyOn` lists statuses this job cannot produce, you have
   switched off its reporting and nothing complains.
4. **Did it exit 0 having done nothing?** Read the transcript and the `warnOn` hits. This is the
   failure the whole wrapper exists to surface.
5. **Is the action still what you think?** A second registrar, or a hand edit, may own the name now.
   `$t.Actions` is the answer; the name and description are not.
6. **Is it a launcher task?** Then `LastTaskResult: 0` is about the shim. Go look at what it started.
7. **Only then** suspect the script.

If the Cronsole side is what looks wrong — a source offline, timeouts, tools missing — check its own
stale-component list first (a Dockerized backend, a published agent, a built `dist/`, and an
unapplied database migration, which makes a whole feature 500 while every test stays green). Cronsole
ships a `/doctor` command for exactly this, and it is **read-only on purpose**: three of four
agent-health incidents there were the readout lying, so a "repair" button would have fixed a working
component forever and looked like it worked.
