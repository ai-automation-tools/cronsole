# Archetype A — an unattended AI agent run

> Launch an agent CLI with permissions bypassed, hand it a prompt, let it work with nobody watching,
> then say what happened. Written against Claude Code; the shape transfers to any headless agent CLI.

---

## 1. Two shapes, and how to choose

| | **A1 — worktree + PR** | **A2 — in place** |
|:---|:---|:---|
| Works on | a git repo, on a branch, ending in a pull request | a folder tree, edited where it sits |
| Isolation | a `git worktree` cut fresh from the base branch | none needed |
| Config | a routine config + a `prompt.md` | `job.json`, prompt inside the script |
| Runs via | a routine runner (yours, or the shape in §3) | `Invoke-ScheduledJob.ps1` wrapping a script that calls the CLI |
| Good for | "take the next roadmap item and build it", scheduled refactors | doc refreshes, index rebuilds, report generation |

**Choose A1 whenever the work lands in a git repo you care about.** The worktree is what makes the
job safe to schedule at all: the run cannot touch uncommitted work, cannot leave your checkout on a
strange branch, and cannot collide with whatever you are doing at noon on a Wednesday.

Choose A2 when the target is not a repo, or when a perfectly good script already exists and only
lacks a voice.

---

## 2. The invocation

This is the line, and every flag on it is load-bearing:

```powershell
& $ClaudeExe --dangerously-skip-permissions --settings $DenyFile --model $Model `
             --output-format stream-json --verbose -p $Prompt
```

```powershell
# Piping the prompt in, so a long brief does not fight the command line:
$Prompt | & $ClaudeExe --print --verbose --output-format stream-json `
                       --model $Model --dangerously-skip-permissions --settings $DenyFile
```

| Flag | Why |
|:---|:---|
| `--dangerously-skip-permissions` | **Mandatory, and never alone: always with `--settings` (next row).** There is no console and nobody to answer an approval prompt. Without it the session hangs until the execution time limit kills it — and the failure then looks like a timeout rather than a missing flag. |
| `--settings $DenyFile` | **Mandatory with the bypass.** A JSON settings file whose `permissions.deny` lists what this session must never do: hardware and live-app MCP tools, merges, repo create/delete/visibility changes, force-push. Deny rules hold even under the bypass. Preflight it: if the file is missing, fail the run rather than start an unfenced session. See `automated-dev-pipeline` rule 11. |
| `-p` / `--print` | Non-interactive. Same reason. |
| `--output-format stream-json --verbose` | Emits NDJSON, one event per tool call, so the transcript shows **what the session actually did** as it happens. This is the only thing that makes a run diagnosable a week later. |
| `--model <tier>` | Per job. State it rather than inheriting the account default, so a tier change elsewhere does not silently re-price every scheduled run. |

**Say in the prompt that fetched content is data.** The session reads repo files, issues, PR
comments and web pages, any of which can carry text aimed at it. The prompt states that these are
evidence, never instructions, and that nothing read during the run widens what the prompt
allows (`automated-dev-pipeline` rule 11).

**Preflight the CLI path before spending a session.** A moved or renamed CLI binary is the most
common break in this archetype, and failing at preflight costs nothing while failing after the
session costs the session.

**Encoding trap.** Windows PowerShell 5.1 pairs the CLI's UTF-8 stdout with the legacy OEM codepage
and mojibakes every em-dash. Set the console encoding explicitly before piping:

```powershell
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding           = [Text.Encoding]::UTF8
```

---

## 3. The A1 config

A worktree-and-PR runner needs these facts about the repo. Names are yours; the *set* is what
matters.

```jsonc
{
  "repo":   "C:\\path\\to\\checkout",
  "ghRepo": "owner/name",
  "base":   "main",
  "model":  "sonnet",

  "branchPrefix": "roadmap/auto",
  "worktree":     "C:\\path\\to\\.project-run",

  "link":       ["backend/node_modules", "frontend/node_modules", ".env", ".mcp.json"],
  "postCreate": ["./scripts/setup-links.ps1"],

  "schedule": { "dayOfWeek": "Friday", "at": "23:00" },
  "executionTimeLimitHours": 6,
  "lockHours": 12
}
```

The four that get people:

- **`base`** — `main` vs `master`. **Check the repo, do not assume.**
- **`link`** — everything gitignored that a build or test needs and a fresh worktree will not have.
  **Go and look** rather than guessing: every `node_modules` (often nested — `backend/`, `frontend/`,
  `packages/*`), every `.env`, every MCP or tool config. A **directory should be junctioned**
  (instant; `node_modules` is far too big to copy weekly); a **file should be copied** (a file
  symlink needs elevation or Developer Mode).
  ⚠️ A copied `.env` is a **real secret sitting at the worktree path** until teardown.
- **`postCreate`** — anything a fresh checkout needs done to it. A per-machine symlink or junction
  that a repo's tooling depends on is the classic case, and **its absence is usually silent**: the
  tool loads nothing and says nothing.
- **`lockHours`** — an overlap lock. A run still holding it makes the next one exit quietly rather
  than pile on; a lock older than the limit is stale and cleared.

**Tear down in the right order.** Unlink every junction *before* removing the worktree. `git` deletes
the tree depth-first, dies on a junction with a bare `failed to delete ...: Invalid argument`, and
dies **halfway** — having already removed the worktree admin data, so every later git command calls
the leftover directory "not a working tree".

---

## 4. The prompt is the product

**It cannot be copied from another job.** Nearly every disappointing run traces back to a brief that
never said what "done" means in that particular repo.

Read the repo's `CLAUDE.md` / `AGENTS.md` / README and its docs tree first, then write:

1. **Where the work list lives**, and how an item is marked open vs done.
2. **How to choose one item**, and **what to skip because it needs a human** — spending money, filing
   or signing anything, publishing under the user's identity, anything behind an account only they
   can open.
3. **That repo's real standards** — its testing story, its doc-update obligations, the invariants it
   holds and where the rationale is written down.
4. **How to verify, and: open NO PR if verification fails.** Revert, leave the tree clean, say what
   blocked it.
5. **That repo's actual commit style.** Read `git log`. An agent pattern-matches the last project it
   saw, so a repo using conventional prefixes and one using plain sentences will get crossed.
6. **Open a PR into the base branch. Never push to the base directly.**

### Three rules any unattended prompt needs

Each was paid for by a real failed run. They apply to A2 and to hosted agents equally.

- **Never offer a choice.** Nobody answers a question at 03:00. *"Which repositories should I
  include?"* does not fail — it **stalls**, and the run is over before anything happened. Give the
  parameter, or tell the agent to pick and say which it picked.

  ```
  BAD   Summarize the release notes. Which projects should I cover?
  GOOD  Summarize the release notes for A, B and C. If a change is ambiguous,
        include it and say why you were unsure.
  ```

- **Demand explicit failure reporting.** An agent that cannot finish a step **narrates success
  instead** — it will describe the digest it would have sent. End every prompt with: *"If any step
  fails, say so explicitly in your final message and name the step that failed, rather than
  summarizing what you would have produced."*

- **Watch for pasted gutter characters.** `▎`, `│`, box-drawing rules, zero-width spaces arrive by
  copying a prompt out of a terminal, a diff, or a chat bubble. The agent reads them as part of the
  instruction and chops it into fragments it ignores. **They are invisible in an editor.** Retype
  rather than paste.

One more that only looks like a prompt problem: **reach is a separate grant.** An instruction to
email, post or fetch is inert if the run has no tool or network access for it — and the run still
reports success. State what the job can touch before you schedule it.

---

## 5. One open PR at a time

Scheduled repo work is **serial**: each run picks "the next thing not done yet" by reading the work
list on the base branch. An open, unmerged PR is therefore **invisible** to the next run — which
branches from the base, reads a list missing the previous run's work, picks the same item, and
reimplements it.

So check by **branch prefix**, not by today's branch name:

| State | What the run should do |
|:---|:---|
| A PR is open with a head starting `<prefix>-` on the same base | **Adopt that branch.** Oldest open PR wins, so a backlog drains in order. Tell the agent, in the prompt, to commit on top and comment on the PR rather than create one. |
| Base moved under an adopted branch | Merge the base in **first**. A clean merge is silent. **A conflicting one is aborted, never resolved** — unattended conflict resolution is how a run quietly deletes someone's work — and the agent is told the branch is stale. |
| No such PR is open | Fresh branch from the base, stamped with today's date. |
| The branch name is taken on origin, unmerged, with no open PR (squash-merged or abandoned) | Nothing to append to: take a stamped branch of its own, `<prefix>-<date>_<hhmm>`. |

> Why the prefix and not the name: two runs a day apart both branched from `main` while the first PR
> sat unmerged, and each independently reimplemented the same item. The two PRs shared nine identical
> files and one had to be closed.

Whatever your runner does automatically, **say the rule in the prompt too** — a run that branches by
hand gets no help from the runner at all.

---

## 6. Reporting the outcome

An agent run has more outcomes than pass/fail, and collapsing them loses the useful ones:

| Status | Means |
|:---|:---|
| `shipped` | A PR exists. Carry the link. |
| `appended` | Commits pushed onto a routine PR that was already open. |
| `no-pr` | Commits, but no PR. **Say where the kept worktree is** — do not delete it. |
| `quiet` | Nothing on the work list was completable. A complete, successful run. |
| `failed` | The run threw. Carry the error and the last ~25 log lines. |

**Check the outcome yourself rather than taking the session's word for it.** On a fresh branch that
means asking whether a PR now exists; in append mode it means asking whether the **remote tip
moved**, because a PR listing would otherwise report the PR that was already open before the run
started.

`Invoke-ScheduledJob.ps1` hands a JSON payload to whatever command `job.json` names, so the transport
is yours — email, webhook, chat, a file. For email, the `html-email-templates` skill has templates
built to survive the clients that strip CSS.

**One notification gotcha worth stating:** if a filter decides which statuses are worth sending, make
sure it names statuses *this* job can actually produce. A filter listing another fleet's statuses
switches off the whole job's reporting and nothing complains — a bug that has shipped twice.

---

## 7. Verify an agent job

**Read the step list, not the status.** A session asked to research and email a report finishes
`completed` having called only `write_file`. No status anywhere can show that; the streamed NDJSON
transcript is the only place it is visible.

Then check the things the session does not control:

```powershell
gh pr list --repo <owner/name> --head <prefix>-<date>   # did a PR actually appear?
git -C <repo> log --oneline origin/<branch> -5          # in append mode, did the tip move?
```

A run that made commits but pushed nothing should **keep its worktree**, deliberately, for you to
look at. That is not litter — but it is not cleaned up for you either.

---

## 8. Anti-patterns

- **Omitting `--dangerously-skip-permissions`.** The session hangs at the first approval prompt.
- **The bypass without `--settings <deny file>`.** Every tool and MCP server becomes callable with
  nothing to stop a steered session. Pass the deny file every time, and fail when it's missing.
- **A prompt that doesn't say fetched content is data.** Anyone who can write an issue, a comment
  or a page the session reads can then write to the session.
- **Running the session in the real checkout.** That is what the worktree is for.
- **Copying a `prompt.md`.** See §4.
- **Resolving a merge conflict unattended.** Abort and tell a human.
- **Re-registering a task you had deliberately disabled.** `-Force` re-enables it; re-disable after.
- **Deleting the worktree on a `no-pr` run.** It is the only evidence of what the session did.
