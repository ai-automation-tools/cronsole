---
name: taskhub
description: Create, run, and manage scheduled tasks through a running TaskHub instance — Windows Task Scheduler tasks and TaskHub-native HTTP jobs. Use when the user asks to schedule something, automate a recurring job, check whether a scheduled job ran, or change/disable/delete an existing scheduled task.
---

# TaskHub

> TaskHub Connect Pack **v1.0** · canonical copy: <https://taskhub.mikesailab.com>
> If this file is older than your TaskHub install, the install wins — re-download the pack.

TaskHub is a single pane of glass for scheduled tasks. It runs **locally** on the user's own
machine: a web dashboard, a backend API, and a Windows agent that talks to Task Scheduler.

This skill teaches you to **use** a running TaskHub. You are driving someone's real computer.

> **The frame:** creating a task is not "calling an API", it's **registering code to run on
> someone's computer forever, with no one watching**. A scheduled task fails differently from
> an interactive one: there is no console to print to, no user to answer a prompt, and no one
> to notice for weeks.

---

## 1. How you reach it

Two surfaces, same backend:

| Surface | Use when |
|:---|:---|
| **MCP server** (`taskhub`) | Your host supports MCP. 14 tools, 1:1 with API routes. Preferred. |
| **REST API** (`http://localhost:3000/api`) | No MCP support, or you need something MCP doesn't expose (template import/export, save-as-template, sync, agent pairing). Bearer token in `Authorization`. |

Both need the backend running and a token. See `README.md` in this pack for wiring.

**If a tool you expect is missing, that is an answer, not an obstacle.** `delete_task` is
absent unless the human set `TASKHUB_MCP_ALLOW_DESTRUCTIVE=true`. Say so and offer the safe
alternative (disable it, or the dashboard). Do not route around a gate.

---

## 2. The tool surface

| Action | MCP tool | REST |
|:---|:---|:---|
| List / inspect tasks | `list_tasks` | `GET /api/tasks` |
| Find a real folder | `list_folders` | `GET /api/tasks/folders` |
| Run now | `run_task` | `POST /api/tasks/:id/run` |
| Create from a command | `create_task` | `POST /api/tasks` |
| Create an HTTP job | `create_native_task` | `POST /api/tasks/native` |
| Create from a template | `create_task_from_template` | `POST /api/templates/:id/apply` |
| Browse templates | `list_templates` | `GET /api/templates` |
| Validate a schedule | `convert_schedule` | `POST /api/tasks/preview` |
| Enable / disable | `set_task_status` | `PATCH /api/tasks/:id/status` |
| Re-schedule | `update_task_schedule` | `PATCH /api/tasks/:id/schedule` |
| Edit the command | `update_task_action` | `PATCH /api/tasks/:id/actions` |
| Run history | `get_task_history` | `GET /api/tasks/:id/executions` |
| Export one task | `export_task` | `GET /api/tasks/:id/export` |
| Delete | `delete_task` (gated) | `DELETE /api/tasks/:id` |
| Bulk export / backup | — | `POST /api/tools/export/tasks` |
| Template import/export, sync, pairing | — | REST / dashboard only |

---

## 3. The invariants — break these and you break the user's machine

| Rule | Why it exists |
|:---|:---|
| **Schedules are 5-field cron in UTC** | Not local time. The dashboard converts for display; you convert on the way in. |
| **Commands are tokenized, no shell** | A Windows command becomes a structured `{executable, args[]}` action. Pipes, `>`, `&&`, `%VAR%` do **not** work unless you invoke a shell explicitly. This is the injection guarantee — an implicit shell turns every parameter into arbitrary code. |
| **`\Microsoft\` is refused** | Registering a task **silently overwrites** a same-named one, and the agent runs **elevated**. Writing there could destroy a real Windows task with no error. Refused in the backend *and* independently in the agent. |
| **A folder must already exist** | The only folder TaskHub creates is `\TaskHub` — and the only one it removes. Deleting a folder needs elevation, so it will not create litter it cannot clean up. A create into a missing folder is refused honestly. |
| **Names are unique per folder** | A collision returns **409** instead of letting Windows silently overwrite. |
| **Disable is how you park a task** | Never encode "don't run" in the cron — see §5. |

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

**TaskHub's own `SUCCESS` is not proof the command worked.** The agent observes that the task
*started*, never that it finished correctly — so a command that hangs forever reports
`SUCCESS`. An empty run history means *TaskHub has no record*, not *it never ran*: a Windows
task firing on its own trigger is recorded by Windows, not by TaskHub.

> **When you are testing whether the reporting is honest, the reporting cannot be your
> witness.** Get evidence from outside TaskHub:

```powershell
$t = Get-ScheduledTask -TaskPath '\TaskHub\' -TaskName '<name>'
$t.Actions  | Select-Object Execute, Arguments      # direct exec? no stray cmd.exe /c?
$t.Triggers | Select-Object StartBoundary, Repetition   # UTC -> local correct?
Start-ScheduledTask -InputObject $t
Get-ScheduledTaskInfo -InputObject $t | Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly           <- Windows' own record, independent of TaskHub
#   267009 = STILL RUNNING (hung)     <- flat CPU means blocked, not working
```

Best evidence is a **real side effect** — a log line, a file, an HTTP hit.

**Clean up test tasks.** A test task is a real scheduled task; it fires forever if you leave it.

---

## 7. Before you create anything on a real machine

1. `convert_schedule` the cron — and **read the trigger**, not the score.
2. Cron is **UTC**, 5 fields.
3. The command tokenizes the way you intend; a shell is **explicit** if you need one.
4. Folder **exists** (`list_folders`) — or omit it and take the default `\TaskHub`.
   Its absence from the listing is normal: it is created on demand and pruned when empty.
5. The name won't collide in that folder.
6. The command **terminates**.
7. After creating: run it and **verify from outside TaskHub**.
8. If it was a test: delete it.
