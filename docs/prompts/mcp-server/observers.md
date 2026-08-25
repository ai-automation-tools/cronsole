<a id="observers-top"></a>

<h1 align="center">📡 Observer Source Prompts</h1>

<p align="center">
  <em>GitHub Actions and Vercel Cron — schedules Cronsole can see but deliberately cannot
  touch.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platforms-GitHub_Actions_·_Vercel_Cron-8B5CF6?style=for-the-badge" alt="GitHub Actions and Vercel Cron">
  <img src="https://img.shields.io/badge/access-observer-0078D4?style=for-the-badge" alt="Observer">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-MCP_prompts-6B7280?style=for-the-badge" alt="MCP prompts"></a>
</p>

---

Two of Cronsole's sources are **read-only by design**. They import your scheduled workflows and
crons so they appear beside everything else on one dashboard, and they change nothing on the
platform — no create, no run, no enable/disable.

> [!IMPORTANT]
> **A read-only observer is a finished connector, not a stalled one.** Cronsole says which kind
> each platform is with a declared `access` field — `controller` or `observer` — rather than
> counting up which cells happen to work. Counting would make a finished read-only connector look
> identical to one whose write verbs are merely unbuilt, which is the whole thing the field exists
> to say. Ask it directly:

```text
Using Cronsole, list the platforms and tell me which are controllers and which
are observers. For each observer, tell me exactly which verbs it refuses and
why — I want to know what's a real boundary versus something just not built yet.
```

## 📊 What you can actually ask

Everything read-shaped works, and that's most of what you want from a schedule you already
manage elsewhere.

```text
Using Cronsole, show me every scheduled GitHub Actions workflow you've imported,
which repository each one is in, and when it's set to run — in my local time as
well as UTC.
```

```text
Using Cronsole, across all my sources, what's scheduled to run in the next 24
hours? Group it by platform and tell me which of those Cronsole can actually
trigger versus only watch.
```

```text
Using Cronsole, list my Vercel crons with their paths and schedules, and tell me
which project each belongs to.
```

```text
Using Cronsole, I have scheduled jobs in three places. Give me one table of
everything — Windows, GitHub Actions, Vercel and Gemini — with schedule, last
known outcome, and how confident Cronsole is about that outcome.
```

## 🚧 What they refuse, and why it's the right answer

Both refuse the same three verbs by completely different routes. That's the point: the boundary is
a property of each connector's design rather than a tally of missing features.

| Verb | GitHub Actions | Vercel Cron |
|:---|:---|:---|
| **`run`** | A `workflow_dispatch` run **is not the scheduled run** — different event, different context. | A cron path is an ordinary HTTP endpoint, but calling it **bypasses `CRON_SECRET`** and is not the scheduled invocation either. |
| **`create`** | Writing a workflow file is a repository change, not a scheduling action. | Crons are declared in `vercel.json` and come from a deploy. |
| **`setStatus`** | Enabling or disabling a workflow is repository state. | Vercel has **no per-cron switch at all** — crons are enabled per **project**. |

```text
Using Cronsole, can you trigger my GitHub Actions workflow "nightly.yml" right
now? If not, explain why refusing is the correct behavior rather than a missing
feature, and tell me what I'd do instead.
```

An assistant that tries to work around one of these is doing you no favors. The refusals are
`400`s — a stated boundary — not `502`s, and they say which is which.

## 📥 Adding a repository or project

For GitHub Actions the tracked set is **declared** — it's the repositories you've asked Cronsole to
watch, not whatever rows happen to exist. That distinction matters the first time you add one:

```text
Using Cronsole, I've added a new repository to the GitHub connection. Sync just
that repository and tell me how many scheduled workflows it found — and if it
found none, tell me whether that means there are none or that it couldn't look.
```

> [!TIP]
> **"Found nothing" and "looked at nothing" render identically, so ask.** A repository whose
> workflows are all push-triggered imports zero tasks and is working perfectly — the same empty
> screen as a broken sync. Cronsole answers this with coverage **notes** on the sync result, so ask
> what it looked at, not just what it kept.

```text
Using Cronsole, run a sync and report what it looked at, not just what it
imported: which repositories were read, which it couldn't read, and whether any
listing was truncated.
```

A sync where **every** source failed throws rather than returning an empty list — otherwise one
revoked scope reads as a mass deletion. A **partial** failure returns what it has, and Cronsole
then adds and refreshes rows but **retires nothing** on that pass: a narrowed reader is not an
emptier platform.

## 🩺 Health, and the honest "unknown"

```text
Using Cronsole, what's the health of my GitHub Actions and Vercel Cron sources,
and for each one tell me what that verdict is actually based on — a real run
outcome, a connection check, or no evidence at all?
```

Vercel is the permanent case worth understanding: it **publishes no cron run history**. So Cronsole
says `unknown` in its own terms, permanently, rather than scoring it healthy off the fact that the
cron is configured.

> [!NOTE]
> **`configured` and `working` are different claims**, and on Vercel only the first is knowable.
> An assistant reporting your Vercel crons as "healthy" is telling you something Cronsole
> deliberately refuses to claim. Absence of evidence is `unknown`, never `ok`.

For GitHub Actions there *is* run history, and it's on the platform rather than in Cronsole's log:

```text
Using Cronsole, my nightly GitHub Actions workflow looks like it's failing. Pull
the run history GitHub itself recorded for it and tell me what the recent
outcomes were.
```

```text
Using Cronsole, why is my scheduled workflow's run history empty in Cronsole even
though it's definitely been running?
```

The answer to that last one is the same everywhere: `get_task_history` reads **runs Cronsole
performed**, which on a source that runs work by itself is empty by design.
`list_platform_runs` is where the runs are.

## 🧹 Getting one off the dashboard

```text
Using Cronsole, I don't want to watch that repository any more. Untrack its
workflows and confirm they won't come back on the next sync — and confirm
nothing changed on GitHub.
```

Untracking removes Cronsole's rows and records an exclusion so a later sync doesn't re-import
them. Nothing on the platform is touched — which on an observer is the only thing that could
happen anyway.

## ⚠️ Gotchas

| What you'll see | What's happening |
|:---|:---|
| Sync reports success and no workflows arrive | The repository isn't in the watched set. Adding it is a sync naming that repository, not a plain refresh. ([#75](../../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive)) |
| A Vercel cron shows `unknown` forever | Correct and permanent — Vercel publishes no run history. Not a bug, not a broken cron. |
| A schedule reads as null with a reason attached | Cronsole could not read that expression and refuses to guess a cron. The reason says why. |
| "Run now" is missing or refused | Both platforms refuse `run`, by design. See the table above. |
| A workflow's Cronsole name doesn't match GitHub | `name` and `category` are **Cronsole labels** — sync never overwrites them, and the real identifier stays on screen once they diverge. |

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**✨ Gemini triggers**](gemini-triggers.md) | The counter-example — a hosted platform Cronsole fully controls. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Cross-platform reporting, where observers pull their weight. |
| [**📘 Using GitHub Actions**](../../user-guides/sources/GitHub_Actions.md) | Setup, scopes, and watching repositories. |
| [**📘 Using Vercel Cron**](../../user-guides/sources/Vercel_Cron.md) | Setup and what Vercel does and doesn't publish. |

---

<p align="center">
  <a href="README.md">← MCP Prompts</a> ·
  <a href="gemini-triggers.md">Gemini Triggers</a> ·
  <a href="inspect-and-audit.md">Inspect &amp; Audit</a>
</p>

<p align="right">(<a href="#observers-top">back to top</a>)</p>
