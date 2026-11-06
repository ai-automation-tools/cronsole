<a id="sources-top"></a>

<h1 align="center">🔌 Sources</h1>

<p align="center">
  <em>Where your tasks come from: every source Cronsole supports, what it can do with each, and
  one document per source for the detail.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/sources-7-8B5CF6?style=for-the-badge" alt="Seven sources">
  <img src="https://img.shields.io/badge/shapes-controller_·_observer_·_quick_link-0078D4?style=for-the-badge" alt="Controllers, observers and quick links">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-user_guides-6B7280?style=for-the-badge" alt="User guides"></a>
</p>

---

Cronsole shows tasks from more than one system, and those systems are not the same shape. A Windows
task lives on your machine and keeps running whether or not Cronsole is up. A Cronsole-native task
*is* a row in Cronsole's database. Claude, Gemini and n8n are somebody else's service that Cronsole
can act on, and GitHub Actions and Vercel Cron are services Cronsole can only *watch*.

This page compares them and covers what is true of all of them. **Each source has its own document**
for the rest: how to connect it, what each capability actually does, the traps, and where to go when
it misbehaves. Every card on the Sources tab links straight to its own.

> **Where to find this in the app:** the **Sources** section of the sidebar lists one row per
> source you have, with **Explore sources** and **Manage sources** beneath it. The **Sources**
> tab shows the same systems from the other direction, in three views (**Connected**,
> **Available** and **Quick links**), covering what each one is capable of, what has been
> *proven* to work on your machine, and everything you have not added yet.

---

## 📋 Every source

| Source | Shape | Where the work runs | What a failed run shows in Cronsole | Templates |
|:---|:---|:---|:---|:---|
| [**⚡ Cronsole-native**](Cronsole_Native.md) | Controller | Inside Cronsole, wherever the backend runs. Four job types: HTTP, Programs, Scripts and Checks | The job's own output, with any `${secret.NAME}` values stripped out | [Browse](https://cronsole.ai-automation-tools.dev/#/browse?target=cronsole-native) |
| [**🪟 Windows Task Scheduler**](Windows_Task_Scheduler.md) | Controller | Your machine, through the local agent. The only source that keeps running when Cronsole is off | Task Scheduler's own messages, the exit code and the action that produced it | [Browse](https://cronsole.ai-automation-tools.dev/#/browse?target=windows) |
| [**🤖 Claude Code Routines**](Claude_Code_Routines.md) | Controller | Anthropic's cloud. What Cronsole can do depends on your install, because there are two doors in | No run history: Cronsole can fire a routine but cannot read its runs | [Browse](https://cronsole.ai-automation-tools.dev/#/browse?target=claude-code) |
| [**✨ Gemini API Triggers**](Gemini_API_Triggers.md) | Controller | Google's cloud, on its own agents | The agent's full output and every tool it used. Google has no page for this, so Cronsole is the only place to read it | [Browse](https://cronsole.ai-automation-tools.dev/#/browse?target=gemini) |
| [**🔀 n8n**](n8n.md) | Controller (*Run now* only) | Your n8n instance. The one source that needs you to state its time zone, because its API does not | The nodes that ran, where it stopped, n8n's error message and a link to the execution | None: Cronsole does not create tasks here |
| [**🐙 GitHub Actions**](GitHub_Actions.md) | Observer | GitHub, for every workflow with an `on: schedule` trigger in the repositories you watch | The failing step by name, plus a link to github.com for the raw log | None: Cronsole does not create tasks here |
| [**▲ Vercel Cron**](Vercel_Cron.md) | Observer | Vercel, for the cron jobs your projects declare | Nothing. Vercel publishes no cron run history, so the section is absent rather than empty | None: Cronsole does not create tasks here |

**Controller** means Cronsole can change something there: run, pause, edit or delete, as far as the
platform allows. **Observer** means Cronsole reads and changes nothing. That is the design in both
cases, not an unfinished first version: each observer refuses the same three verbs by different
routes, and its document says which. ChatGPT Tasks, Grok, Jules and the rest are
[quick links](#-quick-links--schedulers-with-no-connector), not sources.


---

## 🧭 Which source should a new task go in?

Most new tasks land in one of the first two, and the deciding question is whether the job has to run
while Cronsole is down.

| If the job… | Put it in | Because |
|:---|:---|:---|
| Calls a URL, checks something, or runs a short script, and only matters while Cronsole is up | [**⚡ Cronsole-native**](Cronsole_Native.md) | Nothing to install, every run logged with its output, secrets redacted. |
| Must run while Cronsole is off, as your Windows user, or for longer than an hour | [**🪟 Windows Task Scheduler**](Windows_Task_Scheduler.md) | It is Windows' own scheduler. Cronsole only manages the entries. |
| Is work for an AI agent in a repository | [**🤖 Claude Code Routines**](Claude_Code_Routines.md) | Runs in Anthropic's cloud against a checkout. |
| Is work for an AI agent with tools, where you want to read every step | [**✨ Gemini API Triggers**](Gemini_API_Triggers.md) | Cronsole shows each run's output and steps. |
| Joins several services together | [**🔀 n8n**](n8n.md) | Build it in n8n; Cronsole reads it and can start it. |

GitHub Actions and Vercel Cron are for watching work that already lives there; Cronsole creates
nothing on either. [**Cronsole-native › When to use it**](Cronsole_Native.md#-when-to-use-it-and-when-not-to)
has the longer list of what does not belong in a native task.
---

## 🧩 What a source is

A **source** is where a task comes from: the first question you ask about a task, before "is it
failing?". It is the Dashboard's outermost lens, which is why it is the sidebar rail rather than a
row inside the Filters drawer.

**A source is finer than a platform.** A *platform* is what Cronsole talks to: one connector, one
row on the Sources tab, one connection. A *source* is what you navigate by, and the two stopped
matching when Cronsole-native gained more than one kind of job. An HTTP call and a script are the
same platform and genuinely different things to look at, so the rail splits them and the Sources tab
does not.

Three behaviours worth knowing:

- **A source composes with views instead of replacing them.** Pick *Windows Task Scheduler*,
  click *Failures*, and both stay lit: you are looking at failing Windows tasks and the two
  chips say so together. Every other filter drops the view to *Custom*. Source is the one
  exception, and it is allowed only because both constraints are visible at once.
- **The counts are scoped to what you would see.** With a source selected, every view count is
  taken *inside* it, so `My jobs 1` means one, not "88 across everything".
- **A source can read `0`.** It means you have tasks from that source but none survive your
  current view. The button stays so you can always click back out. It disappears only when you
  have no tasks from that source at all.

---

## 👁️ Choosing which sources you see

A fresh install shows **two**: Windows Task Scheduler and Cronsole-native. Claude Code, Gemini API
Triggers, n8n, GitHub Actions and Vercel Cron are supported and are **not** shown until you ask for
them, because a first run listing seven platforms of which two are real teaches you that most of the
product is broken.

Both halves of that live on the **Sources** tab, and the sidebar's **Sources** section links
straight into them:

- **Explore sources** lists everything Cronsole can connect to, including what you have not added
  and the schedulers it can only bookmark. This is where a hidden source is found again, which
  is what makes hiding one safe in the first place.
- **Manage sources** lists the sources you already have: their capabilities, their connection, and
  a switch to show or hide each one.

### The three views

The tab itself is three views, and they split on **whether a source is connected**, not on
whether your sidebar lists it. The two are different facts and the screen shows both.

| View | Holds | What you do here |
|---|---|---|
| **Connected** | Sources with a working connection | Read what each can do and the evidence behind it; show or hide it in the sidebar |
| **Available** | Everything not connected | Set up a source you have added; add one you have not; open a pull request for a source Cronsole has no connector for |
| **Quick links** | Bookmarks to schedulers with no connector | Add, open and remove links. Nothing is read or written |

**Available is in two groups, and the first one is the point.** *Added to your sidebar* holds
sources you asked for that have nothing connected behind them, a real and common half-finished
state. Each one says what would actually connect it, and the answer is one of two shapes:

- **Composed by hand:** Claude Code, Gemini API Triggers, n8n, GitHub Actions and Vercel Cron have
  something to fill in, so *Set up* opens that panel right there.
- **Connects itself:** Windows connects when the Cronsole agent is running, and Cronsole-native
  connects whenever the backend is up. There is no button, because nothing you could type would
  connect them, and a *Connect* button that cannot connect is worse than the sentence saying so.

*Not added* holds the rest. Adding one lists it in the sidebar and moves it into the group above
so it has somewhere to be set up from. **Adding connects nothing on its own.**

Two rules hold whichever you use:

- **A source holding tasks is never hidden.** Hiding is for an empty row you do not want, never
  for tasks you would then be unable to find. The switch on a source with tasks says so.
- **Connecting a source shows it.** You never have to do both, and Cronsole never asks you to
  confirm something it can infer from what you just did.

Which sources you show is a **preference, so it follows your account** rather than this browser.
The same install reached at `localhost` and over a Tailscale name shows you the same sidebar.

---

## 🔍 Seeing why a task failed

Every task's **Run History** tab has two lists. *Runs Cronsole performed* is Cronsole's own log:
your **Run now** clicks, and native jobs it executed itself. *Runs on the platform* is read live
from the source each time you open the tab, and it is where a task's own scheduled runs appear.

**Click a run to see what it produced**, including why it failed. What you get depends on what the
source publishes (the last column of the [table above](#-every-source)), and the differences are
real rather than gaps in the product. Windows run detail needs an agent published on or after
2026-08-25, and Cronsole says so if yours is older.

> [!NOTE]
> **Windows records task history only if it is switched on.** It is a machine-wide setting and it is
> off by default on some installs. Cronsole tells you which, because an empty list and a switched-off
> log are different answers. Turn it on in Task Scheduler under **Action › Enable All Tasks
> History**. It is not retroactive: runs from before you enabled it are gone.

> [!TIP]
> **Read the step list, not just the status.** A run can finish cleanly having skipped the part you
> cared about. An agent asked to email a report will complete successfully having only written a
> file, because its sandbox has no mail access. The status cannot show that; the steps can.

---

## 🔖 Quick links — schedulers with no connector

**Quick Links** is its own item on the top bar: bookmarks to ChatGPT, the Gemini app and other AI
tools Cronsole cannot read, to the web console of **every source that has one** (Claude routines,
Gemini API, GitHub, Vercel), and to any you add yourself. **Nothing is read or written through
them**, and no task from one appears in your dashboard.

They exist so the schedulers Cronsole *cannot* reach are still one click away rather than
invisible. They get their own view rather than a place among the real sources, because a bookmark
that looks like a connector reads as a broken one.

The defaults are kept current by a scheduled job that also adds AI tools that start scheduling work.
A new default appears **once** on an existing install; one you deleted stays deleted. Windows Task
Scheduler and Cronsole-native have no web console, and n8n's address is your own instance's, so add
that one with **Add link**. Switch the top-bar item off in **Settings › Behavior** and the links move
back under the **Sources** tab as its third view. Nothing is deleted either way.

> The **Gemini app**'s scheduled actions and **Gemini API Triggers** are two different things, and
> only the second has an API. A scheduled action you set up by talking to the Gemini app is reachable
> from the bookmark and nowhere else; a trigger created through the API is a real source.

Each link shows its host rather than its whole URL, which is the part that identifies it, instead of
a line that truncates into an ellipsis at tile width. The remove control is **always rendered**, not
revealed on hover, so it is reachable on a phone. Your links are a preference, so they follow your
account rather than the browser you added them in.

**Re-check these rather than assuming.** Gemini sat on this list for the whole of 2026 and shipped a
full CRUD trigger API four weeks before anyone looked again. As of 2026-08-24: ChatGPT Tasks grew a
better UI and no API; Grok Automations has no automation API; and Jules has both a public API *and*
scheduled tasks in the product, with no schedules resource joining them, the closest of the three to
changing.

A link graduates to a connector when it can do something a bookmark cannot, which needs a public API
for reading scheduled work. That is the first question in [Adding a source](#-adding-a-source).

---

## ➕ Adding a source

Every source is a **connector**: one class per platform implementing one interface
(`PlatformConnector`), compiled into the backend. There is no plugin folder and nothing to drop in
at runtime, deliberately. A connector holds credentials, issues commands to your machine and decides
what a sync is allowed to retire, which is not a thing to load off disk unreviewed. So **adding a
source means a pull request** to [the repository](https://github.com/ai-automation-tools/cronsole).

There are three shapes, and picking the wrong one is the usual reason a connector stalls half-built:

| Shape | When it fits | What it costs |
|:--|:--|:--|
| **Controller** | The platform has an API to read *and* change scheduled work: run, enable/disable, edit, delete. | The most work, and the most trust. |
| **Observer** | It can be read but should not be written, or cannot be. | Much less, and a **finished** state rather than a stalled one. GitHub Actions and Vercel Cron are the worked examples. |
| **Quick link** | No public API for scheduled work exists at all. | A bookmark, added from the Sources tab in ten seconds by anyone. |

**Writing one? Read [Adding a source](../../contributing/Adding_A_Source.md)**, the contributor
document. It has the contract every connector must meet, the build order file by file, which
connector to copy, what will not be accepted, and a five-minute proposal issue to open *before* you
write anything, so that *"this should be a quick link"* costs you a paragraph rather than a weekend.

---

## 🛣️ What's coming

The next source is a **POSIX agent** covering launchd, cron and systemd timers. They are the
same shape as Windows Task Scheduler (a local OS scheduler), so one agent covers all three on
the protocol that already exists, rather than one OAuth surface and one rate limit per cloud
scheduler. See [ROADMAP.md](../../ROADMAP.md) › Sources.

---

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🖥️ UI User Guide**](../guides/UI_User_Guide.md) | The dashboard itself: views, filters, the task modal, run history. |
| [**🤖 Windows Agent Setup**](../guides/Agent_Setup_Guide.md) | Installing and troubleshooting the agent that Windows Task Scheduler needs. |
| [**💬 Prompt library**](../../../prompts/README.md) | Creating any of these sources by asking an assistant. |
| [**🧯 Troubleshooting**](../../troubleshooting/README.md) | Symptom → cause → fix for problems already hit, including several per-source ones linked from these pages. |

---

<p align="center">
  <a href="../README.md">← User guides</a> ·
  <a href="../../README.md">Docs home</a> ·
  <a href="../../contributing/Adding_A_Source.md">Adding a source →</a>
</p>

<p align="right">(<a href="#sources-top">back to top</a>)</p>
