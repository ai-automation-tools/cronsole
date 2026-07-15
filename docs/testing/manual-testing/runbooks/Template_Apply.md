# 📄 Template Apply

> **Covers:** F3.1, F3.3, F3.4, F3.9, F2.7 · I5.1, I5.4, I5.5 · U3.1, U3.2, U3.3, U3.4, U4.3, U4.4
> **Time:** ~20 min · **Needs:** the stack + Windows

The template catalog is TaskHub's on-ramp — it's how a new user gets from "empty dashboard" to
"working scheduled task." This runbook walks that arc and checks the two honesty guarantees
that live here: **the 409 duplicate guard** and **honest handling of targets we can't compile**.

Complete the [preflight](../README.md#-preflight--do-this-once-per-session) and
[Smoke Test](Smoke_Test.md) first. `$H` holds your auth header.

---

## 1. Fresh install ships a curated core

```powershell
$templates = Invoke-RestMethod http://localhost:3000/api/templates -Headers $H
$templates.Count
```

**Expect:** **5** on a fresh install — the built-in core sampler. The other 50 are
**import-only** from the gallery.

> A number much larger than 5 on a *fresh* install means a stray `core: true` in
> `bundled.ts` — see [R2.4](../../regression-testing/README.md). On an *existing* install,
> prune-on-sync should have converged it to core already.

## 2. Prune-on-sync spared your own templates

```powershell
docker exec taskhub-db-1 psql -U taskhub -d taskhub `
  -c 'SELECT name, managed FROM "Template" ORDER BY managed, name;'
```

**Expect:** auto-synced rows are `managed = true`. Anything you imported or saved-as-template
is `managed = false` and **still present**. Prune only ever touches managed rows — if one of
your own templates vanished, that's a serious data-loss bug.

## 3. `core` never reached the database

```powershell
docker exec taskhub-db-1 psql -U taskhub -d taskhub -c '\d "Template"'
```

**Expect:** **no `core` column.** `normalize.ts` whitelists Prisma fields; `core` is a
distribution flag that lives in the registry only. A `core` column here means the whitelist
leaked.

## 4. Browse and facet the catalog

In the UI: open **Templates**.

**Expect:**
- Cards render with name, description, and **tag chips**.
- **Category**, **Tags**, and **Availability** facets each filter correctly.
- Availability shows **Built-in** vs **Import**, and built-in cards carry a **"Built-in" badge**.
- Favoriting persists across a reload.

## 5. Params are guessable

Open a template's Apply modal without reading its registry JSON.

**Expect:** every `{{placeholder}}` has a name and help text you could fill in **without
knowing the internals**. If you have to go read `bundled.ts` to know what to type, that's a
finding — log it against [U3.4](../../uat/README.md).

## 6. Preview scores the conversion before you commit

`preview` answers *"how well does this cron survive the trip to this platform's trigger?"* —
it returns `{ score, warnings, trigger }`, **not** a compiled command.

```powershell
$body = @{ platform = 'WINDOWS_TASK_SCHEDULER'; schedule = '0 3 * * *' } | ConvertTo-Json
Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/preview" `
  -Headers $H -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
```

**Expect:** `score` of `1` for a cleanly-convertible cron, **empty** `warnings`, and a
populated `trigger`.

Now feed it garbage:

```powershell
$body = @{ platform = 'WINDOWS_TASK_SCHEDULER'; schedule = 'not a cron' } | ConvertTo-Json
Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/preview" `
  -Headers $H -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
```

**Expect:** a **`200`** with `score: 0`, a warning explaining the 5-field cron format, and
`trigger: null` — **not a `400`**. An unparseable schedule is a *score-0 preview result*, by
design: the modal wants to show you the problem, not throw at you.

In the UI, the preview should update live as you type.

## 7. Schedule preview shows local *and* UTC

In the Apply modal, set a cron and check the human-readable preview.

**Expect:** both local and UTC, and they agree. Try a **cron preset chip** too — it should
populate a valid expression.

## 8. ⭐ Duplicate name returns 409

Apply a template as `manual-test-dup`:

```powershell
$body = @{
  platform   = 'WINDOWS_TASK_SCHEDULER'
  name       = 'manual-test-dup'
  schedule   = '0 3 * * *'
  parameters = @{ }
} | ConvertTo-Json

Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
  -Headers $H -ContentType 'application/json' -Body $body
```

Then apply **again with the same name**:

```powershell
try {
  Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
    -Headers $H -ContentType 'application/json' -Body $body
} catch { $_.Exception.Response.StatusCode.value__ }
```

**Expect:** **409**. Then confirm Windows still has exactly **one** task by that name:

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName 'manual-test-dup'
```

**Why this matters:** without the guard, Windows **silently overwrites** a same-name task.
The user loses a task and is never told. A `200` here is a data-loss bug, not a UX nit.

## 8a. ⭐ Folder selection lands in the real folder — and `\Microsoft\` is refused

> Requires the agent **republished** with the folder handler (troubleshooting #7). Against an
> older agent the create is *rejected* (the signature covers `folder`), which is the honest
> failure — not a silent misplacement.

Read the machine's real folders. Unwritable ones (`\Microsoft\…`) come back with
`writable: false` rather than hidden, so the UI can say *why*:

```powershell
$f = Invoke-RestMethod "http://localhost:3000/api/tasks/folders" -Headers $H
"writable: $(($f.folders | ? writable).Count)   refused: $(($f.folders | ? {-not $_.writable}).Count)"
$f.folders | ? writable | Select -First 8 path, taskCount
```

**Expect:** your real folders with real task counts, every `\Microsoft\*` marked
`writable: false`. **A blank `path` on every row** means the agent is emitting PascalCase keys
the backend can't read — see the note at the end of this case.

Pick an **existing, nested** folder from that list (make one in Task Scheduler by hand if you
have none) and apply into it:

```powershell
$existing = '\Work\Backups'   # <-- must already exist
$body = @{
  platform   = 'WINDOWS_TASK_SCHEDULER'
  name       = 'manual-test-folder'
  folder     = $existing
  schedule   = '0 9 * * 1-5'
  parameters = @{ }
} | ConvertTo-Json

Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
  -Headers $H -ContentType 'application/json' -Body $body
```

**Expect:** the task is really there — ask Windows, not the API response. The weekly trigger
must list **all five** weekdays (`DaysOfWeek` = 62), not just Monday:

```powershell
$t = Get-ScheduledTask -TaskPath "$existing\" -TaskName 'manual-test-folder'
$t.Triggers[0] | Select StartBoundary, DaysOfWeek
```

Confirm the category follows the **root** folder (`Work`, not `Backups`), since a Windows
task's category is a projection of its top-level folder:

```powershell
Invoke-RestMethod "http://localhost:3000/api/tasks" -Headers $H |
  ? { $_.name -like 'manual-test-folder' } | Select name, category, externalId
```

Now the other half of the rule — a folder that does **not** exist must be **refused**, never
created:

```powershell
$body = @{ platform='WINDOWS_TASK_SCHEDULER'; name='manual-test-nofolder'
           folder='\NoSuchFolder\Nested'; schedule='0 3 * * *'; parameters=@{} } | ConvertTo-Json
try {
  Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
    -Headers $H -ContentType 'application/json' -Body $body
} catch { $_.ErrorDetails.Message }

Get-ScheduledTask -TaskPath '\NoSuchFolder\*' -ErrorAction SilentlyContinue   # expect nothing
```

**Expect:** an honest failure naming the missing folder, and no `\NoSuchFolder` left behind.

**Why:** TaskHub creates exactly one folder — its own `\TaskHub`, the same one it prunes when
emptied. Deleting a Task Scheduler folder needs **elevation**, so any other folder TaskHub
created would be a one-way door only the user could close by hand. *Never create what you
cannot remove.*

Now the guard. Each of these must return **400**:

```powershell
foreach ($f in '\Microsoft', '\microsoft\Windows', '\MICROSOFT\Windows\SystemRestore', '\TaskHub\..\Microsoft') {
  $b = @{ platform='WINDOWS_TASK_SCHEDULER'; name='manual-test-sneaky'; folder=$f; schedule='0 3 * * *'; parameters=@{} } | ConvertTo-Json
  try {
    Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/apply" `
      -Headers $H -ContentType 'application/json' -Body $b
    "$f -> CREATED  <-- BUG"
  } catch { "$f -> $($_.Exception.Response.StatusCode.value__)" }
}
```

**Why this matters:** `RegisterTaskDefinition` **silently overwrites** a same-named task in the
same folder, and the agent runs **elevated**. A task named e.g. `SystemRestore` landing in
`\Microsoft\Windows\SystemRestore\` would destroy a real Windows task with no error — and
`create_task_from_template` is reachable over MCP, so a sentence could trigger it. A `200` here
is an OS-integrity bug, not a validation nit.

Then confirm the guard isn't a blanket deny — these are **not** `\Microsoft\` (the check
matches the root *segment*, not a prefix) and must be **allowed**, given the folders exist:

```powershell
# \MicrosoftEdgeBackups is a different folder; \Work\Microsoft is yours, not the reserved root.
```

Finally, the same name in a **different** folder must be *allowed* — `\TaskHub\Backup` and
`\Work\Backup` are genuinely different Windows tasks, and blocking it would make folders
pointless.

Clean up (tasks only — see the note):

```powershell
Get-ScheduledTask -TaskPath "$existing\" -TaskName 'manual-test-folder' |
  Unregister-ScheduledTask -Confirm:$false
```

> **Cleanup note.** TaskHub only auto-prunes an emptied `\TaskHub\`; every other folder is
> **yours** and is deliberately left alone. That's why it also refuses to *create* one — a
> folder it made would need **elevation** to delete, so it would be litter only you could
> clear. If a dogfood ever leaves folders behind, remove them from an **elevated** prompt:
> `(New-Object -ComObject Schedule.Service).Connect()` then
> `$svc.GetFolder('\').DeleteFolder('Name', 0)` — an unelevated shell gets `E_ACCESSDENIED`.

> **If every folder came back with a blank `path`:** the agent is emitting PascalCase
> (`Path`/`TaskCount`) while the backend reads `f.path`. The socket serializer does **not**
> camelCase — every emit must project explicitly (`path = f.Path`), the way `task:full_list`
> does. Nothing throws; you just get a well-formed payload of empty values claiming no folder
> is usable. Mocked tests can't catch it — see `TaskFolders_Event_EmitsCamelCaseKeys…`.

## 9. Applied task is tracked immediately

**Expect:** the applied task appears in the dashboard **right away** — no manual sync needed.

## 10. Lossy conversion is disclosed

Preview a schedule that can't map cleanly onto a Windows trigger — e.g. a step/list cron like
`*/7 * * * *` or `0 3 * * 1,3,5`:

```powershell
$body = @{ platform = 'WINDOWS_TASK_SCHEDULER'; schedule = '*/7 * * * *' } | ConvertTo-Json
Invoke-RestMethod -Method Post "http://localhost:3000/api/templates/<template-id>/preview" `
  -Headers $H -ContentType 'application/json' -Body $body | ConvertTo-Json -Depth 5
```

**Expect:**
- `score < 1.0` comes back with **at least one warning** — never a silent downgrade.
- In the UI, `score < 0.7` **blocks auto-apply** until you acknowledge the warning.

**The principle:** the user consents to loss. TaskHub never quietly degrades a schedule and
reports success. The score is `min(template confidence, conversion confidence)`, so a lossy
*either* way must surface.

## 11. Uncompiled targets are honest

Find a template declaring a `compatibleTargets` entry with **no compiler** (only Windows and
TaskHub-native compile today).

**Expect:** an honest **"copy to set up manually"** path — the command to run yourself. **Not**
a disabled button with no explanation, and **never** a silent no-op that looks like success.

## 12. Registry updates land without a redeploy

```powershell
Invoke-RestMethod https://mikesailab.com/taskhub-registry/index.json |
  Select-Object -ExpandProperty templates | Measure-Object | Select-Object Count
```

**Expect:** the hosted registry lists **all 55** (core + extended) — the gallery always carries
both; only auto-sync is limited to core. This is the decoupling working: content updates
without shipping the app.

## 13. Gallery import journey

From the app, find your way to the [gallery](https://mikesailab.com/taskhub-registry), browse,
and import an **extended** (non-core) template.

**Expect:** the pointer from the app is findable, the gallery's Availability facet works, and
the imported template lands as `managed = false` — so a later sync **won't** prune it. Re-run
step 2 to confirm it survived.

---

## ✅ Pass criteria

- [ ] Fresh install = 5 core; extended is import-only (1)
- [ ] Prune spares `managed = false` rows (2, 13)
- [ ] No `core` column in the DB (3)
- [ ] Facets, badges, favorites work (4)
- [ ] Params guessable without the JSON (5)
- [ ] Preview scores the conversion; a bad cron is **score-0, not a 400** (6)
- [ ] Schedule preview shows local + UTC (7)
- [ ] **Duplicate name → 409, exactly one Windows task** (8)
- [ ] Applied task tracked immediately (9)
- [ ] Lossy conversion warns; very lossy blocks (10)
- [ ] Uncompiled targets offer manual copy (11)
- [ ] Hosted registry serves all 55 (12)
- [ ] Gallery import survives a sync (13)

## 🧹 Cleanup

```powershell
Get-ScheduledTask -TaskPath '\TaskHub\' -ErrorAction SilentlyContinue |
  Where-Object TaskName -like 'manual-test-*' |
  Unregister-ScheduledTask -Confirm:$false

Invoke-RestMethod -Method Post http://localhost:3000/api/tasks/sync -Headers $H
```

---

<p align="center">
  <a href="Windows_Task_Lifecycle.md">← Windows Task Lifecycle</a> ·
  <a href="../README.md">Manual Testing</a> ·
  <a href="Agent_Resilience.md">Agent Resilience →</a>
</p>
