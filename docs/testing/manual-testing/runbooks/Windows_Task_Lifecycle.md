# 🪟 Windows Task Lifecycle

> **Covers:** F1.3, F1.4, F1.5, F1.8, F2.8 · I4.1, I4.2, I4.3, I4.4, I4.6 · U2.2, U4.2
> **Time:** ~25 min · **Needs:** the stack + **real Windows Task Scheduler**

This is the runbook that earns TaskHub's core promise. Every automated test of this path uses
a **mock agent** — which proves the protocol, not the platform. Only this runbook proves a
real task really appears, really fires, and really disappears.

**The discipline:** after every TaskHub action, verify in **Task Scheduler**, not in TaskHub.
TaskHub agreeing with itself proves nothing.

Complete the [preflight](../README.md#-preflight--do-this-once-per-session) and the
[Smoke Test](Smoke_Test.md) first. `$H` holds your auth header.

---

## 1. Baseline the scheduler

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -ErrorAction SilentlyContinue |
  Select-Object TaskName, State
```

**Expect:** whatever's there now (possibly nothing — the `\TaskHub\` folder auto-prunes when
its last task is deleted). Note it; you'll compare at the end.

## 2. Create a task through TaskHub

In the UI: **Templates** → pick a harmless one → apply it with a name like
`manual-test-lifecycle`. Or via the API:

```powershell
$body = @{
  platform   = 'WINDOWS_TASK_SCHEDULER'   # required — also what arms the name guard
  name       = 'manual-test-lifecycle'    # optional; defaults to the template's name
  schedule   = '0 3 * * *'                # 5-field cron, UTC
  parameters = @{ }                       # fill per the template's {{placeholders}}
} | ConvertTo-Json

Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
  -Headers $H -ContentType 'application/json' -Body $body
```

**Expect:** `200/201` and a task id back.

> The server owns `{{placeholder}}` substitution — pass **raw `parameters`**, not a
> pre-substituted `command`. (`command` still exists for legacy clients but is deprecated.)

## 3. ⭐ Verify it exists in Windows — not in TaskHub

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle'
```

**Expect:** the task exists, `State = Ready`.

**This is the step that matters.** If TaskHub shows the task but this doesn't, TaskHub is
lying — the highest-severity bug class in this product.

## 4. Verify the trigger compiled correctly

```powershell
(Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle').Triggers
```

**Expect:** the trigger matches your cron **converted from UTC to local time**. A `0 3 * * *`
task in UTC−5 must show a **22:00** local trigger, not 03:00. Getting this backwards is a
whole class of "why did it run at the wrong time" bugs.

## 5. Verify the action is a real, unshelled command

```powershell
(Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle').Actions |
  Format-List Execute, Arguments
```

**Expect:** `Execute` is the real executable with `Arguments` separate. **`Execute` must not
be `cmd.exe` with a `/c "…"` payload** unless the template opted into a shell explicitly.
Implicit shell = the P0 injection guarantee is broken. See
[R3.1](../../regression-testing/README.md).

## 6. Run Now

```powershell
Invoke-RestMethod -Method Post "http://localhost:3000/api/tasks/<task-id>/run" -Headers $H
```

**Expect:** a success response, and a toast in the UI within ~5s.

## 7. ⭐ Verify Windows actually ran it

```powershell
Get-ScheduledTaskInfo -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle' |
  Select-Object LastRunTime, LastTaskResult, NextRunTime
```

**Expect:** `LastRunTime` is **just now** and `LastTaskResult` is `0`. A TaskHub success toast
with no `LastRunTime` change means the run never reached Windows.

## 8. No console flash

Watch the screen during step 6.

**Expect:** **no PowerShell window flashes.** Scheduled runs go through the hidden-launch path
(`scripts/startup-task/run-hidden.vbs`). A visible flash is a regression — it's a bug we
already fixed once.

## 9. Execution log recorded

```powershell
Invoke-RestMethod "http://localhost:3000/api/tasks/<task-id>/executions" -Headers $H |
  ConvertTo-Json -Depth 5
```

**Expect:** an entry for step 6's run with status and output. Then open the task in the UI —
the detail view should show the same history.

## 10. Edit the schedule

```powershell
$body = @{ schedule = '30 4 * * *' } | ConvertTo-Json
Invoke-RestMethod -Method Patch "http://localhost:3000/api/tasks/<task-id>/schedule" `
  -Headers $H -ContentType 'application/json' -Body $body
```

Then **verify in Windows**:

```powershell
(Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle').Triggers
```

**Expect:** the trigger moved to the new time (again, UTC → local). This edit rides a **signed
HMAC command** — a failure here may be signature-related, not schedule-related.

## 11. Disable, and verify

```powershell
$body = @{ enabled = $false } | ConvertTo-Json
Invoke-RestMethod -Method Patch "http://localhost:3000/api/tasks/<task-id>/status" `
  -Headers $H -ContentType 'application/json' -Body $body

(Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle').State
```

**Expect:** `Disabled` — in **Windows**, not just in TaskHub's UI. Re-enable and confirm it
returns to `Ready`.

## 12. Export round-trip

```powershell
Invoke-RestMethod "http://localhost:3000/api/tasks/<task-id>/export" -Headers $H `
  -OutFile "$env:TEMP\manual-test-lifecycle.xml"
```

**Expect:** valid Task Scheduler XML. Verify the encoding is **UTF-16 LE with a BOM** —
Windows rejects the import otherwise:

```powershell
$bytes = [System.IO.File]::ReadAllBytes("$env:TEMP\manual-test-lifecycle.xml")
'{0:X2} {1:X2}' -f $bytes[0], $bytes[1]     # Expect: FF FE
```

**The real proof** — import it back into Windows under a new name:

```powershell
Register-ScheduledTask -Xml (Get-Content "$env:TEMP\manual-test-lifecycle.xml" -Raw) `
  -TaskName 'manual-test-reimport' -TaskPath '\TaskHub\'
```

**Expect:** it registers without error. That's what "exportable" actually means.

## 13. Delete, and verify it's really gone

```powershell
Invoke-RestMethod -Method Delete "http://localhost:3000/api/tasks/<task-id>" -Headers $H

Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle' -ErrorAction SilentlyContinue
```

**Expect:** the second command returns **nothing**. The DB row must only go **after** the
platform confirms — so if Windows still has it, TaskHub must still list it.

## 14. Empty folder auto-prunes

Delete every task in `\TaskHub\` (including `manual-test-reimport` from step 12), then:

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -ErrorAction SilentlyContinue
```

**Expect:** the `\TaskHub\` folder is gone — it auto-prunes on last-task delete.

## 15. Elevation refusal is honest

Find an admin-ACL'd task (one Windows requires elevation to modify), import it into TaskHub,
and try to delete it.

**Expect:** an honest **"needs elevation"** refusal. **Not** a success toast, and **not** a
deleted DB row for a task that still exists in Windows. A false success here is worse than an
error — the user now trusts a dashboard that's wrong.

---

## ✅ Pass criteria

- [ ] Created task exists in **Windows** with correct trigger + action (3–5)
- [ ] Trigger reflects **UTC → local** conversion correctly (4)
- [ ] Action is unshelled unless explicitly opted in (5)
- [ ] Run Now moves `LastRunTime` with result `0` (6–7)
- [ ] No console flash (8)
- [ ] Execution logged in API + UI (9)
- [ ] Schedule edit lands in Windows (10)
- [ ] Disable/enable changes **Windows** state (11)
- [ ] Export is UTF-16 LE + BOM and **re-imports** (12)
- [ ] Delete removes the real entry; folder auto-prunes (13–14)
- [ ] Elevation refusal is honest (15)

## 🧹 Cleanup

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -ErrorAction SilentlyContinue |
  Where-Object TaskName -like 'manual-test-*' |
  Unregister-ScheduledTask -Confirm:$false

Remove-Item "$env:TEMP\manual-test-lifecycle.xml" -ErrorAction SilentlyContinue
```

Then sync TaskHub so its view matches reality again:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/tasks/sync -Headers $H
```

---

<p align="center">
  <a href="Smoke_Test.md">← Smoke Test</a> ·
  <a href="../README.md">Manual Testing</a> ·
  <a href="Template_Apply.md">Template Apply →</a>
</p>
