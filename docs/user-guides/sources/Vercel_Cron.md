<a id="vercel-top"></a>

<h1 align="center">▲ Vercel Cron</h1>

<p align="center">
  <em>The cron jobs your projects declare — read, never written, and with no run history to read.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-observer-2ea44f?style=for-the-badge" alt="Observer">
  <img src="https://img.shields.io/badge/run_history-none_published-F59E0B?style=for-the-badge" alt="No run history">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

Cronsole watches Vercel projects and brings in every cron job they declare, with its schedule and
whether the project has crons switched on.

**Read-only is the design here too**, and Vercel is the useful contrast with
[GitHub Actions](GitHub_Actions.md): cheaper to read in one way, and poorer in another that matters
more than it first sounds.

---

## 🎯 Best for

Seeing the crons your Vercel projects **declare**, beside everything else.

| Automation | Why it belongs here |
|:---|:---|
| Cron routes in your projects: revalidation, cleanup endpoints, scheduled emails | Cronsole lists each one with its schedule and its project. |
| Spotting a project whose crons are switched off | Crons are on or off per project, and Cronsole shows which. |
| Paired with a native [Endpoint check](Cronsole_Native.md#-checks--measure-something-and-compare-it) on what the cron produces | Vercel publishes no run history, so a check is how you learn whether it worked. |

---

## 🧰 Capabilities at a glance

✅ yes · ⚠️ with a condition · ❌ no · — does not apply

| | Can it? | Details |
|:---|:---:|:---|
| **Where it runs** | ✅ | Vercel's functions, in your projects. |
| **Runs while Cronsole is off** | ✅ | Vercel runs it. |
| **Setup** | ✅ | An access token, then pick projects from a list Cronsole reads for you. |
| **Schedules** | ✅ | Read as declared in `vercel.json`, in UTC. |
| **Sync** | ✅ | Every cron job in the projects you watch. |
| **Run now** | ❌ | Calling the path yourself is not the scheduled invocation ([why](#-the-three-refusals)). |
| **Create** | ❌ | That is a `vercel.json` change and a deploy. |
| **Enable / disable** | ❌ | Vercel only switches crons per project, not per cron. |
| **Edit schedule** | ❌ | Edit `vercel.json`. |
| **Edit what it runs** | ❌ | Edit the route. |
| **Delete** | ❌ | *Remove from Cronsole* stops tracking one cron. |
| **Run history** | ❌ | Vercel publishes none ([the one thing this source cannot tell you](#-the-one-thing-this-source-cannot-tell-you)). |
| **Health** | ❌ | Always `unknown`. *Configured* is knowable here; *working* is not. |
| **Credentials** | ✅ | The token is stored encrypted and never shown again. |
| **Templates** | ❌ | Cronsole creates nothing here. |

---

## 🚫 When to use something else

| 🚫 Use something else for | Instead |
|:---|:---|
| Knowing whether a cron actually worked | Have the job report somewhere Cronsole can read, such as a status endpoint a native [Endpoint check](Cronsole_Native.md#-checks--measure-something-and-compare-it) watches. Vercel publishes no run history. |
| Creating, pausing or running a cron from Cronsole | Vercel itself. This source is read-only by design. |

---

## 🔌 Connecting

1. **Create an access token** in Vercel's account settings.
2. Sources tab → **Vercel Cron** → paste it. Cronsole verifies it before storing.
3. **Pick projects from the list Cronsole reads for you.** The picker shows how many cron jobs each
   project has *before* you commit to it.
4. **Sync.**

A project past the first page, or one under a team the token cannot list, can still be added by
**pasting its dashboard URL**.

> [!WARNING]
> **A team project looked up by bare name will 404.** A name resolves against your *personal* account,
> so a project owned by a team is genuinely not there. Paste the dashboard URL instead — it carries
> the team — and Cronsole's error says so rather than sending you to check spelling.

The token is stored encrypted and never shown again; Vercel cannot re-display one either, so there is
no reveal button and rotating means pasting a new one. Because it is verified before saving, a bad
paste fails at the click rather than inside a sync days later.

---

## 🚨 The one thing this source cannot tell you

**Vercel publishes no run history for a cron job.** Invocations appear in the project's function logs,
behind no stable API. Cronsole has nothing to score with, so **every Vercel task sits at `unknown`
health, permanently** — however well it is actually running.

That is worth stating plainly rather than papering over, because it is the one place this source
gives *less* than GitHub Actions, which reports a real `success` / `failure` / `timed_out` per run.
Cronsole could report "enabled, therefore
healthy" and it would be a lie: **configured** and **working** are different claims, and only the
first is knowable here. Absence of evidence is `unknown`, never `ok`.

If you need to know whether a cron is working, the answer is in your project's function logs or in
whatever the job itself writes — not on this dashboard.

---

## 🚫 The three refusals

- **Create** would mean adding a `crons` entry to your `vercel.json` and deploying it. A code change,
  not a scheduler feature.
- **Run now** *looks* possible — a cron path is a plain HTTP endpoint anyone can call — and is refused
  because calling it **is not the scheduled invocation**. It bypasses your `CRON_SECRET` check, Vercel
  never records it as a cron run, and Cronsole would be reporting a success for something the
  scheduler never did. Use the project's Cron Jobs tab, or `vercel crons run`.
- **Enable / disable** is refused because Vercel has **no per-cron switch to expose**. Crons are turned
  on and off for a whole **project** at once, so a per-task toggle would be inventing a control the
  platform does not have.

---

## 📦 Watching, and un-watching

**You watch a project, not a cron job.** The project name is the category, so adding one brings in
every cron it declares and *Stop watching* takes them all back out. To drop a single cron while
keeping the rest, use **Remove from Cronsole** on that task — the ordinary untrack path works here,
and the next sync will not bring it back.

> [!NOTE]
> **Renaming a project on Vercel re-keys its rows.** The project name is the category *and* part of
> each task's identity, so a rename retires the old tasks and brings in new ones under the new name.
> Cronsole warns on the sync that first sees it; re-add the project to follow the rename.

---

## 📅 Schedules

Vercel documents cron expressions as **UTC with no timezone support** — exactly how Cronsole stores
every schedule. Like GitHub Actions, no conversion layer and none of the DST asymmetry a Windows
trigger carries.

**Two crons on the same path are one row.** Vercel lets a project declare the same path twice with
different schedules; Cronsole stores one schedule per task, so the row shows the first and carries the
rest — rather than being quietly wrong about when it runs, or splitting into two rows fighting over
one identity.

---

## ⚠️ Things that surprise people

- **Reading a project's crons is one request, unlike GitHub's.** A GitHub workflow keeps its cron in a
  file, so each has to be fetched and parsed. A Vercel project hands over every cron definition on the
  project object itself — which is why the picker can tell you a project has three cron jobs before
  you add it, and why the count is exact rather than an upper bound.
- **Disabled is a fact about the project, not the cron.** Vercel turns crons on and off as a unit, so
  when a project's crons are off *every* cron in it shows as Disabled, with that reason attached.
- **There is no next-run time, on purpose.** Vercel queues cron invocations best-effort — on Hobby,
  documented as within the hour of the scheduled time. A computed time would disagree with reality
  with nothing on screen to say which was right.
- **Health comes from your syncs, not from a probe** — the rule every source follows. `getHealth`
  runs every 45 seconds per open tab, so probing would spend your rate limit on a question sync
  already answers.

---

## 📦 Templates

There are none for Vercel Cron. Cronsole changes nothing on Vercel, so a template would have nowhere
to go. Crons are declared in the project's `vercel.json`.

---

## 🔗 Official docs

| Resource | What it covers |
|:---|:---|
| [**Cron jobs**](https://vercel.com/docs/cron-jobs) | Declaring crons, the schedule format, and plan limits. |
| [**Managing cron jobs**](https://vercel.com/docs/cron-jobs/manage-cron-jobs) | `CRON_SECRET`, durations, and securing the cron path. |
| [**Access tokens**](https://vercel.com/kb/guide/how-do-i-use-a-vercel-api-access-token) | Making the token this source connects with. |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="GitHub_Actions.md">GitHub Actions</a>
</p>

<p align="right">(<a href="#vercel-top">back to top</a>)</p>
