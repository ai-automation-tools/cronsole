<a id="claude-top"></a>

<h1 align="center">🤖 Claude Code Scheduled Tasks</h1>

<p align="center">
  <em>Prompts Anthropic runs on a schedule, in the cloud, against the repositories you attach.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-controller-D97757?style=for-the-badge" alt="Controller">
  <img src="https://img.shields.io/badge/status-experimental-F59E0B?style=for-the-badge" alt="Experimental">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

A Claude Code scheduled task (formerly a routine) is a prompt Anthropic runs for you on a schedule.
Cronsole shows them beside your Windows tasks and cron jobs, and — depending on your install — can create, pause and run them.

**This is the one source whose capabilities depend on your machine**, because there are two different
doors into it and Cronsole keeps both.

---

## 🎯 Best for

Agent work on **a repository** that should happen whether or not your machine is on.

| Automation | Why it belongs here |
|:---|:---|
| Reviewing and triaging open pull requests | It gets a fresh checkout and runs in Anthropic's cloud, with no machine of yours involved. |
| Dependency bumps, changelog and docs tidying, opened as a PR | Repository work an agent can do alone. |
| A weekly roadmap or status write-up from a repository's history | It reads the repository and writes the summary. |
| Anything that must run while your PC is off or asleep | Nothing local is involved. |

---

## 🧰 Capabilities at a glance

✅ yes · ⚠️ with a condition · ❌ no · — does not apply

| | Can it? | Details |
|:---|:---:|:---|
| **Where it runs** | ✅ | Anthropic's cloud, against the repositories you attach. |
| **Runs while Cronsole is off** | ✅ | Cronsole only reads and controls it. |
| **Setup** | ⚠️ | Full control needs the Claude Code CLI signed in on the machine running Cronsole. Otherwise each task is connected by hand with its own API token. See [The two doors](#-the-two-doors). |
| **Schedules** | ⚠️ | Read and edited from Cronsole only when signed in. |
| **Sync** | ⚠️ | Signed in: everything on the account. Not signed in: only the tasks you connected. |
| **Run now** | ✅ | On both doors. |
| **Create** | ⚠️ | Signed in only, including from a template. Otherwise create at claude.ai and connect it. |
| **Enable / disable** | ⚠️ | Signed in only. |
| **Edit schedule** | ⚠️ | Signed in only. |
| **Edit what it runs** | ❌ | Change the prompt at claude.ai. |
| **Delete** | ❌ | Impossible on both doors, verified by enumeration. Pause it here; delete it at claude.ai. |
| **Run history** | ❌ | Cronsole can start a run but cannot read one. |
| **Health** | ⚠️ | From syncs only. A probe would fire the task and use up its daily cap. |
| **Credentials** | ✅ | A connected task's token is stored encrypted and never shown again. The CLI's login is read when needed and never stored or refreshed. |
| **Templates** | ✅ | [Gallery: Claude Code templates](https://cronsole.ai-automation-tools.dev/#/browse?target=claude-code). |

This is the one source whose row on the Sources tab depends on **your install**: signed out, Create, Enable / disable and Edit schedule read *Unsupported* for this machine, not for the product.

---

## 🚫 When to use something else

| 🚫 Use something else for | Instead |
|:---|:---|
| A fixed command or script | [Cronsole-native](Cronsole_Native.md) or [Windows Task Scheduler](Windows_Task_Scheduler.md). Exact, cheaper, and the output is recorded. |
| Anything that needs files on your machine | [Windows Task Scheduler](Windows_Task_Scheduler.md). A scheduled task sees only its checkout. |
| Reading why a run failed, inside Cronsole | [Gemini API Triggers](Gemini_API_Triggers.md), if the job fits there. Cronsole can fire a scheduled task but cannot read its runs. |


---

## 🚪 The two doors

| | **Signed in to the Claude Code CLI** on the machine running Cronsole | **Not signed in** |
|:---|:---|:---|
| Sync | Real: names, schedules, enabled state, next run | Returns the scheduled tasks *you declared* |
| Create | Yes, including from a template | No — create at claude.ai, then connect |
| Enable / disable, edit schedule | Yes | No — do it at claude.ai |
| Run now | Yes, no token needed | Yes, using the scheduled task's own API token |
| Delete | **Impossible either way** | **Impossible either way** |

The signed-in path uses the CLI's own OAuth session. **Cronsole reads it at the moment it needs it
and never stores or refreshes it** — refreshing would rotate the CLI's token and could sign you out
of Claude Code from a background poll. A task manager may not invalidate the login of the tool that
created it.

Nothing to configure for that path: run `/login` in Claude Code on the backend's machine, then sync.

---

## 🔌 Connecting a scheduled task by hand

Use this when you are not signed in, or when the scheduled task already exists at claude.ai.

1. **Get the token.** At claude.ai: the scheduled task → **Edit** → **Add another trigger** → **API** →
   **Generate token**. Generating a new one revokes its predecessor.
2. **In Cronsole:** New Task → Claude, or the Claude panel on the Sources tab.
3. Paste the **scheduled task id** and the **token**. A pasted fire URL works too — Cronsole normalizes it
   down to the `trig_` id.

Cronsole stores the token encrypted and never shows it again. **There is no reveal button**, because
claude.ai cannot re-display it either. Mistyped the id? Use **Edit** on the task and the token is
kept.

> [!NOTE]
> **Shape mismatches warn rather than refuse.** This is an experimental API, so an unfamiliar id
> format is saved with a warning instead of being rejected by a rule written last month.

---

## 📄 Applying a template

Cronsole's catalog has a **Claude Scheduled Tasks** pack, and applying one creates a real scheduled task.

Because the "command" is a prompt, the Apply screen says **Resolved prompt** and offers a
**Repositories** box. A scheduled task with no repository still runs — it just has no checkout.

**Cronsole never guesses a repository for you.** A scheduled task can commit, and the wrong repo is not a
mistake you can see before it happens.

---

## 🗑️ Removing one — Disconnect, not Remove

*Remove from Cronsole* is **refused** here, deliberately. On Windows, untracking means "don't
re-import this from the machine". There is no machine here — your list of scheduled tasks is your own
declaration — so removing the row alone would leave the declaration in place and the next sync would
bring the task straight back while the removed-tasks table read empty. (If you hit that loop before
12 August 2026, that was exactly it:
[#47](../../troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole).)

**Disconnect scheduled task** — in the task modal, or on the Sources tab — removes the declaration and the
tracked task together. Two things it also does, both stated in the confirmation:

- **It forgets the API token**, which claude.ai will not show you again. Reconnecting means
  generating a new one. That is precisely why this is a separate button: a control labelled *Remove
  from Cronsole* must not quietly spend a credential.
- **It changes nothing at claude.ai.** The scheduled task still exists and still runs.

This applies to a scheduled task you **connected by hand**. One Cronsole found through your signed-in
CLI session has no declaration behind it, so *Remove from Cronsole* works on it like on any other
source, and that is how you clear one whose scheduled task was deleted at claude.ai.

---

## ⚠️ Things that surprise people

> [!NOTE]
> **These used to be called routines.** Anthropic renamed them "scheduled tasks", and Cronsole now
> uses the new name too. A few things still say `routine` because Anthropic's own surface does
> (`claude.ai/code/routines`) or because renaming would break callers: the MCP tools keep their names
> (`create_claude_routine`, `connect_claude_routine` and the rest).

- **Without a session, sync returns what you typed.** Nothing is fetched, so a scheduled task deleted at
  claude.ai keeps listing until its next run fails.
- **The next-run time comes from Anthropic, not from the cron.** Scheduled runs carry a few minutes of
  scheduling jitter, so a locally computed time would disagree with claude.ai forever with nothing on
  screen to say which was right. With no session there is no schedule to show, and the card shows
  none rather than a guess.
- **Health comes from your syncs, not from a probe.** Without a session the only available endpoint
  *fires your scheduled task* — a health check would eat your daily cap. With one, a read exists, but
  `getHealth` runs every 45 seconds per open tab. Sync is the probe, on every source.
- **This connector is experimental, specifically.** The documented endpoint is a research preview
  behind a dated beta header, and the API that makes create/list/pause possible is undocumented and
  beta-gated. If it changes, Cronsole falls back to the declared-task path rather than breaking —
  which is why that path is kept rather than retired.

---

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| A Claude task keeps coming back after *Remove from Cronsole* | [#47](../../troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole) |
| Cronsole cannot list, pause or create scheduled tasks | [#45](../../troubleshooting/README.md#45-cronsole-cant-list-pause-or-create-claude-code-routines) |

---

## 📦 Templates

| Where | What you get |
|:---|:---|
| [**🌐 Gallery: Claude Code templates**](https://cronsole.ai-automation-tools.dev/#/browse?target=claude-code) | The public catalog, already filtered to this source. |
| **In the app** | **Templates** tab, then **Apply** and pick *Claude Code*. Needs the signed-in door above. |

---

## 🔗 Official docs

| Resource | What it covers |
|:---|:---|
| [**claude.ai/code/routines**](https://claude.ai/code/routines) | Where scheduled tasks are created, edited and deleted. Sign-in required. |
| [**Scheduled tasks docs**](https://code.claude.com/docs/en/routines) | Triggers (schedule, API, GitHub), plans, and the API token. |
| [**Introducing routines in Claude Code**](https://claude.com/resources/articles/introducing-routines-in-claude-code) | Anthropic's launch article. |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Windows_Task_Scheduler.md">Windows Task Scheduler</a> ·
  <a href="Gemini_API_Triggers.md">Next: Gemini API Triggers →</a>
</p>

<p align="right">(<a href="#claude-top">back to top</a>)</p>
