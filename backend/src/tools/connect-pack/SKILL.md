---
name: cronsole
description: Create, run, and manage scheduled tasks through a running Cronsole instance — Windows Task Scheduler tasks and Cronsole-native HTTP jobs. Use when the user asks to schedule something, automate a recurring job, check whether a scheduled job ran, or change/disable/delete an existing scheduled task.
---

# Cronsole

> Cronsole Connect Pack **v1.8** · canonical copy: <https://cronsole.mikesailab.com>
> If this file is older than your Cronsole install, the install wins — re-download the pack.

Cronsole is a single pane of glass for scheduled tasks. It runs **locally** on the user's own
machine: a web dashboard, a backend API, and a Windows agent that talks to Task Scheduler.

This skill teaches you to **use** a running Cronsole. You are driving someone's real computer.

> **The frame:** creating a task is not "calling an API", it's **registering code to run on
> someone's computer forever, with no one watching**. A scheduled task fails differently from
> an interactive one: there is no console to print to, no user to answer a prompt, and no one
> to notice for weeks.

---

## 1. How you reach it

Two surfaces, same backend:

| Surface | Use when |
|:---|:---|
| **MCP server** (`cronsole`) | Your host supports MCP. 15 tools, 1:1 with API routes. Preferred. |
| **REST API** (`http://localhost:3000/api`) | No MCP support, or you need something MCP doesn't expose (template import/export, save-as-template, sync, agent pairing). Bearer token in `Authorization`. |

Both need the backend running and a token. See `README.md` in this pack for wiring.

**If a tool you expect is missing, that is an answer, not an obstacle.** `delete_task` is
absent unless the human set `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`. Say so and offer the safe
alternative — **disable** it (stops it running), **untrack** it (removes it from Cronsole but
leaves it running), or the dashboard. Do not route around a gate.

---

## 2. The tool surface

| Action | MCP tool | REST |
|:---|:---|:---|
| List / inspect tasks | `list_tasks` | `GET /api/tasks` |
| Find a real folder | `list_folders` | `GET /api/tasks/folders` |
| Run now | `run_task` | `POST /api/tasks/:id/run` |
| Create from a command | `create_task` | `POST /api/tasks` |
| Create an HTTP job | `create_native_task` | `POST /api/tasks/native` |
| Schedule an **existing program** | `create_native_program_task` | `POST /api/tasks/native` with `job.jobType: 'EXEC'`. The program must already exist on the machine the **Cronsole backend** is on — not necessarily the user's desktop. Prefer a Windows task for anything that must run as the user or survive Cronsole being down |
| Schedule a **script you write** | `create_native_script_task` | `POST /api/tasks/native` with `job.jobType: 'SCRIPT'`. The body is stored and run under a named interpreter (`powershell`, `pwsh`, `bash`, `sh`, `python`, `node`), so nothing has to exist on disk first. `node` is present wherever the backend runs |
| Schedule a **check** | `create_native_check_task` | `POST /api/tasks/native` with `job.jobType: 'CHECK'`. Asserts on an endpoint, a TCP port, a file's age, or free disk space — a failure here is a fact about the system, unlike a failing script |
| Create from a template | `create_task_from_template` | `POST /api/templates/:id/apply` |
| Browse templates | `list_templates` | `GET /api/templates` |
| Validate a schedule | `convert_schedule` | `POST /api/tasks/preview` |
| Enable / disable | `set_task_status` | `PATCH /api/tasks/:id/status` |
| Enable / disable **many at once** | — | `POST /api/tools/tasks/status` (`{taskIds, status}`) |
| Recategorize **many at once** | — | `POST /api/tools/tasks/category` (`{taskIds, category}`) |
| Remove **many** from Cronsole, keep them running | — | `POST /api/tools/tasks/untrack` (`{taskIds}`) |
| Re-schedule | `update_task_schedule` | `PATCH /api/tasks/:id/schedule` |
| Edit the command | `update_task_action` | `PATCH /api/tasks/:id/actions` |
| Run history | `get_task_history` | `GET /api/tasks/:id/executions` |
| Export one task | `export_task` | `GET /api/tasks/:id/export` |
| Remove from Cronsole, keep it running | `untrack_task` | `POST /api/tasks/:id/untrack` |
| Delete | `delete_task` (gated) | `DELETE /api/tasks/:id` |
| Bulk export / backup | — | `POST /api/tools/export/tasks` (`scope: 'all' \| 'folder' \| 'selection'`; `selection` takes `taskIds`) |
| Restore from a backup | — | `POST /api/tools/restore/tasks` (send `dryRun: true` first) |
| Run history across all tasks | — | `GET /api/tools/history` (`?format=csv`) |
| What needs attention | — | `GET /api/tools/task-health` |
| **Is Cronsole itself working?** | `get_diagnostics` | `GET /api/tools/diagnostics` — the agent connection, database, native scheduler, template catalog, API-token expiry and allowed origins, **each with the evidence behind it**. Ask this **before** `get_task_health` when something is wrong: health asks *"are the user's tasks failing"*, which is meaningless while the agent is wedged — then **every** Windows task reads unhealthy and the fix is in none of them. `unknown` is **not** `pass` (the check could not be measured). `measuredOn` says which machine the facts describe. Read-only; it repairs nothing, and it cannot report on a backend that is down because that backend serves it |
| **What Cronsole can actually do with a platform** | — | `GET /api/tools/platforms` — each verb reads **`verified`** (has worked on this machine), **`declared`** (Cronsole will try; never observed to work here) or **`unsupported`** (would be refused). **Check this before promising the user a capability.** `declared` is not a yes |
| Star / un-star a task | — | `POST` / `DELETE /api/tasks/:id/favorite` (`isFavorite` comes back on `GET /api/tasks`) |
| Template import/export, sync, pairing | — | REST / dashboard only |

---

## 3. The invariants — break these and you break the user's machine

| Rule | Why it exists |
|:---|:---|
| **Schedules are 5-field cron in UTC** | Not local time. The dashboard reads *and writes* in the user's own zone (Pacific by default) and converts before calling the API — **you can't see that setting, so you convert on the way in**. Ask which zone "9am" means, and confirm both readings back. See §3 of the task-authoring reference. |
| **Commands are tokenized, no shell** | A Windows command becomes a structured `{executable, args[]}` action. Pipes, `>`, `&&`, `%VAR%` do **not** work unless you invoke a shell explicitly. This is the injection guarantee — an implicit shell turns every parameter into arbitrary code. |
| **`\Microsoft\` is refused** | Registering a task **silently overwrites** a same-named one, and the agent runs **elevated**. Writing there could destroy a real Windows task with no error. Refused in the backend *and* independently in the agent. |
| **A folder must already exist — unless you ask for it, and say so** | The only folder Cronsole creates *unasked* is `\Cronsole`, and it is the only one it removes. A create into a missing folder is refused honestly; pass **`createFolder: true`** on `create_task` to make the chain instead. **Do not reach for that flag to get past an error.** Deleting a Task Scheduler folder needs elevation, and the agent is elevated — so a folder it creates is a door only an *administrator* can close. Tell the user what you are about to create and why, and prefer an existing folder from `list_folders`. The response names every folder it made. |
| **Names are unique per folder** | A collision returns **409** instead of letting Windows silently overwrite. |
| **Disable is how you park a task** | Never encode "don't run" in the cron — see §5. |
| **A bulk result is per task, not one number** | **Every** `/api/tools` bulk route — status, category, untrack — answers in the same shape: an outcome for each task, one of `updated`, `unchanged` (already in that state), `refused` (declined before the platform was asked), `failed`, `skipped`. **Read the items, not just the count** — partial success is normal, and a task that failed is still in the state it was. If the agent goes offline mid-run the rest come back `skipped` with the reason rather than the batch grinding through a timeout each. Category and untrack never touch a platform, so they cannot halt and their `skipped` is always `0`. |
| **Untrack is how you tidy the dashboard** | `untrack_task` (or `POST /api/tools/tasks/untrack` for many) removes Cronsole's record and leaves the scheduled task running. Deleting to clean up a view destroys someone's automation. Untrack needs no agent, so it works when Windows is unreachable. |
| **A category is a label, not a folder** | Recategorizing a Windows task changes how the dashboard groups it and **does not move it on the machine** — its Task Scheduler folder is unchanged. The response says how many labels that detached from their real folder (`detachedFromFolder`); pass it on rather than reporting a clean success. |

---

## 4. Creating a task

**Default to `create_task`** when the user already knows the command. Reach for a template
when they name a *use case* (DB backup, git fetch, webhook), not a command. Do not bend a
request to fit a template.

Command recipes:

| Kind | Command |
|:---|:---|
| PowerShell script | `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\jobs\nightly.ps1"` |
| Executable, direct | `"C:\Tools\backup.exe" --full --quiet` |
| HTTP ping | `powershell.exe -NoProfile -Command "Invoke-RestMethod -Uri 'https://…'"` |
| npm / node | `cmd.exe /c "npm run build > C:\logs\build.log 2>&1"` |
| Python | `"C:\Python312\python.exe" "C:\jobs\etl.py"` |
| Unattended AI CLI | `powershell.exe -NoProfile -Command "claude -p 'prompt' --permission-mode dontAsk --allowedTools 'Read,Grep' --bare"` |
| HTTP job (no agent) | a URL, with `platform: TASKHUB_NATIVE` |

- `-NoProfile` so an unattended run doesn't depend on the user's shell profile.
- Quote any path with spaces. Inside `-Command "…"`, use single quotes for inner strings.
- Keep `.ps1` files pure ASCII — one em-dash in a BOM-less script makes PowerShell 5.1 fail
  to parse it.
- **The command must terminate.** An unattended run has no console: a prompt, a confirmation,
  or an interactive login hangs forever and reports nothing.

Full detail: `references/task-authoring.md` in this pack.

---

## 5. The schedule trap — read this one twice

**Always `convert_schedule` first, and read the returned trigger, not the score.**

| Score | Means |
|:---|:---|
| `1.0` | Exact native trigger. **Still read it.** A multi-day cron once scored 1.0 with no warnings while silently dropping four of five days. |
| `0.7` | Lossy **or replaced** — two different things sharing one score. Branch on the `lossy` field: `'approximated'` = derived from your input but drifts; `'replaced'` = your input was **discarded** for a hard-coded hourly trigger. |
| `0` | Not convertible. Fix the expression. |

> **A "rare" cron is the dangerous one.** `0 4 1 1 *` (once a year) is not recognized, so it
> is replaced with a trigger that repeats **hourly** — 8,760 runs a year instead of 1. The
> fallback only ever runs **more** often than you asked, never less.

**To create a task that shouldn't fire yet:** use a schedule the converter recognizes and
**disable** it. Never reach for an exotic cron to mean "never".

Recognized shapes: daily (`0 9 * * *`), weekly (`0 9 * * 1-5`), monthly (`0 3 1 * *`),
minute step (`*/15 * * * *`), hour step (`0 */4 * * *`). Everything else hits the fallback.

---

## 6. Verifying — the part everyone skips

**Cronsole's own `SUCCESS` is not proof the command worked.** The agent observes that the task
*started*, never that it finished correctly — so a command that hangs forever reports
`SUCCESS`. An empty run history means *Cronsole has no record*, not *it never ran*: a Windows
task firing on its own trigger is recorded by Windows, not by Cronsole.

> **When you are testing whether the reporting is honest, the reporting cannot be your
> witness.** Get evidence from outside Cronsole:

```powershell
$t = Get-ScheduledTask -TaskPath '\Cronsole\' -TaskName '<name>'
$t.Actions  | Select-Object Execute, Arguments      # direct exec? no stray cmd.exe /c?
$t.Triggers | Select-Object StartBoundary, Repetition   # UTC -> local correct?
Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly           <- Windows' own record, independent of Cronsole
#   267009 = STILL RUNNING (hung)     <- flat CPU means blocked, not working
```

Best evidence is a **real side effect** — a log line, a file, an HTTP hit.

**Clean up test tasks.** A test task is a real scheduled task; it fires forever if you leave it.

---

## 7. Before you create anything on a real machine

1. `convert_schedule` the cron — and **read the trigger**, not the score.
2. Cron is **UTC**, 5 fields.
3. The command tokenizes the way you intend; a shell is **explicit** if you need one.
4. Folder **exists** (`list_folders`) — or omit it and take the default `\Cronsole`.
   Its absence from the listing is normal: it is created on demand and pruned when empty.
5. The name won't collide in that folder.
6. The command **terminates**.
7. After creating: run it and **verify from outside Cronsole**.
8. If it was a test: delete it.
