# Task authoring & management

> Cronsole Connect Pack **v1.17** · canonical copy: <https://cronsole.ai-automation-tools.dev>

Every way to **create** a scheduled task through Cronsole, and how to **manage** it afterwards.
Read this before creating a task on a user's real machine — a scheduled task is durable, runs
unattended, and a Windows task can run **elevated**.

**Which source for which rights.** A Cronsole-native job runs inside Cronsole's backend and
**never has administrator rights**. Anything that needs them (services, protected folders,
`Dism`, `cleanmgr`, firewall rules) must be a **Windows Task Scheduler task** with
`runLevel: highest` - or, on macOS and Linux, a job in that system's own scheduler, which
Cronsole cannot create yet. Choosing native for such a job produces a task that fails every
run with *Access is denied*.

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
| **An exported *task* file** (`cronsoleTaskVersion`) | `import_task` / `POST /api/tasks/import` | Not a template — one concrete task, exported from a Cronsole install. Send the file **whole**. **Cronsole-native only**: a Windows task's definition is Task Scheduler XML and goes through restore instead. |
| **A task the user deleted** | `restore_task_archive` / `POST /api/tools/task-archives/:id/restore` | Rebuilds it from the definition Cronsole archived before the delete. Find the id with `list_task_archives`. |

**Three kinds of JSON, three destinations.** A *template* is a parameterized recipe with
`{{placeholders}}`; importing one fills the catalog, and Apply is what makes a task. A *task
bundle* is one concrete task, and importing it **creates that task immediately**. Task Scheduler
*XML* is a Windows task's real definition and only the restore route reads it. Each route refuses
the other two **by name** — read the refusal, it points at the right one.

**Both import paths make a NEW task**, `ACTIVE`, on the file's **UTC** schedule — report the
returned `nextRunTime`. Nothing is overwritten and no archived run history is reattached, so
importing the same file twice leaves two tasks.

**A credential never goes in a native job spec.** Write `${secret.NAME}` instead — legal in a
url, a header value, a body, an arg and an env value; refused by name in an executable, an
interpreter and a check assertion. `${secret.NAME?}` (trailing `?`) is **optional**: unset, it
becomes an empty string and never blocks a run — for a key that only *enables* something. The
value is stored encrypted on the task and redacted out of the run log. `POST /api/tasks/native`
takes an optional `secrets` map so a create is one gesture; after that it is one secret at a time
(`PUT` / `DELETE /api/tasks/:id/secrets/:name`). **No MCP tool writes a value** —
`list_task_secrets` reports names only, and the person enters the value in the dashboard. A
reference with nothing behind it fails at **run** time, never at create time, so every create,
import and restore reports `missingSecrets` — tell the person which ones to set.

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

## 2a. Compose the prompt (hosted agents — Gemini, Claude scheduled tasks)

On a hosted source the unit of work is **a sentence for an agent**, not a command line, and
nothing in §2 applies: there is no executable, no tokenizer, no quoting problem. There is a
different problem, and it is worse, because **it fails silently**.

> Each rule below was paid for by a real failed run, and all of them were catchable before the
> task existed — which is why Cronsole preflights the prompt and returns `promptWarnings` on the
> create (shown live in the dashboard's form; `create_gemini_trigger` forwards them). They are
> **notes, never refusals**: not one is certainly wrong, so read them rather than expecting a
> create to fail.

### Never let the prompt offer a choice

Nobody answers a question at 03:00. A prompt that asks *"which repositories should I include?"*
or says *"let me know if you'd prefer the short form"* does not fail — it **stalls**, and the
run is over before anything happened.

**Give the parameter, or tell the agent to pick and say which it picked.** The second is often
better: it is honest about the ambiguity, and the report says what was chosen.

```
BAD   Summarize the news. Which topics should I cover?
GOOD  Summarize the news about Postgres releases and CVEs. If a story is ambiguous,
      include it and say why you were unsure.
```

### Always instruct it to report failure explicitly

An agent that cannot finish a step **narrates success instead**. It will describe the digest it
would have sent. The run's status is `completed`, because `completed` means *the agent finished
its turn* — it is not a claim that the job was done.

End every prompt with a sentence like: *"If any step fails, say so explicitly in your final
message and name the step that failed, rather than summarizing what you would have produced."*

### Read the step list, not the status

This one is for **you**, checking afterwards. Use `list_platform_runs` → `get_run_output` and
read `steps`. An agent asked to research and email a report can finish `completed` having called
only `write_file`; no status anywhere shows that, and the step list is the only place it is
visible.

### The two invisible ones

- **Pasted gutter characters.** `▎`, `│`, box-drawing rules, zero-width spaces — they arrive by
  copying a prompt out of a terminal, a diff, or a chat bubble. The agent reads them as part of
  the instruction and chops it into fragments it ignores, and **you cannot see them in a
  textarea**. Retype rather than paste, or read the preflight warnings.
- **Mail with no recipient.** *"Email the digest"* with no address: the agent writes a file
  instead and reports success. Name the address — and remember that **reach is a separate
  grant**: a trigger with no `mcp_server` cannot send mail however clearly the prompt says to,
  and one with no network allowlist reaches nothing outside its own sandbox.

### Reach is half the task

On Gemini the prompt and the **tool grant** are one decision, not two. State what you are
granting before you create it — the agent keeps that reach for as long as the trigger exists —
and grant only what the task needs. `create_gemini_trigger` takes built-in tools by name and MCP
servers **by saved preset name**, so no bearer token ever enters a tool call.

---

## 3. Get the schedule right

**All schedules are 5-field cron in UTC.** Not local time.

**The API is UTC; the person talking to you is not, and neither is their dashboard.** Cronsole's UI
reads and writes schedules in the user's own timezone (the browser's by default) and converts before it
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

Recognized shapes: daily (`0 9 * * *`), weekly (`0 9 * * 1-5`), monthly (`0 3 1 * *`, or a
list or range of days — `0 3 1,15 * *`), minute step (`*/15 * * * *`), hour step
(`0 */4 * * *`). Everything else hits the fallback — including a **specific month**
(`0 4 1 1 *`). Monthly has one refusal the others don't: a time whose UTC form lands on a
**different local calendar date** on the user's machine is refused by name at create time,
because a fixed day of the month cannot be rolled across that boundary the way a weekday can.

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
| Create | `create_task`, `create_native_task` (and `create_native_program_task` / `_script_task` / `_check_task`), `create_task_from_template`, `create_gemini_trigger`, `create_claude_routine` | `POST /api/tasks`, `/native`, `/api/templates/:id/apply` |
| Validate a schedule | `convert_schedule` | `POST /api/tasks/preview` |
| **Enable / disable** | `set_task_status` | `PATCH /api/tasks/:id/status` |
| **Re-schedule** | `update_task_schedule` | `PATCH /api/tasks/:id/schedule` |
| **Edit the command** | `update_task_action` | `PATCH /api/tasks/:id/actions` |
| **Edit a native job** (URL, method, headers, body, script command) | `update_native_job` | `PATCH /api/tasks/:id/job` |
| **Rename** (Cronsole's label only) | `rename_task` | `PATCH /api/tasks/:id` — refused where the platform owns the name (GitHub Actions, Vercel, n8n, Gemini, a session-read Claude scheduled task) |
| Run history | `get_task_history` | `GET /api/tasks/:id/executions` |
| Export one task | `export_task` | `GET /api/tasks/:id/export` — the platform's own definition: Task Scheduler **XML** for Windows (UTF-16 LE + BOM; write it as raw bytes), Cronsole **JSON** for a native task. Restores that exact task onto that platform |
| Export a task so it can be recreated **elsewhere** | `export_task` with `format: 'template'` | `GET /api/tasks/:id/export?format=template` — a portable Registry v1 template, importable with `POST /api/templates/import` and then applied to any compatible target. **Not a backup**: it drops platform-specific settings (the account the task runs as, run level, extra actions), so say so if you offer it as one. It is the only export that works with the **agent offline**, or for a **Claude routine**, whose definition lives at claude.ai. Writes nothing — unlike save-as-template |
| Bulk export / backup | — | `POST /api/tools/export/tasks` |
| Restore from a backup | — | `POST /api/tools/restore/tasks` |
| Run history, all tasks | `list_run_history` | `GET /api/tools/history` (`?format=csv`) |
| What needs attention | `get_task_health` | `GET /api/tools/task-health` |
| What Cronsole can do with each platform | `list_platforms` | `GET /api/tools/platforms` — per verb `verified` / `declared` / `unsupported`; `declared` is not `yes` |
| Refresh from a platform | `sync_tasks` | `POST /api/tasks/sync` |
| **Is Cronsole itself working?** | `get_diagnostics` | `GET /api/tools/diagnostics` — read-only, with the evidence behind each verdict. Ask before `task-health`: a wedged agent makes every Windows task look unhealthy. `unknown` ≠ `pass` |
| **Star / un-star** | — | `POST` / `DELETE /api/tasks/:id/favorite` |
| **Untrack** (remove from Cronsole, keep it running) | `untrack_task` | `POST /api/tasks/:id/untrack` |
| **Delete** (Cronsole-native only) | `delete_task` — **only** when the human set `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`, else absent | `DELETE /api/tasks/:id/native` (archives first; refuses non-native) |
| **Delete a template** the user imported or saved | `delete_template` — gated the same way as `delete_task` | `DELETE /api/templates/:id` — a catalog-synced template is refused (`409`) |
| **Delete a Windows task** | — *(deliberately not available to an assistant)* | `DELETE /api/tasks/:id`, or the Cronsole dashboard |
| List / read deleted-task backups | `list_task_archives` | `GET /api/tools/task-archives[/:id]` — each row's `restorable` carries **its reason** |
| **Rebuild a deleted task** | `restore_task_archive` | `POST /api/tools/task-archives/:id/restore` — a **new** task; the archived runs are not reattached and the archive is kept |
| **Import an exported task file** | `import_task` | `POST /api/tasks/import` — the body **is** the file. Cronsole-native only |
| **Claude scheduled tasks** (formerly routines): which door, connect, fix, forget | `list_claude_routines`, `connect_claude_routine`, `edit_claude_routine`, `disconnect_claude_routine` | `/api/tools/platforms/claude/routines[/:id]`. Disconnect forgets a Claude scheduled task; it keeps running at claude.ai |

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

**`delete_task` reaches Cronsole-native tasks only.** It calls
`DELETE /api/tasks/:id/native`, which refuses every other platform with a **400** — Windows
included. So **no MCP verb can destroy a scheduled task on the user's machine**: for a Windows
task the removal you have is `untrack_task` (which leaves it running), and genuinely deleting one
needs the person to do it in the Cronsole dashboard. That 400 is a boundary, not a missing
feature — no retry or different argument gets past it, so report it rather than working around it.

**What it can delete, Cronsole backs up first.** The task definition and its last 20 run records
are archived *before* the delete, and the delete is **refused outright if that backup fails**,
leaving the task untouched. Archives are readable at `GET /api/tools/task-archives` (and
`/:id` for the full definition) and **rebuilt with `restore_task_archive`**, which gives back a
**new** task on the same schedule — not the old one revived, so its id changes and the archived
run history stays in the archive. The live task is still gone in the meantime — its schedule stops.

**If `delete_task` isn't in your tool list, that is the answer.** Say so and offer
`set_task_status: DISABLED`, the dashboard, or the REST call. Don't route around it.

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

On a **hosted agent** (Gemini, a Claude scheduled task) items 3–6 do not apply and three others take
their place (§2a): the prompt **offers no choice**, it **demands explicit failure reporting**,
and the **grant** covers what it is told to do. Then verify by reading the run's **step list**,
never its status.
