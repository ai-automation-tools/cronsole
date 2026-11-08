<a id="github-top"></a>

<h1 align="center">🐙 GitHub Actions</h1>

<p align="center">
  <em>Scheduled workflows in the repositories you watch — read, never written.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shape-observer-2ea44f?style=for-the-badge" alt="Observer">
  <img src="https://img.shields.io/badge/run_outcomes-real-0078D4?style=for-the-badge" alt="Real run outcomes">
  <a href="README.md"><img src="https://img.shields.io/badge/↩-source_guides-6B7280?style=for-the-badge" alt="Source guides"></a>
</p>

---

Cronsole watches repositories and brings in every workflow with an `on: schedule` trigger. It tells
you what is scheduled, when it claims to run, and **how the last runs actually went**.

**Read-only is the design, not a first version.** Every mutating capability on this source's row
reads *Unsupported*, and two of the three have working APIs behind them.

---

## 🎯 Best for

Scheduled workflows that already live in a repository, **watched** beside everything else.

| Automation | Why it belongs here |
|:---|:---|
| A nightly build and test run: `on: schedule: - cron: '0 3 * * *'` | Cronsole shows each run's outcome and the failing step by name. |
| A weekly CodeQL or dependency vulnerability scan | You see a failed scan beside your other tasks instead of in an email you missed. |
| Closing stale issues and PRs with `actions/stale` | Shows whether it still runs, and when it last did. |
| A scheduled link check of a docs site | Real pass or fail per run. |
| A scheduled data refresh that commits JSON back to the repository, or publishes a site | A failure shows up as unhealthy, with a link to the log. |
| A scheduled workflow GitHub switched off after 60 days without activity | Cronsole reports it, with GitHub's reason, which is usually the first anyone hears of it. |

---

## 🧰 Capabilities at a glance

✅ yes · ⚠️ with a condition · ❌ no · — does not apply

| | Can it? | Details |
|:---|:---:|:---|
| **Where it runs** | ✅ | GitHub's runners. |
| **Runs while Cronsole is off** | ✅ | GitHub runs it. |
| **Setup** | ✅ | A personal access token (classic `repo`, or fine-grained *Contents: read* and *Actions: read*), then the repositories or owners to watch. |
| **Schedules** | ✅ | Read as written: GitHub's cron is already UTC, so there is no conversion ([Schedules](#-schedules--the-one-source-with-no-conversion)). |
| **Sync** | ✅ | Every workflow with an `on: schedule` trigger in what you watch. |
| **Run now** | ❌ | A `workflow_dispatch` run is not the scheduled run ([why](#-the-three-refusals-and-why-each-is-a-boundary)). |
| **Create** | ❌ | That is committing a workflow file. |
| **Enable / disable** | ❌ | A repository-state change that belongs behind its own scope. |
| **Edit schedule** | ❌ | Edit the workflow file. |
| **Edit what it runs** | ❌ | Edit the workflow file. |
| **Delete** | ❌ | *Remove from Cronsole* stops watching one workflow. |
| **Run history** | ✅ | Each run's outcome, the failing step by name, and a link to the raw log on github.com. |
| **Health** | ✅ | From real run outcomes. |
| **Credentials** | ✅ | The token is stored encrypted and never shown again. |
| **Templates** | ❌ | Cronsole creates nothing here. |

---

## 🚫 When to use something else

| 🚫 Use something else for | Instead |
|:---|:---|
| Creating, pausing or running a workflow from Cronsole | GitHub itself. This source is read-only by design ([why](#-the-three-refusals-and-why-each-is-a-boundary)). |
| A job that does not need a repository | [Cronsole-native](Cronsole_Native.md) or [Windows Task Scheduler](Windows_Task_Scheduler.md). |

---

## 🔌 Connecting

1. **Create a personal access token.** Classic: the **`repo`** scope. Fine-grained: **Contents: read**
   and **Actions: read** on the repositories you care about.
2. Sources tab → **GitHub Actions** → paste it. Cronsole verifies it against GitHub before storing,
   so a bad paste fails at the click.
3. **Add repositories** by URL or `owner/name` — or a whole **account or organization** by its name
   or URL (`acme`, `github.com/acme`), which watches every repository under it (see below).
4. **Sync.**

> [!WARNING]
> **A private repository that 404s is almost always a scope, not a typo.** GitHub answers `404` rather
> than `403` for anything a token cannot see — deliberately, so a token cannot be used to enumerate
> private repositories. So "not found" is the *expected* symptom of a missing `repo` scope, and the
> status code sends you to check spelling instead. Cronsole names the likely cause in the error.
> ([#73](../../troubleshooting/README.md#73-cronsole-says-a-github-repository-does-not-exist-and-you-are-looking-at-it))

The token is stored encrypted and never shown again — GitHub cannot re-display a PAT either, so there
is no reveal button and rotating means pasting a new one.

---

## 🚫 The three refusals, and why each is a boundary

- **Create** would mean committing a workflow file to your default branch. That is a code change, not
  a scheduler feature, and not one a *New Task* button should be able to make.
- **Run now** would be a `workflow_dispatch` run — which is **not the scheduled run** you came to
  check. The API exists; using it would have Cronsole report a success for something else.
- **Enable / disable** changes repository state and belongs behind its own scopes and its own
  confirmation, rather than slipping in behind a read.

**What would change that.** Of the three, only *Enable / disable* is a candidate: its API
(`PUT …/actions/workflows/:id/disable`) does exactly what the Cronsole verb claims, with no second
meaning. Unlocking it needs a scope you granted on purpose, a confirmation naming the repository, and
the capability cell to stop saying *Unsupported* only once both exist.

---

## 📦 Watching, and un-watching

**You watch a repository, not a workflow.** `owner/repo` is the category, so adding one brings in
every scheduled workflow it has — now and later — and *Stop watching* takes them all back out.

**Or watch a whole owner.** Type an account or organization (`acme`, `acme/*`, `github.com/acme`,
`github.com/orgs/acme`) instead of a repository. It is listed as `acme/*`, and **every sync asks
GitHub again** which repositories it has, so a repository created next month is picked up with no
second step. Three details:

- **The token is the boundary.** Cronsole lists what the token can see (`GET /user/repos`), private
  repositories included. A fine-grained token's repository selection is therefore the allowlist —
  narrow it on GitHub, not here.
- **Forks and archived repositories are skipped**, and the sync note says how many. GitHub runs no
  schedules in either by default.
- **Stopping an owner watch keeps any repository you also added on its own.** Asking for one twice
  and removing the broader ask is not a request to drop the narrower one.

If the repository list cannot be read, or runs past 1,000 repositories, that sync is **partial**: it
adds and refreshes, but retires nothing.

To drop a **single** workflow while keeping the rest, use **Remove from Cronsole** on that task. The
ordinary untrack path works here and the next sync will not bring it back.

> [!NOTE]
> **Adding a repository is the gesture that starts tracking it.** A plain Sync used to filter to
> already-tracked categories and derive them from stored rows — so a freshly added repository had no
> rows, the include-set came back empty, every workflow was filtered out, and **Sync reported success
> over nothing**. Fixed 2026-08-24 by letting a connector declare its own tracked set.
> ([#75](../../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive))

---

## 📅 Schedules — the one source with no conversion

GitHub documents `on: schedule` as **UTC with no timezone support**, which is exactly how Cronsole
stores every schedule. No conversion layer, no lossy-trigger warning, and none of the DST asymmetry a
Windows trigger carries.

**A workflow with several `cron:` entries shows the first one.** Cronsole stores one schedule per
task, so the rest travel with the task and the card says how many there are — rather than the row
being quietly wrong about when it runs.

---

## 🕐 Run history and health

**The run outcomes here are real outcomes.** GitHub reports whether a run succeeded, failed, timed out
or was cancelled — the result of the work. A Windows task can only tell Cronsole that the agent
*accepted a start*, so health here is better founded than on the source Cronsole controls most.

**GitHub disables scheduled workflows after 60 days of repository quiet, silently.** Cronsole surfaces
that as its own health signal with GitHub's reason attached, which is usually the first anyone hears
that a "nightly" workflow stopped two months ago.

---

## ⚠️ Things that surprise people

- **There is no next-run time, on purpose.** GitHub queues scheduled runs best-effort and delays them
  under load. A time computed from the cron would disagree with what actually happens, with nothing on
  screen to say which was right — so the card shows the cron and no prediction.
- **A workflow whose file Cronsole cannot read keeps its row and says why.** "Could not read this" and
  "this has no schedule" are different facts needing different actions, so they never render the same.
- **A sync that saw only part of a repository retires nothing.** If one repository fails while others
  succeed, or a listing is truncated, the tasks Cronsole could not see are left alone rather than
  marked Missing. A task absent from a narrowed view is evidence about the reader, not the task.
- **Health comes from your syncs, not from a probe.** `getHealth` runs every 45 seconds per open tab
  against a 5,000-per-hour rate limit, so probing would spend your budget on a question sync already
  answers.

---

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| Cronsole says a repository does not exist and you are looking at it | [#73](../../troubleshooting/README.md#73-cronsole-says-a-github-repository-does-not-exist-and-you-are-looking-at-it) |
| A watched repository is listed, Sync succeeds, no workflows arrive | [#75](../../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive) |

---

## 📦 Templates

There are none for GitHub Actions. Cronsole changes nothing on GitHub, so a template would have
nowhere to go. Write the workflow file in the repository.

---

## 🔗 Official docs

| Resource | What it covers |
|:---|:---|
| [**The `schedule` event**](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) | Cron syntax, UTC, and the delays GitHub warns about. |
| [**Workflow runs API**](https://docs.github.com/en/rest/actions/workflow-runs) | What Cronsole reads run outcomes from. |
| [**Personal access tokens**](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) | Making the token this source connects with. |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="n8n.md">n8n</a> ·
  <a href="Vercel_Cron.md">Next: Vercel Cron →</a>
</p>

<p align="right">(<a href="#github-top">back to top</a>)</p>
