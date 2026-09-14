# Task authoring & management

How to **create** a scheduled task in Cronsole, in every way the system supports, and how to
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
| **An exported *task* file** (`cronsoleTaskVersion`) | **`import_task`** (MCP) / `POST /api/tasks/import` | Not a template — a specific task, exported from a Cronsole install. Pass the file **whole**. **Cronsole-native only**; a Windows bundle is refused and points at Tools → Restore. |
| **A task the user deleted** | **`restore_task_archive`** (MCP) / `POST /api/tools/task-archives/:id/restore` | Rebuilds it from the definition Cronsole archived before deleting. Find the id with `list_task_archives`. |

**A credential never goes in the job spec** (ADR 0003). Any free-text field of a native job may
carry `${secret.NAME}` — legal in a url, a header value, a body, an arg and an env value; refused
by name in an `executable`, an `interpreter` and a check assertion. The value lives encrypted on
the task, is substituted only inside `executeJob`, and is redacted back out of the run log.
`POST /api/tasks/native` takes an optional `secrets` map so a create is one gesture; everything
after that is per secret (`PUT` / `DELETE /api/tasks/:id/secrets/:name`), because a whole-set write
destroys what the client forgot to resend and there is no read path to notice with. **No MCP tool
writes a value** — `list_task_secrets` reports names, and the user enters the value in the app. A
reference with nothing behind it is a **run-time** refusal (`ran: false`, so a 502), never a
create-time one; every create, import and restore reports `missingSecrets`.

**Exporting has two formats, and the same distinction runs the other way.**
`GET /api/tasks/:id/export` defaults to `native` — the platform's own definition, which restores
*this* task onto *this* platform — and takes **`?format=template`** for a portable Registry v1
template that recreates it anywhere. Over MCP that is `export_task`'s `format` param. The template
**drops platform-specific settings** (run-as account, run level, extra actions), so never offer it
as a faithful backup; it is the right answer to *"set this task up on my other machine"* and the
wrong one to *"back this up before I change it"*. It reaches no platform, so it is also the only
export that works with the agent offline or on a Claude routine — and it writes nothing, unlike
`save-as-template`, which leaves a catalog row behind.

**Three JSON files, three destinations — do not confuse them.** A *template* is a parameterized
recipe with `{{placeholders}}`, and importing one puts it in the catalog (Apply is what then makes
a task). A *task bundle* (`cronsoleTaskVersion`) is one concrete task and importing it **creates
that task immediately**. Task Scheduler *XML* is a Windows task's real definition and only
`POST /api/tools/restore/tasks` reads it. Each route refuses the other two by name — read the
refusal, it names the right one.

**What `import_task` and `restore_task_archive` give you is a NEW task.** New id, `ACTIVE`, running
on the schedule in the file — which is **UTC**, so say when it will actually first fire (the
response carries `nextRunTime`). Nothing is overwritten and no archived run history comes back:
importing the same file twice leaves two tasks, and restoring twice leaves two.

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

## 2a. Compose the prompt (hosted agents — Gemini, Claude routines)

On a hosted source the unit of work is **a sentence for an agent**, not a command line, and
nothing in §2 applies: there is no executable, no tokenizer, no quoting problem. There is a
different problem, and it is worse, because **it fails silently**.

> **The three rules below were each paid for by a real failed run on 2026-08-25.** None of them
> was a Cronsole defect. All three were catchable before the trigger existed, which is why
> Cronsole now preflights the prompt server-side (`services/promptPreflight.ts`) and returns
> `promptWarnings` on the create — shown live in the form, forwarded by
> `create_gemini_trigger`. They are **notes, never refusals**: not one is certainly wrong, and a
> task manager that refuses a prompt it merely dislikes is worse than one that mentions it.

### 1. Never let the prompt offer a choice

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

### 2. Always instruct it to report failure explicitly

An agent that cannot finish a step **narrates success instead**. It will describe the digest it
would have sent. The run's status is `completed`, because `completed` means *the agent finished
its turn* — it is not a claim that the job was done.

Every prompt ends with a sentence like: *"If any step fails, say so explicitly in your final
message and name the step that failed, rather than summarizing what you would have produced."*

### 3. Read the step list, not the status

This is a rule for **you**, checking afterwards, and it is the reason the run panel shows steps
at all. Use `list_platform_runs` → `get_run_output` and read `steps`. An agent asked to research
and email a report finishes `completed` having called only `write_file`; no status anywhere can
show that, and the step list is the only place it is visible.

### The two invisible ones

- **Pasted gutter characters.** `▎`, `│`, box-drawing rules, zero-width spaces — they arrive by
  copying a prompt out of a terminal, a diff, or a chat bubble. The agent reads them as part of
  the instruction and chops it into fragments it ignores. **You cannot see them in the
  textarea.** Retype rather than paste, and if you must paste, read the preflight panel.
- **Mail with no recipient.** *"Email the digest"* with no address: the agent writes a file
  instead and reports success. Name the address — and remember that **reach is a separate
  grant**: a trigger with no `mcp_server` cannot send mail however clearly the prompt says to,
  and one with no network allowlist reaches nothing outside its own sandbox.

### Reach is half the task

On Gemini the prompt and the **tool grant** are one decision, not two. State what you are
granting before you create it — the agent keeps that reach for as long as the trigger exists —
and grant only what the task needs. `create_gemini_trigger` takes built-ins by name and MCP
servers **by preset name**, so no bearer token ever enters a tool call.

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

Recognized shapes: daily (`0 9 * * *`), weekly (`0 9 * * 1-5`), monthly (`0 3 1 * *`, and a list
or range of days — `0 3 1,15 * *`), minute step (`*/15 * * * *`), hour step (`0 */4 * * *`).
Everything else hits the fallback — including a **specific month** (`0 4 1 1 *`), which is why that
stays the canonical once-a-year example even though monthly itself became exact on 2026-09-08.
Monthly has one refusal the others do not: a time whose UTC form lands on a **different local
calendar date** on the agent's machine is rejected by name at create time, because a fixed
day-of-month cannot be rolled across the boundary the way a weekday can — a week is always seven
days, a month is not.

---

## 4. Placement, naming, and the refusals

| Rule | Behavior |
|:---|:---|
| **Default folder is `\Cronsole`** | The only folder Cronsole creates — and the only one it prunes when the last task leaves. |
| **Any other folder must ALREADY EXIST — unless you opt in** | Deleting a folder needs elevation, so by default Cronsole will not create one it can't remove; a create into a missing folder is refused honestly. Since **2026-08-04** `POST /api/tasks` (and MCP `create_task`) takes **`createFolder: true`** to create the missing chain instead, and names every folder it created in the response — since **2026-09-14** so do `POST /api/templates/:id/apply` / `create_task_from_template`, and the dashboard exposes the same opt-in as the **New folder…** row in the *Task Scheduler folder* box on New Task and Apply Template. **Reach for `list_folders` and an existing folder first.** The flag is for a folder the user asked for *by name* — not for recovering from a typo, because the agent is elevated and a misspelled path becomes a folder needing **administrator rights** to remove. It never widens *where* a task may land: `\Microsoft\` is still refused, in the backend and independently in the agent. |
| **`\Microsoft\` is refused outright** | `RegisterTaskDefinition` **silently overwrites** a same-named task, and the agent runs **elevated** — writing there could destroy a real Windows task with no error. Refused in the backend **and independently in the agent**. |
| **Name must be unique per folder** | A collision returns **409** rather than letting Windows silently overwrite. `\Work\Backup` and `\Cronsole\Backup` are different tasks. |
| **`folder` is inside the signature** | Every field the agent acts on is signed — an unsigned field would let an on-path attacker redirect the write. |

**Use `list_folders` to find a valid one** (MCP) / `GET /api/tasks/folders` — it returns every
real folder with its task count and whether you can create there. Don't guess a path: the only
folder Cronsole will create is `\Cronsole`, so a guess that doesn't exist is an honest refusal,
not a new folder.

Two things about that listing that will otherwise mislead you:

- **An unwritable folder is still listed** (`writable: false`, e.g. `\Microsoft\…`). That's
  deliberate — *"exists but refused"* is a different fact from *"doesn't exist"*. Don't read
  its presence as permission.
- **The default `\Cronsole` is often absent from the list.** It's created lazily and **pruned
  when its last task is deleted**, so on a clean machine it genuinely doesn't exist yet. That
  is not a problem and not a reason to pick a different folder — omit `folder` and Cronsole
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
| **Run history, all tasks** | ❌ | `GET /api/tools/history` (`?format=csv`) — the only cross-task read of `ExecutionLog`; per-task history is capped at 20 rows. **Read `runKind` before reading `status`**: `native-execution` is a real outcome, `manual-trigger` means only that the agent accepted the start. Dashboard: **Tools** tab |
| **Task health / "what needs attention"** | ❌ | `GET /api/tools/task-health` — per-task tier + **signals with their evidence**. Windows tasks score from Windows' own `lastTaskResult`/`lastRunTime`/missed runs; native tasks from `ExecutionLog`. A task with no evidence is `unknown`, never `ok`. Not to be confused with `GET /api/tasks/health`, which is *per-platform connector* health. Dashboard: **Tools** tab › Task health |
| **What can Cronsole DO with a platform** | ❌ | `GET /api/tools/platforms` — per platform: connection, tracked count, last real sync, and ten capability verbs each as **verified** / **declared** / **unsupported**, with the timestamp behind the verdict. **`declared` is not `yes`**: it means the route would accept the verb but nothing has been observed to work here. Read-only — opening it asks no platform anything, so it cannot change what it reports. Reachability is a property of the **route**, not of `typeof connector.method` (which is false for Cronsole-native's route-handled delete/reschedule/export). Dashboard: **Sources** tab |
| **Analytics — failures / slowing down / idle** | ❌ | `GET /api/tools/analytics?days=&tz=&idleDays=` — daily failure buckets, per-task duration trend, and idle tasks, in one read. **Each section has a different source and the response's `source` field says so.** The duration trend is **native-only** (a Windows `durationMs` times the agent accepting a start); the idle report judges Windows tasks from Windows' own `lastRunTime`, never from `ExecutionLog`, and splits its output four ways — idle / never-run / no-run-evidence / disabled-or-on-demand — because only the first is a defect. `tz` is an IANA name; an unknown one is a **400**, not a silent UTC fallback. Totals are exact; `trend.partial` means the chart covers a narrower span than the totals do. Dashboard: **Tools** tab › Execution analytics |
| **Restore from a backup** | ❌ | `POST /api/tools/restore/tasks` — the write twin. `dryRun: true` returns a **plan** (create / overwrite / skip / refuse per file) and writes nothing; that is the only honest way to see what an archive contains first. `overwrite` and `createFolders` both default **false**. Restoring puts a task on the machine — it does **not** make Cronsole track it. Dashboard: **Tools** tab |
| **Untrack** (remove from Cronsole, keep it running) | ✅ `untrack_task` — ungated | `POST /api/tasks/:id/untrack` |
| **Delete** | ⚠️ `delete_task` — **only** with `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`, else absent | `DELETE /api/tasks/:id` |
| Template import/export, save-as-template, sync, pairing | ❌ | REST / UI only |

**Disable is how you park a task** — not a weird cron (§3 explains why that backfires). It is
reversible and ungated precisely so the safe move is the easy one.

**Untrack is how you tidy the dashboard** — not delete. `untrack_task` drops Cronsole's row (and
its Cronsole run history) while leaving the real scheduled task exactly where it is, still running
on its own schedule, and records an exclusion so the next sync doesn't quietly re-import it. Use
it for an over-broad import, a folder full of OS tasks, or anything the user just doesn't want to
see. It refuses `TASKHUB_NATIVE` tasks, which exist **only** inside Cronsole and therefore have
nothing to keep — that 400 is correct, not a bug to route around. The way back is re-importing
the category in the UI.

**Three verbs, three blast radii — do not substitute one for another:**

| Goal | Verb | What survives |
|:---|:---|:---|
| Stop it running, keep everything | `set_task_status: DISABLED` | the task, its schedule, its history |
| Stop *seeing* it, keep it running | `untrack_task` | the real scheduled task (Cronsole's history goes) |
| Make it stop existing | `delete_task` (gated, **native-only**) | nothing live — but the definition is archived |

**`delete_task` reaches Cronsole-native tasks only** (2026-08-13). It wraps
`DELETE /api/tasks/:id/native`, which refuses every other platform with a **400** — Windows
included. So **no MCP verb can destroy a scheduled task on the machine**: for a Windows task the
removal you have is `untrack_task`, and genuinely deleting one needs a human in the UI. That 400 is
a boundary, not a missing feature — no retry or alternate argument gets past it.

**What it can delete, the backend archives first.** The task definition plus its last 20 run
records are written to `DeletedTaskArchive` *before* the delete, and the delete is **refused if
that write fails**, leaving the task untouched. Read archives back at
`GET /api/tools/task-archives[/:id]`. The live task is still gone — the schedule stops — but it can
be rebuilt.

**And it is absent unless the human opted in.** If it isn't in your tool list, that is the answer,
not an obstacle: say so and offer `set_task_status: DISABLED`, the UI, or the REST call. Don't
route around it.

**Two behaviors worth knowing before you use these:**

- **`update_task_action` REPLACES the action, it does not patch it.** `command` and `runLevel` are
  both required. Read the task's current values (`list_tasks` / `export_task`) before changing
  one field, or you will silently reset the other.
- **`get_task_history` is not a complete record.** Cronsole logs manual runs it triggered and
  native scheduler fires; a Windows task firing on its **own** trigger is recorded by Windows.
  So an empty history means "Cronsole has nothing", never "it never ran". And a `SUCCESS` means
  *dispatched and reported success* — a hung task reports exactly that (§6, and trap #12).

---

## 6. Verify it — the part everyone skips

**A green suite is not evidence a task works.** Resolvability proves a command *tokenizes*,
not that it *runs*. Neither is Cronsole's own `lastRunStatus: SUCCESS` — the agent observes
that the task **started**, never that the command worked, so a command that hangs forever
reports `SUCCESS` ([#12](../../../docs/troubleshooting/README.md#12-a-template-passes-every-test-and-still-hangs-on-the-target)).

> **When you're testing the reporting layer's honesty, the reporting layer cannot be your
> witness.** Get evidence from outside Cronsole.

```powershell
$t = Get-ScheduledTask -TaskPath '\Cronsole\' -TaskName '<name>'
$t.Actions | Select-Object Execute, Arguments     # direct exec? no stray cmd.exe /c?
$t.Triggers | Select-Object StartBoundary, DaysInterval, Repetition   # UTC->local correct?
Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly            <- Windows' own record, independent of Cronsole
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
   and take the default `\Cronsole` (absent from the listing is fine — it's created on demand).
6. Name won't collide in that folder.
7. The command **terminates**. An unattended run has no console — a prompt or an unprinted
   error hangs forever.
8. After creating: **run it and verify from outside Cronsole** (`LastTaskResult` + a side effect).
9. If it was a test: **delete it**.

On a **hosted agent** (Gemini, a Claude routine) items 3–6 do not apply and three others take
their place (§2a): the prompt **offers no choice**, it **demands explicit failure reporting**,
and the **grant** covers what it is told to do. Then verify by reading the run's **step list**,
never its status.

## Canonical sources

| Topic | Doc |
|:---|:---|
| MCP tools, wiring, tokens | [`docs/user-guides/guides/MCP_Server_Guide.md`](../../../docs/user-guides/guides/MCP_Server_Guide.md) |
| Routes, data model, agent protocol | [architecture.md](architecture.md) |
| The catalog / registry | [templates.md](templates.md) |
| Traps in full | [`docs/troubleshooting/README.md`](../../../docs/troubleshooting/README.md) |
| What's shipped / next | [`docs/ROADMAP.md`](../../../docs/ROADMAP.md) |
