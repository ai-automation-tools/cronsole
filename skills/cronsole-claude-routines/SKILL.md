---
name: cronsole-claude-routines
description: >-
  Design, create and track a Claude Code cloud routine (now called a scheduled task) — a scheduled agent run on Anthropic's
  infrastructure that opens a pull request — and connect it to Cronsole's CLAUDE_CODE source. Use
  whenever the user wants a recurring cloud agent, a scheduled Claude routine, a weekly drift check,
  or a docs/catalog refresh that runs by itself; whenever they want to list, pause, edit, retire or
  debug an existing routine; whenever a routine "ran" but opened nothing, or Cronsole shows no Claude
  routines, cannot pause one, or reports them all UNKNOWN. Also use to decide whether a scheduled
  agent job belongs in the cloud or on a local machine before building it.
---

# Claude Code routines — scheduled agents in the cloud

> [!NOTE]
> Anthropic renamed routines to **scheduled tasks**, and Cronsole's UI and docs now say so. This skill
> keeps "routine" for brevity; Cronsole's MCP tools keep their `*_claude_routine` names and the URL
> stays `claude.ai/code/routines`.

A **routine** is a prompt Anthropic runs on a schedule, in an isolated checkout, ending in a pull
request. It is one of two places a scheduled agent job can live, and picking the wrong one is the
expensive mistake.

| | **Cloud routine — this skill** | **Local scheduled job** |
|:---|:---|:---|
| Runs on | Anthropic's infrastructure, isolated checkout | your machine, via the OS scheduler |
| Needs | a repo it can reach and a prompt | a machine that is awake |
| Config | the dashboard. **Nothing on disk.** | files you own and can diff |
| Can reach | the repo, plus whatever you granted | anything the machine can |
| Managed with | `/schedule`, or the `RemoteTrigger` tool | a registrar (→ `cronsole-windows-jobs`) |
| Cronsole sees it as | `CLAUDE_CODE` | `WINDOWS_TASK_SCHEDULER` |

**Choose the cloud when the work needs no local state** — no installed dependencies, no `.env`, no
local service, no machine that has to be on. **Choose local** when it does, or when the work must
touch that machine.

---

## 1. The three constraints that shape everything

1. **Nothing lives locally.** There is no config file and no prompt on disk. The routine's entire
   definition is in the dashboard, which means **the prompt is the only artifact** — there is no
   version history behind it and nothing to diff when a run goes wrong. **Keep your own copy of every
   prompt** in the repo it acts on, or in a notes folder. Nothing else will.
2. **You cannot enumerate the fleet from a fresh session.** `CronList` is session-scoped and shows
   nothing from another session. Use `/schedule`, or `RemoteTrigger` with `{action: "list"}`. Do not
   read its silence as an empty fleet.
3. **Deleting is dashboard-only.** No API surface Cronsole has can remove a routine. The reversible
   move is to **turn one off** and leave it.

---

## 2. Build one

| Step | What |
|:---|:---|
| 1 | **Pick the routine type** → [`references/routine-types.md`](references/routine-types.md). Four shapes cover almost everything worth scheduling. |
| 2 | **Write the prompt.** It is the whole product — same file, § "The prompt contract". |
| 3 | **Pick a branch prefix**, and register it with whatever merges your PRs, in the same change. |
| 4 | **Pick a UTC time.** Routines fire in UTC; any local fleet you are avoiding shifts twice a year. |
| 5 | **Create it** with `/schedule`, or `RemoteTrigger`. |
| 6 | **Track it in Cronsole** → [`references/cronsole-side.md`](references/cronsole-side.md). |
| 7 | **Verify by reading the run's step list**, never its status. |

### Keep a fleet inventory

A cloud fleet has **no local record at all**, so a routine you forget about keeps running, keeps
opening PRs, and keeps costing money. Write down — anywhere you will actually look — each routine's
name, repo, branch prefix, fire time and whether it is on. The dashboard is the source of truth and
your inventory is not, which is exactly why it drifts and exactly why it is worth keeping.

---

## 3. The four rules a cloud prompt must follow

The first three are the universal unattended-agent rules. The fourth is what the cloud adds.

1. **Never offer a choice.** Nobody answers a question at 14:00 UTC on a Saturday. A prompt that asks
   *"which repositories should I include?"* does not fail — it **stalls**, and the run is over before
   anything happened. Give the parameter, or tell the agent to pick and say which it picked.
2. **Demand explicit failure reporting.** An agent that cannot finish a step **narrates success
   instead**. `completed` means *the agent finished its turn* — never that the job was done. End every
   prompt with: *"If any step fails, say so explicitly in your final message and name the step that
   failed, rather than summarizing what you would have produced."*
3. **State the verification, and forbid a PR when it fails.** Revert, leave the tree clean, say what
   blocked it.
4. **Carry the one-open-PR rule in the prompt itself.** A local runner can enforce this in code by
   adopting an open branch. **A cloud routine branches by hand and gets no such help**, so its prompt
   must say: *check for an open PR on this prefix first; if one exists, commit onto that branch and
   comment on the PR rather than cutting a new one.*

> Why rule 4 exists: two runs a day apart both branched from the base while the first PR sat
> unmerged. Each read a work list missing the other's changes, picked the same item, and
> reimplemented it. The two PRs shared nine identical files and one had to be closed. Code fixed the
> local case; the cloud case is only ever fixed in prose.

---

## 4. Cronsole's side, in one paragraph

`CLAUDE_CODE` is a **dual-mode** connector, and **what it can do depends on the install, not on the
platform**. With a readable Claude Code session on the Cronsole backend's host it uses the
undocumented OAuth `/v1/code/triggers` API and gets a real sync plus `create`, `setStatus`,
`updateSchedule` and `run`. Without one it falls back to the documented per-routine fire token:
`run` only, and `syncTasks` returns **the routines you declared in config** — which is not a sync and
is documented as not being one. So `unsupportedVerbs` is a **getter**, and a capability matrix read
on one machine does not describe another. **Neither mode can delete.** Full detail, and what every
reading on screen means, in [`references/cronsole-side.md`](references/cronsole-side.md).

---

## 5. Anti-patterns

- **Putting a job in the cloud that needs a specific machine.** No local state reaches it. If the
  work needs installed dependencies, a `.env`, a running service or a local path, it is a local job.
- **Creating a routine without registering its branch prefix** with whatever reviews and merges its
  PRs. It will open them forever and nothing will ever merge them.
- **Trusting `completed`.** Read the step list.
- **Assuming `CronList` shows the fleet.** It is session-scoped and shows nothing.
- **Trying to delete a routine from Cronsole.** No verb exists in either mode, by enumeration.
  Disconnecting the Claude source removes its *tracked tasks* along with the declaration — that is
  not a delete, and it is not reversible without re-declaring.
- **Keeping the prompt only in the dashboard.** It is the only artifact and it has no history.
- **Copying a prompt between routines.** The infrastructure is generic; the prompt is not.

---

## Related

| For | See |
|:---|:---|
| Scheduled agent jobs on a local machine | the `cronsole-windows-jobs` skill |
| Cronsole's own create/schedule/manage rules | Cronsole's `cronsole` skill → `cronsole/references/task-authoring.md` |
| Choosing a model tier for a routine | the `task-router` skill |
