# Archetype C — service jobs

> Keeping a local app alive: start it, stop it, restart it, and check on it. Plus the watchdogs and
> audits that look at things nobody else is looking at.

---

## 1. The quartet

An app that runs on this machine gets four tasks in its own folder, and it is four **because the
verbs have different triggers and different blast radii**:

| Task | Trigger | Script |
|:---|:---|:---|
| `Start-<App>` | **At logon** | `startup-app.ps1` — idempotent, skips what is already running |
| `Stop-<App>` | **On demand** (no trigger) | `stop-app.ps1` |
| `Restart-<App>` | **On demand** (no trigger) | `restart-app.ps1` |
| `Healthcheck-<App>` | **Repetition**, every 15 m – 1 h | `healthcheck-app.ps1` — probes, and repairs by delegating |

A fifth is common: `Maintain-<App>`, on a daily trigger, for log rotation and pruning.

**Two of the four have no trigger on purpose.** Stop and Restart are things you *do*, not things that
*happen*. Giving them a schedule is how an app ends up bouncing nightly for reasons nobody remembers.

### The repair rule

**A healthcheck delegates repair; it never reimplements a start.** It should call the start script,
which is idempotent and already knows how to launch each part. Two definitions of "start this app" is
how one of them drifts and the check begins healing the app into a state the real start script never
produces.

It should also take a `-Repair:$false` switch so it can run as a **pure probe** when you are
diagnosing by hand. A check you cannot run without it changing things is not a diagnostic.

### Probe in the right currency

- **A thing with a port gets a real request.** A *process* check is not enough: a web server can be
  running and not serving — a bind failure, an exception during startup. Only an HTTP GET proves the
  thing a browser needs actually works.
- **A thing with no port gets a process check.** A synthetic write to prove a sidecar is alive would
  put real rows in a real store.
- **Name what the check must never touch**, in the script's header. A health check that kills
  "stray" child processes will eventually kill one that was doing something. Write the boundary down
  rather than remembering it.

**Log a healthcheck separately from start/stop.** A timer firing every few minutes otherwise buries
the start/stop history in noise.

---

## 2. `run-hidden.vbs` — why a VBScript is in the chain

Task Scheduler launches PowerShell as a **console application**, so conhost paints a window on the
interactive desktop *before* PowerShell ever parses `-WindowStyle Hidden`. The flash is unavoidable
that way, and on a 15-minute timer it is unbearable.

`wscript.exe` is a windowless host. `Shell.Run(cmd, 0, True)` starts the child hidden **and waits for
it**, so the exit code still reaches the task.

```
Execute:   C:\Windows\System32\wscript.exe
Arguments: "<path>\run-hidden.vbs" "<path>\healthcheck-app.ps1"
```

[`scripts/run-hidden.vbs`](../scripts/run-hidden.vbs) ships with this skill — it prefers PowerShell 7,
falls back to Windows PowerShell, and passes any extra arguments straight through.

> [!WARNING]
> **Keep it ASCII with no BOM — wscript chokes on a UTF-8 BOM.** The failure mode is the task
> "running" and nothing happening.

Use the shim for anything on a short repetition interval, or firing while someone is at the desk. A
daily 03:00 job can use `-WindowStyle Hidden` directly and nobody will ever see the flash.

---

## 3. Triggers

| Want | Trigger | Registers as |
|:---|:---|:---|
| Every N minutes, forever | A one-time trigger with a **repetition interval**, indefinite duration | `MSFT_TaskTimeTrigger` + `rep=PT15M` |
| At logon, then keep re-asserting | A **logon** trigger with a repetition interval | `MSFT_TaskLogonTrigger` + `rep=PT30M` |
| At logon, once | Logon trigger, no repetition | `MSFT_TaskLogonTrigger` |
| On demand only | **No trigger at all** | — |

Logon + repetition is the right shape for *"make sure this is up"*, as distinct from *"start this"*.

**In Cronsole these read as cron.** `rep=PT15M` arrives as `*/15 * * * *`, and a task with no trigger
has `schedule: null` — which is correct, not missing data. **The reverse conversion is lossy: never
re-create a task from that cron string** to express a repetition interval.

---

## 4. A launcher task is not the process it launched

The trap that costs the most, and it applies to every task in this archetype using the shim.

When the thing a task starts **outlives the task**, the task instance ends in under a second while
the process runs on, unparented. Therefore:

- **`Stop-ScheduledTask` on a launcher task stops nothing** — and reports success.
- **`LastTaskResult: 0` is a statement about the shim**, never about what it started.
- **Restarting is a property of the script, not of the task.** Give the app its own explicit restart
  path. An idempotent `up`-style script is **not** a restart — idempotence is the property that lets
  a self-heal run every few minutes, and it is exactly why `up` cannot double as a bounce.

And the general rule this archetype turns on:

> **Every layer needs a keeper that runs as often as the failure can happen.** A watchdog that can
> only *report* that a dependency is down, while the thing that could start it runs once at logon, is
> half a watchdog.

### Read the registered action, not the name

A task's name and description are **not** its definition. If two scripts can register the same task
name, `-Force` lets one overwrite the other exactly as documented, and a bounce can return success
while changing nothing for months.

```powershell
(Get-ScheduledTask -TaskPath '\MyOrg-Projects\MyApp\' -TaskName 'Healthcheck-MyApp').Actions |
  Select-Object Execute, Arguments, WorkingDirectory
```

**Exactly one script may own a task name.** If two registrars can write it, one of them is wrong.

---

## 5. Monitors: repairing vs reporting

A monitor is archetype C when it repairs and archetype B when it only reports. Decide which you are
building, **say so in the script header**, and do not let a reporter grow a repair path by accident.

| Shape | Example | Why |
|:---|:---|:---|
| **C** — shim + repetition, restarts what is down | an app watchdog every 15 min | It repairs, so it is a service task |
| **B** — wrapped by the runner, `warnOn: ^ISSUE:` | a weekly scheduled-task audit | It reports only; the notification *is* the output |

> **A diagnostic reports; it does not repair.** When the readout itself is the thing that is wrong —
> and in practice it often is — a "restart it" button restarts a working component forever and looks
> like it is working.

**An audit should sweep by path**, flagging any task with a real failure result or an unexpected
`Disabled` state. Two consequences: keep every job inside the roots the audit sweeps, and **when you
move a task, grep for its old path** — scripts that hardcode task paths are exactly what a folder
reorg breaks silently.

---

## 6. Verify a service job

```powershell
$t = Get-ScheduledTask -TaskPath '\MyOrg-Projects\MyApp\' -TaskName 'Healthcheck-MyApp'
$t.Actions  | Select-Object Execute, Arguments      # the shim, and the right script?
$t.Triggers | Select-Object StartBoundary, Repetition
Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly
#   267009 = STILL RUNNING (hung). Flat CPU means blocked, not working.
```

Then get evidence **from outside the task**: the app's own log line, an HTTP response, a PID that
changed. For a launcher task, `LastTaskResult: 0` proves only that the shim ran — go and look at the
thing it was supposed to start.

---

## 7. Anti-patterns

- **Giving Stop or Restart a schedule.** They are on-demand verbs.
- **A healthcheck that reimplements the start.** Delegate to the start script.
- **A process check where a port exists.** Running is not serving.
- **Plain PowerShell on a short repetition interval.** A console flashes on every fire.
- **A BOM in `run-hidden.vbs`.** wscript chokes and the task "succeeds".
- **`Stop-ScheduledTask` on a launcher task**, and believing the success it reports.
- **Two registrars writing one task name.** `-Force` hides which one won.
- **A service task outside the roots your audit sweeps.** It will never be reported on.
