<a id="ai-jobs-top"></a>

<h1 align="center">🤖 AI Agent Job Prompts</h1>

<p align="center">
  <em>Schedule a headless coding-agent run against a local repo — Claude Code, Codex, Gemini,
  opencode, Cursor, Aider — something that wakes at 3am, does one bounded job, and leaves a log.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Windows_Task_Scheduler-0078D4?style=for-the-badge" alt="Windows Task Scheduler">
  <img src="https://img.shields.io/badge/pack-AI_&_Agents-8B5CF6?style=for-the-badge" alt="AI and Agents pack">
  <img src="https://img.shields.io/badge/read_this-first-F59E0B?style=for-the-badge" alt="Read this first">
</p>

---

This is the sharpest thing in the prompt library. Everything else on this page schedules a
command; these schedule an **agent** — something that reads your repository, decides what to
do, and can be allowed to write and commit while nobody is watching.

The whole design is about fencing that in. Four properties make a headless CLI run safe enough
to schedule, and every prompt below asks for all four:

| Fence | Claude Code | Codex |
|:---|:---|:---|
| **Non-interactive** | `-p "<prompt>"` print mode | `exec` with `--ask-for-approval never` |
| **No permission prompts to nobody** | `--permission-mode dontAsk` | `--sandbox read-only` (or `workspace-write`) |
| **A tool allowlist** | `--allowedTools 'Read,Grep,Glob'` | the sandbox mode is the fence |
| **Captured output** | `--bare *> 'C:\logs\run.log'` | `-o summary.md` plus `*> log` |

A run that skips any of these either hangs forever waiting for a prompt nobody will answer, or
does more than you meant to a repo you care about.

Those two columns are the CLIs Cronsole ships templates for. For Gemini CLI, opencode, Cursor,
Antigravity and Aider — where the fence sits somewhere else, or nowhere — skip to
[**one prompt per CLI**](#-one-prompt-per-cli).

> [!TIP]
> **Start read-only and promote later.** Run a digest job for a week before you let the same
> agent commit. The prompt that reads your repo and writes a Markdown summary tells you almost
> everything about whether the write-enabled version would have behaved.

## 📚 The easy path: apply a template

Seven catalog templates already encode the fencing. Applying one is a single prompt, and the
parameters are the parts that are actually yours — repo path, prompt, log path.

```text
Using Cronsole, list the templates in the AI & Agents pack and tell me which ones
run a coding agent against a local repo, and which of those can write.
```

```text
Using Cronsole, apply the "Claude Code Repo Digest" template to
D:\AI_Agents\Projects\my-app. Run it Mondays at 7am Pacific, write the digest to
C:\reports\my-app-digest.md, and keep the read-only tool allowlist as it is.
```

```text
Using Cronsole, apply the "Codex Headless Run" template against
D:\work\api-service with the sandbox set to read-only. Prompt it to list every
TODO older than a month with file and line. Output to C:\reports\api-todos.md,
weekly on Friday afternoon Pacific.
```

Templates worth knowing by name:

| Template | What it does | Writes? |
|:---|:---|:---|
| **Claude Code Headless Run** | One fixed prompt against one repo, tools you list, output to a log. | Only if you allow it |
| **Claude Code Repo Digest** | Summarizes a repo to Markdown. Tools locked to `Read,Grep,Glob`. | No |
| **Claude Code Auto-Fix & Commit** | Edits and commits, with scoped `Bash(git commit *)` style tools. | **Yes** |
| **Codex Headless Run** | `codex exec` with an explicit sandbox, ephemeral, no color. | Sandbox decides |
| **Codex Repo Digest** | Read-only sandbox, summary to a file. | No |
| **Codex Auto-Fix Workspace** | `--sandbox workspace-write`. | **Yes** |
| **Claude Code Log Cleanup** | Deletes the run logs the above pile up. | Logs only |

## 🔁 Update a local repo on a schedule

The job most people want first: keep a checkout current, then have an agent do something to it.
Split it into two tasks rather than one clever command — the pull can fail for reasons that
have nothing to do with the agent, and you want to see which half broke.

**Step one, the pull.** A fast-forward-only pull never rewrites anything you have locally:

```text
Using Cronsole, create a Cronsole-native task called "Pull my-app" that runs
git -C "D:\AI_Agents\Projects\my-app" pull --ff-only every six hours. I want the
real exit code in the history, so use the native script path, not Windows.
```

**Step two, the agent.** Now schedule the headless run against that same checkout:

```text
Use the Cronsole MCP server to create a Windows task named "my-app nightly fix"
that runs Claude Code headlessly against D:\AI_Agents\Projects\my-app at 3am
Pacific.

The command should Set-Location to the repo, then run claude in print mode with
--permission-mode dontAsk, a scoped allowlist of
Read,Edit,Write,Grep,Glob,Bash(git add *),Bash(git commit *),Bash(git status *),Bash(git diff *)
--max-turns 10, --model sonnet, --bare, and capture everything to
C:\logs\my-app-fix.log.

The prompt: fix lint and type errors, run the test suite, and commit only if it
passes. Do not touch anything outside src/, and do not push.

Check the schedule conversion first and show me the exact command before you
create it.
```

Two things in that prompt do most of the work. **`Bash(git commit *)` rather than a bare
`Bash`** means the agent can commit and cannot run arbitrary shell. And **"do not push"** keeps
a bad night local, where `git reset` fixes it.

The equivalent with Codex, which fences by sandbox rather than by allowlist:

```text
Using Cronsole, create a Windows task "api-service autofix" that runs
codex --ask-for-approval never exec --sandbox workspace-write --ephemeral
--color never against D:\work\api-service at 4am Pacific, writes its summary to
C:\reports\api-autofix.md and its log to C:\logs\api-autofix.log. Prompt: repair
failing tests without changing public API signatures. Show me the full command
line before creating it.
```

**Step three, the cleanup.** Logs from a nightly run add up:

```text
Using Cronsole, apply the "Claude Code Log Cleanup" template to C:\logs so
anything matching *.log older than 30 days is deleted weekly on Sunday morning.
```

## 🧰 One prompt per CLI

Every agentic CLI has a headless mode; they differ in **where the fence lives**. Claude Code
fences per tool, Codex fences with a sandbox, and several fence with nothing at all — their only
non-interactive mode is "approve everything", which moves the whole burden onto *what the agent
can reach*.

| CLI | Non-interactive shape | Where the fence is | Verified in Cronsole? |
|:---|:---|:---|:---|
| **Claude Code** | `claude -p` | `--permission-mode dontAsk` + `--allowedTools` | Yes — 4 templates |
| **Codex** | `codex exec --ask-for-approval never` | `--sandbox read-only` / `workspace-write` | Yes — 3 templates |
| **Gemini CLI** | `gemini -p` | approval mode; no per-tool allowlist | No |
| **opencode** | `opencode run` | model/agent config, not flags | No |
| **Cursor CLI** | `cursor-agent -p` | approval flags | No |
| **Antigravity** | agent-first IDE — headless support varies by version | unclear; check before scheduling | No |
| **Aider** | `aider --message --yes-always` | git — it commits every change | No |

> [!IMPORTANT]
> Only the first two are backed by templates whose invocation Cronsole verified against the
> CLI's own docs. **For the rest, make the assistant read `--help` before it writes the command
> line** — every prompt below asks it to. A flag that was renamed between versions turns a
> scheduled run into a process that either exits immediately or sits forever waiting for input
> nobody will give it, and you find out days later from an empty log.

### Claude Code

Fences per tool, which is the finest-grained control of the group. Scope `Bash` or don't include
it.

```text
Using Cronsole, create a Windows task "my-app digest" that runs Claude Code
headlessly against D:\AI_Agents\Projects\my-app every Monday at 7am Pacific:
print mode, --permission-mode dontAsk, --allowedTools 'Read,Grep,Glob',
--max-turns 8, --model sonnet, --bare, output captured to
C:\reports\my-app-digest.md. Prompt: summarize notable changes, open TODOs, and
anything risky.
```

### Codex

Fences by sandbox rather than by tool list. `read-only` is the safe default; `workspace-write`
confines writes to the working directory.

```text
Using Cronsole, create a Windows task "api-service review" that runs
codex --ask-for-approval never exec --sandbox read-only --ephemeral --color never
-C D:\work\api-service -o C:\reports\api-review.md, with the log at
C:\logs\api-review.log, every weekday at 6am Pacific. Prompt: list anything in
the diff since yesterday that looks like a regression. Read-only — the sandbox is
the fence, so don't add write permissions.
```

### Gemini CLI

Non-interactive via a prompt flag, with an approval mode rather than a tool allowlist. That
means the fence has to be the checkout, not the flags.

```text
Using Cronsole, I want a scheduled Gemini CLI run against D:\work\reports-tool.
First check `gemini --help` and tell me the exact non-interactive prompt flag and
approval-mode flag on my installed version — don't guess. Then create a Windows
task for 7am Pacific daily that runs it read-only, captures output to
C:\reports\gemini-daily.md, and a log to C:\logs\gemini-daily.log.
```

### opencode

Runs a prompt non-interactively through its `run` subcommand. Permissions come from its config
rather than the command line, so check what the config allows before scheduling it.

```text
Using Cronsole, set up a nightly opencode run against D:\work\my-service at 2am
Pacific. Check `opencode --help` first for the correct non-interactive subcommand
and model flag on my version, and tell me where opencode's permission config
lives — I want to know what it's allowed to do before this runs unattended.
Capture output to C:\logs\opencode-nightly.log.
```

### Cursor CLI

`cursor-agent` runs headlessly with a print flag. Confirm the output format flag, because the
default may be a stream designed for a terminal rather than a file.

```text
Using Cronsole, create a weekly Windows task that runs the Cursor CLI headlessly
against D:\work\web-app on Friday afternoons Pacific. Check `cursor-agent --help`
for the print/non-interactive flag and the plain-text output format on my
version. Prompt: list components with no test coverage. Output to
C:\reports\cursor-coverage.md.
```

### Antigravity

Antigravity is agent-first as an **IDE**, and whether the installed version exposes a usable
headless entry point varies. Establish that before scheduling anything, rather than discovering
at 3am that the task launched a window on a logged-out session.

```text
Using Cronsole, I want to schedule an Antigravity agent run against
D:\work\my-app. Before creating anything: check whether my installed Antigravity
has a headless or CLI mode that runs a prompt without opening the editor, and
tell me plainly if it doesn't. If it does, create a Windows task for 4am Pacific
with output captured to a log. If it doesn't, say so and suggest the closest
thing that does work headlessly.
```

> [!WARNING]
> A GUI-first tool scheduled as a Windows task is a specific trap: Task Scheduler will happily
> run it with no desktop session, and it hangs or dies silently. If a tool has no documented
> headless mode, the honest answer is that it isn't schedulable yet — not that it needs a
> cleverer command line.

### Aider

Its fence is git: it commits every change it makes, so a bad run is one `git reset` away rather
than a mystery. That makes it unusually safe to schedule on a scratch branch and unusually noisy
on a shared one.

```text
Using Cronsole, create a nightly Windows task that runs aider against
D:\work\my-app in message mode with auto-confirm and streaming off — check
`aider --help` for the exact flags on my version. It should work on a branch
called nightly-agent, never main. Prompt: fix failing tests without changing
public APIs. Log to C:\logs\aider-nightly.log.
```

### Any CLI, when you don't know the flags

```text
Using Cronsole, I want to schedule <tool> against D:\work\my-app. Work out its
headless invocation from `<tool> --help` first — the non-interactive flag, how
approvals are suppressed, how output is captured — and show me the full command
line before creating the task. If it has no way to run without a prompt, tell me
rather than working around it.
```

### The auto-approve tradeoff

Three of these tools have no per-tool allowlist, so their headless mode is effectively
"approve everything". That's not automatically wrong — it's the same bargain as any cron job —
but it relocates the fence:

- **Point it at a scratch checkout**, not your working tree. A clone the agent owns is cheap.
- **Put it on a branch it can't damage anything from**, and never let a scheduled prompt push.
- **Give it a read-only job** unless you have a specific reason not to. Most useful agent jobs
  are digests, audits and triage, none of which need write access.
- **Keep the log.** With no allowlist, the log is the only record of what it decided to do.

## 🔍 Read-only agent jobs

These are the ones worth scheduling without hesitation.

```text
Using Cronsole, schedule a weekly Claude Code run that reads
D:\AI_Agents\Projects\my-app and writes a Markdown digest of notable changes,
open TODOs, and anything that looks risky. Read-only tools only — Read, Grep,
Glob and nothing else. Mondays at 7am Pacific.
```

```text
Using Cronsole, create a daily headless Claude run that checks my repo's
documentation against the code it describes and writes every stale claim, with
file and line, to C:\reports\docs-drift.md. It must not edit anything.
```

```text
Using Cronsole, schedule a Codex read-only run every Friday that lists the ten
largest files in D:\work\api-service, flags any that mix more than one concern,
and writes the result to a report file. Nothing else.
```

## ☁️ The cloud alternative

A headless CLI run happens on **your machine**, with your checkout and your credentials. A
[**Claude Code routine**](claude-routines.md) is the same idea running in Anthropic's sandbox
against a repository URL — no agent, no local paths, and it keeps running when your machine is
asleep.

Reach for a routine when the job is about a repo on GitHub and doesn't need anything local.
Reach for a headless CLI task when the work touches a path only your machine has.

```text
Using Cronsole, I want a nightly dependency review of https://github.com/me/my-app.
Tell me whether this install can create a Claude routine, and if it can, create
one rather than a local headless task — the repo is on GitHub and nothing about
this needs my machine.
```

## 🛑 Things worth refusing

Ask your assistant to push back on these, and be suspicious if it doesn't.

- **A bare `Bash` in the allowlist.** That's not a fence, it's a shell.
- **`--dangerously-skip-permissions`** or any flag that removes the sandbox. If the fenced
  version can't do the job, the job needs redesigning, not the fence removing.
- **A blanket auto-approve flag on a tool that *has* a finer control.** On Claude Code or Codex
  that's throwing away the fence; on a CLI with no allowlist it's the only headless mode there
  is, and the fence has to come from the checkout instead.
- **A guessed flag on a CLI nobody checked.** `--help` costs one command and settles it.
- **A write-enabled run with no log path.** The log is the only account you'll have of what it
  did at 3am.
- **`git push` in a scheduled prompt.** A local mistake is recoverable; a pushed one involves
  other people.
- **A prompt containing single quotes** — the PowerShell wrapper carries the prompt as a
  single-quoted string, so an apostrophe closes it early and the command fails in a way that
  looks like the agent misbehaved.

```text
Using Cronsole, review the task "my-app nightly fix" — show me its exact command
and tell me honestly whether the tool allowlist is narrow enough for something
that runs unattended and can commit.
```

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**🪟 Windows task prompts**](windows-tasks.md) | The general form of what these are — folders, conversion, no-shell. |
| [**🧠 Claude routines**](claude-routines.md) | The same jobs in Anthropic's cloud, against a repo URL. |
| [**📄 Templates**](templates.md) | Browsing and applying the catalog these draw on. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Confirming the 3am run did what the log claims. |
| [**📦 Template catalog spec**](../../reports/templates/README.md) | Where the AI & Agents pack is defined. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="windows-tasks.md">Windows tasks</a> ·
  <a href="claude-routines.md">Next: Claude routines →</a>
</p>

<p align="right">(<a href="#ai-jobs-top">back to top</a>)</p>
