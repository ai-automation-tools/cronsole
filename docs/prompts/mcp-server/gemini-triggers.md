<a id="gemini-top"></a>

<h1 align="center">✨ Gemini Trigger Prompts</h1>

<p align="center">
  <em>Schedule a prompt — not a command — on Google's managed agent, and read back what it
  actually did.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-Gemini_API_Triggers-8B5CF6?style=for-the-badge" alt="Gemini API Triggers">
  <img src="https://img.shields.io/badge/access-controller-2ea44f?style=for-the-badge" alt="Controller">
  <img src="https://img.shields.io/badge/API-v1beta_preview-F59E0B?style=for-the-badge" alt="v1beta preview">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-MCP_prompts-6B7280?style=for-the-badge" alt="MCP prompts"></a>
</p>

---

A **Gemini API trigger** is a prompt Google runs on a schedule, on its own managed agent, in a
sandbox you don't operate. No machine of yours has to be on, there is no executable and no shell —
the unit of work is a sentence.

> [!WARNING]
> **This is not the Gemini CLI.** [AI agent jobs](ai-agent-jobs.md#gemini-cli) has prompts for
> scheduling `gemini -p` as a **Windows task** — that runs the CLI on *your* machine, against
> *your* files, through the local agent. This page is the **hosted platform**: Google's
> infrastructure, Google's sandbox, no local paths at all. They share a brand and nothing else.
> If your prompt mentions a path like `D:\work\repo`, you want the other page.

Gemini is the first platform Cronsole **controls** rather than merely observes, and it is the only
connector that refuses none of the **mandated** verbs — create, run, pause/resume and delete each
reach a documented endpoint. Two *optional* verbs are absent, and the difference between them
matters: editing the prompt is a **not yet**, while rescheduling is a **cannot** (see
[below](#-a-trigger-is-immutable--plan-for-it)). Start here to see it for yourself:

```text
Using Cronsole, list the platforms and tell me specifically about Gemini API
Triggers: is it a controller or an observer, which capabilities are verified on
this install versus only declared, and is the connection healthy?
```

## ✨ Create a trigger

```text
Using Cronsole, create a Gemini trigger called "Morning AI news brief" that runs
at 6am UTC every weekday. The prompt: search for significant AI model and
research announcements from the last 24 hours, and write a brief of at most ten
bullets, each one sentence with a source link. If nothing significant happened,
say so in one line rather than padding the list. Grant it google_search and
url_context.
```

```text
Using Cronsole, create a Gemini trigger that runs every Monday at 13:00 UTC and
watches for changes to a spec page: fetch https://example.com/api/changelog,
compare it against what it reported last week, and describe what changed. If the
page is unreachable, say the fetch failed and stop — do not guess from cached
knowledge. It needs url_context, and the allowlist should be example.com only.
```

```text
Using Cronsole, create a Gemini trigger for the first of every month at 9am UTC
that computes a small report with code_execution: given the figures I paste into
the prompt, produce the quarter-to-date totals and the three largest movements.
Show the numbers it used. No other tools.
```

Before it calls anything, a good assistant will read the prompt back to you. Take that seriously —
this is the one platform where **you cannot fix it afterwards**.

## 📏 The three rules, and why each one exists

Every one of these was paid for by a real failed run. Ask your assistant to apply them, and
push back if it doesn't.

| Rule | The failure it prevents |
|:---|:---|
| **Never let the prompt ask a question or offer a choice** | Nobody is there at 03:00 to answer. The run stalls, having done nothing, and reports a status that looks fine. Give the parameter, or tell it to pick and say which it picked. |
| **Always tell it to report failure explicitly** | An agent that cannot finish a step will narrate success instead. "If you cannot X, say so and stop" is the difference between a report and a fiction. |
| **Grant only the tools the task needs** | Every tool is reach the agent keeps for as long as the trigger exists — and it runs unattended, so nobody is watching it use them. |

A prompt that follows all three:

```text
Using Cronsole, create a Gemini trigger "Weekly competitor pricing" for Mondays
at 8am UTC. The prompt should: fetch the pricing pages for the three URLs I list,
extract each plan name and monthly price, and produce a table comparing them
against the prices in the previous run. Rules for the agent — if a page will not
load or the prices cannot be found, state which URL failed and continue with the
others rather than stopping silently; never estimate a price that isn't on the
page; if every page fails, say the run produced nothing. Tools: url_context.
Allowlist those three domains only.
```

## 🔐 Tools, domains and credentials

Three separate grants, and they are separate on purpose.

**Built-in tools** — `google_search`, `url_context`, `code_execution`, `bash`, `filesystem`,
`file_search`, `computer_use`, `google_maps`, `tool_search`. Omit them entirely for a plain
sandbox that reaches nothing outside itself.

```text
Using Cronsole, what tools can a Gemini trigger be granted, and what does each
one actually let it reach? I want to give one the minimum for a job that reads
two web pages and writes a summary.
```

> [!CAUTION]
> **A capability list is not a permission list.** The managed agent can refuse a tool this list
> accepts — `filesystem` is the known case. Such a trigger is created successfully and then fails
> in about five seconds on every run. If a brand-new trigger fails almost instantly, read the run
> output before touching the prompt: it will name the rejected tool
> ([#84](../../troubleshooting/README.md#84-a-gemini-run-fails-in-five-seconds-and-cronsole-says-there-is-nothing-to-read)).

**The allowlist** — domains the sandbox may contact. Empty means it reaches nothing outside
itself, which is why a trigger asked to email a report will quietly write a file instead and
report `completed`.

```text
Using Cronsole, my Gemini trigger is supposed to email me the report but nothing
arrives and every run says completed. Read the last run's output and tell me
which steps it actually took, then tell me what the allowlist and tools would
need to be for the email step to be possible at all.
```

**Saved MCP servers** — extra tools with credentials behind them, granted by *name*:

```text
Using Cronsole, list my saved MCP servers, then create a Gemini trigger that
sends me a Friday summary at 4pm UTC using the resend preset. The prompt should
name the recipient and the subject line explicitly, and say what to do if the
send fails.
```

> [!IMPORTANT]
> **Never paste a bearer token into a prompt to an assistant.** `create_gemini_trigger` has no
> field for one, deliberately — a tool call travels through the model's context and into your
> host's transcript, which is the one place a credential must not land. You save the server once
> in Cronsole's Gemini panel; the assistant names it. The credential is resolved server-side and
> never passes through the conversation.
>
> A **wrong** preset name is refused **with the list of what exists**, so a bad guess costs one
> call and leaks nothing. A grant is never silently narrowed either: an unknown tool type is
> rejected before the call rather than dropped, because a trigger with quietly less reach than you
> asked for is worse than an error.

## 🚫 A trigger is immutable — plan for it

Google's update endpoint takes a **status** and a **display name**. That's all. There is no edit
for the prompt, and the schedule is fixed at create time — `PATCH` answers
`400 Unknown parameter 'schedule'`, there is no `PUT`, and no field mask.

```text
Using Cronsole, I need to change the prompt on my "Morning AI news brief"
trigger — it should also cover funding rounds. Show me the current prompt and
schedule first, then create the replacement with the change and confirm it
exists and is enabled. Then pause the old one and tell me exactly where to
delete it, since I know you can't delete it yourself.
```

> [!IMPORTANT]
> **The assistant cannot finish this for you, and that's deliberate.** `delete_task` over MCP is
> **Cronsole-native only** — it refuses every other platform with a `400`, Gemini and Windows
> included, because no MCP verb may destroy a real scheduled artifact. Deleting the old trigger is
> a **dashboard** action. What the assistant *can* do is pause it with `set_task_status`, which
> stops the duplicate schedule immediately and is fully reversible — so ask for that first and
> delete at your leisure.

What your assistant should refuse to pretend it can do:

- **Edit the prompt** — `update_task_action` is absent for this platform. It is a *not yet*, not a
  *cannot*.
- **Reschedule** — `update_task_schedule` is absent because the platform genuinely cannot. Same
  fix: recreate.

Both are create-then-delete, and the order matters: **build the replacement first**. A failure
partway then leaves the original still running rather than leaving you with neither. Conversely,
if both end up alive, the schedule now fires twice — which is why the pause-then-delete sequence
above is the safe shape when the delete has to happen on a different surface.

### Rotating a credential

```text
Using Cronsole, I rotated my Resend API key. Which of my Gemini triggers use the
resend preset, and what does Cronsole have to do to each one to pick up the new
value? Walk me through it before changing anything.
```

Because a trigger is immutable, rotation is a rebuild of every trigger using that server — each an
independent create-then-delete against Google's API. It reports **per task, never per batch**, it
inherits a paused status (rotating a parked trigger must not resume it), and it rekeys the existing
Cronsole row so favourites, collections and run history survive. A trigger also carrying an
*unsaved* MCP server is **skipped with its reason** rather than rebuilt — Cronsole never read that
credential, so rebuilding would drop it.

## 🔎 Read what it actually did

This is the half most people skip, and it's where the value is.

```text
Using Cronsole, show me the last ten runs of my "Morning AI news brief" trigger
from Gemini's own history, then open the most recent one and tell me the steps it
took — not just whether it says completed.
```

```text
Using Cronsole, my Gemini trigger has been running for a week and I have no idea
whether it's doing the job. Pull its platform run history, read the output of the
newest successful run, and tell me: did it do every part of what the prompt asked,
or did it finish having skipped a step?
```

> [!IMPORTANT]
> **`get_task_history` is the wrong tool here and will look like a bug.** It reads Cronsole's own
> log, which holds only runs Cronsole *performed* — so on a platform that runs work by itself it is
> empty by design, however well the trigger is running. The runs are in
> **`list_platform_runs`**, which is a live read of Gemini's own record.

> [!TIP]
> **Read the step list, not the status.** `completed` means the agent finished its turn, not that
> it did the job. A trigger asked to email a report completes cleanly having only called
> `write_file`, because its sandbox had no mailer — and no status anywhere can show that. The step
> list is the only thing that can.

Output is fetched **one run per call**, deliberately — a transcript runs to ~90KB, so pulling a
list of them would flood the context for nothing. And a refusal carries its reason, because
*"still running"*, *"produced nothing"* and *"aged out of the platform's list"* are three different
facts and none of them is an error.

## 🩺 When something's wrong

```text
Using Cronsole, check the health of all my Gemini triggers. For any that aren't
healthy, tell me what the evidence actually is — a failed run, a trigger the
platform disabled by itself, or just no data yet.
```

Gemini reports real run outcomes, so its health is evidence rather than a guess — and it produces
one signal no observer can: **a trigger the platform paused itself** after too many consecutive
failures. That's a fact worth surfacing, not a Cronsole error.

```text
Using Cronsole, one of my Gemini triggers is disabled and I didn't disable it.
Did Google pause it, and if so what were the failures that led to that? Show me
the run history that caused it.
```

**A slow "Run now" is not a failed one.** Firing a trigger manually holds the connection while the
agent works, which outlasts any sane client timeout. On a transport timeout Cronsole re-reads the
platform and looks for a run that started since the request, rather than reporting a healthy task
as failed. If you see a run-now result you don't believe, ask for the platform's own record:

```text
Using Cronsole, I ran my Gemini trigger manually and the result was ambiguous.
Check Gemini's run history for a run that started in the last few minutes and
tell me what actually happened.
```

## 🕐 Time zones

Cronsole stores every schedule as **5-field cron in UTC**, and Gemini is the one platform that
stores a zone of its own alongside the expression. So this is the single place in the product where
a server-side conversion happens:

- Everything Cronsole **writes** goes out as UTC — an exact round trip.
- Everything Cronsole **reads** is normalized to UTC, with Google's original pair kept in metadata.
- An expression with no honest UTC equivalent comes back as **`null` with its reason**, never a
  guessed cron.

```text
Using Cronsole, I want a Gemini trigger at 7am Chicago time on weekdays. Convert
that to the UTC cron first, tell me what it will be in UTC and confirm what
happens across a daylight-saving change, then create it.
```

## ⚠️ Gotchas

| What you'll see | What's happening |
|:---|:---|
| A brand-new trigger fails in ~5 seconds, every time | The managed agent refused a tool the API accepted — usually `filesystem`. Read the run output; it names it. ([#84](../../troubleshooting/README.md#84-a-gemini-run-fails-in-five-seconds-and-cronsole-says-there-is-nothing-to-read)) |
| Every run says `completed` but the job isn't getting done | Status ≠ outcome. Read the step list. Usually the sandbox lacked a tool or a domain, so the agent did the nearest thing it could. |
| Run history is empty although it's been running for days | You read `get_task_history` (Cronsole's own log, empty by design here) instead of `list_platform_runs`. |
| "Edit schedule" fails mentioning a word you never typed | Google's `schedule` parameter. The platform has no reschedule; recreate. ([#82](../../troubleshooting/README.md#82-a-gemini-trigger-loses-its-prompt-on-the-first-sync-and-edit-schedule-fails-with-googles-word)) |
| A trigger disabled itself | The platform paused it after consecutive failures. Fix the cause, then re-enable. |
| Every trigger lands in one category | Correct. An API key is scoped to one Google Cloud project and sees a flat list, so the tracked set is the constant `Gemini`. Rename or recategorize in Cronsole if you want your own grouping — those are Cronsole labels and sync never overwrites them. |

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**📡 Observer sources**](observers.md) | GitHub Actions and Vercel Cron — read-only, and why that's a finished state. |
| [**🔎 Inspect & audit**](inspect-and-audit.md) | Platform run history across every source, not just this one. |
| [**🤖 AI agent jobs**](ai-agent-jobs.md) | The *other* Gemini — the CLI, scheduled locally as a Windows task. |
| [**🧠 Claude routines**](claude-routines.md) | The other hosted agent platform, and how the two differ. |
| [**📘 Using Gemini API Triggers**](../../user-guides/sources/Gemini_API_Triggers.md) | Setup, the API key, and the source panel. |

---

<p align="center">
  <a href="README.md">← MCP Prompts</a> ·
  <a href="claude-routines.md">Claude Routines</a> ·
  <a href="observers.md">Observers</a>
</p>

<p align="right">(<a href="#gemini-top">back to top</a>)</p>
