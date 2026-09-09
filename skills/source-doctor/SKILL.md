---
name: source-doctor
description: Run a full test-and-fix session across every Cronsole source (Windows, Cronsole-native, Claude Code, Gemini Triggers, GitHub Actions, Vercel Cron) — diagnose what's actually broken vs. what only looks broken, and apply safe fixes. Use when a task "failed", a source looks unhealthy, or before/after touching a connector.
---

# Source Doctor

`/doctor` answers *"is Cronsole itself working"* (stale builds, agent socket, DB, MCP token).
**This skill answers *"is each connected source actually doing its job, and can I fix what
isn't"*** — one source at a time, using the live `cronsole` MCP tools, not by reading code.

Read the `cronsole` skill's invariants table first if you haven't — this skill leans on it
constantly. The rule underneath everything here: **a status field is only as good as the event
that wrote it.** Most "task failed" reports are actually one of the known false signals below,
not a real failure.

## Order of operations

1. **`get_diagnostics`** — is Cronsole itself healthy (agent socket, DB, scheduler)? A wedged
   agent makes every Windows task look broken; nothing below is meaningful until this passes.
2. **`list_platforms`** — the capability matrix, every connected platform. Read `healthState`,
   and per verb: `verified` / `declared` / `unsupported`, plus `lastFailureReason`. This tells
   you *what kind* of platform you're dealing with before you touch a task: `access: observer`
   (GitHub Actions, Vercel Cron) can never be "fixed" past reading — refusals there are the
   design. `access: controller` (Windows, Gemini, Claude, native) can actually be repaired.
3. **`get_task_health`** (per platform, or `tier: critical`/`attention` across all) — which
   tasks the *platform itself* reports as unhealthy. Remember: `unknown` ≠ `ok`, `disabled` ≠
   unhealthy, and a Windows task's health comes from `lastTaskResult`, never from
   `get_task_history` (that log only holds runs Cronsole triggered).
4. **For the task in question**: `list_platform_runs` (the platform's own run history — this is
   where Gemini/GitHub/Vercel/Windows runs actually live) then `get_run_output` on the run in
   question. **Read the step list, not just the status** — `completed` means the agent finished
   its turn, not that it did the job (a digest trigger with no mailer finishes `completed` having
   only written a file).
5. Only for a Cronsole-native task or one you ran manually: `get_task_history` /
   `list_run_history` — these hold only runs *Cronsole performed*.

## Classify before you touch anything

Every "it failed" report is one of these. Say which, out loud, before proposing a fix:

| Symptom | Real cause | Evidence that proves it |
|:---|:---|:---|
| **Cronsole-side outage** | Agent wedged, backend stale, DB migration unapplied | `get_diagnostics` fails a check |
| **Platform genuinely failed the run** | The job/trigger executed and reported failure | `list_platform_runs` status is a failure state, or `get_run_output`'s steps show it never reached the goal |
| **Dispatch timeout, not a failed dispatch** | Cronsole's request to the platform timed out waiting, but the platform actually started or finished the run | `run_task`/`list_platforms`'s `run` verb shows no `lastFailureAt` at that time, or a run exists on the platform starting after the request |
| **A live read failed, not the run** | `get_run_output` (or any "live" verb) hit a transient error fetching *evidence*, independent of whether the run happened | The run's own `status` in `list_platform_runs` is fine; only the output fetch errors, and retrying later may resolve it (Gemini's `v1beta` API 500s occasionally) |
| **Absence of evidence, not failure** | Platform reports nothing for this signal at all (Vercel run history, disabled Windows task history, an agent too old for a verb) | `reportsRunResult: false`, `historyEnabled: null`, or the field is genuinely absent, never zero |
| **A capability boundary, not a bug** | The verb is `unsupported` for this platform/route by design | `list_platforms` shows `unsupported`, not a failure with a reason naming your system |

**Never report a fix for a boundary or an absence** — say what it means instead.

## What's actually fixable, and how

| Situation | Fix | Tool / where |
|:---|:---|:---|
| Task genuinely failed and is safe to retry | Re-run it | `run_task` |
| A task should stop firing while you investigate | Park it (never delete/untrack to "fix" a failure) | `set_task_status: DISABLED` |
| A Gemini trigger's prompt or schedule needs changing | It's immutable — recreate | UI's **Recreate with changes** (not an MCP verb — `updateAction`/`updateSchedule` are `unsupported` by design) |
| A Windows task's own history is empty | Check `historyEnabled` via diagnostics/agent before assuming it never ran — turning it on is **not retroactive** | User action on the machine |
| Windows subtree vanished (MISSING) after sync | Don't clear MISSING reflexively — check whether the agent is running **elevated** (#74) before concluding tasks are gone | `CronsoleRestart` scheduled task, then re-sync |
| A native job fails naming a secret | Working as designed (ADR 0003) — set the value in the UI, never pass it through MCP | UI only |
| Credential rotated on a Gemini/other hosted target | Rotate via UI, not MCP (`rotateCredentials` takes live values) | UI only |
| Platform reachable but capability `unsupported` | Nothing to fix — state the boundary | N/A |
| Observer platform (GitHub Actions, Vercel) refuses `run`/`create`/`setStatus` | Nothing to fix — by design, not a to-do | N/A |

Anything past this table (schema migrations, agent republish, elevation, Docker/proxy state)
belongs to `/doctor`, not here — hand off rather than improvise.

## Report format

For each source touched, one block:

```
<Platform> — <task name or "all tasks">
Verdict:   <healthy | degraded | broken | boundary | insufficient evidence>
Evidence:  <the specific field/value that proves it>
Root cause: <one of the classify-table rows above>
Action:    <fix applied, fix recommended (needs UI/user), or "none — this is by design">
```

Then one line: what still needs the user (UI-only actions, machine-side settings) vs. what you
already fixed.
