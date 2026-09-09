<a id="sources-top"></a>

<h1 align="center">🔌 Source Guides</h1>

<p align="center">
  <em>One document per source, covering setup, daily use and the things that catch people out.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/sources-6-8B5CF6?style=for-the-badge" alt="Six sources">
  <img src="https://img.shields.io/badge/shapes-controller_·_observer-0078D4?style=for-the-badge" alt="Controllers and observers">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-user_guides-6B7280?style=for-the-badge" alt="User guides"></a>
</p>

---

A **source** is where a task comes from. Cronsole shows six of them side by side on one dashboard,
and they are not the same kind of thing: one lives on your machine, one *is* a row in Cronsole's
database, and four are somebody else's cloud service reached over HTTP.

That difference decides what Cronsole can do with each. The [Sources Guide](../guides/Sources_Guide.md)
compares all six in one place — start there if you are choosing between them. **These documents are
the deep dive for one source at a time**: how to connect it, what each capability actually does, and
the failures worth knowing about before you hit them.

## 🎛️ Controllers — Cronsole can change things here

| Source | What it is |
|:---|:---|
| [**🪟 Windows Task Scheduler**](Windows_Task_Scheduler.md) | The scheduler already on your machine, reached through the local agent. The only source that keeps running when Cronsole is off, and the one with the fullest set of verbs. |
| [**⚡ Cronsole-native**](Cronsole_Native.md) | Jobs Cronsole schedules and runs itself — HTTP calls, programs, scripts you write in the app, and checks that measure something and compare it. Four job types, per-job secrets, no agent involved. |
| [**🤖 Claude Code Routines**](Claude_Code_Routines.md) | Prompts Anthropic runs on a schedule against repositories you attach. The one source whose capabilities depend on your install, because there are two different doors into it. |
| [**✨ Gemini API Triggers**](Gemini_API_Triggers.md) | Scheduled prompts Google runs on its own agents. The first hosted source Cronsole can act on rather than only watch — and the one where saving an MCP server once is the difference between usable and tedious. |

## 👁️ Observers — Cronsole reads and changes nothing

Read-only is the **design** in both cases, not an unfinished first version. Each refuses the same
three verbs by different routes, and each says which.

| Source | What it is |
|:---|:---|
| [**🐙 GitHub Actions**](GitHub_Actions.md) | Every workflow with an `on: schedule` trigger in the repositories you watch, with real run outcomes and GitHub's silent 60-day auto-disable surfaced as a health signal. |
| [**▲ Vercel Cron**](Vercel_Cron.md) | The cron jobs your projects declare. Exact counts before you add a project — and no run history at all, which is stated rather than papered over. |

> [!NOTE]
> **Not listed here: quick links.** ChatGPT Tasks, Grok, Jules and the rest are bookmarks, not
> sources — nothing is read or written through them, because none has a public scheduled-task API to
> read. The [Sources Guide](../guides/Sources_Guide.md#quick-links--schedulers-with-no-connector)
> covers them, along with why re-checking that list matters: Gemini was on it until August 2026.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧭 Sources Guide**](../guides/Sources_Guide.md) | All six compared in one place, plus quick links and how to add a source. |
| [**🖥️ UI User Guide**](../guides/UI_User_Guide.md) | The dashboard itself — views, filters, the task modal, run history. |
| [**🤖 Windows Agent Setup**](../guides/Agent_Setup_Guide.md) | Installing and troubleshooting the agent that Windows Task Scheduler needs. |
| [**🧯 Troubleshooting**](../../troubleshooting/README.md) | Symptom → cause → fix for problems already hit, including several per-source ones linked from these pages. |

---

<p align="center">
  <a href="../README.md">← User guides</a> ·
  <a href="../guides/Sources_Guide.md">Sources Guide</a> ·
  <a href="../../README.md">Docs home</a>
</p>

<p align="right">(<a href="#sources-top">back to top</a>)</p>
