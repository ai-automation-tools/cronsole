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

## 🔌 Connecting

1. **Create a personal access token.** Classic: the **`repo`** scope. Fine-grained: **Contents: read**
   and **Actions: read** on the repositories you care about.
2. Sources tab → **GitHub Actions** → paste it. Cronsole verifies it against GitHub before storing,
   so a bad paste fails at the click.
3. **Add repositories** by URL or `owner/name`.
4. **Sync.**

> [!WARNING]
> **A private repository that 404s is almost always a scope, not a typo.** GitHub answers `404` rather
> than `403` for anything a token cannot see — deliberately, so a token cannot be used to enumerate
> private repositories. So "not found" is the *expected* symptom of a missing `repo` scope, and the
> status code sends you to check spelling instead. Cronsole names the likely cause in the error.
> ([#73](../../troubleshooting/README.md#73-cronsole-says-a-github-repository-does-not-exist-and-you-are-looking-at-it))

The token is stored encrypted and never shown again — GitHub cannot re-display a PAT either, so there
is no reveal button and rotating means pasting a new one.

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

## 🎛️ What Cronsole can do here

**Sync** and **health**, plus **Remove from Cronsole** on an individual workflow. Everything else is a
stated boundary rather than a pending feature.

## 📦 Watching, and un-watching

**You watch a repository, not a workflow.** `owner/repo` is the category, so adding one brings in
every scheduled workflow it has — now and later — and *Stop watching* takes them all back out.

To drop a **single** workflow while keeping the rest, use **Remove from Cronsole** on that task. The
ordinary untrack path works here and the next sync will not bring it back.

> [!NOTE]
> **Adding a repository is the gesture that starts tracking it.** A plain Sync used to filter to
> already-tracked categories and derive them from stored rows — so a freshly added repository had no
> rows, the include-set came back empty, every workflow was filtered out, and **Sync reported success
> over nothing**. Fixed 2026-08-24 by letting a connector declare its own tracked set.
> ([#75](../../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive))

## 📅 Schedules — the one source with no conversion

GitHub documents `on: schedule` as **UTC with no timezone support**, which is exactly how Cronsole
stores every schedule. No conversion layer, no lossy-trigger warning, and none of the DST asymmetry a
Windows trigger carries.

**A workflow with several `cron:` entries shows the first one.** Cronsole stores one schedule per
task, so the rest travel with the task and the card says how many there are — rather than the row
being quietly wrong about when it runs.

## 🕐 Run history and health

**The run outcomes here are real outcomes.** GitHub reports whether a run succeeded, failed, timed out
or was cancelled — the result of the work. A Windows task can only tell Cronsole that the agent
*accepted a start*, so health here is better founded than on the source Cronsole controls most.

**GitHub disables scheduled workflows after 60 days of repository quiet, silently.** Cronsole surfaces
that as its own health signal with GitHub's reason attached, which is usually the first anyone hears
that a "nightly" workflow stopped two months ago.

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

## 🧯 When something looks wrong

| Symptom | Start here |
|:---|:---|
| Cronsole says a repository does not exist and you are looking at it | [#73](../../troubleshooting/README.md#73-cronsole-says-a-github-repository-does-not-exist-and-you-are-looking-at-it) |
| A watched repository is listed, Sync succeeds, no workflows arrive | [#75](../../troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive) |

---

<p align="center">
  <a href="README.md">← Source guides</a> ·
  <a href="Gemini_API_Triggers.md">Gemini API Triggers</a> ·
  <a href="Vercel_Cron.md">Next: Vercel Cron →</a>
</p>

<p align="right">(<a href="#github-top">back to top</a>)</p>
