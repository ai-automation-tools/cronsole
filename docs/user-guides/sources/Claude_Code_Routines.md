<a id="claude-top"></a>

<h1 align="center">🤖 Claude Code Routines</h1>

<p align="center">
  <em>Prompts Anthropic runs on a schedule, in the cloud, against the repositories you attach.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-controller-D97757?style=for-the-badge" alt="Controller">
  <img src="https://img.shields.io/badge/status-experimental-F59E0B?style=for-the-badge" alt="Experimental">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

A routine is a prompt Anthropic runs for you on a schedule. Cronsole shows them beside your Windows
tasks and cron jobs, and — depending on your install — can create, pause and run them.

**This is the one source whose capabilities depend on your machine**, because there are two different
doors into it and Cronsole keeps both.

## 🚪 The two doors

| | **Signed in to the Claude Code CLI** on the machine running Cronsole | **Not signed in** |
|:---|:---|:---|
| Sync | Real: names, schedules, enabled state, next run | Returns the routines *you declared* |
| Create | Yes, including from a template | No — create at claude.ai, then connect |
| Enable / disable, edit schedule | Yes | No — do it at claude.ai |
| Run now | Yes, no token needed | Yes, using the routine's own API token |
| Delete | **Impossible either way** | **Impossible either way** |

The signed-in path uses the CLI's own OAuth session. **Cronsole reads it at the moment it needs it
and never stores or refreshes it** — refreshing would rotate the CLI's token and could sign you out
of Claude Code from a background poll. A task manager may not invalidate the login of the tool that
created it.

Nothing to configure for that path: run `/login` in Claude Code on the backend's machine, then sync.

## 🔌 Connecting a routine by hand

Use this when you are not signed in, or when the routine already exists at claude.ai.

1. **Get the token.** At claude.ai: the routine → **Edit** → **Add another trigger** → **API** →
   **Generate token**. Generating a new one revokes its predecessor.
2. **In Cronsole:** New Task → Claude, or the Claude panel on the Sources tab.
3. Paste the **routine id** and the **token**. A pasted fire URL works too — Cronsole normalizes it
   down to the `trig_` id.

Cronsole stores the token encrypted and never shows it again. **There is no reveal button**, because
claude.ai cannot re-display it either. Mistyped the id? Use **Edit** on the routine and the token is
kept.

> [!NOTE]
> **Shape mismatches warn rather than refuse.** This is an experimental API, so an unfamiliar id
> format is saved with a warning instead of being rejected by a rule written last month.

## 🎛️ What Cronsole can do here

**Signed in:** sync · run now · create · enable/disable · edit schedule, plus connect, edit and
disconnect the declaration.

**Not signed in:** run now and the declaration verbs. Create, enable/disable and edit-schedule show
as *Unsupported* on the Sources tab — that tab answering about **this install**, not about the
product. It is the one source where the capability row is a getter rather than a constant.

**Delete is impossible on both doors**, verified by enumeration rather than assumed. Cronsole can
pause a routine and forget it; removing it happens at claude.ai.

## 📄 Applying a template

Cronsole's catalog has a **Claude Routines** pack, and applying one creates a real routine.

Because the "command" is a prompt, the Apply screen says **Resolved prompt** and offers a
**Repositories** box. A routine with no repository still runs — it just has no checkout.

**Cronsole never guesses a repository for you.** A routine can commit, and the wrong repo is not a
mistake you can see before it happens.

## 🗑️ Removing one — Disconnect, not Remove

*Remove from Cronsole* is **refused** here, deliberately. On Windows, untracking means "don't
re-import this from the machine". There is no machine here — your list of routines is your own
declaration — so removing the row alone would leave the declaration in place and the next sync would
bring the task straight back while the removed-tasks table read empty. (If you hit that loop before
12 August 2026, that was exactly it:
[#47](../../troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole).)

**Disconnect routine** — in the task modal, or on the Sources tab — removes the declaration and the
tracked task together. Two things it also does, both stated in the confirmation:

- **It forgets the API token**, which claude.ai will not show you again. Reconnecting means
  generating a new one. That is precisely why this is a separate button: a control labelled *Remove
  from Cronsole* must not quietly spend a credential.
- **It changes nothing at claude.ai.** The routine still exists and still runs.

## ⚠️ Things that surprise people

- **Without a session, sync returns what you typed.** Nothing is fetched, so a routine deleted at
  claude.ai keeps listing until its next run fails.
- **The next-run time comes from Anthropic, not from the cron.** Routine runs carry a few minutes of
  scheduling jitter, so a locally computed time would disagree with claude.ai forever with nothing on
  screen to say which was right. With no session there is no schedule to show, and the card shows
  none rather than a guess.
- **Health comes from your syncs, not from a probe.** Without a session the only available endpoint
  *fires your routine* — a health check would eat your daily cap. With one, a read exists, but
  `getHealth` runs every 45 seconds per open tab. Sync is the probe, on every source.
- **This connector is experimental, specifically.** The documented endpoint is a research preview
  behind a dated beta header, and the API that makes create/list/pause possible is undocumented and
  beta-gated. If it changes, Cronsole falls back to the declared-routine path rather than breaking —
  which is why that path is kept rather than retired.

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| A Claude task keeps coming back after *Remove from Cronsole* | [#47](../../troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole) |
| Cronsole cannot list, pause or create routines | [#45](../../troubleshooting/README.md#45-cronsole-cant-list-pause-or-create-claude-code-routines) |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Cronsole_Native.md">Cronsole-native</a> ·
  <a href="Gemini_API_Triggers.md">Next: Gemini API Triggers →</a>
</p>

<p align="right">(<a href="#claude-top">back to top</a>)</p>
