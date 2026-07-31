# 🪟 Windows Task Lifecycle

> **Covers:** F1.3, F1.4, F1.5, F1.8, F1.8b, F1.8c, F1.9, F2.8 · I4.1, I4.2, I4.3, I4.4, I4.4a, I4.4b, I4.6 · U2.2, U4.2
> **Time:** ~30 min · **Needs:** the stack + **real Windows Task Scheduler**

This is the runbook that earns Cronsole's core promise. Every automated test of this path uses
a **mock agent** — which proves the protocol, not the platform. Only this runbook proves a
real task really appears, really fires, and really disappears.

**The discipline:** after every Cronsole action, verify in **Task Scheduler**, not in Cronsole.
Cronsole agreeing with itself proves nothing.

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

## 2. Create a task through Cronsole

In the UI: **Templates** → pick a harmless one → apply it with a name like
`manual-test-lifecycle`. Or via the API:

```powershell
$body = @{
  platform   = 'WINDOWS_TASK_SCHEDULER'   # required — also what arms the name guard
  name       = 'manual-test-lifecycle'    # optional; defaults to the template's name
  schedule   = '0 3 * * *'                # 5-field cron, UTC
  parameters = @{ }                       # fill per the template's {{placeholders}}
} | ConvertTo-Json

$created = Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
  -Headers $H -ContentType 'application/json' -Body $body
$taskId = $created.id
$taskId
```

**Expect:** `200/201` and a task id back.

> **`$taskId` is what every `<task-id>` below means** — Cronsole's own row id (a cuid), **not**
> the task name. `/api/tasks/manual-test-lifecycle/run` returns `Task not found`; the route
> looks the task up by primary key. If you created the task in the UI instead, get the id with:
>
> ```powershell
> $all    = Invoke-RestMethod "http://localhost:3000/api/tasks" -Headers $H
> $taskId = @($all | Where-Object { $_.externalId -eq '\TaskHub\manual-test-lifecycle' })[0].id
> ```
>
> **The id changes.** Untrack (12a) deletes the row and re-import creates a new one, so re-read
> `$taskId` after **12a** and again after **12b** — a full pass through this runbook uses three
> different ids for the same Windows task.

> The server owns `{{placeholder}}` substitution — pass **raw `parameters`**, not a
> pre-substituted `command`. (`command` still exists for legacy clients but is deprecated.)

## 3. ⭐ Verify it exists in Windows — not in Cronsole

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle'
```

**Expect:** the task exists, `State = Ready`.

**This is the step that matters.** If Cronsole shows the task but this doesn't, Cronsole is
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

**Expect:** `LastRunTime` is **just now** and `LastTaskResult` is `0`. A Cronsole success toast
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
$body = @{ status = 'DISABLED' } | ConvertTo-Json
Invoke-RestMethod -Method Patch "http://localhost:3000/api/tasks/$taskId/status" `
  -Headers $H -ContentType 'application/json' -Body $body

(Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle').State   # -> Disabled
```

Then re-enable:

```powershell
$body = @{ status = 'ACTIVE' } | ConvertTo-Json
Invoke-RestMethod -Method Patch "http://localhost:3000/api/tasks/$taskId/status" `
  -Headers $H -ContentType 'application/json' -Body $body

(Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle').State   # -> Ready
```

**Expect:** `Disabled` then `Ready` — in **Windows**, not just in Cronsole's UI.

> The body is `{ status: 'ACTIVE' | 'DISABLED' }`, not `{ enabled: <bool> }` — the route
> validates against `patchTaskStatusSchema` and rejects anything else with
> `400 status: Invalid status`. A 400 here leaves Windows untouched, so a failed call is safe
> to just re-issue.

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

## 12a. Untrack — the row goes, the task stays

The whole safety claim of untrack is that it makes **no platform call**. Cronsole reporting
"Removed from Cronsole" is not evidence of that; Windows is.

```powershell
# Untrack it (the dashboard button is "Remove from Cronsole")
Invoke-RestMethod -Method Post "http://localhost:3000/api/tasks/$taskId/untrack" -Headers $H

# 1. Gone from Cronsole?
$all = Invoke-RestMethod "http://localhost:3000/api/tasks" -Headers $H
@($all | Where-Object { $_.externalId -eq '\TaskHub\manual-test-lifecycle' }).Count   # -> 0

# 2. THE check — does Windows still have it?
Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle'      # -> State: Ready
```

> [!WARNING]
> **Assign the response to a variable before filtering it — don't pipe `Invoke-RestMethod`
> straight into `Where-Object`.** IRM writes its array to the pipeline *without enumerating*,
> so the filter receives one `Object[]` instead of N task objects. `$_.externalId -eq '…'`
> then evaluates against the whole array and returns the *matching elements*, which is truthy,
> so **every** task passes the filter. Piping into `Select-Object` fails the same way and
> renders one blank row.
>
> This matters most right here: the broken form prints `0` when nothing matches, so it looks
> correct — but if untrack had left the row behind it would report the full task count instead
> of `1`. **It is a check that cannot fail in the direction it's testing.** `@(…)` around the
> filter also keeps `.Count` honest when exactly one row matches.

**Expect:** the row is gone from Cronsole and the scheduled task is **still there and still
`Ready`**. If Windows lost the task, untrack silently performed a delete — the single worst
outcome this feature can have, because it wore a reversible label while being irreversible.

Then prove the exclusion holds and that the way back works:

```powershell
# 3. A routine sync must NOT bring it back
Invoke-RestMethod -Method Post "http://localhost:3000/api/tasks/sync" -Headers $H `
  -ContentType 'application/json' -Body '{"scope":"tracked"}'
#    -> untracked.excludedCount = 1, and the task does NOT reappear

# 4. An explicit category import IS the way back
Invoke-RestMethod -Method Post "http://localhost:3000/api/tasks/sync" -Headers $H `
  -ContentType 'application/json' -Body '{"categories":["Cronsole"]}'
#    -> exclusionsCleared = 1, and the task returns
```

**Expect:** step 3 leaves it out (a sync that re-imported it would look identical to "untrack is
broken"), step 4 brings it back and **says so** — `exclusionsCleared` is what the toast turns
into *"Re-imported 1 task you had removed from Cronsole."*

Also check `GET /api/tasks/discover` between 3 and 4: the `Cronsole` category should report
`excludedCount: 1`, which is the amber **+1 removed** badge in the Import modal. The number has
to arrive **before** the click.

## 12b. Restore — put it back, and check with Windows

Step 12 proves the XML is *importable by Windows*. This proves **Cronsole can do the importing**,
which is a different claim and the one the Tools tab makes.

```powershell
# Base64 the exported bytes — never send the XML as a JSON string, or the UTF-16 is lost
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes("$env:TEMP\manual-test-lifecycle.xml"))
$body = @{ files = @(@{ relativePath = 'Cronsole/manual-test-lifecycle.xml'; contentBase64 = $b64 })
           dryRun = $true } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post "http://localhost:3000/api/tools/restore/tasks" `
  -Headers $H -ContentType 'application/json' -Body $body |
  Select-Object -ExpandProperty plan | Select-Object counts, foldersToCreate
```

**Expect** while the task still exists: `skip: 1`. Restore refuses to overwrite by default, and
the plan says so *before* anything is written.

Now delete the task in Windows and re-run the dry run with `createFolders = $true`. **Expect:**
`create: 1`. Then commit it (`dryRun = $false`) and take the evidence from **Windows**:

```powershell
$t = Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle'
$t.State; $t.Actions[0].Execute; $t.Principal.UserId; $t.Principal.LogonType; $t.Principal.RunLevel
```

**Expect:** the action, the trigger, **and the principal** match what you exported. The principal
is the one worth staring at — a restore that silently re-registers the task as a different account
is a restore that changed what it claimed to reproduce.

Then run it once more with `overwrite = $false`. **Expect:** `exists`, and the task's registration
date **unchanged** — "left alone" has to mean untouched, not rewritten identically.

> **Heads-up for cleanup:** the restore ran through the **elevated** agent, so the restored task
> (and any folder it created) now carry an administrator ACE. An unelevated
> `Unregister-ScheduledTask` will fail with `Access is denied` — delete it through Cronsole, or
> from an elevated Task Scheduler. See [#28](../../../troubleshooting/README.md#28-a-restored-task-or-the-folder-it-landed-in-cant-be-deleted-access-is-denied).

## 13. Delete, and verify it's really gone

```powershell
Invoke-RestMethod -Method Delete "http://localhost:3000/api/tasks/<task-id>" -Headers $H

Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-lifecycle' -ErrorAction SilentlyContinue
```

**Expect:** the second command returns **nothing**. The DB row must only go **after** the
platform confirms — so if Windows still has it, Cronsole must still list it.

## 14. Empty folder auto-prunes

Delete every task in `\TaskHub\` (including `manual-test-reimport` from step 12), then:

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -ErrorAction SilentlyContinue
```

**Expect:** the `\TaskHub\` folder is gone — it auto-prunes on last-task delete.

## 15. Elevation refusal is honest

Find an admin-ACL'd task (one Windows requires elevation to modify), import it into Cronsole,
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
- [ ] Untrack drops the row while **Windows still has the task**; a tracked sync leaves it out; an explicit import brings it back and says so (12a)
- [ ] Restore's dry run says `skip` while the task exists, `create` once it's gone, and the commit puts back the action, trigger **and principal** — read from Windows (12b)
- [ ] Delete removes the real entry; folder auto-prunes (13–14)
- [ ] Elevation refusal is honest (15)

## 🧹 Cleanup

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -ErrorAction SilentlyContinue |
  Where-Object TaskName -like 'manual-test-*' |
  Unregister-ScheduledTask -Confirm:$false

Remove-Item "$env:TEMP\manual-test-lifecycle.xml" -ErrorAction SilentlyContinue
```

Then sync Cronsole so its view matches reality again:

```powershell
Invoke-RestMethod -Method Post http://localhost:3000/api/tasks/sync -Headers $H
```

---

<p align="center">
  <a href="Smoke_Test.md">← Smoke Test</a> ·
  <a href="../README.md">Manual Testing</a> ·
  <a href="Template_Apply.md">Template Apply →</a>
</p>
