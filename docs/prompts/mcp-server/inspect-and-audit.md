<a id="inspect-top"></a>

<h1 align="center">🔎 Inspect &amp; Audit Prompts</h1>

<p align="center">
  <em>Find out what you have, what's failing, what hasn't run in months —
  and how much of that Cronsole can actually prove.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tools-read--only-2ea44f?style=for-the-badge" alt="Read-only tools">
  <img src="https://img.shields.io/badge/changes-nothing-6B7280?style=for-the-badge" alt="Changes nothing">
</p>

---

Nothing on this page modifies a task, so these are the prompts to run first on an unfamiliar
machine. They're also where Cronsole is most careful about the difference between *knowing* and
*assuming*, and the prompts are written to keep an assistant on the right side of that line.

## 📋 What do I have?

```text
Using Cronsole, show me all my scheduled tasks grouped by category, with each
one's schedule and last run result.
```

```text
Using Cronsole, list my tasks by platform — how many are Windows, how many are
native, how many are Claude routines?
```

```text
Using Cronsole, search my tasks for anything with "backup" in the name and show
me when each one next runs.
```

```text
Using Cronsole, which of my tasks are currently disabled? For each, tell me its
schedule so I can decide whether to re-enable it.
```

```text
Using Cronsole, export the task called "Daily Portfolio Analysis" and show me the
exact command and trigger it's registered with — I want the real definition, not
the summary.
```

**Ask for the *portable* format when the point is to move the task, not inspect it.** Export has
two, and they answer different questions:

```text
Using Cronsole, export "Daily Portfolio Analysis" as a portable template so I can
set it up on my laptop. Tell me what the template leaves out.
```

The answer should name the loss — the account it runs as, run level, extra actions — because a
template is a recipe, not a backup. It is also the only export that works with the **Windows agent
offline**, or for a **Claude routine**, whose definition lives at claude.ai and cannot be fetched at
all. Ask for the native format when you want *this exact task back on this platform*.

## 🩺 What's broken?

```text
Using Cronsole, score my tasks worst-first and show me the top ten. For each
signal, name the field it came from — I don't want a number without its source.
```

```text
Using Cronsole, list every task whose last run failed, then pull the recent run
history for each so I can see what went wrong.
```

```text
Using Cronsole, show me the cross-task run history for the last week. Group the
failures by task and tell me which ones are repeat offenders versus one-offs.
```

```text
Using Cronsole, my "Weekly PR Creator" hasn't produced anything in a fortnight.
Check its status, its schedule, its next run time and its history, then tell me
which of those explains it.
```

Three things the health scorer does that are worth relying on:

- **Absence of evidence is `unknown`, never `ok`.** A field the agent has never reported is
  missing, not zero. An un-republished agent omits `lastTaskResult`, and reading that as "never
  ran" would flag every Windows task at once.
- **Disabled is not unhealthy.** Parking a task is a legitimate thing to have done.
- **System tasks are hidden by default and counted out loud.** On a real machine most of the
  worst-scoring tasks are Windows' own, which buries yours if nothing separates them.

## ⏰ What isn't running?

```text
Using Cronsole, which of my tasks look idle — nothing recorded in 90 days? Split
them into ones that genuinely haven't run and ones where Cronsole simply has no
evidence either way.
```

```text
Using the Cronsole REST API, pull the analytics (GET /api/tools/analytics) and
summarize the failure trend and the idle report. Tell me what the duration trend
excludes and why.
```

That distinction matters more than it sounds. The idle report has **four** outcomes — idle,
never-run, no-run-evidence, and disabled-or-on-demand — because only one of them is a defect,
and collapsing them would let "nothing is idle" mean "we couldn't tell".

## 🧾 What the run history does and doesn't cover

This is the single most common misreading of the dashboard, so it's worth a prompt of its own:

```text
Using Cronsole, show me the run history for "Nightly Backup" — and tell me
explicitly whether an empty or short history means it didn't run, or just that
Cronsole didn't perform the run.
```

Cronsole's `ExecutionLog` records runs **it performed**: manual runs you triggered and
Cronsole-native scheduler fires. A Windows task firing on its own trigger writes nothing there;
Windows records that itself. So:

| What you see | What it means |
|:---|:---|
| Empty history on a Windows task | Nothing about whether it ran. Ask for the **platform's** run history instead. |
| `SUCCESS` on a manual Windows run | The agent accepted the start. Not that the job finished. |
| `SUCCESS` on a native task | The process exited zero. That one is real. |
| A duration on a Windows run | The agent round trip, not the job. |

```text
Using Cronsole, I think "Data Import" is hanging rather than failing. Its status
looks green — tell me why that isn't proof, and what would actually settle it.
```

### The other half: runs the platform recorded itself

The rule above leaves a real hole — on a source that runs work by itself, Cronsole's own log
correctly says *"no recorded runs"* over a week of them. **`list_platform_runs`** is a live read of
the platform's own record, and it is where the runs actually are on Gemini, GitHub Actions, Vercel
and Windows.

```text
Using Cronsole, why did my scheduled task fail last night? Read the run history
the platform itself recorded — not Cronsole's log — and then open the failed run
and tell me what it produced.
```

```text
Using Cronsole, for "Nightly Backup" show me both populations side by side: the
runs Cronsole performed and the runs Windows recorded on its own. Don't merge
them into one list — I want to see which is which.
```

The two are **never summed**. Folding one into the other turns a table meaning *"Cronsole did
this"* into one meaning nothing. Nothing is stored either, so the platform half can fail on its own
and must say so rather than showing a short list as a complete one.

```text
Using Cronsole, pull the platform run history for all my tasks and tell me which
sources could actually answer. For any that couldn't, say whether that's a
failure or a platform that publishes no history at all.
```

> [!TIP]
> **Read the step list, not the status.** `get_run_output` returns what one run produced *and the
> steps it took* — and on an agent platform that's the whole answer. A trigger asked to email a
> report finishes `completed` having only written a file, and no status can show that. Output is
> one run per call (a transcript is ~90KB), and a refusal names its reason: *"still running"*,
> *"produced nothing"* and *"aged out of the list"* are three different facts.

```text
Using Cronsole, open the most recent run of my scheduled agent task and tell me
the steps it actually took. Did it do every part of what I asked, or finish
having skipped one?
```

> [!NOTE]
> **Windows can be told not to record history.** Per-task history is a machine-wide switch that is
> off by default on some installs, and a disabled log returns **zero events — identical to a task
> that has never run**. Cronsole reports that as a third state rather than rendering both as one
> sentence, and it will tell you that turning it on is **not retroactive**.

```text
Using Cronsole, "Nightly Backup" shows no platform runs at all. Is Windows task
history even enabled on this machine, or has the task genuinely never run?
```

## 🔌 What can this install do?

```text
Using Cronsole, list the platforms and tell me which capabilities are verified on
this machine versus only declared. Treat declared as untested rather than
supported.
```

```text
Using Cronsole, is my Windows agent healthy? If the status is anything other than
online, tell me what evidence that's based on and when it was last observed.
```

```text
Using Cronsole, run the diagnostics and tell me whether Cronsole itself is
working. For anything that isn't passing, quote the evidence rather than the
verdict, and say which of it describes my machine versus the backend container.
```

```text
Using Cronsole, nothing seems to be running. Check the diagnostics first, then
task health — and tell me explicitly if the task-level picture is unreliable
because of something the diagnostics found.
```

**Ask `get_diagnostics` before `get_task_health` when something is wrong.** They answer different
questions: diagnostics asks *"is Cronsole working"*, health asks *"are my tasks working"* — and the
second is meaningless while the first is failing, because a wedged agent makes **every** Windows
task read unhealthy and the fix is in none of those tasks. Two readings to carry over: `unknown` is
not `pass` (it means the check could not be measured, and it ranks above pass for that reason), and
`measuredOn` says which machine the facts describe — on a Dockerized stack a filesystem or clock
fact is about the **container**, so telling a user to free disk space could point at the wrong
machine entirely. It is read-only: it diagnoses, it never repairs, and it cannot report on a
backend that is down because that backend serves it.

The capability matrix has three states and the middle one carries the weight: **verified** (it
has actually succeeded here, with a timestamp), **declared** (the route would accept it, nothing
has been observed), **unsupported** (the route would refuse). Health has four, and the fourth is
the useful one — **unknown** means nothing has been heard recently, which is neither a problem
nor an all-clear. An assistant reporting "all platforms online" over a connection nothing has
touched since yesterday is worse than one saying it doesn't know.

## 🔄 Refresh what Cronsole knows

```text
Using Cronsole, sync my tasks and tell me what changed — anything new, anything
that's gone missing since last time.
```

```text
Using Cronsole, sync and then show me the tasks marked MISSING. Those are ones
Cronsole tracks that the platform no longer reports — I want to know whether I
deleted them or something else did.
```

## 📤 Get it out of Cronsole

```text
Using the Cronsole REST API, export my cross-task run history for the last 30
days as CSV so I can open it in Excel.
```

```text
Using the Cronsole REST API, export task <task-id>. For a Windows task the body
is UTF-16 LE with a BOM — save it back in that encoding or Windows will reject
the re-import.
```

The CSV neutralizes cells starting with `=`, `+`, `-` or `@`, because Cronsole stores command
lines and Excel would otherwise execute one on open. The BOM isn't cosmetic either — without it
Excel mangles non-ASCII task names.

## 🔗 Related

| Resource | Why |
|:---|:---|
| [**⚙️ Manage tasks**](manage-tasks.md) | Acting on what you found here. |
| [**🌐 REST API prompts**](../rest-api/README.md) | Analytics, CSV export, archives — the read surfaces MCP doesn't wrap. |
| [**🧯 Troubleshooting**](../../troubleshooting/README.md) | When the answer is "that's a known trap". |
| [**🧪 Testing**](../../testing/README.md) | The runbooks for proving a stack is alive rather than assuming it. |

---

<p align="center">
  <a href="README.md">← MCP prompts</a> ·
  <a href="templates.md">Templates</a> ·
  <a href="manage-tasks.md">Next: Manage tasks →</a>
</p>

<p align="right">(<a href="#inspect-top">back to top</a>)</p>
