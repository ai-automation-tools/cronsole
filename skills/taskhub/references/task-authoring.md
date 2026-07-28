# Task authoring & management

How to **create** a scheduled task in TaskHub, in every way the system supports, and how to
**manage** it afterwards. Read this before creating a task on a user's real machine —
a scheduled task is durable, runs unattended, and runs **elevated** on Windows.

> **The frame:** creating a task is not "calling an API", it's **registering code to run on
> someone's computer forever, with no one watching**. Every rule below exists because a
> scheduled task fails differently from an interactive one: there's no console to print to, no
> user to answer a prompt, and no one to notice for weeks.

---

## 1. Pick the creation path

| You have… | Use | Why |
|:---|:---|:---|
| **A command you already know** | **`create_task`** (MCP) / `POST /api/tasks` | The direct path. The template is the wrong unit when you already know the command. |
| **A recognizable use case** (DB backup, git fetch, webhook) | **`create_task_from_template`** (MCP) / `POST /api/templates/:id/apply` | Inherits a tested command, sane default schedule, declared params. `list_templates` first for the id + params. |
| **A URL to poll** | `create_task` with `platform: TASKHUB_NATIVE` | Becomes a backend-run HTTP GET job. **No agent, no Windows task.** Command must be a URL — anything else is honestly refused. |
| **A richer native job** (non-GET, headers, body) | **`create_native_task`** (MCP) / `POST /api/tasks/native` | Takes a full `job` spec. Separate from `create_task` because the connector's command-string path only builds HTTP GET. |
| **A task that already exists and is good** | `POST /api/tasks/:id/save-as-template` | Turns a real task into a catalog template. One of two non-reseed ways the catalog grows. |
| **A template JSON from the gallery** | `POST /api/templates/import` | The other one. Same schema + `{{placeholder}}` validation as any catalog content. |

**Default to `create_task`.** Reach for a template when the user names a use case, not a
command. Do **not** bend a request to fit a template — that's what made the catalog a gate on
a capability the app never gated (ROADMAP › MCP surface expansion).

---

## 2. Compose the command (Windows)

A Windows `command` is **tokenized into a structured no-shell action** — `{executable,
args[]}` — before the agent registers it. This is the **P0 injection guarantee**: a shell is
never implied.

```
create_task command: 'powershell.exe -NoProfile -File "C:\jobs\nightly.ps1"'
       ->  Execute:   powershell.exe
           Arguments: -NoProfile -File C:\jobs\nightly.ps1     # one arg, quotes consumed
```

**Consequence: pipes, `>`, `&&`, `%VAR%` do NOT work by default** — there's no shell to
interpret them. You must invoke one *explicitly*:

```powershell
cmd.exe /c "npm outdated > C:\reports\deps.txt"          # redirection needs a shell
powershell.exe -NoProfile -Command "..."                  # PowerShell features need PowerShell
```

That explicitness is the point — a shell you opted into is auditable; an implicit one turns
every parameter into arbitrary code.

### Recipes by kind of work

| Kind | Command | Notes |
|:---|:---|:---|
| **PowerShell script** | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{path}.ps1"` | `-NoProfile` so an unattended run doesn't depend on the user's profile. |
| **Executable, direct** | `"C:\Tools\backup.exe" --full --quiet` | The cleanest case — real no-shell exec. Quote the exe if its path has spaces. |
| **HTTP ping** | `powershell.exe -NoProfile -Command "Invoke-RestMethod -Uri 'https://…'"` | **`Invoke-RestMethod` over `Invoke-WebRequest`.** If you must use the latter, **`-UseBasicParsing` is mandatory** — see the traps below. |
| **npm / node** | `cmd.exe /c "npm run build > C:\logs\build.log 2>&1"` | `npm` is a `.cmd`, and redirection needs a shell — so the shell is opted in explicitly. |
| **Python** | `"C:\Python312\python.exe" "C:\jobs\etl.py"` | Prefer the absolute interpreter path over relying on PATH under Task Scheduler. |
| **Docker** | `docker compose -f "{composeFile}" up -d` | Direct exec; docker is a real exe on PATH. |
| **Claude Code / Codex CLI** | `powershell.exe -NoProfile -Command "claude -p '{prompt}' --permission-mode dontAsk --allowedTools 'Read,Grep' --bare"` | Unattended agent runs **must** be non-interactive or they hang forever on an approval prompt. See `references/templates.md` › AI Pack. |
| **Native HTTP job** | `https://example.com/health` with `platform: TASKHUB_NATIVE` | Backend-executed. No agent required, so it works with the agent offline. |

### Quoting

- Quote any path with spaces: `-File "C:\Program Files\x\job.ps1"`.
- Inside `powershell.exe -Command "…"`, use **single quotes** for inner strings so the whole
  script rides as one double-quoted arg — the nesting the webhook starter uses.
- Keep `.ps1`/`.vbs` files **pure ASCII**. A single em-dash in a BOM-less script makes
  PowerShell 5.1 fail to parse it (troubleshooting #6).

---

## 3. Get the schedule right

**All schedules are 5-field cron in UTC.** Not local time. The UI converts for display; you
must convert on the way in.

**Always `convert_schedule` first — and read the returned `trigger`, not the score.**

```
convert_schedule '0 9 * * 1-5'
  -> score 1, Weekly at 09:00 on Monday, Tuesday, Wednesday, Thursday, Friday   ✅ verify the days
```

| Score | Means | Do |
|:---|:---|:---|
| **1.0** | Native trigger, exact | Still read it. The Monday-only bug scored **1.0 with no warnings** while dropping four days. |
| **0.7** | Lossy **or replaced** — two very different things sharing one score | **Read the trigger, or the `lossy` field.** A `*/7` step really is approximate (the trigger *is* derived from your input and drifts). An unrecognized cron is **discarded** and replaced with a **hard-coded hourly** trigger. The `0.7` score can't tell them apart — but since 2026-07-16 the response carries a machine-readable **`lossy: 'approximated' \| 'replaced'`** (and `convert_schedule` prints a `Lossy:` line, `create_task` leads its warning with the verb). `'replaced'` = delete and re-create; `'approximated'` = honored but drifts. The score stays `0.7` for both by design, so branch on `lossy`, not the number. |
| **0** | Invalid / not convertible | Fix the expression. |

> [!WARNING]
> **A "rare" cron is the dangerous one.** `0 4 1 1 *` (once a year) registers as **daily,
> repeating hourly** — 8,760 runs/year. The fallback only ever runs **more** often than you
> asked. **Never encode "don't run" in the cron** ([#14](../../../docs/troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)).

**To create a task that shouldn't fire yet:** use a schedule the converter recognizes and
**disable** it (§5), or create it and delete it when done. Never reach for an exotic cron to
mean "never".

Recognized shapes: daily (`0 9 * * *`), weekly (`0 9 * * 1-5`), monthly (`0 3 1 * *`), minute
step (`*/15 * * * *`), hour step (`0 */4 * * *`). Everything else hits the fallback.

---

## 4. Placement, naming, and the refusals

| Rule | Behavior |
|:---|:---|
| **Default folder is `\TaskHub`** | The only folder TaskHub creates — and the only one it prunes when the last task leaves. |
| **Any other folder must ALREADY EXIST** | Deleting a folder needs elevation, so TaskHub will not create one it can't remove. *Never create what you cannot remove.* A create into a missing folder is refused honestly. |
| **`\Microsoft\` is refused outright** | `RegisterTaskDefinition` **silently overwrites** a same-named task, and the agent runs **elevated** — writing there could destroy a real Windows task with no error. Refused in the backend **and independently in the agent**. |
| **Name must be unique per folder** | A collision returns **409** rather than letting Windows silently overwrite. `\Work\Backup` and `\TaskHub\Backup` are different tasks. |
| **`folder` is inside the signature** | Every field the agent acts on is signed — an unsigned field would let an on-path attacker redirect the write. |

**Use `list_folders` to find a valid one** (MCP) / `GET /api/tasks/folders` — it returns every
real folder with its task count and whether you can create there. Don't guess a path: the only
folder TaskHub will create is `\TaskHub`, so a guess that doesn't exist is an honest refusal,
not a new folder.

Two things about that listing that will otherwise mislead you:

- **An unwritable folder is still listed** (`writable: false`, e.g. `\Microsoft\…`). That's
  deliberate — *"exists but refused"* is a different fact from *"doesn't exist"*. Don't read
  its presence as permission.
- **The default `\TaskHub` is often absent from the list.** It's created lazily and **pruned
  when its last task is deleted**, so on a clean machine it genuinely doesn't exist yet. That
  is not a problem and not a reason to pick a different folder — omit `folder` and TaskHub
  creates it. `list_folders` reports `defaultFolder` separately for exactly this reason.

---

## 5. Managing a task afterwards

**Task management is fully covered over MCP as of 2026-07-15** — with exactly one verb gated:

| Action | MCP | REST |
|:---|:---|:---|
| List / inspect | ✅ `list_tasks` | `GET /api/tasks` |
| Find a folder | ✅ `list_folders` | `GET /api/tasks/folders` |
| Run now | ✅ `run_task` | `POST /api/tasks/:id/run` |
| Create | ✅ `create_task`, `create_native_task`, `create_task_from_template` | `POST /api/tasks`, `POST /api/tasks/native`, `POST /api/templates/:id/apply` |
| Validate a schedule | ✅ `convert_schedule` | `POST /api/tasks/preview` |
| **Enable / disable** | ✅ `set_task_status` | `PATCH /api/tasks/:id/status` |
| **Re-schedule** | ✅ `update_task_schedule` | `PATCH /api/tasks/:id/schedule` |
| **Edit the command** | ✅ `update_task_action` | `PATCH /api/tasks/:id/actions` |
| Run history | ✅ `get_task_history` | `GET /api/tasks/:id/executions` |
| Export | ✅ `export_task` | `GET /api/tasks/:id/export` (Windows→XML, native→JSON) |
| **Bulk export / backup** | ❌ | `POST /api/tools/export/tasks` — all folders or one, as native XML. Exports what is **on the machine**, not just tracked tasks; `\Microsoft\` excluded unless `includeSystem: true`. Dashboard: **Tools** tab |
| **Untrack** (remove from TaskHub, keep it running) | ✅ `untrack_task` — ungated | `POST /api/tasks/:id/untrack` |
| **Delete** | ⚠️ `delete_task` — **only** with `TASKHUB_MCP_ALLOW_DESTRUCTIVE=true`, else absent | `DELETE /api/tasks/:id` |
| Template import/export, save-as-template, sync, pairing | ❌ | REST / UI only |

**Disable is how you park a task** — not a weird cron (§3 explains why that backfires). It is
reversible and ungated precisely so the safe move is the easy one.

**Untrack is how you tidy the dashboard** — not delete. `untrack_task` drops TaskHub's row (and
its TaskHub run history) while leaving the real scheduled task exactly where it is, still running
on its own schedule, and records an exclusion so the next sync doesn't quietly re-import it. Use
it for an over-broad import, a folder full of OS tasks, or anything the user just doesn't want to
see. It refuses `TASKHUB_NATIVE` tasks, which exist **only** inside TaskHub and therefore have
nothing to keep — that 400 is correct, not a bug to route around. The way back is re-importing
the category in the UI.

**Three verbs, three blast radii — do not substitute one for another:**

| Goal | Verb | What survives |
|:---|:---|:---|
| Stop it running, keep everything | `set_task_status: DISABLED` | the task, its schedule, its history |
| Stop *seeing* it, keep it running | `untrack_task` | the real scheduled task (TaskHub's history goes) |
| Make it stop existing | `delete_task` (gated) | nothing |

**`delete_task` is absent unless the human opted in.** If it isn't in your tool list, that is the
answer, not an obstacle: say so and offer `set_task_status: DISABLED`, the UI, or the REST call.
Don't route around it. Delete removes the real Task Scheduler entry via a signed agent command,
and the DB row goes **only after the platform confirms**; an admin-ACL'd task gets an honest
"needs elevation" refusal rather than a fake success.

**Two behaviors worth knowing before you use these:**

- **`update_task_action` REPLACES the action, it does not patch it.** `command` and `runLevel` are
  both required. Read the task's current values (`list_tasks` / `export_task`) before changing
  one field, or you will silently reset the other.
- **`get_task_history` is not a complete record.** TaskHub logs manual runs it triggered and
  native scheduler fires; a Windows task firing on its **own** trigger is recorded by Windows.
  So an empty history means "TaskHub has nothing", never "it never ran". And a `SUCCESS` means
  *dispatched and reported success* — a hung task reports exactly that (§6, and trap #12).

---

## 6. Verify it — the part everyone skips

**A green suite is not evidence a task works.** Resolvability proves a command *tokenizes*,
not that it *runs*. Neither is TaskHub's own `lastRunStatus: SUCCESS` — the agent observes
that the task **started**, never that the command worked, so a command that hangs forever
reports `SUCCESS` ([#12](../../../docs/troubleshooting/README.md#12-a-template-passes-every-test-and-still-hangs-on-the-target)).

> **When you're testing the reporting layer's honesty, the reporting layer cannot be your
> witness.** Get evidence from outside TaskHub.

```powershell
$t = Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName '<name>'
$t.Actions | Select-Object Execute, Arguments     # direct exec? no stray cmd.exe /c?
$t.Triggers | Select-Object StartBoundary, DaysInterval, Repetition   # UTC->local correct?
Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly            <- Windows' own record, independent of TaskHub
#   267009 = STILL RUNNING (hung)      <- flat CPU = blocked, not working
```

Best evidence is a **real side effect** — a log line, a file, an HTTP hit. If the command
can't prove it ran, you haven't verified it.

**Clean up after a test.** A test task is a real scheduled task: it will keep firing forever
if you leave it. Delete it, and don't leave one running on a schedule you picked for
convenience.

---

## 7. Checklist

Before you call `create_task` on a real machine:

1. **`convert_schedule`** the cron — and **read the trigger**, not the score.
2. Cron is **UTC**, 5 fields.
3. Command **tokenizes** the way you intend; a shell is **explicit** if you need one.
4. `-NoProfile` on PowerShell; `-UseBasicParsing`/`Invoke-RestMethod` for HTTP.
5. Folder **exists and is writable** — check with **`list_folders`**, don't guess. Or omit it
   and take the default `\TaskHub` (absent from the listing is fine — it's created on demand).
6. Name won't collide in that folder.
7. The command **terminates**. An unattended run has no console — a prompt or an unprinted
   error hangs forever.
8. After creating: **run it and verify from outside TaskHub** (`LastTaskResult` + a side effect).
9. If it was a test: **delete it**.

## Canonical sources

| Topic | Doc |
|:---|:---|
| MCP tools, wiring, tokens | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../../docs/user-guides/guides/MCP_Server_Guide.md) |
| Routes, data model, agent protocol | [architecture.md](architecture.md) |
| The catalog / registry | [templates.md](templates.md) |
| Traps in full | [`docs/troubleshooting/README.md`](../../../docs/troubleshooting/README.md) |
| What's shipped / next | [`docs/ROADMAP.md`](../../../docs/ROADMAP.md) |
