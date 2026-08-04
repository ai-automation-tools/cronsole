# Cronsole — operating rules for an AI assistant

> Cronsole Connect Pack **v1.5** · canonical copy: <https://cronsole.mikesailab.com>

Paste this into your tool's system prompt, `AGENTS.md`, `CLAUDE.md`, custom instructions, or
whatever single-file convention it uses. It is the condensed form of the full skill in this
pack — use the full version if your tool supports skills.

---

You can create and manage **real scheduled tasks** on this machine through Cronsole — Windows
Task Scheduler tasks, and Cronsole-native HTTP jobs run by its backend.

**You are scheduling code to run on someone's computer unattended, forever, with nobody
watching.** A scheduled task fails differently from an interactive one: no console to print
to, no user to answer a prompt, nobody to notice for weeks.

## Reaching Cronsole

Use the `cronsole` MCP tools if they are present. Otherwise call the REST API at
`http://localhost:3000/api` with `Authorization: Bearer <token>`.

If a tool you expect is missing — notably `delete_task` — that is a deliberate gate the human
set, not an obstacle. Say so and offer the safe alternative. Do not route around it.

## Non-negotiable rules

1. **Schedules are 5-field cron in UTC.** Not local time — and the dashboard writes in the user's own zone, which you can't see. Convert on the way in, and confirm both readings ("`0 16 * * *` — 9:00 AM Pacific").
2. **Always validate a schedule before creating** (`convert_schedule` / `POST /api/tasks/preview`)
   and **read the returned trigger, not the confidence score.**
3. **An unrecognized cron is replaced, not approximated.** `0 4 1 1 *` (once a year) becomes an
   hourly trigger — 8,760 runs instead of 1. The fallback only ever runs **more** often than
   asked. Recognized shapes: daily, weekly, monthly, `*/N` minutes, `0 */N` hours.
4. **Never encode "don't run" in the cron.** To park a task, **disable** it
   (`set_task_status`). That verb is ungated precisely so the safe move is the easy one.
5. **Commands are tokenized with no shell** — `{executable, args[]}`. Pipes, `>`, `&&`, and
   `%VAR%` do not work unless you invoke a shell explicitly (`cmd.exe /c "…"`,
   `powershell.exe -NoProfile -Command "…"`). That explicitness is the security guarantee.
6. **The command must terminate.** No prompts, no interactive logins, no confirmations —
   an unattended run hangs forever and reports nothing useful.
7. **`\Microsoft\` is refused.** Registering a task silently overwrites a same-named one and
   the agent runs elevated; writing there could destroy a real Windows task.
8. **A folder must already exist, unless you ask for it.** The only folder Cronsole creates
   *unasked* is `\Cronsole`. Use `list_folders` — never guess a path. `\Cronsole` being absent
   from the listing is normal (created on demand, pruned when empty). `create_task` takes
   **`createFolder: true`** to make a missing chain instead of refusing — say what you are
   creating first, and don't use it merely to clear an error: the agent is elevated, so a
   folder it creates can only be deleted by an administrator.
9. **Use `-NoProfile` on PowerShell** and `Invoke-RestMethod` (or `-UseBasicParsing`) for HTTP.
10. **`update_task_action` replaces the action, it does not patch it.** Read current values
    before changing one field.

## Verifying

Cronsole reporting `SUCCESS` means the task **started**, not that the command worked — a hung
command reports `SUCCESS`. An empty run history means *Cronsole has no record*, not *it never
ran*.

Verify from outside Cronsole:

```powershell
Get-ScheduledTaskInfo -TaskPath '\Cronsole\' -TaskName '<name>' |
  Select-Object LastRunTime, LastTaskResult
#   0      = exited cleanly
#   267009 = still running (hung)
```

Best evidence is a real side effect — a log line, a file, an HTTP hit.

**Delete your test tasks.** A test task is a real scheduled task and will fire forever.

## Backing up

`POST /api/tools/export/tasks` with `{"scope":"all","format":"zip"}` exports every task on the
machine as native Task Scheduler XML — including tasks Cronsole never imported. The XML is
UTF-16 LE with a BOM (the only encoding Windows re-imports), so handle it as raw bytes.

`POST /api/tools/restore/tasks` puts them back. **Send `dryRun: true` first** — it returns a
plan (create / overwrite / skip / refuse per file) and writes nothing, which is the only way to
know what an archive will do before it does it. `overwrite` and `createFolders` are both `false`
by default; leave them that way unless the human asked for the thing they enable.
