# 🔌 MCP Tools

> **Covers:** F6.5, F6.6, F6.7 · I6.4 · U4.x
> **Time:** ~25 min · **Needs:** the stack, a built `mcp-server/dist/`, an MCP host, and the agent online

The runbook the testing README has been pointing at. It exists to close one gap, and the gap is
precise:

> **`mcp-server`'s own suite stubs the HTTP client.** It drives the real tools through a real MCP
> client over an in-memory transport — so it proves what the wrapper *does*, and it **cannot**
> prove that the wrapper and the API still **agree**. Move a route's response shape and the stub
> stays green while the real tool breaks. That is [#9](../../../troubleshooting/README.md#9-agent-payload-arrives-with-every-field-empty)
> one layer up: *both sides green while disagreeing about the wire.*

So the only thing that closes it is calling the tools **through a host, against a running backend**.
Nothing here is automatable — if it were, it would be in the suite.

Complete the [preflight](../README.md#-preflight--do-this-once-per-session) first.

---

## 0. Preflight — three ways this fails before it starts

**1. The server runs `dist/`, not `src/`.** An unbuilt change is invisible, which makes it a third
thing that runs stale alongside the Dockerized backend and `agent/publish/`:

```powershell
cd mcp-server; npm run build
```

**2. `CRONSOLE_TOKEN` must be set in the environment the host was launched from.** `.mcp.json`
references it as `${CRONSOLE_TOKEN}` so the committed config never holds the secret. If it is
unset, the literal text is forwarded, the API answers `403`, and the server **refuses to start** —
so the tools go *missing* rather than erroring, which is a much more confusing symptom
([#8](../../../troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)).
On Windows a newly set variable needs a **fresh terminal**: a process inherits its parent's
environment, so restarting the host inside an old one will not pick it up.

**3. Restart the host after rebuilding.** It holds the old `dist/` in memory. New tools will not
appear until it restarts — which is itself the first thing this runbook checks.

## 1. The census — does the surface match what the docs claim?

This is the mechanical tripwire, and it is the reason no count is written into the coverage
catalogs: a number in prose is a number nobody re-reads.

```powershell
(Select-String -Path mcp-server\src\tools.ts -Pattern 'server\.registerTool' -AllMatches).Count
```

Then ask your host to list its tools and compare **by name**, not by count:

```text
List every Cronsole MCP tool you can see, one per line, sorted.
```

**Expect:** the source count, minus `delete_task` unless `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`.
As of 2026-08-17 that is **33 in source, 32 visible** by default.

**Also compare against the two tool tables** — [`mcp-server/README.md`](../../../../mcp-server/README.md)
and [`MCP_Server_Guide.md`](../../../user-guides/guides/MCP_Server_Guide.md). A tool present in one
and missing from the other is the §11a drift this whole exercise exists to catch; `/sync-surfaces`
diffs them by name.

## 2. Read-only sweep

Call each and read the *content*, not just the absence of an error. These are safe on a real
machine.

| Tool | What to actually check |
|:---|:---|
| `get_diagnostics` | Ask this **first**. Agent connected, `measuredOn` names your machine, `unknown` is not reported as a pass |
| `list_platforms` | Three states appear (`verified` / `declared` / `unsupported`) and evidence timestamps are real, not invented |
| `list_tasks` | The count matches the dashboard. System tasks excluded by default, and the exclusion is **named** |
| `list_folders` | Real Task Scheduler folders; `\Microsoft\…` present with `writable: false` rather than hidden |
| `list_templates` | Ids, tags, params. Should match the Templates tab |
| `get_task_health` | Signals name the field they came from; a task with no evidence is `unknown`, not `ok` |
| `list_run_history` | Every row carries a `runKind`, and an empty result says *why* rather than implying nothing ran |
| `get_task_history` | On a **Windows** task: the empty-history caveat is stated, not implied |
| `export_task` | On a Windows task: real XML, and the UTF-16 warning is present. On a native task: a `cronsoleTaskVersion` bundle. Then **`format: 'template'` on the same task** — a Registry v1 template, and the result must say it is **not** a faithful backup. Drive it once with the **agent stopped**: native 502s there and template must still succeed, which is the difference that justifies the second format |
| `list_task_archives` | Each row carries `restorable` **with its reason** when it is false |
| `convert_schedule` | Feed it `0 9 * * 1-5` and read the **trigger**, not the score — the Monday-only bug scored 1.0 |
| `list_claude_routines` | Reports `session.mode`. Note which it is; §5 depends on it |

> [!IMPORTANT]
> **`convert_schedule` deserves a real attempt to break it.** Give it `0 4 1 1 *` (once a year) and
> confirm the response says the trigger was **replaced** with an hourly one, in words — not merely
> a `0.7`. A score alone conflates *approximated* with *replaced*, and those call for opposite
> actions ([#14](../../../troubleshooting/README.md#14-a-rare-cron-becomes-an-hourly-trigger)).

## 3. Create — and clean up after yourself

Everything here makes a **real scheduled task**. Name them so you can find them again:
prefix every one `mcp-runbook-`.

| Tool | Drive it with |
|:---|:---|
| `create_task` | A command you know, e.g. `powershell.exe -NoProfile -Command "exit 0"`, daily |
| `create_native_task` | An HTTP job against something harmless you control |
| `create_native_program_task` | An existing program — check the response names the **execution host** |
| `create_native_script_task` | A `node` one-liner. Nothing should need to exist on disk |
| `create_native_check_task` | A `tcp` probe at a port you know is open, then one you know is closed |
| `create_task_from_template` | Any core template, into `\Cronsole` |

**Then verify from outside Cronsole.** This is the step that matters and the one people skip:

```powershell
Get-ScheduledTask -TaskPath '\Cronsole\' | Where-Object TaskName -like 'mcp-runbook-*' |
  Select-Object TaskName, State
```

> [!WARNING]
> **Cronsole's own report is not evidence here.** A `SUCCESS` on a Windows task means the agent
> accepted the start, and a hung task reports exactly that. When you are testing whether the
> reporting layer is honest, the reporting layer cannot be your witness — use Windows'
> `LastTaskResult`, or a real side effect.

**A failing check should come back as a result, not an error.** Point `create_native_check_task` at
a closed port, `run_task` it, and confirm the host reports *"the check ran and failed"* rather than
*"I could not run the check"* — a `502` there would make "your disk is full" and "monitoring is
broken" the same message ([#59](../../../troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)).

## 4. Modify, import, and remove

| Tool | What to check |
|:---|:---|
| `run_task` | Runs, and the result distinguishes *dispatched* from *executed* |
| `set_task_status` | Disable then enable. This is the honest way to park a task |
| `update_task_schedule` | Read the returned **trigger**, not the score |
| `update_task_action` | It **replaces** — confirm both `command` and `runLevel` are required |
| `update_native_job` | It **replaces**; switching `jobType` moves the task between rail sources |
| `rename_task` | Renames in Cronsole **only** — confirm in Task Scheduler that the real name is untouched |
| `import_task` | Feed it the `export_task` bundle from §2. A **new** task appears, `nextRunTime` is reported, and importing twice gives you **two** |
| `restore_task_archive` | Delete a native task, then restore it. New id, **no** archived runs on it, archive **still listed** |
| `untrack_task` | On a **Windows** task: row goes, real task keeps running. On a native or Claude one: refused, by name |
| `sync_tasks` | No `categories` = refresh; with them = import, and it forgets prior untracks in those categories |

**The refusals are the point, so drive them deliberately:**

```text
Use import_task on this Windows task bundle: {"cronsoleTaskVersion":"1.0","task":{"name":"x","platform":"WINDOWS_TASK_SCHEDULER","schedule":"0 4 * * *","job":null}}
```

**Expect:** refused *by name*, pointing at Tools → Restore — not a generic failure. Try a template
catalog export too; it should point at the Templates tab. A refusal that cannot say which of
Cronsole's three JSON formats you handed it is the defect
([#65](../../../troubleshooting/README.md#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it)).

## 5. Claude routines — read `session.mode` first

`list_claude_routines` reports which of Claude's two APIs this install can reach, and the
capabilities genuinely differ:

- **`oauth`** — `create_claude_routine`, `set_task_status` and `update_task_schedule` all work.
- **`declared`** — creation is refused with a `400`. That refusal is **correct**, not a defect.

`connect_claude_routine` takes a **live credential as a parameter**, so it lands in the host's
transcript — prefer the UI when a human is present, and treat any token you paste here as spent.
There is no `delete_claude_routine` and cannot be; confirm the tools say removal happens at
claude.ai.

## 6. The gate

With `CRONSOLE_MCP_ALLOW_DESTRUCTIVE` unset, ask the host to delete a task.

**Expect:** it reports that no such tool exists and offers `set_task_status` or `untrack_task`.
`delete_task` must be **absent from `tools/list`**, not present-and-erroring — a capability that
announces itself then refuses is worse than one never offered.

Then set the flag, restart the host, and confirm:

- `delete_task` appears, and **only** it changed.
- It **refuses a Windows task** with a `400`, and the refusal reads as a boundary rather than a
  missing feature. No MCP verb may destroy an artifact on the machine.
- Deleting a native task reports the archive id — and `restore_task_archive` can spend it.

**Unset the flag and restart the host when you are done.**

---

## ✅ Pass criteria

- [ ] Tool names match source **and** both tool tables (1)
- [ ] Read-only tools return content that agrees with the UI, evidence included (2)
- [ ] `convert_schedule` names a replaced trigger in words (2)
- [ ] Created tasks exist in **Task Scheduler**, verified outside Cronsole (3)
- [ ] A failing check is a result, not a tool error (3)
- [ ] Import / restore produce a new task and report it as new (4)
- [ ] Every refusal names the reason and the right alternative (4, 5)
- [ ] `delete_task` absent without the flag; Windows refused with it (6)

## 🧹 Cleanup

```powershell
# Remove every task this runbook created
Get-ScheduledTask -TaskPath '\Cronsole\' | Where-Object TaskName -like 'mcp-runbook-*' |
  Unregister-ScheduledTask -Confirm:$false
```

Then remove the Cronsole rows (and any native tasks) through the dashboard, unset
`CRONSOLE_MCP_ALLOW_DESTRUCTIVE`, and restart the host.

> A test task is a real scheduled task. Left behind, it fires forever.

---

<p align="center">
  <a href="../README.md">← Manual Testing</a> ·
  <a href="Security_Checks.md">Security Checks →</a>
</p>
