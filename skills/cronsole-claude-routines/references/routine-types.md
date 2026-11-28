# Cloud routine types, and the prompt contract

> Four shapes cover almost everything worth scheduling in the cloud. Pick one, then write the prompt
> — which is the only artifact a cloud routine has.

---

## 1. The four types

### A. Drift check — "has the thing I documented moved?"

Compares two records that are supposed to agree, and opens a PR only when they do not. A docs-vs-code
check is the canonical case: the real surface against what the documentation claims.

- **Cheap by design.** The first job is to find out whether there is anything to do at all.
- **Name the two records by path**, and say **which one is authoritative** when they disagree. That
  direction is the whole decision, and an agent will otherwise pick the wrong one half the time.
- **A quiet week is a success.** Say so explicitly, or the agent invents a change to justify the run.

### B. Content batch — "produce N more of a thing"

Adds to a catalog, a library, a test suite, a set of examples.

- **Name the count and the quality bar.** "Add some templates" produces filler.
- **Name what already exists and how to check**, so the batch does not duplicate.
- **Name any build step the content needs.** Generated or content-addressed artifacts are the classic
  trap: editing the source without running the generator ships a PR that fails its own drift test.
- This type is where **"what does done look like"** matters most, because there is no natural stop.

### C. Refresh — "re-derive this from its source"

Rebuilds a derived artifact from an upstream that moves on its own — a link index, a generated page,
a dependency report.

- **The source must be reachable from the sandbox.** No local path, no VPN, no credential you have
  not granted.
- **A dead source is a failure, not an empty result.** Say that: an empty refresh and an unreachable
  source render identically, and only one of them is fine.
- Monthly usually suits this. Weekly over-fires.

### D. Scan — "go and look at the outside world"

Surveys something external and reports or files.

- **The loosest type and the easiest to get wrong.** It has no fixed input, so the prompt has to
  supply the taste: what counts as relevant, what to skip, how many.
- **Require it to say what it searched**, not only what it found. "Found nothing" and "looked at
  nothing" render identically, and that ambiguity hides real breakage.
- **Be willing to turn it off.** A scan producing PRs nobody merges is worse than no scan.

---

## 2. The prompt contract

Every cloud routine's prompt needs all eight. The first four are the unattended-agent rules; the last
four are what the cloud adds, because there is no runner to enforce anything.

| # | Must say | Because |
|:--|:---|:---|
| 1 | **No questions.** Give every parameter, or instruct the agent to choose and state its choice. | Nobody answers at 14:00 UTC. A question stalls the run; it does not fail it. |
| 2 | **Report failure explicitly and name the step.** | An agent that cannot finish narrates success instead. `completed` means the turn ended. |
| 3 | **How to verify, and: open NO PR if verification fails.** Revert, leave the tree clean, say what blocked it. | A PR failing its own repo's checks costs more attention than no PR. |
| 4 | **What to skip because it needs a human** — spending money, filing or signing anything, publishing under the user's identity, anything behind an account only they can open. | An unattended agent with a credential will use it. |
| 5 | **The exact branch name pattern**, e.g. `weekly-refresh-<date>`. | Nothing generates it for you, and whatever merges your PRs matches on the prefix. |
| 6 | **The one-open-PR rule, in full.** Check for an open PR on this prefix first; if one exists, commit onto that branch and comment rather than cutting a new one. | A local runner does this in code. A cloud routine only ever has prose. |
| 7 | **The repo's real standards** — its testing story, its doc-update obligations, its invariants and where the rationale lives, and its **actual commit style** (read `git log`). | An agent pattern-matches the last repo it saw, so a repo using conventional prefixes and one using plain sentences get crossed. |
| 8 | **What a quiet week looks like**, and that a quiet week is a complete, successful run. | Without it, a routine with nothing to do invents something. |

### Two invisible failures

- **Pasted gutter characters.** `▎`, `│`, box-drawing rules, zero-width spaces arrive by copying a
  prompt out of a terminal, a diff, or a chat bubble. The agent reads them as part of the instruction
  and chops it into fragments it ignores. **You cannot see them in the textarea.** Retype rather than
  paste.
- **Reach without a grant.** An instruction to email, post or fetch is inert if the routine has no
  tool or network access for it — and the run still reports `completed`. **Reach is the consequential
  half of an autonomous task**: state what the routine can touch before you create it, and grant only
  what the prompt actually needs.

---

## 3. Cadence and collisions

Cloud routines fire in **UTC**. Any local fleet you are staggering against runs in local time, so a
slot that looked safe moves twice a year — pick with an hour of margin rather than a minute.

Two scheduling rules that are not about load:

- **Land PRs before whatever reviews them, not after.** A routine whose PR arrives just after the
  weekly review waits a full week to be merged — and in the meantime it is the open PR that the
  *next* run adopts. Correct behaviour, confusing result.
- **One routine per repo per cadence.** Two routines opening PRs into the same repo on the same day
  will each read a work list missing the other's changes.

Monthly suits a refresh whose source moves slowly. Weekly suits a drift check. Daily is almost never
right for anything that opens a PR.

---

## 4. Creating, editing, retiring

```
/schedule                            # create, update, list, run once
RemoteTrigger {action: "list"}       # enumerate the fleet
```

`CronList` is **session-scoped** and shows nothing from a fresh session.

**Deleting is dashboard-only** — no Cronsole mode has a delete verb, verified by enumeration, and
`/schedule` cannot remove one either. Turning a routine **off** is the reversible move, and it is the
honest state for one whose output nobody has read in a while.

**Editing a prompt is editing the only artifact there is.** Copy the current text somewhere before
you change it: no local file, no git history, no version list behind it.

---

## 5. After it runs

1. **Read the step list, not the status.** A routine asked to research and file a report finishes
   `completed` having called only `write_file`. No status can show that.
2. **Check the PR exists, yourself**: `gh pr list --repo <owner/name> --head <prefix>`. In append mode
   check whether the **remote tip moved** instead — a PR listing would otherwise report the PR that
   was already open before the run started.
3. **Check whatever merges PRs will take it.** If the branch prefix, repo and base are not all on its
   list, the PR sits open forever and nothing mentions it.
4. **Read the held reasons.** A PR left open should carry, in a comment, the reason it was held.
