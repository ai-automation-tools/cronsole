# Archetype B — a maintenance job

> An existing script, wrapped so that it reports. Drive cleanup, idle-process pruning, log rotation,
> repo pulls, doc refreshes, audits. [`scripts/Invoke-ScheduledJob.ps1`](../scripts/Invoke-ScheduledJob.ps1)
> runs one per task.

---

## 1. What the wrapper does, and does not do

Per run, in order:

1. **Launch** the script in the shell `job.json` names — with its arguments, at its working
   directory, at its run level.
2. **Capture** everything it wrote to stdout and stderr, into a UTF-8 transcript at
   `<jobs-root>\<job>\logs\<timestamp>.log`. The script's own logging is untouched and stays the
   deep record.
3. **Classify.** The **exit code is the source of truth**: non-zero is `failed`, full stop. A clean
   exit whose output matched a `warnOn` pattern is `attention`. Anything else is `ok`.
4. **Report.** Pipe a JSON payload to the job's `notify` command, if it has one.

**The wrapper never second-guesses the exit code and never edits the script it runs.** If you want
different behaviour from a job, change the *script*. The wrapper only decides what to quote.

This is why wrapping an existing job costs nothing: the script is unchanged, keeps its own logging,
and simply gains a voice. A script that writes a log nobody opens and exits is a job whose failures
stay invisible until someone happens to look.

---

## 2. `job.json`

```jsonc
{
  "_comment": "Why this job exists, and anything a reader would otherwise reverse-engineer.",

  "name":     "Cleanup C Drive",
  "taskName": "Cleanup C Drive",
  "taskPath": "\\MyOrg-Maintenance\\Cleanup\\",

  "script":           "C:\\Scripts\\Cleanup-CDrive.ps1",
  "arguments":        "-Apply",
  "shell":            "powershell.exe",
  "workingDirectory": "",
  "runLevel":         "Highest",              // omit for the default, Limited

  "logDir":  "C:\\Logs",                      // optional: the script writes its own
  "logGlob": "cleanup-cdrive_*.log",          //   transcript, a better report source

  "report": ["^Reclaimed \\(measured\\)", "^Free before / after"],
  "warnOn": ["^Skipped:", "needs an elevated shell"],

  "notify": {
    "command":   "python",
    "arguments": "C:\\Scripts\\notify.py",    // reads the JSON payload on stdin
    "notifyOn":  ["attention", "failed"]      // default: attention + failed
  },

  "schedule": { "dayOfWeek": "Sunday", "at": "03:00" },
  "executionTimeLimitHours": 2,
  "keepLogs": 20
}
```

**Write a `_comment_<key>` beside every non-obvious key.** It is what makes a two-year-old job
legible. `"runLevel": "Highest"` with no comment reads as carelessness; with one it reads as the
deliberate exception it is.

### The fields that decide behaviour

| Field | Rule |
|:---|:---|
| `shell` | **`powershell.exe` unless you have a reason.** The wrapper may be pwsh 7; that must not change the child's shell. A script written against 5.1 carries 5.1-specific workarounds. |
| `arguments` | **Never drop one you do not understand.** A cleanup script that is a *dry run* without `-Apply` makes that argument the whole job. |
| `runLevel` | `Limited` by default, and the default is right. `Highest` only when a non-elevated run would **quietly do less** rather than fail — Windows Temp, Delivery Optimization and DISM component-store targets get skipped with a note, so dropping elevation shrinks what a cleanup reclaims without failing anything. |
| `taskPath` | Keep it inside whatever roots your audit sweeps, or the job is invisible to it. |
| `logDir` + `logGlob` | When the script writes its own human-readable transcript, **that file is the report source** and stdout is only the fallback. Use it for anything producing a structured report. |
| `schedule` | `{dayOfWeek, at}` · `{daily, at}` · `{everyMinutes}` · `{atLogon}`. |
| `catchUp` | `false` by default: a run the machine slept through is skipped. `true` sets `StartWhenAvailable`, so it fires late at wake-up instead. Only for jobs where a late run is harmless. |
| `notify.arguments` | An array, one element per argument, so an argument with a space survives. A string still works but is split on spaces. |

---

## 3. `report` and `warnOn` — the craft

These two regex lists are the entire difference between a notification you read and one you filter
away. Both are matched line by line against the transcript.

### `report` = what the task did

Match the **shapes the script actually prints**, not prose you hope it prints. **Read a real run's
log before writing these.**

```jsonc
// A cleanup: a GB-sorted table, then a summary. Table rows open with a right-aligned figure.
"report": [
  "^\\s*[0-9,]+\\.[0-9]{2}\\s",
  "^Reclaimed \\(measured\\)",
  "^Free before / after",
  "^Would reclaim about"          // the dry-run wording, so an -Apply-less run still reports
]

// An agent-backed doc job: the prompt asks for a CHANGE SUMMARY heading, then bold
// headers and one bullet per file. Match those shapes, not sentences.
"report": ["CHANGE SUMMARY", "^\\*\\*", "^- \\*\\*", "^= done:", "^exit code:"]

// An audit that also writes an HTML report: one headline only. The per-item detail is in
// the attachment and must not be duplicated as a plain-text dump in the message body.
"report": ["^SUMMARY:"]
```

### `warnOn` = exited 0, still worth reading

This is the honest-reporting layer, and it exists because **a clean exit is not evidence of a clean
run**.

```jsonc
// A script that skips locked files rather than forcing them, and exits 0 either way --
// the Skipped list is the ONLY signal that a target was missed.
"warnOn": ["^Skipped:", "^  - .*(in use|denied|elevated|not found)", "needs an elevated shell"]

// Any unattended agent session: it can report a problem in prose and still exit clean.
"warnOn": ["^\\s*ERROR", "\\bcould not\\b", "\\bfailed to\\b", "\\bpermission denied\\b"]

// An audit: an ISSUE line means something needs a look. That is 'attention', not failure.
"warnOn": ["^ISSUE:"]
```

Three patterns worth stealing:

- **Match a fact, not a severity word.** A doc job that warns on `behind origin/main` catches the
  case where the docs now describe a build nobody is running. No error text anywhere says that.
- **Match hedging.** `\bnot sure\b`, `\bunsure\b`, `flagged, not fixed` catch an agent that did the
  work and quietly declined half of it.
- **Match the quiet-week line too**, so a run with nothing to do still reports *something*. A silent
  success and a silent failure look identical.

JSON escaping: these are strings, so every regex backslash doubles — `^\\s*`, `\\bcould not\\b`.

---

## 4. Registering and dry-running

```powershell
pwsh -File scripts\Invoke-ScheduledJob.ps1   -Job <name> -WhatIfChild   # print the command, run nothing
pwsh -File scripts\Invoke-ScheduledJob.ps1   -Job <name>                # run it, by hand, now
pwsh -File scripts\Register-ScheduledJob.ps1 -Job <name> -WhatIf        # preview the registration
pwsh -File scripts\Register-ScheduledJob.ps1 -Job <name>                # apply
```

The registrar is **idempotent** and doubles as "apply the schedule change I just made to `job.json`".
It points the task at the runner, never at the script directly — which is the whole point, and the
one thing a hand-edit in the Task Scheduler UI will quietly undo.

---

## 5. Spend nothing when there is nothing to do

The best maintenance jobs **diff before they work**. A doc job that fetches its upstream, compares
against the SHA it documented last time, and exits in two seconds when nothing landed costs nothing
on a quiet week — and when there *is* a delta it hands the agent the commit list rather than asking
it to go find one.

Copy this whenever the job's input might not have changed. An agent session that reads everything to
conclude "nothing changed" costs exactly as much as one that does real work.

---

## 6. Wrapping a job that already exists

Mechanical and safe — the script is not touched:

1. Create `<jobs-root>\<job>\job.json`. Copy `script`, `arguments`, `workingDirectory` and the run
   level **from the existing task's registered action**, not from memory.
2. Run one real run by hand and **read the log**. Write `report` and `warnOn` from what you see.
3. `Register-ScheduledJob.ps1 -Job <name>` — this re-points the existing task at the wrapper.
4. Confirm the action changed: `(Get-ScheduledTask ...).Actions`.

Do this the moment a job's silence starts to matter.

---

## 7. Anti-patterns

- **Writing `report` from the script's source instead of a real log.** The shapes differ.
- **Leaving `warnOn` empty** because "it exits non-zero if it fails". Exit codes are the *failure*
  signal; `warnOn` is the *did-less-than-you-think* signal, and that is the one that hides.
- **Dropping an argument you did not understand.**
- **`runLevel: Highest` for comfort.** It stamps an admin ACE; you then need elevation to delete your
  own task.
- **Pointing the task at the script instead of the wrapper.** Silently removes transcript,
  classification and report.
- **Duplicating an attached report into the message body.** Match one summary line instead.
- **A notifier that can throw and fail the run.** A reporting failure must not turn a good run into a
  bad one — the shipped wrapper catches and logs it.
