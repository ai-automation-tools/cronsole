# Task authoring & management

> Cronsole Connect Pack **v1.6** · canonical copy: <https://cronsole.mikesailab.com>

Every way to **create** a scheduled task through Cronsole, and how to **manage** it afterwards.
Read this before creating a task on a user's real machine — a scheduled task is durable, runs
unattended, and on Windows runs **elevated**.

---

## 1. Pick the creation path

| You have… | Use | Why |
|:---|:---|:---|
| **A command you already know** | `create_task` / `POST /api/tasks` | The direct path. A template is the wrong unit when you already know the command. |
| **A recognizable use case** (DB backup, git fetch, webhook) | `create_task_from_template` / `POST /api/templates/:id/apply` | Inherits a tested command, a sane default schedule, declared parameters. Call `list_templates` first for the id and its params. |
| **A URL to poll** | `create_task` with `platform: TASKHUB_NATIVE` | Becomes a backend-run HTTP GET job. **No agent, no Windows task** — so it works with the agent offline. The command must be a URL; anything else is refused. |
| **A richer HTTP job** (non-GET, headers, body) | `create_native_task` / `POST /api/tasks/native` | Takes a full job spec. Separate from `create_task` because the command-string path only builds a GET. |
| **A task that already exists and is good** | `POST /api/tasks/:id/save-as-template` | Turns a real task into a reusable template. |
| **A template JSON from the gallery** | `POST /api/templates/import` | Same schema and placeholder validation as any catalog content. |

---

## 2. Compose the command (Windows)

A Windows `command` is **tokenized into a structured no-shell action** — `{executable,
args[]}` — before the agent registers it:

```
create_task command: 'powershell.exe -NoProfile -File "C:\jobs\nightly.ps1"'
       ->  Execute:   powershell.exe
           Arguments: -NoProfile -File C:\jobs\nightly.ps1     # one arg, quotes consumed
```

**Consequence: pipes, `>`, `&&`, and `%VAR%` do NOT work by default** — there is no shell to
interpret them. Invoke one explicitly when you need it:

```powershell
cmd.exe /c "npm outdated > C:\reports\deps.txt"       # redirection needs a shell
powershell.exe -NoProfile -Command "..."               # PowerShell features need PowerShell
```

That explicitness is the point: a shell you opted into is auditable; an implicit one turns
every parameter into arbitrary code.

### Recipes by kind of work

| Kind | Command | Notes |
|:---|:---|:---|
| **PowerShell script** | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{path}.ps1"` | `-NoProfile` so an unattended run doesn't depend on the user's profile. |
| **Executable, direct** | `"C:\Tools\backup.exe" --full --quiet` | The cleanest case. Quote the exe if its path has spaces. |
| **HTTP ping** | `powershell.exe -NoProfile -Command "Invoke-RestMethod -Uri 'https://…'"` | Prefer `Invoke-RestMethod`. If you must use `Invoke-WebRequest`, **`-UseBasicParsing` is mandatory** — without it, it can block waiting on Internet Explorer engine initialization in a session that has no user. |
| **npm / node** | `cmd.exe /c "npm run build > C:\logs\build.log 2>&1"` | `npm` is a `.cmd`, and redirection needs a shell — so the shell is explicit. |
| **Python** | `"C:\Python312\python.exe" "C:\jobs\etl.py"` | Prefer the absolute interpreter path over relying on PATH under Task Scheduler. |
| **Docker** | `docker compose -f "{composeFile}" up -d` | Direct exec; docker is a real exe on PATH. |
| **Unattended AI CLI** | `powershell.exe -NoProfile -Command "claude -p '{prompt}' --permission-mode dontAsk --allowedTools 'Read,Grep' --bare"` | Agent runs **must** be non-interactive or they hang forever on an approval prompt. |
| **Native HTTP job** | `https://example.com/health` with `platform: TASKHUB_NATIVE` | Backend-executed, no agent required. |

### Quoting

- Quote any path with spaces: `-File "C:\Program Files\x\job.ps1"`.
- Inside `powershell.exe -Command "…"`, use **single quotes** for inner strings so the whole
  script rides as one double-quoted argument.
- Keep `.ps1` / `.vbs` files **pure ASCII**. A single em-dash in a BOM-less script makes
  PowerShell 5.1 fail to parse it.

---

## 3. Get the schedule right

**All schedules are 5-field cron in UTC.** Not local time.

**The API is UTC; the person talking to you is not, and neither is their dashboard.** Cronsole's UI
reads and writes schedules in the user's own timezone (Pacific by default) and converts before it
calls the API — you have no access to that setting, so **you must convert yourself**. When someone
says "run it at 9am", ask which zone if you don't know it, convert to UTC, and **state both** in your
confirmation ("`0 16 * * *` — 9:00 AM Pacific"). Sending `0 9 * * *` for a 9am request is the single
easiest way to create a task that runs in the middle of the night and looks correct in every log.
Watch the day-of-week too: converting an evening or early-morning time crosses midnight, so
`0 22 * * 1-5` local becomes `0 6 * * 2,3,4,5,6` in UTC — the days move with the hour.

**Always `convert_schedule` first — and read the returned `trigger`, not the score.**

```
convert_schedule '0 9 * * 1-5'
  -> score 1, Weekly at 09:00 on Monday, Tuesday, Wednesday, Thursday, Friday  <- verify the days
```

| Score | Means | Do |
|:---|:---|:---|
| **1.0** | Native trigger, exact | Still read it. A multi-day cron once scored 1.0 with no warnings while dropping four of five days. |
| **0.7** | Lossy **or replaced** — two very different things sharing one score | Branch on the machine-readable `lossy` field, not the number. `'approximated'` = the trigger *is* derived from your input and merely drifts. `'replaced'` = your input was **discarded** for a hard-coded hourly trigger; delete and re-create with a recognized shape. |
| **0** | Invalid / not convertible | Fix the expression. |

> **A "rare" cron is the dangerous one.** `0 4 1 1 *` (once a year) registers as **daily,
> repeating hourly** — 8,760 runs a year. The fallback only ever runs **more** often than you
> asked, never less. **Never encode "don't run" in the cron.**

**To create a task that shouldn't fire yet:** use a recognized schedule and **disable** it, or
create it and delete it when done.

Recognized shapes: daily (`0 9 * * *`), weekly (`0 9 * * 1-5`), monthly (`0 3 1 * *`),
minute step (`*/15 * * * *`), hour step (`0 */4 * * *`). Everything else hits the fallback.

---

## 4. Placement, naming, and the refusals

| Rule | Behavior |
|:---|:---|
| **Default folder is `\Cronsole`** | The only folder Cronsole creates *unasked* — and the only one it prunes when the last task leaves. |
| **Any other folder must ALREADY EXIST — or be asked for explicitly** | A create into a missing folder is refused honestly. `create_task` takes **`createFolder: true`** (default false) to build the missing chain instead, and the response **names every folder it made**. Treat it as a decision, not an error-handler: deleting a Task Scheduler folder needs elevation and the agent *is* elevated, so a folder it creates is a door only an **administrator** can close — the user cannot tidy it up themselves. Prefer a folder `list_folders` already reports; when you do use the flag, say which folder you are creating before you create it. |
| **`\Microsoft\` is refused outright** | Registering a task **silently overwrites** a same-named one, and the agent runs **elevated** — writing there could destroy a real Windows task with no error. Refused in the backend **and** independently in the agent. |
| **Name must be unique per folder** | A collision returns **409** rather than letting Windows silently overwrite. `\Work\Backup` and `\Cronsole\Backup` are different tasks. |

**Use `list_folders` to find a valid one.** It returns every real folder with its task count
and whether you can create there. Two things about that listing that will otherwise mislead
you:

- **An unwritable folder is still listed** (`writable: false`, e.g. `\Microsoft\…`). That is
  deliberate — *"exists but refused"* is a different fact from *"doesn't exist"*. Do not read
  its presence as permission.
- **The default `\Cronsole` is often absent.** It is created lazily and **pruned when its last
  task is deleted**, so on a clean machine it genuinely does not exist yet. That is not a
  problem and not a reason to pick another folder — omit `folder` and Cronsole creates it.
  `list_folders` reports `defaultFolder` separately for exactly this reason.

---

## 5. Managing a task afterwards

| Action | MCP | REST |
|:---|:---|:---|
| List / inspect | `list_tasks` | `GET /api/tasks` |
| Find a folder | `list_folders` | `GET /api/tasks/folders` |
| Run now | `run_task` | `POST /api/tasks/:id/run` |
| Create | `create_task`, `create_native_task`, `create_task_from_template` | `POST /api/tasks`, `/native`, `/api/templates/:id/apply` |
| Validate a schedule | `convert_schedule` | `POST /api/tasks/preview` |
| **Enable / disable** | `set_task_status` | `PATCH /api/tasks/:id/status` |
| **Re-schedule** | `update_task_schedule` | `PATCH /api/tasks/:id/schedule` |
| **Edit the command** | `update_task_action` | `PATCH /api/tasks/:id/actions` |
| Run history | `get_task_history` | `GET /api/tasks/:id/executions` |
| Export one task | `export_task` | `GET /api/tasks/:id/export` |
| Bulk export / backup | — | `POST /api/tools/export/tasks` |
| Restore from a backup | — | `POST /api/tools/restore/tasks` |
| Run history, all tasks | — | `GET /api/tools/history` (`?format=csv`) |
| What needs attention | — | `GET /api/tools/task-health` |
| **Star / un-star** | — | `POST` / `DELETE /api/tasks/:id/favorite` |
| **Untrack** (remove from Cronsole, keep it running) | `untrack_task` | `POST /api/tasks/:id/untrack` |
| **Delete** | `delete_task` — **only** when the human set `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`, else absent | `DELETE /api/tasks/:id` |

**Disable is how you park a task** — not a weird cron (§3 explains why that backfires). It is
reversible and ungated precisely so the safe move is the easy one.

**Untrack is how you tidy the dashboard** — not delete. `untrack_task` removes Cronsole's record of
a task (and its Cronsole run history) while leaving the real scheduled task exactly where it is,
still running on its own schedule; future syncs won't pull it back. Reach for it when someone
imported a folder by mistake, or wants OS-owned tasks out of their view. It refuses Cronsole-native
tasks, which exist only inside Cronsole and so have nothing to keep.

**Three verbs, three blast radii — never substitute one for another:**

| Goal | Verb | What survives |
|:---|:---|:---|
| Stop it running, keep everything | `set_task_status: DISABLED` | the task, its schedule, its history |
| Stop *seeing* it, keep it running | `untrack_task` | the real scheduled task |
| Make it stop existing | `delete_task` (gated) | nothing |

**If `delete_task` isn't in your tool list, that is the answer.** Say so and offer
`set_task_status: DISABLED`, the dashboard, or the REST call. Don't route around it. Delete
removes the real Task Scheduler entry, and Cronsole's own record goes **only after the platform
confirms**; a task with an admin ACL gets an honest "needs elevation" refusal rather than a
fake success.

Two behaviors worth knowing before you use these:

- **`update_task_action` REPLACES the action, it does not patch it.** `command` and `runLevel`
  are both required. Read the task's current values first, or you will silently reset the one
  you didn't mean to change.
- **`get_task_history` is not a complete record.** Cronsole logs manual runs it triggered and
  its own native jobs; a Windows task firing on its **own** trigger is recorded by Windows. An
  empty history means "Cronsole has nothing", never "it never ran".

---

## 6. Verify it — the part everyone skips

**A command that tokenizes is not a command that runs.** Neither is Cronsole's own
`lastRunStatus: SUCCESS` — the agent observes that the task **started**, never that the
command worked, so a command that hangs forever reports `SUCCESS`.

> **When you're testing whether the reporting is honest, the reporting cannot be your
> witness.** Get evidence from outside Cronsole.

```powershell
$t = Get-ScheduledTask -TaskPath '\Cronsole\' -TaskName '<name>'
$t.Actions  | Select-Object Execute, Arguments
$t.Triggers | Select-Object StartBoundary, DaysInterval, Repetition
Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly
#   267009 = STILL RUNNING (hung)
```

Best evidence is a **real side effect** — a log line, a file, an HTTP hit. If the command
can't prove it ran, you haven't verified it.

**Clean up after a test.** A test task is a real scheduled task: it will keep firing forever
if you leave it.

---

## 7. Backing tasks up

Before a risky change — and on a schedule, ideally — export the machine's tasks:

```
POST /api/tools/export/tasks
  { "scope": "all",    "format": "zip" }
  { "scope": "folder", "folder": "\\Work", "format": "zip" }
```

This exports what is **on the machine**, not only what Cronsole imported, as native Task
Scheduler XML. The XML is UTF-16 LE with a BOM — the only encoding Windows re-imports — so if
you write it anywhere, write it as **raw bytes**, never re-encoded as UTF-8. Tasks under
`\Microsoft\` are excluded unless you pass `includeSystem: true`.

Re-import on Windows with `Register-ScheduledTask -Xml (Get-Content -Raw file.xml)`.

### Restoring one back

Cronsole can put them back itself:

```
POST /api/tools/restore/tasks
  { "files": [{ "relativePath": "Work/Nightly.xml", "contentBase64": "..." }],
    "dryRun": true }
```

**Always run `dryRun: true` first and read what comes back.** It returns a *plan* — one of
`create` / `overwrite` / `skip` / `refuse` for every file, worked out against what is really on
the machine — and writes nothing. That is the only honest way to find out what an archive
contains before it lands, because Windows replaces a same-named task without asking.

Two flags, both `false` by default, both deliberate:

- `overwrite` — off means a task that already exists is **left exactly as it is** and reported
  as skipped. Turn it on only when replacing the live task is the actual intent.
- `createFolders` — off means a task whose Task Scheduler folder is missing is refused by name.
  Turn it on when restoring a folder tree onto a machine that no longer has it.

Send the file's **raw bytes** base64-encoded (or the whole `.zip` as `archiveBase64`) — never
the XML as a JSON string, or the UTF-16 encoding is lost. Restoring a task puts it on the
machine; it does **not** make Cronsole track it. Import it from the dashboard for that.

---

## 8. Checklist

Before you call `create_task` on a real machine:

1. **`convert_schedule`** the cron — and **read the trigger**, not the score.
2. Cron is **UTC**, 5 fields.
3. The command **tokenizes** the way you intend; a shell is **explicit** if you need one.
4. `-NoProfile` on PowerShell; `Invoke-RestMethod` (or `-UseBasicParsing`) for HTTP.
5. Folder **exists and is writable** — check with `list_folders`, don't guess. Or omit it and
   take the default `\Cronsole`.
6. The name won't collide in that folder.
7. The command **terminates**. An unattended run has no console.
8. After creating: **run it and verify from outside Cronsole**.
9. If it was a test: **delete it**.
