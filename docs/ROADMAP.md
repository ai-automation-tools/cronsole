# Cronsole Roadmap

> The living plan for Cronsole — what's shipped and what's still open, in priority order.

**How to read this file:** it is a **checklist**, not a narrative. Every line is one item with a
state and a date. The reasoning, design records, verification notes and dated addenda that used
to live here were moved to [`CHANGELOG.md`](CHANGELOG.md) on **2026-08-04** — shipped work is
described there under its date, and the full pre-2026-08-04 roadmap narrative is preserved
verbatim in that file's *Roadmap narrative archive* appendix.

**Update rule:** when a task ships, tick it here with a date and write what changed in
[`CHANGELOG.md`](CHANGELOG.md). When a material decision changes scope, edit the item here
first, then implement. Keep the lines short — if an item needs a paragraph, the paragraph
belongs in the CHANGELOG.

**Legend:** `[ ]` open · `[~]` partially shipped · `[x]` complete

> **Note on names.** The product was called **TaskHub** until 2026-07-31. This file is
> current-tense description, so it says Cronsole throughout; the historical entries in
> `CHANGELOG.md` keep the old name on purpose.

---

## ▶ Next up

### 🔴🔴 Top priority — requested 2026-08-15

Three items, requested directly after the dashboard IA redesign landed. Ordered as given.

1. **Custom views on the source rail.** Users can already save a named filter combination, but it
   becomes a chip in the horizontal views bar. Let them save one **into the rail**, alongside
   *All sources* and *Favorites*.

   **The design question to settle first, because it decides everything else:** the rail is
   *navigation* (**where** a task lives) and views are *slices* (**which** of them). Favorites
   crossed that line on 2026-08-15 and it worked, because a starred set reads as a place. A saved
   view is less obviously one. Two candidate shapes:
   - **Scopes** — a rail row saves only the rail's own dimensions (source + category + favorites)
     and composes with whatever view is lit, exactly as Favorites does. Consistent with every other
     row; cannot express "failing Windows tasks" as one click.
   - **Pinned views** — a rail row carries a full `TaskFilters`, so picking one *replaces* the view.
     More powerful, but it makes the rail's rows behave in two different ways depending on origin,
     which is the folder-vs-source inconsistency that this redesign existed to remove.

   Whichever wins, the invariants it must not break: `filtersEqual` ignores the rail's dimensions,
   `viewFiltersFrom` strips them, the Filters badge counts none of them, and **every rail count is
   taken with every rail dimension neutralized** (see the 363-vs-6 bug below). A rail row also needs
   a delete affordance and an order — `savedViews` is currently an unordered array.

2. **More Cronsole-native job types.** Native has exactly two — `HTTP` and `EXEC` — and they are the
   `STRUCTURAL_SUBTYPES` the rail always lists. Widen that set so Cronsole is useful without an
   agent on more than "call a URL" and "run a program".

   Candidates worth scoping: a **script** type that writes an inline body to a temp file and runs it
   under a named interpreter (PowerShell / bash / python), so a user does not need the script on
   disk first; a **database query**; an **MCP tool call**; a **compound/sequence** job. Each new type
   touches the same five places, and missing one is how a job is accepted at create time and fails
   at 3am: `buildNativeJob` + `validateJob` (`services/nativeJob.ts`, one definition shared by
   create, edit and the connector), `NativeTaskExecutor`, `taskSource.ts` (the server derives the
   subtype — the browser must not), `STRUCTURAL_SUBTYPES` + an icon in the rail, and at least one
   template per type, since a source with nothing in the catalog is a source the product does not
   really have. The `EXEC` rules carry over unchanged and are non-negotiable: **no shell** unless the
   user names one, and **`childEnv()`, never `process.env`** — a scheduled job must not inherit the
   key that encrypts every stored platform credential.

3. **Fix the themes — light first.** The light theme clashes and is hard to read; the dark theme's
   palette is also open to reconsideration. This is `frontend/src/index.css` and nowhere else: every
   colour is already a semantic role token, which is what makes a theme pass an edit *there* rather
   than a 263-site sweep.

   What to check rather than guess at: the roles were tokenised on 2026-08-12 specifically because
   the light theme was wearing dark mode's status colours and **every status role failed WCAG AA on
   white (1.67–2.77 against a 4.5 bar)**. That fix corrected the `-text` variants; it did not audit
   the whole light ramp, and the surface steps are the likely culprit now — light runs
   `background 100% → surface 95% → raised 98%`, which inverts the dark ramp's direction and gives a
   *raised* panel less contrast than a *surface* one. Measure contrast for every role pair in both
   themes before changing values, and keep the two rules the token system exists to enforce: the
   accent (`--x`) and its text form (`--x-text`) are separate because the text version must invert
   between themes and the accent must not; and a shared hue is not a shared role (`--system` vs
   `--claude`, `--danger` vs `--isolate`). Any change here is visible on every screen, so it wants
   the visual-regression baselines regenerated — note that masking hides colour, not geometry
   ([#43](troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)).

4. **Verify the redesigned dashboard on a phone — it has never been seen at that width.** The
   top toolbar, the source rail and its drawer all shipped on 2026-08-15 with their responsive
   classes written and read back as correct, and **not once rendered below `md`**. The browser
   automation used to check everything else reported `resize_window` as succeeding while
   `window.innerWidth` stayed at 2124 and `matchMedia('(min-width: 768px)')` stayed `true`, so the
   breakpoints never fired.

   **The unit suite cannot cover this**: jsdom does not evaluate CSS media queries, so `hidden
   md:flex` is invisible to it — every test passes whether the class is right or wrong. What needs
   eyes (or a viewport-setting test) at 375px: the rail `<aside>` disappearing, the *Sources* button
   beside the page heading opening the drawer, picking a source closing it, the toolbar dropping its
   labels to icons below `sm`, the breadcrumb being the only thing naming the current folder, and
   the FAB not colliding with the sticky filter zone. Also worth a look: page padding moved off
   `<main>` onto each screen in the same change, so a screen that forgot its wrapper is flush to the
   edge only at small widths.

   **Playwright is the fix, not a manual pass** — the e2e suite already exists (`npm run test:e2e`)
   and Playwright sets the viewport directly rather than resizing a real window, so this can become
   a standing check instead of something re-verified by hand every time. The `<375px` requirement is
   a first-class target (CLAUDE.md §9) and is currently unenforced by anything.

### 🔴 Start here next session — 2026-08-13 follow-ups

Left open at the end of the 2026-08-13 MCP/Claude test pass and the cron-parsing sweep that came
out of it. Ordered worst-first. Items 1–2 are the **unfixed remainder of the defect class** fixed in
[troubleshooting #51/#51a](troubleshooting/README.md#51a-the-same-bug-in-the-step-branch--and-this-one-never-errors-at-all) —
they are the same `parseInt`-on-a-multi-value-field shape on surfaces outside that commit's blast
radius, and they are listed here rather than left in the completed item so they cannot read as done.

1. **`shiftCron` stores a zoned cron 7–8 hours off, silently** — `frontend/src/utils/timezone.ts`.
   The `isNum` guard correctly *refuses* to shift a multi-value hour, then returns `shifted: false`
   with **no `reason`**, so a Pacific user typing `0 9-17 * * 1-5` has it stored verbatim as UTC with
   nothing on screen. `reason` exists for exactly this case ("has a clock time we would have moved
   but could not"); the two paths that set it only cover midnight-crossing. **The most user-facing
   item on this list** — it is wrong output, not a confusing message.
2. ~~**The gallery's `describeCron` drops day-of-month values**~~ — **fixed 2026-08-13.**
   `registry-site/index.html` rendered `0 9 1,15 3 *` as *"March 1st"* (`parseInt('1,15')`). The
   month branch now returns **no reading at all** for a multi-value day rather than a confident
   wrong date; the raw cron is printed beside it and stays true. Ships with the template-catalog
   publish (`publish-registry.ps1` + `publish-frontdoor.ps1`), which is what it was waiting on.
3. **A `MISSING` Claude row cannot be removed by anything** — delete a routine at claude.ai and its
   Cronsole row is correctly detected as `MISSING`, but `untrack_task` 400s for `CLAUDE_CODE` and
   `disconnect_claude_routine` only reaches *declared* routines. OAuth mode can now produce tracked
   Claude rows that nothing in `PlatformConnection.config` declares, so the documented escape hatch
   does not cover them. Two such rows are stranded on the dev machine today.
4. **Two refusal messages point at each other** — `delete_task` on a Claude task says *"untrack it
   instead"*, and `untrack_task` 400s for `CLAUDE_CODE`; neither names `disconnect_claude_routine`.
   The delete copy predates Claude being added to untrack's refusal list. Same pass: untrack's
   message promises removing the routine *"also forgets its API token"*, which an OAuth-created
   routine never had.
5. **`list_platforms`' MCP tool description is stale** — it still teaches that *"Claude Code reports
   `create` and `setStatus` as unsupported, because Anthropic exposes exactly one routines
   endpoint"*. The matrix itself now correctly reports both as `verified`. A §11a mirror surface, and
   the description is what an agent reads *before* deciding what is possible.
6. **`update_task_schedule` echoes a next-run time it computed** — the immediate response carries
   `computeNextRun(cron)` while the platform's real value (Anthropic's jitter; Windows' trigger)
   only lands on the next sync. Storage converges, so this is the response shape only — but it is
   the [#42](troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday)
   shape: a timestamp whose label does not name the event that produced it.
7. **The sync response's `missing` is a delta, not a state** — it counts rows *newly* marked
   `MISSING` by that pass, so it reads `0` beside `count: 5` while two rows sit `MISSING`. Defensible,
   but it is presented next to a state field and invites the wrong reading.
8. **`NativeTaskExecutor.test.ts` is flaky under parallel load** — one test timed out at 7s in a full
   run and passed in isolation and on re-run. It spawns real processes. Not investigated.

**Chores, not roadmap items** (dev machine, 2026-08-13): the MCP host needs a restart to load the
rebuilt `mcp-server/dist/`, and the Windows task `Cronsole conversion-response probe (safe to
delete)` in `\Cronsole` is left disabled and wants deleting.

> The [API-token P0](#-p0--security-hardening--reopened-2026-08-13) below is unchanged and is still
> the largest open item — nothing here demotes it. These sit first because they are small, known,
> and were found by hand rather than reported.

---

**🔴 [API tokens are the top priority](#-p0--security-hardening--reopened-2026-08-13)** *(2026-08-13)* —
the only way to get a token for the MCP server is to run `jsonwebtoken.sign` by hand with the
backend's `JWT_SECRET`. That is not a workaround someone invented; it is
[what our own guide tells them to do](user-guides/guides/MCP_Server_Guide.md#getting-a-token). The
product cannot issue a credential its own documented integration requires. Ahead of Sources
because it gates every non-browser client and is the last thing anyone should discover on a
30-day expiry.

**[Sources](#-sources--where-a-task-comes-from) is the priority after that** *(scoped 2026-08-12)* — the
dashboard's first-level axis is now where a task comes from, and the plan is to fill it in. In order:

1. ~~**Native job types — scripts**~~ — **shipped 2026-08-12.**
2. ~~**API / Web Services source**~~ — **resolved and shipped 2026-08-12** as a subtype split of
   Cronsole-native (HTTP / Scripts), not a new platform.
3. **POSIX agent** — launchd · cron · systemd timers in one build. The one that actually broadens
   the product.
4. ~~**Claude Code routines**~~ — **shipped 2026-08-12, and completed 2026-08-13** with the full
   read/write connector: list, create, reschedule, pause and token-free run. *(This line said the
   platform exposed "one write-only endpoint, so sync / create / enable-disable are boundaries
   rather than gaps" — true of the documented API, false of the product. See
   [#50](troubleshooting/README.md#50-two-claude-routines-apis-and-the-documented-one-is-the-smaller-one).)*
5. **GitHub Actions** — read-only observer, ~a day. Note it is the **mirror image of Claude**:
   reads everything, changes nothing. Between them they bracket the observer pattern.

Everything below the sources track, unchanged in priority relative to each other:

6. **Versioning & releases** — semver, tagged releases, changelog discipline. Also unblocks the
   deliberately-skipped `version` fields in the package manifests.
7. **Restore's plan doesn't check that a task's action points at anything that exists** — the
   advisory resolvability column, logged 2026-07-31 (see P2 Open).
8. **Task-detail trust indicators** — say how old the truth is, per task (see P2 Open). The
   dashboard health strip now answers this at the *platform* level; the per-task half is open.
9. **Bulk export's directory-picker branch is still undriven** — the one part of the Tools tab no
   click-through has reached, because it opens a native dialog. Low priority; noted so its absence
   stays visible rather than being mistaken for coverage.

> **The UX & UI refinement pass is complete** *(2026-08-12)* — all six items, plus two defects it
> uncovered. Details in [`CHANGELOG.md`](CHANGELOG.md) and P2 below.

---

## 🔷 Sources — where a task comes from

> **The current top priority** *(scoped 2026-08-12)*. The dashboard's first-level axis is now the
> **source** a task comes from, and Cronsole ships with two: Windows Task Scheduler and
> Cronsole-native. This section is the plan for the rest.
>
> **Read the guardrail change first** ([Strategy guardrails](#strategy-guardrails)): the capability
> matrix makes a **read-only observer** an honest, complete product state, so a source no longer has
> to be fully controllable to be worth shipping. Controllers stay gated on reliability; observers
> do not. That is what makes this list affordable rather than a return to breadth-over-depth.
>
> **Ordering principle: prefer the build that unlocks several sources over the one that unlocks
> one.** A POSIX agent covers launchd, cron *and* systemd timers with one protocol and no new auth
> story. Each cloud scheduler costs its own OAuth surface, rate limit and mental model, and unlocks
> exactly one.

- [x] **Native job types — scripts** *(shipped 2026-08-12)*: Cronsole-native runs
      HTTP and nothing else, so the source you already own cannot run a script. Add an `EXEC` job
      type reusing **`StructuredAction {executable, args[]}`** — the tested no-shell primitive that
      already backs Windows task creation, so this is the existing P0 injection guarantee applied to
      a second executor, not a new attack surface.
      **The honesty problem that must be solved with it:** a native job runs *where the backend
      runs*. On a host-run backend that is your machine; in the Dockerized backend the same task
      silently runs **inside the container**, against a filesystem that is not yours — one task, one
      UI, two meanings. So containerization is **detected at boot** (`/.dockerenv` / cgroup) and the
      New Task modal states which one it is. A task that cannot say where it executes is the same
      class of lie as a timestamp that cannot say what it measured.
      Real `ExecutionLog` rows (exit code, duration, output snippet) — native's genuine advantage
      over Windows, where `SUCCESS` only means the agent accepted a start.

- [x] **API / Web Services source — resolved as a subtype split** *(decided and shipped
      2026-08-12)*: Cronsole-native divides in the source bar into **Cronsole (HTTP)** and
      **Cronsole (Scripts)** rather than becoming a new platform. A source key is `PLATFORM` or
      `PLATFORM:SUBTYPE`, derived server-side in `services/taskSource.ts`.
      **Platform and source are deliberately different things:** the Platforms tab does not split,
      because native HTTP and native scripts are the same connector with identical capabilities.
      Matching is prefix-aware, which is what let this ship without emptying every stored
      `defaultPlatform`; and the selected source stays listed even when no task derives it, or a
      pre-split link filters the list with the whole bar unlit.
      **The umbrella-grouping reading (c) is still open** for when three hosted observers exist to
      group — it is a presentation question about the bar, not a data-model one, so it no longer
      blocks anything.

- [ ] **POSIX agent — launchd · cron · systemd timers** *(the big one, and the one that actually
      broadens the product)*: all three are **local OS schedulers**, structurally identical to
      Windows Task Scheduler — read the machine, run a thing, enable/disable. One build reuses the
      whole existing protocol: outbound WebSocket, HMAC-signed commands, the sync model, folder/path
      handling, the capability matrix. **Three of the most universal developer schedulers, one
      auth story, zero new server surface.** Absorbs the former standalone *macOS agent (launchd)*
      P3 item and the 7 catalog templates waiting on it.
      Open sub-questions: whether the agent is a .NET port (the `ITaskScheduler` abstraction ports
      cleanly) or a separate binary; per-user vs system crontab; and how a systemd timer's
      `OnCalendar` maps onto 5-field cron, which is lossy in both directions and needs the same
      honest-warning treatment the Windows trigger conversion already has.

- [x] **Cron→trigger conversion: multi-value hour and minute fields** *(2026-08-13)*. `0 9-17 * * 1-5`
      ("every hour, 9–5, weekdays") converted at **confidence 1.0 with no warnings** into a malformed
      `startBoundary` of `"9-17:00"`, because `parseInt('9-17')` is `9`. Same defect as the Monday-only
      `1-5` day-of-week bug fixed 2026-07-14 — **one field over, and missed when that one was fixed**;
      lists (`9,17`), ranges (`9-17`), minute-side equivalents (`0,30 9 * * *`) and out-of-range values
      (`0 25 * * *`) were all affected.

      Nothing wrong ever reached Task Scheduler — the agent rejected the malformed boundary — so it
      surfaced as a `500`/`502` ("the platform failed, retry") for a schedule Cronsole cannot express,
      and pointed debugging at the one layer that was behaving. These now land on the documented
      replaced-with-hourly fallback with a warning naming the workaround (several start times means
      several tasks).

      **Carried a second fix that was previously unreachable:** a lossy conversion now rides the
      **success** of `PATCH /api/tasks/:id/schedule` (and MCP `update_task_schedule`), not just the
      refusal — otherwise fixing the converter would have traded a noisy `502` for a silent `200` over
      a task quietly rescheduled to ~24 runs a day. See [troubleshooting #51](troubleshooting/README.md#51-a-schedule-edit-returns-502-for-a-cron-that-is-simply-not-expressible).

      **Grepping for the pattern instead of fixing the one instance (#21's rule) found two more, and
      the worse one.** `*/10,45 * * * *` and `0 */6,13 * * *` passed `startsWith('*/')` and were read
      as clean `PT10M`/`PT6H` steps at confidence 1.0 — and because a mis-parsed *step* yields a
      **well-formed** trigger, the agent accepted it and the task ran on the wrong schedule
      indefinitely, with nothing anywhere to notice. The malformed-boundary bug at least failed loudly.
      The reverse direction (`convertWindowsTriggerToCron`, which reads triggers off real machines) was
      hardened for the same reason: it read `"9-17:00"` as `0 9 * * *` at confidence 1.0.

      **Found by the same sweep and deliberately not bundled here** — two other surfaces carried this
      defect class. `registry-site` `describeCron` was fixed 2026-08-13 with the catalog publish;
      `timezone.ts` `shiftCron` is still open. Both are items 1–2 of
      [Start here next session](#-start-here-next-session--2026-08-13-follow-ups); that block is the
      live list, so do not track them from here.

- [x] **Claude Code routines — full read/write connector** *(2026-08-13)*. Cronsole lists the real
      routines on the account (name, 5-field UTC cron, enabled state, next run), **creates** them,
      reschedules them, pauses and resumes them, and fires them **without a per-routine token**.

      **This item existed because the 2026-08-12 entry below was wrong, and the way it was wrong is
      the reusable part.** That entry recorded, as a finding, that Anthropic exposes exactly one
      routines endpoint and that sync / create / enable-disable were therefore *boundaries, not
      gaps*. The finding was sound about the **documented** API and false about the product: Claude
      Code has always created and listed routines through `/v1/code/triggers`, authenticated with
      the account's OAuth session rather than a per-routine token — the API `/schedule` uses. The
      previous check asked *"what does the vendor document?"* and recorded the answer as *"what can
      the platform do?"*. **A capability claim needs evidence about the platform**; a doc search is
      evidence about the docs. Verified this time by driving every verb against the live API
      (create, partial update, reschedule, pause) before any of it was built on.

      - **Two modes, both kept.** `services/claudeOAuth.ts` decides per call. With a readable
        Claude Code session: real sync, create, setStatus, updateSchedule, token-free run. Without
        one: the previous declared-registry + fire-token behaviour, unchanged. **The fallback is
        load-bearing** — door 2 is undocumented and beta-gated, and a connector that deleted the
        documented path would take every user's routines down the day the beta header expires.
      - **`unsupportedVerbs` became a getter**, because the matrix's claim is about *this install*.
        Corollary that bit during the work: any test asserting Claude's capabilities must mock the
        credential, or it passes or fails according to whether the developer is signed in.
      - **The credential is read, never stored, never refreshed.** Refreshing would rotate the CLI's
        own token and could sign the user out of Claude Code from a background poll. Expiry is
        reported (`/login`), never repaired.
      - **Delete is still impossible — and this time verified**, by enumerating the surface rather
        than reading docs. Neither API family has a DELETE. Cronsole disables; claude.ai removes.
      - **MCP**: `create_claude_routine` added (26 tools); `list_claude_routines` reports
        `session.mode`. Routines are created with **no MCP connectors attached** — the server would
        otherwise attach every connector on the account.
      - **Also fixed on the way:** `updateSchedule` took a `WindowsTrigger` and the route rejected
        any cron it could not convert — so a reschedule Anthropic would have accepted was refused
        over a Windows trigger nothing in that path would use. It now takes the cron, with the
        native trigger as an option, and connectors flag `clientError` so a bad request answers
        400 rather than a retry-implying 502.

- [x] **Claude Code routines — promoted as far as the platform allows** *(requested and shipped
      2026-08-12; **its central finding was superseded 2026-08-13**, see above — kept as written
      because the reasoning is the record of how a documentation search got mistaken for an API
      audit)*: the connector is production-ready for the one verb that has an API behind it,
      and everything else is now declared impossible rather than left looking unfinished.

      **The API check the item asked for changed the item.** Anthropic exposes exactly one routines
      endpoint — `POST /v1/claude_code/routines/{trig_id}/fire` — and the reference states its
      token's scope as *"One routine only; **no read access**."* There is no list, get, create,
      enable/disable, or token-management endpoint. So of the four things this item asked for, three
      are **not gaps but boundaries**: real sync and enable/disable cannot be built at all.
      Shipped instead:
      - **`run` — real.** Correct beta header, and the documented statuses mapped to causes a user
        can act on. Two matter: a **400 is usually a paused routine** (the *only* signal Cronsole
        ever gets about a routine's enabled state), and a 429 is a quota boundary, not a bad config.
      - **Health from evidence** — read back from the `PlatformCapability` rows the run route
        already writes. It previously returned `HEALTHY` whenever config was non-empty: a verdict
        from a precondition, troubleshooting #40's exact shape. **It cannot probe**: the only
        endpoint has a side effect, so "check this works" and "run the user's routine" are the same
        request — a probing health check would fire someone's nightly job on every poll.
      - **`create` and `setStatus` are `unsupported`, not `declared`** — a new `unsupportedVerbs`
        declaration on `PlatformConnector`, because both methods are interface-mandated refusals
        that no evidence can ever promote. `declared` reads as *"reachable, just unproven"* and
        invites waiting for something that cannot arrive.
      - **Two fixes worth naming**: the fire body no longer carries filler text (it arrived as the
        routine's `<routine-fire-payload>`, so for a routine whose prompt reads that block it
        *displaced* the real context), and the token is destructured out of task metadata rather
        than set to `undefined`, which left the key present and relied on `JSON.stringify` dropping it.

      Left as-is deliberately: `syncTasks` returns the routines the user **declares** in the
      connection config. That is not a sync and is documented as not being one — it earns its place
      only because a declared routine gets a dashboard row, a working Run button and real run
      history, which is strictly more than the bookmark the quick-links-only platforms get.

- [x] **A Claude task is its declaration** *(2026-08-12)* — closes the reported loop where a routine's
      task came back after every *"Remove from Cronsole"*, with `TaskExclusion` empty as if untrack
      had never run.

      Untrack ran; its exclusion was then legitimately cleared. `TaskExclusion` assumes the Windows
      shape — the task is on the machine, sync enumerates the machine, Cronsole remembers *"don't
      re-import this"*. Claude inverts it: with no list API, `syncTasks` returns the routines declared
      in `PlatformConnection.config`, so **the registry is the platform** and the exclusion fenced the
      user's own config off from itself while the declaration stayed. Importing the Claude category
      clears exclusions *by design*, which un-hid a routine that was never gone. The mirror half:
      removing the routine left its task row behind as an un-runnable orphan.

      Fixed as one mechanism — untrack **400s** for `CLAUDE_CODE` (bulk refuses per item without
      halting), disconnecting the routine **removes its tasks and history** and writes **no**
      exclusion, and the modal offers *Disconnect routine*. **Refused rather than widened**: making
      untrack drop the routine too would silently spend a token claude.ai shows once, under a label
      that mentions no credential. Pinned by an integration suite that reproduces the loop against
      real Postgres. See [troubleshooting #47](troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole).

- [x] **Renaming a task** *(2026-08-12)* — pencil in the task modal, `name` on `PATCH /api/tasks/:id`,
      `rename_task` over MCP. Works on every platform; a rename is a **Cronsole label**, DB-only, and
      the modal keeps the real `externalId` on screen and says so once the two diverge.

      **This was logged as a three-way design fork and turned out not to be one**, which is worth
      keeping as a record of how the wrong recommendation got made. The fork was read off the code —
      `upsertTasks` does `update: { name: t.name }`, therefore a rename reverts, therefore you need
      either a `displayName` column (recommended at the time) or an agent-side rename. Nobody had
      asked whether that line *can fire*. It cannot: a Windows task's name is the last segment of its
      path and the path **is** `externalId`, the key the row is matched on — so renaming on the
      machine yields a **different task** (old path MISSING, new path imported), never a new name on
      this one. Checked against the live DB: **354 Windows tasks, zero** whose stored name differed
      from their path leaf. Claude's name is the user's own declaration; a native row *is* the task.

      So option (a) — stop overwriting `name` — costs nothing, needs no migration, and `displayName`
      would have been a second column maintained against an event that cannot happen. **Lesson: a
      line of code is evidence that something was intended, not that it is reachable.**

- [x] **Editing a Cronsole-native job spec** *(2026-08-12)* — `PATCH /api/tasks/:id/job`, an Edit
      pencil on the task modal's Action section, and an `update_native_job` MCP tool. A native HTTP
      task's URL previously could not be changed at all; the only route to a different URL was delete
      and recreate, losing the run history.

      Kept as its own route rather than folded into `/actions`: that one asks the elevated agent to
      rewrite a task on the machine and records nothing until the platform confirms, while this one
      rewrites a row the backend owns — the write *is* the change, and it works with the agent
      offline. It **replaces** the job (the two job types share no fields, so a merge strands one
      type's fields inside the other) and reuses the create route's `buildNativeJob` + `validateJob`,
      so an edit can never produce a spec creation would have refused.

- [ ] **The last unedited attribute** *(reported 2026-08-12)*: **category** (inline), **schedule**
      (Windows + native), **action/command** (Windows), **job spec** (native) and **name** (all
      platforms) are now editable. A task's **`externalId`** is not, and probably should not be —
      it is the identity the row is keyed on and the address every signed agent command uses. For
      Windows it is the Task Scheduler path, so "editing" it means moving the task on the machine;
      for Claude it is the routine id, which `edit_claude_routine` already re-points properly. Left
      open as a question rather than a task: is there a case for it that is not one of those two?

- [ ] **`NativeTaskExecutor` has one intermittently failing test** *(logged 2026-08-12)*:
      `reports a non-zero exit as failure, and keeps stderr` failed roughly 1 run in 3 under full-suite
      load and passes in isolation and across 6 consecutive clean runs. **Not the obvious cause** —
      `executeJob` resolves on `'close'`, not `'exit'`, so stderr is flushed before it settles; the
      code is right and this is a test-level timing issue, not truncated logs. Logged rather than
      chased: a flaky test quietly erodes trust in the suite, so it should be pinned down, but it is
      not evidence of a product defect.

- [x] **`HealthState` has no `UNKNOWN`, so "never checked" has to borrow a verdict**
      *(logged 2026-08-12, shipped 2026-08-13)*: the enum was `HEALTHY | DEGRADED |
      OFFLINE`. A configured-but-never-exercised platform is none of those, so the Claude connector
      reported `DEGRADED` with a reason naming why — pessimistic-with-an-explanation, chosen because
      the failure it prevents is trusting a config nothing has checked.

      **A fourth instance found it in the field, and it is the one that made the item urgent.**
      Windows sat at *"Agent connected but not responding (task:folders timed out)"* for **ten and
      a half hours** over an agent that answered a sync immediately when finally asked. Health is
      the newest of `lastResponseAt` against `lastFailureAt` — correct, and with no notion of an
      observation getting old. One timeout at 21:05, nobody using Cronsole overnight, and the
      strip reported it in the present tense until morning ([troubleshooting #48](troubleshooting/README.md#48-windows-sits-at-degraded-for-hours-while-the-agent-is-perfectly-healthy)).

      That sharpened what the missing state was actually for. It is not only *"never checked"* —
      it is **"no current evidence"**, which covers a verdict that has expired as well as one that
      never existed. And it named the rule the other three instances were groping at:
      **evidence of a connection renews itself and evidence of a failure does not**, so a socket
      may stand indefinitely while a timeout must age out. Fifteen minutes
      (`UNRESPONSIVE_EVIDENCE_TTL_MS`), which is long enough that an agent someone is actually
      trying to use stays `DEGRADED` — each attempt renews the evidence.

      **Shipped:** `UNKNOWN` on the enum (two migrations — Postgres refuses to *use* a new enum
      value in the transaction that adds it), rendered as **"Not checked"** in neutral colours in
      `healthMeta` / `HEALTH_STYLE`; the aging rule in `WindowsAgentConnector.getHealth`; all four
      no-evidence branches in `ClaudeConnector` moved off `DEGRADED`; the schema default and both
      hardcoded `healthState: 'HEALTHY'` creates removed, so a connection is no longer born
      Online. `HealthStrip` ranks `UNKNOWN` below the two observed problems but **above healthy**,
      or the green *"All 3 platforms online"* would have replaced the amber lie with a worse one.
      The `list_platforms` MCP description now says `UNKNOWN` means "no current evidence", not a
      problem to route around.

      **Four instances of the same shape, none of them Claude-specific — all now closed:**
      1. `getHealth` deriving a verdict from a precondition — fixed in `ClaudeConnector` 2026-08-12;
         its four no-evidence branches now return `UNKNOWN` rather than borrowing `DEGRADED`.
      2. `POST /api/tasks/health` auto-creating the Windows connection with a hardcoded
         `healthState: 'HEALTHY'` before the agent had ever said anything — the literal removed, so
         the row takes the default and the same request derives the real verdict a few lines later.
      3. **The schema itself**: `PlatformConnection.healthState` was `@default(HEALTHY)`, so *every*
         connection was born Online. Found when the routines route created one and the Platforms
         card immediately read *Online* having contacted Anthropic never. Worked around there by
         recomputing health on write (`refreshClaudeHealth`) — safe only because Claude's
         `getHealth` does not probe, and **not** a pattern to copy to a platform whose health check
         talks to the platform. Now `@default(UNKNOWN)`, which makes the workaround belt-and-braces
         instead of load-bearing. **No backfill**: every stored value was written by a real poll, so
         overwriting it would discard a true verdict to make the column uniform.
      4. **A verdict that expired** — the Windows case above. The one that had to be *observed*,
         because the other three are visible by reading the code and this one only shows up as a
         status that is quietly hours out of date.

      **Testing note worth keeping.** The connector's existing DEGRADED test used hardcoded
      absolute dates, which were fine while the rule was "newest evidence wins" and silently became
      *two days stale* the moment freshness entered the verdict — it kept passing, for the wrong
      reason. The cases now fix the clock relative to the failure. And the first mutation used to
      check them was itself worthless: setting the TTL to `MAX_SAFE_INTEGER` also moved the tests,
      since they derive their clock from the same constant. Deleting the branch is the mutation that
      proves anything.

- [x] **Claude connection config — the panel that makes the connector reachable**
      *(shipped 2026-08-12)*: the connector above was correct and **unreachable** — the only
      `platformConnection.create` in the codebase was the Windows auto-init, so nothing could write
      a routine id or token. Now `GET`/`POST`/`DELETE /api/tools/platforms/claude/routines` plus a
      **Routines** panel on the Claude card in the Platforms tab.

      Claude-specific rather than a generic `PUT /platforms/:platform/connection` on purpose: a
      generic route would imply the other platforms are configurable this way (they are not) and
      would have to accept an arbitrary JSON blob into a field every connector trusts. Each
      platform gets its own validated shape when it needs one.

      Decisions worth keeping: **the token is write-only** across all three routes (`hasToken`, never
      the value; no reveal endpoint, because claude.ai cannot re-display it either and a second copy
      would be a secret with a longer life than it needs); **re-adding an id rotates rather than
      409s**, since generating a token at Anthropic revokes its predecessor, so the stored one is
      already dead by the time the user gets here; **a pasted fire URL is normalized to its `trig_`
      id**, because the modal shows the URL beside the token and storing it would 404 much later
      with nothing pointing back at the paste; **shape mismatches warn rather than refuse**, since
      `/fire` is experimental behind a dated beta header; and **removing the last routine removes
      the connection**, so the card reads "Not connected" instead of sitting at amber
      *"No routines configured"* forever for someone who never finished setup.

- [ ] **GitHub Actions — read-only observer** *(~a day)*: near-universal for developers, and
      scheduled workflows are invisible until they break. `on: schedule` cron is **already UTC**, so
      it matches the storage contract exactly — no conversion layer and none of the DST asymmetry
      Windows carries. The API gives **real run outcomes**, which would make the health scoring
      genuinely good here rather than the "agent accepted a start" approximation Windows forces.
      Ships as an observer: sync + health verified, every mutating verb `unsupported`.

- [ ] **Vercel Cron · Supabase `pg_cron` — read-only observers**: increasingly the default for web
      and indie developers, and both have trivial APIs. Same observer shape as GitHub Actions.

- [ ] **Deferred — Kubernetes CronJobs · AWS EventBridge Scheduler · Azure Functions · Google Cloud
      Scheduler**: common in *teams*, rare for a solo developer, and each is its own auth surface,
      rate limit and mental model for exactly one source. Revisit only after the observer pattern
      has proven itself on the two above. Kept here rather than dropped so the omission stays a
      decision rather than an oversight.

- [ ] **Staying quick-links-only — ChatGPT · Gemini · Jules**: no public scheduled-task API exists.
      A connector would render a row of `unsupported` that says strictly less than the link already
      does. Revisit if an API appears.

---

## 🔴 P0 — Security hardening — REOPENED (2026-08-13)

*Closed 2026-07-09; reopened for one item. The five below are still done — what reopened this is a
gap none of them covered, because it is not a hole in a mechanism but the **absence** of one.*

- [ ] **API tokens — the product cannot issue the credential its own docs require** ← **top priority**
      *(found 2026-08-13, while answering "where do we have `CRONSOLE_TOKEN`?")*

      **Symptom.** The working `CRONSOLE_TOKEN` on this machine is a JWT with a **30-day** life and
      an `email` claim (`mike@example.com`) that does not match the user row it points at
      (`mikeschecht@gmail.com`). Neither is something Cronsole can produce: `generateToken`
      hardcodes `expiresIn: '24h'` and signs the user's real email.

      **It was not improvised.** [`MCP_Server_Guide.md` › Getting a token](user-guides/guides/MCP_Server_Guide.md#getting-a-token)
      instructs the user to run `jsonwebtoken.sign(..., {expiresIn:'30d'})` in a shell with
      `JWT_SECRET` in scope. **That is the documented integration path**, and it is the only one.
      So the finding is not "someone hand-minted a token" — it is that **hand-minting is the
      product's answer**, and it requires the signing secret, a `userId` read out of the database,
      Node, and a shell. A stranger following the MCP guide has to forge a credential to use a
      feature we ship.

      **Four specifics, in the order they bite:**
      1. **No issuing surface.** The auth surface is exactly `GET /status`, `POST /setup`,
         `POST /login`. `/login` returns the same 24h session JWT the browser uses — fine for a tab,
         useless for a long-lived stdio client that cannot re-authenticate.
      2. **Silent daily expiry.** Because a login token lasts 24h, the honest path costs a daily
         re-export. And an unset or expired var does not error usefully — the MCP server refuses to
         start and the tools go *missing* ([#8](troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)),
         which reads as "the integration is broken", not "your credential lapsed".
      3. **No revocation.** Nothing tracks issued tokens, so a leaked one can only be killed by
         rotating `JWT_SECRET`, which signs everyone out at once. Defensible for a single-user
         local app — but it is a choice nobody wrote down, and it stops being defensible the moment
         the multi-user item below lands.
      4. **Claims are trusted without a lookup.** `authenticateToken` verifies the signature and
         assigns `req.user` from the payload; it never checks the `id` against the database. A
         correctly-signed token for a deleted user stays valid for its full life, and the `email`
         claim is whatever the signer typed. Harmless today because only `id` is used for scoping —
         and exactly the kind of thing that stays harmless until something reads `req.user.email`.

      **Shape of the fix, smallest first.** (a) `JWT_EXPIRES_IN`, defaulting to `24h` so nothing
      changes for the browser — this alone makes the long-lived local token a *supported* thing
      rather than a forged one. (b) A real token surface: issue named tokens from Settings, list
      them, revoke them, store a hash rather than the token. (c) Resolve `req.user` from the DB on
      each request, or at minimum stop trusting the `email` claim. **(a) is worth doing on its own
      and immediately**; (b) is the honest destination and overlaps the account-system item under
      Go-public; (c) is small and independent of both.

      - [x] **(a) `JWT_EXPIRES_IN`** — *shipped 2026-08-15.* Defaults to `24h`, so a browser session
            is unchanged unless someone sets it. Validated by **probe-signing at boot** rather than
            by pattern-matching (`ms` accepts a wide, undocumented range of spellings, so a regex
            would reject valid values or admit invalid ones), and the probe also rejects values that
            parse but mint an already-expired token. An all-digits value is converted to a **number**
            so it reads as *seconds*: `jsonwebtoken` hands a string to `ms`, which treats a unitless
            string as **milliseconds**, so `JWT_EXPIRES_IN=3600` would otherwise have issued
            **3.6-second** tokens — every login succeeding and every request after it 403ing. Login
            and setup now also return **`expiresIn`**, because the failure this item exists to fix is
            a credential lapsing *silently*. **The guide's hand-minting instructions are gone**,
            replaced by log-in-and-read-the-token; the old command survives only in a collapsed block
            so anyone still holding such a token knows what it was.
      - [x] **(b) A real token surface** — *shipped 2026-08-15.* `ApiToken` + three routes
            (`POST`/`GET`/`DELETE /api/auth/tokens`) and a manager in **Settings → Account**: name a
            token, pick **30 / 60 / 90 days or never**, confirm with your password, copy it once.
            The list shows last-used dates and revokes individually.
        - **`never` is only offered because these are revocable.** A permanent credential you can
              withdraw is a convenience; one you cannot is a liability — and revocation is the thing
              that was missing, since a leaked token could previously only be killed by rotating
              `JWT_SECRET`, signing out every client at once.
        - **The database stores the `jti` and nothing else.** The signature already proves
              authenticity, so the only question a row has to answer is *"has this been withdrawn?"*.
              Storing the token, or a hash of it, would be a second copy of a credential with no use
              for it.
        - **Revocation covers every door.** `checkToken` is one definition shared by the REST
              middleware and the Socket.IO handshake — a revoked token the API refuses but the
              live-update channel accepts would keep streaming task updates, and that is the half
              nobody would think to test. It also **fails closed**: if the database cannot be asked,
              the answer is `503`, not "assume valid".
        - **It cost the hot path nothing.** Only tokens *with* a `jti` are looked up; a browser
              session carries none, so the dashboard poll still verifies a signature and stops.
              `lastUsedAt` is throttled to ~60s so an active client does not turn every read into a
              write.
        - **Browser sessions deliberately stay at 24h**, decoupled from API tokens — which is the
              coupling (a) knowingly left open. `JWT_EXPIRES_IN` still governs logins only.
      - [ ] **(c) Resolve `req.user` from the DB** (or stop trusting the `email` claim). Small,
            independent of both.

- [x] Agent WebSocket authentication — pairing-secret HMAC handshake, per-session command signing *(2026-07-09)*
- [x] Encrypt `PlatformConnection.config` at rest (AES-256-GCM, migration-free legacy read) *(2026-07-09)*
- [x] Multi-tenancy route scoping + JWT fail-fast + dev-JWT rotation (IDOR closed) *(2026-07-09)*
- [x] Structured command handling — no `cmd.exe /c` shell wrap *(2026-07-09)*
- [x] Agent config file/env for server URL + WSS support *(2026-07-09)*

## 🟠 P1 — Correctness & honesty

New correctness work lands here as it is found. Everything logged before 2026-08-12 is closed.

- [x] **`get_task_health` summarized a different population than it listed** *(logged and fixed
      2026-08-13, found by hand-driving the tool against 358 real tasks)*: with `includeSystem: false` the
      response returns `counts.critical: 25` beside `matched: 13`, and the header a model reads
      aloud says *"Across 358 task(s): 25 critical"* directly above thirteen rows. Flipping
      `includeSystem` does not move `counts` at all
      ([#49](troubleshooting/README.md#49-get_task_healths-counts-describe-a-different-population-than-its-list)).
      **This is the filter-chip defect above, one layer out** — the same mixed-population failure,
      fixed in the dashboard card on 2026-07-31 and never carried to the API's other consumers,
      because the card fixed it by counting where it filtered rather than by moving the rule
      somewhere both could reach.
      **The cause is `mcp-server/` owning logic.** `GET /api/tools/task-health` accepts no `tier`,
      no `includeSystem` and no `limit`; it scores every task and summarizes that same array, which
      is self-consistent and honest. All three parameters are implemented client-side in
      `mcp-server/src/tools.ts`, which then forwards the server's unfiltered `counts` beside its own
      filtered `matched`. Per §11a the wrapper owns no logic, and *which tasks the answer is about*
      is logic — so **the fix is to move `tier` / `includeSystem` / `limit` into the route**, apply
      them before `summarizeHealth`, and reduce the wrapper to a pass-through; the UI and every
      future consumer get the corrected summary at once. Recomputing `counts` inside the wrapper is
      the cheap alternative and leaves the next consumer to rediscover this.
      **Shipped the route version.** `GET /api/tools/task-health` now takes `tier`, `includeSystem`
      and `limit` (`taskHealthQuerySchema`) and applies them beside the counting; the wrapper is a
      pass-through that filters nothing. Three details carry the design. **`counts` is taken after
      the system lens but before the `tier` filter** — the `applyTaskFiltersExcept` rule one layer
      out, since a breakdown counted after `tier` reports that tier and four zeros. **Every route
      default is "everything"** (`includeSystem` defaults `true`, `limit` unbounded) because
      `useTaskHealthTiers` passes no parameters and needs a verdict for every task, so the
      unparameterized response is byte-identical to before; the MCP tool keeps its own `false`
      default and states it explicitly. And the response carries **`scope: {includeSystem, tier,
      systemExcluded}`**, so the summary names its population and the 257 hidden tasks are counted
      out loud rather than silently fenced off. A malformed lens is a `400`, not a guess.
      Verified live: `?includeSystem=false` now returns `counts.critical: 13` beside `matched: 13`
      where it read `25`, and the bare call is unchanged at 358/358. Five integration tests, the
      #49 one mutation-tested by reinstating `summarizeHealth(results)`.

- [x] **`missed-runs` was charged against disabled tasks** *(logged and fixed 2026-08-13, same
      exercise)*: the worst-ranked task on a real machine was `DISABLED`, scoring 35 on
      `last-run-failed` (50) **plus `missed-runs` (15)** — so a parked task led the worst-first
      list, above every task still running and failing. The `disabled` signal itself was correctly
      `weight: 0`; the fault was scoring a task for doing exactly what disabling it means.
      **Decided: do not track missed runs for a disabled task.** Windows keeps incrementing
      `numberOfMissedRuns` while a task is parked, and parking is the action §9 calls the
      recommended safe one — the same reasoning that ships `set_task_status` ungated. **A health
      model that penalizes the safe fix pushes people toward the unsafe ones.**
      Notably this was an *inconsistency*, not a new rule: `overdue` and `never-run` already
      skipped disabled tasks, and `missed-runs` sat in the same function without the guard. The
      count is suppressed, not forgotten — re-enable the task and the signal returns.
      Fixed alongside: the evidence read *"reported 1 missed runs"* under a summary that correctly
      said *"1 scheduled start"*, and the evidence line is the half meant to be quotable.

- [x] **The filter chips counted every task, while the list showed the filtered ones**
      *(logged and fixed 2026-08-12, from the UX review)*: `Showing All 269` above two rows on the
      Favorites view — exactly the failure §9 predicts (*"the fifth filter applied to the list but
      not to the counts beside it"*), arriving with the sixth. Both counts now come from
      `applyTaskFiltersExcept`, the population the control governs; the chip names its dimension
      (`All statuses` / `Active only`); the facet chips share the same helper. Verified in the
      browser against rendered rows.

- [x] **The dashboard reported a folder listing as a sync** *(logged and fixed 2026-08-12, while
      building the health strip)*: `getHealth` returned the agent's last inbound event of any kind
      under the name `lastSync`, so *"Synced 7m ago"* sat above a task list from the previous day
      ([#42](troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday)).
      **This survived the fix for #40** — a *real* timestamp of the wrong event passes every
      honesty check an invented one fails, which is the residual item below happening again in a
      harder-to-see form. Fixed structurally: `ConnectorHealth.lastSync` is deleted, connectors
      report `lastContactAt`, and `lastSync` has exactly one writer.

- [x] **The health strip changed its own height and shoved the page down** *(2026-08-12)*: a
      `flex-wrap` status line went one row to two whenever a segment appeared, moving everything
      below it by ~22px on a 45-second poll. Now one scrolling line. Caught by the new screenshot
      suite.

- [ ] **System-status honesty — residual** *(mostly shipped 2026-07-08)*: live per-platform health,
      the "synced N ago" chip and the honest Sync/Import split all ship; what remains is periodic
      review that no status surface has drifted back to asserting something it can't evidence.
      **The review found one on 2026-08-11 and it is fixed** — `getHealth` reported `HEALTHY` from a
      socket object existing and stamped `lastSync: new Date()`, so a wedged agent read as online and
      "synced just now" while every request against it timed out
      ([#40](troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)).
      Keep the item open: the lesson is that this class returns, and the tell is a status field
      derived from a precondition that cannot change when the subject fails.
      **It returned the next day** ([#42](troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday),
      fixed above) — through the *replacement value*, not the old one, which sharpens the tell:
      a status field can be first-hand, correctly absent, and correctly stale, and still be
      **the wrong event**. Ask what writes it, and whether that is what the label names.

<details>
<summary>Completed P1 items</summary>

- [x] Multi-day weekly schedules no longer collapse to one day (`0 9 * * 1-5`) *(2026-07-14)*
- [x] Live-agent smoke test for schedule normalization + midnight-cross day-of-week fix *(2026-07-09)*
- [x] Browser live updates — receive-only `/ui` Socket.IO namespace, push instead of polling *(2026-07-09)*
- [x] Local-time schedule display in the task detail view *(2026-07-09)*
- [x] Filter chips reflect the active view (faceted category + platform) *(2026-07-08)*
- [x] Agent-auth hardening follow-ups — signed trigger, replay guard, session-key overlap *(2026-07-10)*
- [x] Command-handling follow-up — server-side per-token template substitution *(2026-07-10)*
- [x] Backend hygiene — Zod at boundaries, one error middleware, Prisma singleton, batched upserts *(2026-07-10)*
- [x] Remaining QA — integration suite vs real Postgres, Playwright E2E + mock agent, resilience/soak, security audit, dependency remediation, performance baseline *(2026-07-10)*
- [x] `cronsole.ps1 status` probes services instead of ports, and can report `WARN` *(2026-07-28)*
- [x] Dark is actually the default theme, not just documented as one *(2026-07-28)*
- [x] The closed mobile sidebar is out of the tab order and a11y tree below `md` *(2026-07-28)*

</details>

## 🟡 P2 — Product value

### Dashboard IA redesign *(requested 2026-08-15 — pass 1 shipped, pass 2 open)*

> **Why.** The dashboard was hard to navigate: five full-width things stacked above the first
> task, three of them horizontal chip rows doing different jobs at the same visual weight, and
> the axis you actually navigate a real machine by — *which Task Scheduler folder is this in?* —
> was a facet buried inside the Filters popover. Requested as "put the sections on top, put the
> sources in a left sidebar, and let each source show its own groupings".

- [x] **Pass 1 — the shell** *(2026-08-15)*: section links moved to a **top toolbar**
      (`components/TopBar.tsx`); the left column became a two-level **source rail**
      (`components/SourceRail.tsx` + pure `utils/sourceTree.ts`) — the system at level 1, that
      system's own grouping at level 2 (Windows → Task Scheduler folders, Cronsole-native → job
      type, which stopped being two *top-level* sources). The category facet left the Filters
      popover; the sidebar's "System Status" panel was deleted and per-platform health became a dot
      on the rail row. `\Microsoft\` is one collapsed, counted disclosure group with **no filter
      patch**, so the rail never becomes a third controller of the system lens.
      **The behaviour change worth remembering:** `filtersEqual` now ignores `category` as well as
      `source`, so navigating the rail no longer drops the view bar to *Custom*. A folder click
      used to and a source click did not — two halves of one control behaving oppositely. The rule
      was always about **hidden** constraints, and a rail selection is not hidden.
      23 new tests (16 tree + 7 component); 508 green; verified in-browser against 363 real tasks.
- [ ] **Pass 2 — scoping** *(open)*: views filtered to the source they make sense for (*System* is
      Windows-only and reads `0` everywhere else); source-scoped header actions, so **Sync** and
      **Import** state which platform they mean; per-source empty states, so a connected platform
      with nothing imported says how to import from it. Mobile layout still needs a real device
      check — the automation session could not resize the browser window.

### Open — UX & UI refinement pass *(logged 2026-08-12)*

> A full-app review on 2026-08-12 (`.claude/temp/cronsole-review-8_12_26/`, live app + repo) found
> the product powerful but reading as a dense internal admin panel rather than a control plane.
> Every item below was re-verified against the source and is stated as what the code actually
> does, not as the review phrased it. **Ordered.** The counts bug the same review found is P1
> above and should ship first — it is the one that makes the dashboard say something untrue.

- [x] **Status colour isn't themeable — 263 hard-coded Tailwind utilities across 8 hues**
      *(shipped 2026-08-12)*. Roles now live in `index.css` as `--x` / `--x-text` pairs
      (`success` · `warning` · `danger` · `isolate` · `info` · `system` · `neutral-text`, plus
      `native` / `claude` / `chatgpt` identity and a `danger-surface` alarm pair). Zero raw palette
      utilities remain. **The real defect was worse than untidiness: all five status roles failed
      WCAG AA in the light theme** (1.67–2.77 against white, AA is 4.5) and *could not be fixed
      where they were written*, since one literal cannot serve both themes — now 5.05–8.65, with
      dark unchanged at 7.15–11.70. Also caught: `bg-violet-600` and `bg-primary` are the same
      colour, so the native-vs-Windows chip drew no distinction.
      **Correction to this item as originally written:** it claimed three synonym pairs from a
      hue-frequency count. Checked before merging, only **green/emerald** was real — and even that
      excludes `platform.ts`, where emerald is ChatGPT's brand, so a blind merge would have
      recoloured a live badge. violet/purple (system lens vs Claude identity) and red/rose
      (failure vs isolating lens) are distinct roles that happen to share a hue.
      `--raised` is added and applied to one panel; **spending it across the app to build real
      hierarchy is the *thin the first viewport* item below**, not done here.
- [~] **Thin the first viewport** *(desktop shipped 2026-08-12)*. Status, ownership, platform and
      category moved into one **Filters** popover (`components/TaskFilterMenu.tsx`) carrying an
      active-filter count; two full rows of category chips and the platform toggle are gone. The
      constraint held: **what a lens withholds did not move inside.** Category and platform became
      dismissible pills (they name themselves), while system and status — defaults nobody chose
      today — print `189 system hidden` / `10 inactive hidden` beside the trigger, each also being
      the control that undoes it. `withheldBy` + `activeFilterCount` are pure and pinned by tests
      so the rule survives edits. The filter zone is now a `bg-raised` panel, which is where the
      neutral step earns its keep. `TaskCard` is memoised (a search keystroke re-rendered all 269).
      **Mobile half shipped 2026-08-12**: saved views became one horizontally-scrolling row bled to
      the screen edge, Help Center and Import dropped to icons (names kept as `aria-label`),
      `New Task` became a FAB — the *same* control, with the header button hidden at that width —
      and the filter toolbar became one scrolling row that **sticks to the top**, since on a phone
      it is the only way back out of a filtered list. **The 375px verification is now done and
      automated** (`tests/e2e/layout.spec.ts`): the browser-resize route never reached the tab, so
      it moved into Playwright, where `setViewportSize` does. It asserts no horizontal overflow, a
      one-row views bar, the toolbar surviving a 2000px scroll, and a 44px FAB.
- [x] **Grow the Platforms tab into a capability matrix** *(shipped 2026-08-12; the open decision
      resolved **grow**)*. Three platform rows — Windows, Cronsole-native, Claude (experimental) —
      each with connection, tracked count, last real sync, last verified, and ten capability chips
      over an expandable per-verb evidence table. The bookmarks stay as *Quick links*.
      **Verified / Declared / Unsupported**, and the middle one is the point: reachable but never
      observed to work is not *yes*.
      **What the item's own wording would have got wrong:** deriving a cell from
      `typeof connector.deleteTask === 'function'` is false for Cronsole-native, whose delete,
      reschedule and export are handled by `routes/tasks.ts` directly (the DB row *is* the task) —
      so a connector-derived matrix reports that platform as unable to do three things it does
      daily. Reachability is therefore a property of the **route**
      (`services/platformCapabilities.ts`, pinned against both the connector objects and the route
      source), and evidence is a new `PlatformCapability` table the routes write as they run.
- [x] **Dashboard health strip** *(shipped 2026-08-12)*: connection state, last real sync, and the
      newest recorded command outcome — **success or failure**, since a status line that hid
      failures would go quiet exactly when something is wrong. Nothing recorded reads *"No commands
      run yet"*, not a tick. It found the `lastSync` defect (P1 above) and its own layout shift.
- [x] **Icon-only controls need accessible names** *(shipped 2026-08-12)*: all 8 modal close
      buttons named; the card's category control became a real button. **The card itself was the
      bigger defect** — a clickable `<div>`, so the dashboard's primary action was mouse-only. The
      title is now the control (*"Open details for &lt;task&gt;"*), which is where it had to go: the
      card contains the row-action buttons, and a button may not nest in a button. A hover/focus
      *"Open details ›"* hint names the card's default click.
- [x] **Screenshot regression coverage** *(shipped 2026-08-12, `tests/e2e/layout.spec.ts`)*:
      dashboard at 1280px and 375px, Templates, Tools, Platforms, New Task and Import.
      **Split by what each surface can honestly assert** — pixels for chrome that does not move
      (live regions masked, `maxDiffPixels: 40` for antialiasing noise), structure for everything
      else. Platforms and the Import modal get **no** pixel baseline: both are almost entirely live
      evidence, and masking hides colour but not geometry, so the baseline would be an empty frame
      that still breaks whenever a row's height moves
      ([#43](troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)).
      Green on 6 consecutive runs.
      **Not covered:** the task-detail modal (its body is one live task) and the Tools tab's
      individual tool panels — named here so the gap stays visible rather than reading as coverage.
- [x] **In-app help, per control** *(requested and shipped 2026-08-12)*: a **?** beside fourteen
      controls, each opening one topic — what it is, the two or three non-obvious facts, and a
      link to the doc section that covers it. The Help Center and the `?` are **one modal**: the
      hub indexes every topic and every topic ends in *Browse all help*, because the two entry
      points fail in opposite directions (a `?` is only findable once you are looking at the
      control it explains; a hub is only useful if it can reach what those buttons say).
      Source help **follows the source you are on** — the Source bar, each Platforms row and the
      New Task platform selector all resolve to that source's topic, degrading to the platform
      and then to the overview so a connector landing before its help copy still opens something
      true. New [`Sources_Guide.md`](user-guides/guides/Sources_Guide.md) is the deep-link target.
      **`HelpTopic.doc` is required**: a topic with nowhere to point is one explaining something
      undocumented, and the fix is a doc, not a popover that becomes the only place a rule is
      written down.
      **The links are checked** (`frontend/src/data/__tests__/docsLinks.test.ts`, 43 assertions) —
      a stale anchor does not fail on its own, since GitHub serves the page scrolled to the top
      with no error anywhere. Mutation-tested.
- [x] **One Edit button per task, instead of four** *(requested and shipped 2026-08-13)*. The task
      modal carried four edit affordances in four places with three different shapes — a rename
      pencil in the title, a *Change* link on the category card, an *Edit* in the Action panel
      (opening one of two modals by platform), and *Edit Schedule* in the footer. Now one **Edit**
      opening `EditTaskModal`; `EditScheduleModal` / `EditActionModal` / `EditNativeJobModal` are
      deleted, their fields extracted to `components/edit/`, and the prefill + gating rules moved
      to `utils/taskEditing.ts` so one rule decides both what a field holds and whether its section
      renders.
      **The design constraint: one gesture, still three routes.** Labels are a DB row this process
      owns; a Windows schedule or command change is an elevated agent round trip Windows can
      refuse. So Save sends only changed sections, sequentially, and **reports each separately** —
      a section that lands is re-baselined and goes clean, one that fails keeps its values and its
      error, and a second press retries only what is outstanding. The same per-item rule the bulk
      verbs follow, and for the same reason. **All-or-nothing was rejected**: the rollback runs
      through the same offline agent that just failed.
      A part this platform cannot change is now a **sentence in the form**, not a disabled button
      with the reason in a tooltip — which is unreadable on the phone this app must work on. The
      Edit button itself is never disabled, since name and category are editable on every source.
      Also fixed under it: [#52](troubleshooting/README.md#52-an-open-edit-modal-closes-by-itself-discarding-what-you-typed),
      an open editor closing itself on every background refetch (reset effect keyed on the task
      **object**, which `tasks.find(...)` makes new each time, rather than on its id). Pre-existing;
      merging four short-lived modals into one long form is what made it costly.

### Open

- [x] **Source-first dashboard** *(requested and shipped 2026-08-12)*: a source bar above the
      saved views — *All sources* / *Windows Task Scheduler* / *Cronsole (Native)* / … — as the
      first-level axis, ahead of views and categories. Platform left the Filters popover in the
      same change (two controls for one dimension). **Source is an outer lens**: it survives
      clicking a view (`filtersEqual` ignores it, so both chips stay lit), rides alongside the view
      id in the URL, is stripped from saved views by `viewFiltersFrom`, is not counted by the
      Filters badge, and **scopes every view count** — `My jobs 88` above a list of one is the same
      broken promise as `Showing All 269` above two rows.
      **The bug worth remembering:** the button list was first derived from the *faceted*
      population, so on a view whose matches were all one source the bar vanished — taking the only
      control that could switch away. Existence now comes from the whole task list; only the counts
      stay faceted, which is why a source may legitimately read `0`.
      Groundwork for adding AI systems and other operating systems as further sources.

- [x] **Mass Actions console on the Tools tab — now the only bulk surface**
      *(requested and shipped 2026-08-12)*. **Action-first**: a vertical list of verbs, each opening
      its own scope step (category — the default — / all / platform / status / health tier). Plan
      visible before anything is asked of a platform, typed confirmation at
      **≥25 tasks**, chunked at the server's 100-task ceiling with halt propagation, per-task
      five-outcome report, and undo for enable/disable only. No backend added — every verb is an
      existing `/api/tools/tasks/*` route. **Dashboard row selection was removed entirely
      *(2026-08-12)*** — checkboxes, select-all, the bulk bar, the bulk-category modal and
      `taskSelection.ts` are gone, and bulk work is only this console. The safe-path objection to
      that did not survive checking: *Remove from Cronsole* sits beside *Delete from Windows* in the
      **task modal**, per task, which is where that pairing always lived. The scope opens on
      **By category**, not *All tasks* — defaulting to everything would make the widest possible
      operation the path of least resistance; its starting value comes from `defaultScopeValue`,
      because a category scope with an empty value resolves to nothing. Absorbed *bulk
      enable/disable by folder*. Export and import stay in their own tools rather than being
      duplicated here. Verified live at zero mutation — see CHANGELOG.
      **Deferred:** running a real agent-backed enable/disable end to end (it mutates real
      scheduled tasks), and the mid-flight progress indicator, which a DB-only run completes too
      fast to observe.

- [ ] **Two Settings toggles are now vestigial** *(logged 2026-08-12, created by the same change)*:
      the dashboard opens on **All**, which hard-sets `status: any` and `system: include` — exactly
      what *Show disabled tasks* and the persisted system lens control. So neither affects the
      opening view any more. `defaultCategory` and `defaultPlatform` still do.
      **Not silently removed**, because the system lens is still written when you change it from the
      dashboard and both may want to become "what the All view means for you" instead. Decide
      between making them apply again, repurposing them, or deleting them — but do not leave two
      settings that look like they do something and don't.

- [ ] **Restore's plan doesn't check that a task's action points at anything that exists**
      *(logged 2026-07-31)*: add an **advisory** column reporting, per file, whether the action's
      executable and file-looking arguments resolve on this machine. Not a refusal — an executable
      missing here may exist on the machine being restored to.
- [ ] **Task-detail trust indicators — say how old the truth is**: per-task last platform-confirmed
      sync, last agent result, and Windows' own `lastTaskResult` in the modal. *(Re-raised by the
      2026-08-12 review, which adds a fourth: whether the displayed action was reported by the
      **current** agent version — an un-republished agent omits fields rather than erroring, so a
      stale panel and a correct one look identical.)*
- [ ] **Optional periodic Windows sync**: opt-in interval sync, interval stated, last run shown,
      the `untracked` remainder surfaced. Must stay `scope: 'tracked'`.
- [ ] **UI polish pass**: full-path tooltip/copy on truncated task paths · Apply-modal footer
      crowding · Help Center reachability at ~720px · the two dev-mode Socket.IO console warnings
      (worth clearing before any demo capture — they bury real console errors).
- [ ] **Onboarding becomes contextual instead of global** *(absorbs the banner half of the polish
      pass; sharpened 2026-08-12)*: the banner lives in `Dashboard.tsx` **above the tab switch**, so
      it rides along on Templates, Tools and Platforms too, and clears only on an explicit click.
      Auto-retire it once the user has imported, created or starred; replace it with per-tab
      first-use cards, which is where the advice is actually actionable.
- [ ] **Console noise in user-facing flows**: **37 backend + 3 frontend** `console.*` calls
      *(counted 2026-08-12)*, the worst carrying task names, native paths and full command lines —
      in `routes/tasks.ts`, `WindowsAgentConnector.ts`, `NativeScheduler.ts`, `TaskService.ts`,
      `AgentManager.ts` and `Dashboard.tsx`. Do it with the structured-logging work under
      *Production operations*: levels + redaction, with full command lines gated behind an explicit
      diagnostics export rather than on by default.
- [ ] **Template registry — optional follow-up**: index signing, beyond the per-file sha256.
- [ ] **Cross-platform template targets — follow-up (b)**: real export artifacts (cron line,
      launchd plist, Claude routine payload). Lands as connectors and the macOS agent do.
- [ ] **Settings agent-pairing panel** *(deferred)*: waits on the per-user pairing-code flow.
- [ ] **Native task follow-ups**: `CLAUDE_PROMPT` job type, and a Redis lock before multi-instance.
- [ ] **Tools tab — further candidate tools** *(candidates only, none scheduled)*: scheduled
      automatic backups (backend writes, not the elevated agent) · snapshot diff ("what changed
      since your last backup") · a user-facing diagnostics panel. *(Bulk enable/disable by folder
      was absorbed into the Mass Actions console above on 2026-08-12.)*
      Rule for the tab: everything on it must be genuinely cross-cutting, or it is a junk drawer.

### Completed

<details>
<summary>Windows task management</summary>

- [x] Windows task enable/disable from Cronsole *(2026-07-10)*
- [x] Edit Windows task schedules — signed `task:update_schedule` *(2026-07-10)*
- [x] Edit Windows task actions/settings — signed `task:update` *(2026-07-11)*
- [x] Agent `task:delete` — deletes the real Task Scheduler entry *(2026-07-10)*
- [x] Windows folder selector on apply (`\Microsoft\` refused in agent **and** backend) *(2026-07-14)*
- [x] Full task detail view — parsed Schedule / Action / Settings panels *(2026-07-08)*
- [x] Apply-modal upgrades — editable name, duplicate guard (409), preset chips, schedule preview *(2026-07-10)*
- [x] Untrack — remove from Cronsole without deleting from Windows (+ `TaskExclusion`) *(2026-07-28)*
- [x] System/personal split — server-owned `isSystem` + persisted Personal toggle *(2026-07-28)*
- [x] Import defaults — None/Non-system/All presets, remembered selection, count before the click *(2026-07-31)*
- [x] Saved views — five built-ins + user-named views, URL-backed *(2026-07-31)*
- [x] Task schedule on every card — "Daily at 8:00 AM PDT", read in the Settings zone; raw cron
      for shapes it won't guess at, "No cron schedule" for triggers cron can't express *(2026-08-11)*
- [x] Favorites — star any task (`TaskFavorite`, per-user, cascades with the row); the dashboard
      opens on your stars and falls back to your saved defaults when there are none. A sixth
      built-in view that ignores every other lens, plus a banner naming what a self-applied
      filter is hiding *(2026-08-11)*
- [x] Bulk enable/disable across all four views *(2026-07-31)*
- [x] Bulk task actions complete — recategorize, untrack, export-selected; the five-outcome
      convention extracted to one shared definition; verified live in the browser *(2026-08-04)*
- [x] Schedule timezone — author and display in your own zone, storage stays UTC *(2026-07-31)*
- [x] `createFolder` on `POST /api/tasks` + MCP `create_task` — opt-in, signed, reports what it created; second and last carve-out to "Cronsole creates only `\Cronsole`" *(2026-08-04)*

</details>

<details>
<summary>Templates & catalog</summary>

- [x] Template library UI — search, faceted OS + category chips, type toggle, grouping *(2026-07-10)*
- [x] Templates honesty pass — fake `upvotes` removed, "Compatible with" framing, Tier-B parameterized *(2026-07-10)*
- [x] Template view selector (Grid / List / Kanban) *(2026-07-10)*
- [x] Template Resources menu *(2026-07-10)*
- [x] Favorite templates — per-user `TemplateFavorite` + Favorites filter *(2026-07-11)*
- [x] Tags model — free-form `tags String[]`, carried registry → DB → export *(2026-07-13)*
- [x] Template import/export + agent authoring *(2026-07-13)*
- [x] Save task as template *(2026-07-13)*
- [x] Developer Pack — 9 templates *(2026-07-13)*
- [x] AI Pack — Claude Code (4) + Codex (3) *(2026-07-13)*
- [x] Export existing tasks — Windows → XML (UTF-16 LE + BOM), native → JSON *(2026-07-13)*
- [x] **Cronsole Native pack (6) + Claude Routines pack (5)** — 55 → **66 templates, 7 core, 8 packs**
      *(2026-08-13)*. Closes the gap where Cronsole-native was a source everywhere **except** the
      catalog. Shipped with the connector fix that makes them applicable (`buildNativeJob` shared
      by the create route, the edit route and the connector) — a template family without its
      apply path is a promise the button breaks.
- [x] **Templates tab reads creatability from the capability matrix** *(2026-08-13)* — the
      hardcoded `CREATABLE_PLATFORMS` set is gone; badges, the Apply platform buttons and the new
      **Target** facet all take the server's per-install verdict, with `unknown` asserting nothing
      while it loads. Same change in the public gallery, where a static page states the *condition*
      ("needs sign-in") because it cannot know the visitor's install.
- [~] Template registry — decouple the catalog from the repo: schema + ADR, catalog behind an
      interface, static registry + remote source, hosted, runtime refresh, prune-on-sync — all
      shipped *(2026-07-13 → 2026-07-14)*. Only **index signing** remains, and it is optional.

</details>

<details>
<summary>Tools tab, backup & restore</summary>

- [x] Tools tab — bulk export/backup + Connect Pack downloads *(2026-07-28)*
- [x] Restore tasks from an export — signed `task:import`, plan-before-write, four outcomes *(2026-07-28)*
- [x] Run history export (CSV) + automation health score *(2026-07-28)*
- [x] Schedule tester — shows what you asked for **and** what will actually run *(2026-07-31)*
- [x] Richer execution analytics — failure trend, duration trend, idle-task list *(2026-07-31)*
- [x] Live browser click-through of Execution analytics + the Import-defaults modal — every rendered
      number checked against the API; found four defects, all fixed: platform health asserting
      HEALTHY/"synced just now" from socket presence ([#40](troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)),
      the idle all-clear rendering beside its own contradiction, an empty platform heading in the
      Import modal, and `1 tasks` *(2026-08-11)*

</details>

<details>
<summary>Other P2</summary>

- [x] Failure notifications — generic / Discord / ntfy webhooks *(2026-07-10)*
- [x] User resources & onboarding — Help Center walkthrough + first-run banner *(2026-07-13)*
- [x] Cronsole-native schedule editing *(2026-07-13)*
- [x] Settings runtime backend-URL override *(2026-07-13)*
- [x] Self-heal tasks no longer flash a PowerShell window + self-heal dedup *(2026-07-13)*
- [x] Empty `\Cronsole\` scheduler folder auto-pruned on last-task delete *(2026-07-13)*
- [x] On-demand elevated agent republish task *(2026-07-14)*

</details>

## 🟢 P3 — Expansion

> **Launch posture (decided 2026-07-13): Cronsole ships and stays local-first.** Cloud/SaaS
> hosting is not a launch requirement. Remote access to your own instance is the final, optional
> enhancement at the bottom of this list; go-live does not depend on it.

### Open

- [ ] **macOS agent (launchd)** — *folded into the **POSIX agent** item under
      [Sources](#-sources--where-a-task-comes-from) (2026-08-12), because launchd, cron and systemd
      timers are one build, not three.* 7 catalog templates still wait on it; the `ITaskScheduler`
      abstraction ports cleanly.
- [ ] **Installer packages (agent only)** — signed WiX MSI replacing the PowerShell setup script;
      macOS `.pkg`/Homebrew once the launchd agent exists.
- [ ] **Ship the whole application as a Windows installer (`.exe`)** — four jobs, not a packaging
      step: (1) Postgres bundled vs. SQLite *(open decision below; lean bundle)*, (2) drop Redis,
      (3) `vite build` served same-origin by Express, (4) bundle the Node + .NET runtimes.
      Secrets must be generated **per machine at install time**, and uninstall must sweep Task
      Scheduler. Signing is a hard prerequisite (SmartScreen), not polish. ~1 week to installable,
      ~1 more to trustworthy.
- [ ] **Split the files that have become fault lines** — *(re-counted 2026-08-12; every one grew,
      and one was missing from the list)*: `DashboardScreen.tsx` (1,251), `routes/tasks.ts` (1,182),
      `mcp-server/src/tools.ts` (1,140), **`routes/tools.ts` (1,130 — not previously listed)**,
      `TemplatesScreen.tsx` (794), `AgentService.cs` (782), `TaskModal.tsx` (757).
      **Still not a refactor sprint** — split along the named seams only when next touching that
      area. Named seams: dashboard filters/saved views · dashboard bulk actions · dashboard view
      renderers · task mutation vs. sync/discovery routes · tools backup/restore routes · MCP task
      vs. template vs. diagnostic tools. The UX pass above lands squarely in `DashboardScreen.tsx`,
      so that is the one to split *while you are there*, not afterwards.
- [ ] **Claude Code connector** — *promoted to top priority under
      [Sources](#-sources--where-a-task-comes-from) (2026-08-12).* Promote from experimental
      scaffold to production-ready.
- [ ] **ChatGPT** — stays quick-links-only unless a public automations API appears.
- [~] **Template gallery site** — parts 1, 2, 4, 5 shipped; **part 3, the one-click "Add to my
      Cronsole" deep-link/protocol handoff, remains**. Download + Copy JSON use the shipped Import
      path today.
- [ ] **Route-level code-splitting** *(optional follow-up to the frontend refactor)*: the single
      bundle trips Vite's 500 kB hint; cheap now that the router and screen modules exist.
- [~] **Remote access (self-hosted) — the final, optional enhancement**: reach your **own** local
      instance from other devices (the code-server model) via Tailscale or Cloudflare Tunnel +
      Access. Not part of the local-first launch. **The tooling shipped 2026-08-15**; what remains
      is polish, not plumbing.
  - [x] **Bundled single-origin reverse proxy** — `proxy/Caddyfile` + two opt-in Compose profiles
        (`proxy`, `remote`). Serves the built dashboard at `/`, forwards `/api/*` and
        `/socket.io/*` to the backend, SPA fallback for router deep links. Bound to
        `127.0.0.1:8080`; cloudflared reaches it over the compose network.
  - [x] **Same-origin frontend builds** — `npm run build:remote` (`VITE_API_URL=same-origin`)
        resolves the API against `window.location`, so **one build is correct at every address**
        and the per-device API-origin override is no longer needed.
  - [x] **Cloudflare Tunnel profile + Access instructions**, and `TRUST_PROXY` so the login
        rate-limiter stays per-client behind the proxy.
  - [x] **Pre-req found and fixed while verifying it**: a real owner JWT was compiled into the
        production bundle via `VITE_DEV_TOKEN`, making the login screen decorative on any built
        copy. Gated on `import.meta.env.DEV` + guarded by `check-bundle-secrets.mjs` on every
        build. See the CHANGELOG and [troubleshooting #55](troubleshooting/README.md#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in).
  - [ ] **PWA manifest + icons** so the dashboard installs to a phone home screen — the last
        piece of the "trigger from your phone in under 30 seconds" goal.
  - [ ] **Auth hardening for an internet-facing gate** *(deliberately deferred 2026-08-15 — the
        network gate is doing this job today)*: there is no password reset, so forgetting the one
        password while travelling is only fixable at the keyboard; and the 24h JWT lives in
        `localStorage` on a phone that can be lost, with no refresh flow and no revocation. Both
        are acceptable behind Tailscale or Access and are the first things to revisit if the gate
        is ever relaxed.

- [x] **MCP delete is native-only, and archives before it destroys** *(decided and shipped
      2026-08-13)*. `delete_task` was gated all-or-nothing by `CRONSOLE_MCP_ALLOW_DESTRUCTIVE`, and
      when open it wrapped the same `DELETE /api/tasks/:id` the UI uses — so the one MCP verb that
      cannot be undone had the **widest** blast radius on the surface, reaching a real Task
      Scheduler entry through the elevated agent. Two changes, both in the backend, because
      `mcp-server/` owns no logic and a platform check written into the wrapper would be a
      *client-side* check the raw REST route still ignores.
  - **A narrower route carries the narrower capability.** MCP wraps
        `DELETE /api/tasks/:id/native`, which refuses anything but `TASKHUB_NATIVE` with a `400`
        (the `verbDeclaredUnsupported` convention — a boundary, not a retry). The UI keeps the
        existing full-power route, where a human is at a confirm dialog. This is *a capability is
        a property of the route* applied literally: caller identity would be the alternative, and
        auth today is a single 24h JWT with no claims to scope on.
  - **The boundary is coherent, not just restrictive.** MCP can `untrack_task` a Windows task
        (row dropped, the real task keeps running) and `delete_task` a native one (where the row
        **is** the task, and it is archived first). So **no MCP verb can destroy an artifact on the
        machine** — the half of the surface that needed a human keeps one.
  - **The archive is written before the delete, and the delete refuses if it fails.** A backup
        that only succeeds when you did not need it is worse than none. It lands in
        `DeletedTaskArchive` — a DB row, deliberately **not** cascaded from `Task`, for the same
        reason `TaskExclusion` is keyed on `(platform, externalId)`: it has to outlive the row it
        describes. Not a file, because on a Dockerized stack a file lands inside the container —
        a backup the user cannot reach, the same execution-host defect as a native `EXEC` path.
        And not merely returned to the caller, because an agent may discard the response.
  - **It captures the last 20 `ExecutionLog` rows with the definition.** For a native task those
        are real outcome evidence (exit code, duration, captured output), unlike a Windows task
        where a `SUCCESS` records the agent accepting a start — so without them the archive cannot
        answer "was this working before I deleted it?". The delete transaction drops them.
  - **The env gate stays shut by default.** The blast radius is now bounded and reversible, which
        weakens the case for it — but loosening two safety dimensions in one change means a later
        failure cannot be attributed to either. Same friction, smaller radius, recoverable.

- [ ] **Product bets — from "a better Task Scheduler UI" to "a local automation control plane"**
      *(directions, not scheduled work — each needs its own design pass first)*. ★ = recommended
      first. The shared constraint: this project's guardrail is reliability first, and every bet
      below is a feature that can be confidently wrong.
  - ★ Automation health score *(shipped 2026-07-28 — see P2 Tools)*
  - ★ Runbooks attached to tasks
  - ★ Dry run & validation lab *(cheapest slice — the Schedule tester — shipped 2026-07-31)*
  - ★ Task collections / playlists
  - Task dependency graph *(manual edges only for v1; inference is a suggestion, never a fact)*
  - Watchdog tasks
  - Task definition versioning
  - Schedule conflict & load map
  - Intent labels & purpose-driven views
  - Failure triage assistant *(explain/assist only — autonomous repair is out)*
  - Approval gates *(the gate must be out-of-band, or an agent approves itself)*
  - Environment profile manager *(reports present/missing, never stores values)*
  - Calendar & quiet hours *(not cheap — deferral means rewriting triggers on the machine)*
  - Restore & migrate wizard
  - Automation inventory report

### Completed

<details>
<summary>Completed P3 items</summary>

- [x] MCP server — thin stdio wrapper over the REST API, 5 tools at first ship *(2026-07-13)*
- [x] MCP surface expansion — `create_task`, `list_folders`, 7 management verbs, tiered destructive gating; surface 14 tools *(2026-07-15)*
- [x] `untrack_task` on MCP, ungated — surface 15 tools *(2026-07-28)*
- [x] MCP test suite + CI enforcement *(2026-07-15)*
- [x] Frontend refactor — five slices, `Dashboard.tsx` 1,830 → 248 lines *(2026-07-13)*
- [x] Template gallery site — gallery frontend, core/extended split, whole-pack download, search + filters *(2026-07-14 → 2026-07-28)*
- [x] `convert_schedule` fallback warning names the resulting frequency *(2026-07-15)*
- [x] Split the `0.7` confidence score — `lossy: 'approximated' | 'replaced'` *(2026-07-16)*
- [x] Reconcile vanished tasks to `MISSING` instead of hard-deleting *(2026-07-16)*
- [x] Per-command nonce on signed agent commands *(2026-07-15)*
- [x] `run_task` on a disabled task reports the reason instead of a 15s timeout *(2026-07-15)*
- [x] Sweep for literal control bytes in source + CI `repo-hygiene` guard *(2026-07-16)*
- [x] Bulk-clear MISSING tasks *(2026-07-25)*
- [x] Surface that un-imported tasks exist *(2026-07-27)*

</details>

## 🚀 Go-public checklist

Everything required before the repo flips public and Cronsole is promoted beyond personal use.
**Cronsole launches local-first** — each user runs the whole stack on their own machine, so these
items cover the repo and product going public, not standing up a multi-tenant cloud service.

### Repo goes public

- [~] **Secret & history audit** — audit clean *(2026-07-13)*; **remaining:** squash to a fresh
      public root at publish time, and scrub personal machine paths from internal docs.
- [~] **Repo hygiene for outsiders** — done *(2026-07-13)*; **remaining:** branch protection on
      `main` (a GitHub setting, do at publish).
- [~] **Community scaffolding** — `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates, CI badge
      shipped *(2026-07-13)*; **remaining:** enable Discussions at publish.
- [~] **Final README/docs pass for a stranger audience** — the CLAUDE.md cloud-hosting row is fixed
      *(2026-07-31)*; **remaining:** a quick-start that works on a machine that isn't Mike's,
      screenshots/GIF, an honest feature-status table, and the wider stale-claims sweep.
- [x] License decision — **Apache-2.0** *(2026-07-13)*
- [x] Package manifests say Apache-2.0, not the `npm init` ISC default *(2026-07-31)*
- [x] `check_db` pokes replaced by `npm run db:check` *(2026-07-31)*
- [x] Close the unauthenticated `POST /auth/register` primitive — **deleted**, 404 pinned *(2026-07-31)*
- [x] Align REST CORS with `ALLOWED_ORIGINS` + a refusal that explains itself *(2026-07-31)*
- [x] **Rename TaskHub → Cronsole** — all four stages *(2026-07-31)*: in-repo brand, this machine,
      the public surface (repos + registry URL + front door), and the local checkout folder.
      Deliberately **not** renamed: `PlatformType.TASKHUB_NATIVE` (a stored Postgres enum) and the
      historical CHANGELOG/ROADMAP entries.

### Application goes public

- [ ] **Versioning & releases** ← *next*: semver, tagged releases, changelog discipline, so
      advertised versions are reproducible. Also unblocks the package manifests' `version` fields.
- [ ] **Production operations**: error tracking, structured logs, uptime monitoring + status page,
      automated Postgres backups with a **tested restore**, broader API rate limiting, staging +
      deploy pipeline. *(Auth rate limiting shipped 2026-07-16.)*
- [ ] **Agent distribution & trust**: signed installer, code-signing certificate to clear
      SmartScreen, versioned releases with an update channel, and a documented "what the agent can
      do / how to remove it" trust page. **The certificate is a hard prerequisite for the
      whole-stack installer.**
- [ ] **Legal minimum**: privacy policy, terms of service, account deletion + data export that
      actually purges tasks and logs, cookie handling on the public site.
- [ ] **Multi-user / hosted account system** *(deferred — not a local-first launch requirement)*:
      password reset (needs email infra), open registration as a *designed* invite/approval flow,
      JWT refresh tokens, per-user agent pairing, account management and roles.
- [~] **Launch surface** — one public page shipped *(2026-07-28, consolidated from two)*;
      **remaining:** real install/download links once the app repo is public, and richer marketing
      content.
- [x] Account/login system — single-user local login *(2026-07-16)*

---

## Open decisions

- [ ] **Installed-app database: bundled Postgres vs. SQLite** *(opened 2026-07-28)* — blocks the
      whole-stack installer and only that. Bundled Postgres costs ~250 MB and a service lifecycle
      but needs **no schema or test changes**; SQLite gives a single-file install but
      `Template.tags String[]` is Postgres-only, forcing a migration and forking the integration
      suite. **Lean: bundle Postgres for v1.**
- [x] **What shape is the "API / Web Services" source?** *(opened and resolved 2026-08-12)* —
      **resolved (b): a subtype split inside Cronsole-native**, surfaced in the source bar as
      *Cronsole (HTTP)* and *Cronsole (Scripts)*. Reading (a) was rejected for the reason predicted
      below; (c) remains open as a presentation question once there are three hosted observers to
      group, and blocks nothing. The original framing follows. Three readings,
      producing three different data models, and they are not refinements of one another:
      **(a) a new `PlatformType`** for schedules that live in an external service Cronsole observes
      rather than executes — coherent, but it must be distinguishable from Cronsole-native, which
      already *is* "call an HTTP endpoint on a schedule";
      **(b) a job-type split inside Cronsole-native** — once native gains `EXEC`, one source
      contains two very different kinds of thing, and the dashboard arguably should say which. But
      that is a *kind*, not a source, so it belongs on the card and in filters, not in the source
      bar;
      **(c) an umbrella grouping** over the hosted schedulers (GitHub Actions, Vercel Cron,
      Supabase) — which makes the source bar two-level and is the largest change of the three.
      **Lean: (b) for the near term, (c) once there are three hosted observers to group.** (a) risks
      a source that is indistinguishable from native at the point of creation, which is the
      duplication the source bar exists to prevent.
- [ ] **Agent transport** — WebSocket only, or hybrid with long-polling for restricted networks?
- [ ] **Template registry — static vs. dynamic at launch** — static JSON registry is leading; earn
      a DB-backed API + admin/submission UI later. *(Format is already decided: target-agnostic
      JSON, compiled per target.)*

<details>
<summary>Resolved decisions</summary>

- [x] Cloud hosting choice — **moot; Cronsole launches local-first** *(2026-07-13)*
- [x] License model — **Apache-2.0** *(2026-07-13)*
- [x] Template distribution — **curated core locally + gallery with selective import** *(2026-07-13)*
- [x] Default theme — **dark** *(2026-07-28)*
- [x] Does untrack need an exclusion memory — **yes, subtractive-only `TaskExclusion`** *(2026-07-28)*
- [x] Keep the "TaskHub" name or rebrand — **rebrand to `Cronsole`** *(2026-07-31)*
- [x] Rename the Platforms tab, or grow it — **grow it** into a per-platform capability/status
      matrix *(opened 2026-07-28, decided 2026-08-12)*. The review settled it: the tab currently
      omits the only two platforms that work, so renaming it to `Links` would make that permanent.

</details>

## Strategy guardrails

- **Reliability control plane, not universal scheduler** — two excellent connectors beat six half
  connectors. **Sharpened 2026-08-12, because the capability matrix changed what "half" means.**
  A partial connector used to *lie*: the UI implied verbs it could not perform, so shipping one was
  a promise you had not kept. Every verb now reads **verified / declared / unsupported** against
  this machine, which makes a **read-only observer** a complete and honest product state rather
  than an unfinished controller. So the gate splits by what a connector can *do*, not by how much
  of the interface it fills:
  - **Controllers** (read *and* write — sync, run, enable/disable, create) still unlock only when
    sync reliability >95% and crash rate <2% hold. These can break someone's machine.
  - **Observers** (read-only; every mutating verb `unsupported`) are **not** gated. They cannot
    damage anything and cannot overclaim, and refusing to show a scheduled job because Cronsole
    cannot yet *control* it is the invisible-fence failure at product scale.
  The guardrail's real content was never "few connectors" — it was "never imply a capability you
  do not have." That is now enforced by the matrix instead of by scarcity.
- **No fake data in the UI** — an automation tool earns trust by telling the truth.
- **Dogfood** — migrate real Task Scheduler jobs onto Cronsole-created tasks; every friction point
  is roadmap input.

---

## Appendix — Template & scheduler catalog (backlog reference)

> The **content backlog** the template registry will hold. The abstract catalog can grow freely
> via the registry, but **execution targets unlock only when reliable** (the guardrail above).
> The concrete near-term commitment is the MVP starter set + the Windows compiler; everything
> below that is a prioritized reference, not committed scope.

### Core model

Every automation is three interchangeable parts — **Trigger → Action → Execution Target** (e.g.
*every weekday 07:00 → run PowerShell script → Windows Task Scheduler*). Cronsole exposes one
consistent UI and compiles the abstract template to the chosen target's native config. Per-task
**execution settings**: identity, timeout, retries, concurrency, notifications, logging, governance.

### MVP starter set (first registry templates)

PowerShell Script · Bash Script · Python Script · Executable · Docker Container · REST API ·
Webhook · Folder Watch · File Archive · Database Backup · HTTP Health Check · Windows Service
Monitor · Linux Service Monitor · Certificate Check · Report Generator · GitHub Repo Health Check ·
Scheduled AI Prompt · AI Research Digest · AI Code Review · AI Multi-Agent Workflow.

### MVP execution targets (compile priority order)

Windows Task Scheduler *(real today)* → Cron → systemd Timers → GitHub Actions → Kubernetes
CronJobs → AWS EventBridge Scheduler → Azure Functions → Google Cloud Scheduler → ChatGPT Tasks →
Claude Code Routines.

### Full template taxonomy (categories → templates)

- **Script & command**: Run Program / PowerShell / CMD / Bash / Python / Node.js / Java / .NET / Docker Container / Remote SSH·WinRM.
- **Schedule shapes**: One-Time · Every-N-Min · Hourly · Daily · Weekdays · Weekly · Monthly · First/Last Weekday · Quarterly · Annual · Business Day · Random Window · Delayed · Maintenance Window · Sunrise/Sunset.
- **File automation**: Watch Folder · Copy · Move · Delete Old · Compress · Sync · Upload · Download · Rename · Process CSV/JSON/XML.
- **Backup & maintenance**: Database/File/Config Backup · Log Rotation · Temp Cleanup · DB Maintenance · Disk Cleanup · Certificate Check · Credential Rotation · Patch Prep · Restart Service · Scheduled Reboot · Restore Validation.
- **Monitoring**: HTTP Health · API Validation · TCP Port · DNS · SSL Cert · Process · Windows/Linux Service · Disk Space · CPU/Memory Threshold · DB Connectivity · Queue Depth · File Arrival · Job Watchdog.
- **API & integration**: REST GET/POST · Generic Webhook · GraphQL · OAuth API · Download API Data · API-to-API Transfer · Message Queue Publish · DB Query · Email/Calendar Trigger · SaaS Connector.
- **Developer / CI-CD**: Build · Unit/Integration Tests · Security Scan · Dependency Updates · Build/Push Container · Deploy · Rollback · Repo Sync · Release · Docs Build · DB Migration · Env Refresh · Nightly Build · Branch Cleanup · PR Watchdog.
- **Security / IAM**: Inactive/Orphan Account · Access Review · Expiring/Privileged Access · Group Snapshot · Unauthorized-Change Detection · Service-Account Validation · Secret Inventory · Identity Aggregation/Reconciliation · Joiner/Mover/Leaver · Failed-Provisioning Retry · Governance Reports · SIEM Export.
- **Reporting & notifications**: Generate/Email Report · Daily Digest · Weekly Summary · Slack · Teams · SMS · PagerDuty · ServiceNow · Jira · Approval Request · Escalation Workflow.
- **AI / LLM**: Scheduled Prompt · Research Briefing · News Digest · Document Summarizer · Email Triage · Meeting Prep/Follow-up · Repo/PR/Security Review · Log Analyzer · Report Generator · Data Classifier · Change Detector · Agent Watchdog · Remediation Agent · Multi-Agent Workflow · Human-Approval Workflow.

### Universal trigger types

- **Time**: One-Time · Interval · Cron · Calendar · Maintenance Window.
- **System**: Startup · Login · Logout · Shutdown · Idle · Resume · Windows Event · Process Start/Stop · Service Change.
- **File/Data**: File Created/Changed · Folder Changed · DB Event · Queue Message · Cloud Storage Upload.
- **Development**: Git Push · Pull Request · Issue Created · Release Published · Build Complete · Deployment Complete.
- **External**: Webhook · Email · Calendar Event · Monitoring Alert · IoT Event.
- **Conditional**: Price Threshold · Website Changed · Certificate Expiring · Missing File · Previous-Task Success/Failure · Human Approval.

### Scheduler adapter backlog (execution targets)

- **Operating systems**: Windows Task Scheduler · PowerShell Scheduled Jobs · Windows Services · SQL Server Agent · Cron · Anacron · systemd Timers · launchd · BSD periodic · at.
- **CI/CD**: GitHub Actions · GitLab CI · Jenkins · Azure DevOps · CircleCI · TeamCity · Buildkite · Tekton · Argo Workflows.
- **Containers**: Kubernetes CronJobs · Docker · Nomad · OpenShift · ECS Scheduled Tasks · Azure Container Jobs · Cloud Run Jobs.
- **Cloud** — *AWS*: EventBridge Scheduler · Lambda · Step Functions · Systems Manager · Batch. *Azure*: Functions · Logic Apps · Automation · Data Factory · Power Automate. *Google*: Cloud Scheduler · Workflows · Cloud Functions · Composer.
- **Workflow engines**: Airflow · Prefect · Dagster · Temporal · Kestra · Luigi · n8n · Node-RED · Windmill · Activepieces.
- **Business automation**: Zapier · Make · Workato · Tray.io · IFTTT · MuleSoft · Boomi · ServiceNow Flow.
- **Database**: SQL Server Agent · pg_cron · pgAgent · Oracle DBMS Scheduler · MySQL Event Scheduler · Snowflake Tasks · MongoDB Atlas Triggers.
- **AI platforms**: ChatGPT Tasks · Claude Code Routines · Claude Scheduled Tasks · Claude Hooks · LangGraph · CrewAI · AutoGen · Semantic Kernel · GitHub Copilot Agents · Azure AI Foundry · Vertex AI Agents · Amazon Bedrock Agents · Custom MCP Agents.

---

## Foundation — completed before the July 2026 sprints

<details>
<summary>MVP build-out (Phases 0–3, Jan–Jun 2026, archived)</summary>

- Discovery, requirements, architecture, competitive research *(archived locally under `docs/archive/`)*
- **Windows Task Scheduler end-to-end**: .NET agent ↔ Socket.io backend ↔ Prisma/Postgres ↔ React dashboard
- **Dashboard UX**: dark theme, 4 view modes, category chips with counts, selective import, task cloning, Help Center
- **Template library**: two-tier catalog, Apply modal with `{{placeholder}}` parameters
- Auth scaffold (JWT), Docker Compose dev stack, GitHub Actions CI, unit suites across backend / frontend / agent
- Settings page, non-blocking toasts, live connection health *(2026-07-08)*
- Toast migration, honest Sync/Import split, last-synced chip *(2026-07-08)*
- Synced Windows schedules normalized to cron *(2026-07-08)*
- Template library filters, search & grouping *(2026-07-08)*
- Task search on the dashboard *(2026-07-07)*
- Standard dark/light/system theme system *(2026-07-07)*
- Real cron→Windows-trigger conversion wired end-to-end *(2026-07-07)*
- Cronsole-native tasks — backend scheduler, HTTP job executor, connector *(2026-07-07)*
- Run history & failure surfacing *(2026-07-07)*
- Stale-task pruning on sync *(2026-07-07)*
- Agent reconnect resilience *(2026-07-07)*
- Platform selector in the New Task modal *(2026-07-07)*
- Docs restructure + README visual overhaul *(2026-07-08)*
- Post-rename full test sweep — every automated suite green *(2026-07-31)*

</details>
