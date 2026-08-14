<a id="routines-top"></a>

<h1 align="center">🧠 Claude Routine Prompts</h1>

<p align="center">
  <em>Create, connect, and manage Claude Code routines — scheduled agent runs in Anthropic's
  cloud — from the same dashboard as everything else.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Claude_Code-8B5CF6?style=for-the-badge" alt="Claude Code">
  <img src="https://img.shields.io/badge/runs_on-Anthropic's_cloud-0078D4?style=for-the-badge" alt="Runs on Anthropic's cloud">
</p>

---

A routine is a saved prompt Anthropic runs on a schedule in a cloud sandbox. No agent, no local
paths, and it fires whether or not your machine is on. What Cronsole can do with routines
depends on which of two doors this install can reach, so **start every session here**:

```text
Using Cronsole, check the Claude connection — which API mode is available, and
what does that let me do? Tell me plainly whether I can create routines from
here or only fire ones I've connected.
```

| `session.mode` | What it means | What works |
|:---|:---|:---|
| **`oauth`** | The backend can read your Claude Code session, because you signed in with the `claude` CLI on that machine | Create, list, reschedule, pause and run — routines behave like any other platform |
| **`declared`** | No readable session | Only routines you've connected with a per-routine token, and only firing them |

If it says `declared` and you wanted `oauth`, the fix is a `/login` in the Claude Code CLI **on
the machine running the Cronsole backend** — not on whichever machine you happen to be reading
this from.

## ✨ Create a routine

```text
Using Cronsole, create a Claude routine called "Nightly dependency audit" that
runs at 5am UTC daily against https://github.com/me/my-app. The prompt: check
for dependencies with known advisories or more than two majors behind, and write
a short report ranked by risk. Report only — do not open PRs or change anything.
```

```text
Using Cronsole, create a routine that triages new issues on
https://github.com/me/my-app every weekday morning: label them, spot duplicates,
and summarize anything that looks like a regression. It should stop and report
rather than close anything.
```

```text
Using Cronsole, create a weekly routine that compares the docs under docs/ in
https://github.com/me/my-app against the code they describe, and lists every
claim that's no longer true with the file and line that contradicts it. Friday
afternoons.
```

```text
Using Cronsole, list the Claude routine templates in the catalog and apply the
CI failure digest one to my repo, scheduled for weekday mornings.
```

Three things about creating one, all of which your assistant should tell you unprompted:

- **The prompt is the whole context.** A routine starts with nothing but that text and the
  repositories you attach. "Fix the build" means less to a cold agent than it does to you.
- **Repositories are attached deliberately, never guessed.** A routine with none still runs; a
  routine pointed at the wrong repo by an assistant filling in a blank is a bad afternoon.
- **The schedule is UTC cron and passes straight through.** No conversion, so nothing can be
  lossy. Anthropic adds a few minutes of its own jitter to the actual fire time, which is why
  the dashboard shows the platform's next-run time rather than recomputing one.

> [!NOTE]
> A routine created this way arrives with **no MCP connectors attached**, on purpose. You add
> those at claude.ai per routine — so a routine made from one sentence never quietly ends up
> holding your mailbox.

## 🔌 Connect a routine you made at claude.ai

In `declared` mode this is the only way a routine reaches Cronsole. Anthropic mints a token
**per routine** and shows it exactly once.

```text
Using Cronsole, connect the Claude routine with id <routine-id> and the token I'm
about to paste, named "Morning digest". Then sync so it appears on the dashboard.
```

```text
Using Cronsole, I typed the routine id wrong when I connected "Morning digest".
Fix the id to <correct-id> — keep the token, I can't get it again.
```

That second prompt is `edit_claude_routine`, and it exists precisely because claude.ai won't
re-show a token. Correcting a typo must not cost you the credential.

## ▶️ Run and manage

```text
Using Cronsole, run my "Nightly dependency audit" routine now so I can see what
it produces without waiting for 5am.
```

```text
Using Cronsole, pause the "Issue triage" routine — I'm on holiday and I don't
want the daily run burning cap. Don't remove it.
```

```text
Using Cronsole, move my docs-drift routine from Friday to Monday morning UTC.
```

```text
Using Cronsole, sync my Claude tasks and show me every routine on the account
with its schedule and next run — I want to know what's actually there, not what
Cronsole thinks is there.
```

Routines draw on the account's Claude Code usage and its **daily run cap**. Pausing is the
honest way to stop one; encoding "don't run" into the cron is how you end up with a schedule
nobody can read six months later.

## 🚪 Getting one off the dashboard

Three verbs, and they're easy to confuse:

| You want to… | Ask for | What happens |
|:---|:---|:---|
| Stop it running for now | **Pause / disable** | The routine stays, does nothing, restarts with one prompt |
| Take it off Cronsole entirely | **Disconnect** | The declaration and its tracked tasks go; the routine keeps running at claude.ai |
| Destroy the routine | **Nothing here can** | Neither Claude API exposes a delete — do it at claude.ai |

```text
Using Cronsole, disconnect the routine "Morning digest" — take it off my
dashboard. I understand the routine keeps running at claude.ai and that the
stored token is gone for good.
```

```text
Using Cronsole, get "Issue triage" off my dashboard. Warn me first about what
disconnecting discards versus what pausing would do.
```

> [!IMPORTANT]
> **Untrack doesn't work on Claude tasks, and that's a refusal rather than a gap.** For Windows,
> untrack means "forget this, the machine still has it" — the machine is the source of truth.
> For Claude in declared mode there is no list endpoint, so your own declaration *is* the
> platform. Untracking would fence your config off from itself, and the next import would bring
> the task straight back. Disconnect is the verb, and it says out loud that it's spending a
> token you can't get again.

## 🆚 Routine or headless CLI run?

Both schedule a coding agent. They differ in where the work happens.

| | Claude routine | [Headless CLI task](ai-agent-jobs.md) |
|:---|:---|:---|
| **Runs on** | Anthropic's sandbox | Your machine, via Task Scheduler |
| **Sees** | Repository URLs you attach | Any local path, your tools, your credentials |
| **Needs** | A Claude Code session or a routine token | The local agent, and the CLI installed |
| **When your machine is off** | Still runs | Doesn't |
| **Best for** | Repo hygiene, triage, digests on GitHub | Anything touching a path only your machine has |

```text
Using Cronsole, I want a nightly job that reviews my repo for dependency drift.
The repo is on GitHub and nothing about this needs my machine — tell me whether
a routine or a local headless task is the right shape, then create it.
```

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🤖 AI agent jobs**](ai-agent-jobs.md) | The local equivalent — headless Claude Code and Codex on Task Scheduler. |
| [**🧹 Cleanup & removal**](cleanup-and-removal.md) | Disconnect in context, next to untrack and delete. |
| [**🧯 Troubleshooting #47**](../../troubleshooting/README.md) | Why a Claude task kept coming back after "remove from Cronsole". |
| [**🖥️ UI User Guide**](../../user-guides/guides/UI_User_Guide.md) | The same operations in the dashboard. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="ai-agent-jobs.md">AI agent jobs</a> ·
  <a href="templates.md">Next: Templates →</a>
</p>

<p align="right">(<a href="#routines-top">back to top</a>)</p>
