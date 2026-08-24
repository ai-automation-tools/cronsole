# Cronsole Roadmap

> The living plan for Cronsole — **what is still open, then what is done**, in priority order.

**How to read this file.** It is a **checklist**, not a narrative, and it is in two parts:

- **[Part I — Open work](#part-i--open-work)** is everything still to do. Nothing in it has shipped.
- **[Part II — Completed](#part-ii--completed)** is everything that has. Every line is ticked, with its date.

An item appears in exactly one part. **Reasoning does not live here** — a shipped item's design
record, verification notes and post-mortem are in [`CHANGELOG.md`](CHANGELOG.md) under its date,
the rationale behind an invariant is in [`DESIGN_NOTES.md`](DESIGN_NOTES.md), and a symptom→fix
write-up is in [`troubleshooting/README.md`](troubleshooting/README.md).

**Update rule.** When a task ships, **move its line from Part I to Part II** with a date, and write
what changed in [`CHANGELOG.md`](CHANGELOG.md). When a material decision changes scope, edit the
item here *first*, then implement. Keep the lines short — **if an item needs a paragraph, the
paragraph belongs in the CHANGELOG.** (This file was reorganized twice, on 2026-08-04 and
2026-08-18, because that rule stopped being followed. Both prior versions are preserved verbatim in
the CHANGELOG's *Roadmap narrative archive* appendices.)

**Legend:** `[ ]` open · `[~]` partially shipped, remainder named · `[x]` complete

> **Note on names.** The product was called **TaskHub** until 2026-07-31. This file is
> current-tense, so it says Cronsole throughout; historical CHANGELOG entries keep the old name on
> purpose.

---

## Status at a glance

| Area | State | What is left |
|---|---|---|
| **P0 — Security** | 🟢 substantially closed | one item: resolve `req.user` from the DB |
| **P1 — Correctness & honesty** | 🟢 closed, two standing items | the E2E suite in CI · the recurring status-honesty review |
| **P2 — Product value** | 🟡 rolling | periodic sync · IA redesign pass 2 · trust indicators · polish *(themes done 2026-08-24)* |
| **P3 — Expansion** | 🟡 underway | POSIX agent · installers · repair verbs · remote-access polish |
| **Sources** | 🟡 4 of ~8 built | POSIX agent (the big one) · Vercel + Supabase observers |
| **Go-public — repo** | 🟡 mostly done | publish-time settings, a stranger-facing README pass |
| **Go-public — application** | 🔴 not started | versioning · ops · code signing · legal |

**Leading the queue as of 2026-08-24:** the
[source-onboarding requests](#sources-onboarding) — **all five landed the same day.** The fifth,
GitHub Actions' live verification, ran against a real repository and immediately earned its keep:
it found a defect no unit test could see ([#75](troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive)),
which is the argument for doing this on every connector rather than trusting a green suite.

**The largest open item is now the POSIX agent.** *(The light theme and the `env` editor — the
whole 2026-08-15 request block — both shipped 2026-08-24; the theme pass carved out one follow-up,
`--border` needing a second token to meet WCAG 1.4.11.)* *(Per-job encrypted
fields led this list until it shipped 2026-08-21, which unblocked the `NOTIFY` and `SQL` job
types — neither is scheduled.)*

---

<a id="part-i--open-work"></a>

# Part I — Open work

## ▶ Next up

The short list. Everything here is small, known, and was found by hand rather than reported —
which is why it sits first, not because it outranks the larger work below.

<a id="sources-onboarding"></a>

### 🔴 Requested 2026-08-24 — source onboarding

Five requests about **sources**: how a new user meets them, how the set is managed, and where the
things that are *not* sources ended up. **Four shipped the same day** (see
[Part II](#shipped-2026-08-24--source-onboarding)); what is left is the one half that needs a
credential nobody has checked in.

**The three decisions taken first, kept here because the items in Part II are the record of what
was built and these are the record of why it took that shape:**

1. **The Platforms tab becomes the Sources tab.** It already holds the capability matrix, the
   Claude and GitHub panels and the quick links — it *was* the sources screen under a name that
   described the code rather than the user's question. Rebuilt as **Your sources · Available ·
   Quick links · Add a custom source**, rather than standing up a second screen about the same
   four platforms, which is the §11a drift shape.
2. **The rail gets two buttons, not three.** *Explore sources* and *Manage sources* deep-link into
   that screen's two halves; **Add a custom source** lives on the screen, reached from Explore.
   Three controls stacked in a 240px rail is furniture, and Explore/Manage are two views of one
   list.
3. **A fresh install shows Windows Task Scheduler and Cronsole-native.** Claude Code and GitHub
   Actions are opt-in from Explore. Visibility is the **union** of the preference, the platforms
   holding tasks, and the platforms with a connection — so opting in is additive and *no source
   holding a task can be hidden*.

- [~] **GitHub Actions — verified against a real repository** *(2026-08-24)*. Connected with a PAT,
      watched two repositories, and synced: **3 tasks**, two with their crons read UTC-for-UTC
      (`10 13 * * *`, `20 13 * * *`) and their real run outcomes, the third kept with
      `schedule: null` **and a reason** because its workflow file is genuinely malformed YAML — the
      *"could not read ≠ has no schedule"* rule doing exactly its job on a file nobody planted.
      The pass found a real defect and it was not in the read path: a plain **Sync** could never
      adopt a newly watched repository, and reported success on every press
      ([#75](troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive)) —
      fixed the same day.
      **Left, and only reachable by waiting or by breaking something on purpose:** a revoked scope
      mid-life must **throw** rather than retire every tracked workflow, and GitHub's silent 60-day
      auto-disable must surface as health with GitHub's own reason. Both paths have unit coverage;
      neither has been seen live.

<a id="native-job-types"></a>

### 🔴🔴 Top priority — requested 2026-08-15

Four items were requested directly after the dashboard IA redesign landed. **Three shipped** —
collections, the native job types, and the phone verification (see
[Part II](#shipped-2026-08-15--2026-08-17)); the fourth, per-job encrypted fields, shipped
2026-08-21 as [ADR 0003](adr/0003-per-job-secrets.md), and the `env`-editor remainder that work
carved out shipped 2026-08-24. **The themes shipped the same day, so this block is closed** — see
the two entries below for what measuring them turned up.

- [x] **An `env` editor for `EXEC` and `SCRIPT` jobs** — shipped 2026-08-24 *(carved out of per-job
      secrets, 2026-08-21)*. One **Environment** control shared by both types, `NAME=value` per line
      or JSON, `#` and blank lines dropped so a pasted `.env` block works. Backend needed nothing:
      `buildNativeJob` and `validateEnv` already carried `env`, and `secretRefsIn` already read
      `payload.env` — the field was reachable through the API and MCP the whole time and had no
      control in the app. `${secret.…}` is legal in a value and **unrepresentable** in a name
      (the parser mirrors `SECRET_NAME_RE`, so the illegal case cannot be typed rather than being
      typed and refused at 3am). `discardedByTypeSwitch` now reads the *target* type too, because
      `env` is the one field EXEC and SCRIPT agree about and so survives that pair's conversion
      and no other.
      **What building it found**, both the [#20a](troubleshooting/README.md) second-definition
      shape: `EditTaskModal` carried its own completeness check that knew two job types, so
      **every edit to a script or check task was blocked by "A command is required."** over a
      field those types do not have; and the null-payload refusal was hard-coded to the headers,
      so an unreadable env on a script job reported a headers problem on a type with no headers
      ([#76](troubleshooting/README.md#76-save-is-blocked-on-a-script-task-over-a-command-field-that-does-not-exist)).
      Both now go through the shared `nativeJobIncomplete` / `nativeJobUnreadable` pair — which
      also closed the create form's half (unreadable headers posted a literal `job: null`) and a
      third disagreement it exposed: the browser refused a `${secret.WEBHOOK_URL}` URL the API
      accepts and the guide recommends.
      **Verified live, not only in the suite** — `frontend/tests/e2e/native-job-env.spec.ts` drives
      the real form against a real backend and reads the stored job back, on both the create and
      the edit path. The unit suite could never have caught the gap this closed: `buildNativeJob`
      handled `env` the whole time and nothing in the browser sent it, which is green from both
      sides.

- [x] **Fix the themes — light first** — shipped 2026-08-24. The hypothesis recorded here was
      right, and measuring first is what found the rest: **26 pairs were below the WCAG AA bar
      across both themes**, not only in light.
      **The structural fault was the one predicted.** Light ran `background 100% → surface 95% →
      raised 98%`, putting a *raised* panel at 1.04 against the page — flatter than the `surface`
      card it sits above (1.12) and very nearly invisible. Light is now the **mirror** of dark:
      the same separations, in the only direction available when the page is white. Dark
      1.05/1.16/1.27, light 1.07/1.14/1.25. The old comment defended the inversion as "lifted
      rather than sunken", which is a real concern and the wrong trade — on a white page every
      step away from the background is darker, so "lifted" cannot be expressed as "lighter" and
      the honest choice is a step you can see.
      **What measuring found that guessing would not:** `subtle-foreground` — the 10px uppercase
      label above every form field, 338 sites — failed AA on *every* surface in **both** themes
      (3.27 dark, 2.89 light). White on the green **Run now** fill was 2.59 and white on the red
      destructive-confirm fill 3.78. Amber and sky were invisible as *dots* in light (2.14, 2.85)
      — a status dot has no text beside it, so it is non-text UI at 3:1. `muted-foreground` had to
      move with `subtle-foreground` in light or the two collapsed to one weight.
      **The bars are now a test, not a review** (`frontend/src/__tests__/themeContrast.test.ts`,
      65 assertions): it parses `index.css` and measures every pair, so a future value cannot
      regress quietly. It also pins `:root === .dark`, because a drift there flashes the wrong
      palette before hydration on every cold load and nothing fails. Baselines regenerated; the
      `-text` / accent split and "a shared hue is not a shared role" both held throughout — no
      component changed, exactly as scoped.

- [ ] **`--border` does not meet WCAG 1.4.11, and needs a second token** *(carved out of the theme
      pass, 2026-08-24)*. It measures **1.61:1** in light and **1.69:1** dark against the page,
      against a 3:1 bar for non-text UI. It was raised from 1.41/1.40 as far as one token can go,
      and the test pins that floor so it cannot slip back — but the gap cannot be closed by a
      value. `--border` does two jobs: separating cards (decorative, *exempt* from 1.4.11) and
      drawing the boundary of a text input (in scope, not exempt). Reaching 3:1 needs `L=58%` in
      light and `L=37%` in dark, which would turn every hairline into a heavy rule at all **313**
      call sites, including the ~260 the rule does not apply to. The fix is `--border` plus
      `--border-strong` and a sweep of the *controls* only — a component change, which is why it
      is not in the palette pass. The test says so and will fail if someone closes it by value.

<a id="import-sync-split"></a>

### 🔴 Requested 2026-08-18

- [ ] **Periodic sync — promoted from P2** *(asked 2026-08-18; the P2 line is now a pointer here)*.
      Nothing in the stack schedules a sync today: `POST /tasks/sync` has three callers — the two
      dashboard buttons, the Claude-routine create path, and the `sync_tasks` MCP tool. The only
      timers are the 45s connection-**health** poll (health is evidence, never a sync), the catalog
      refresh and `NativeScheduler`. The agent has no watcher either.
      **Refresh-only, opt-in, per connection**, interval stated and last run shown — for the reason
      above: an automated `categories` import would clear exclusions. A newly appeared *folder* is
      surfaced from the `untracked` count as a prompt, **never auto-adopted**: on this machine that
      would mean 257 of Microsoft's tasks arriving unasked. New tasks *inside* an already-tracked
      folder need nothing new — `upsertTasks` creates them on any refresh.
      **What people would otherwise do, and why it is worth building instead:** a native `HTTP` job
      posting to `/tasks/sync` works today but stores its API token in `Task.metadata` as plaintext
      — the same gap [per-job encrypted fields](#native-job-types) exists to close, and it would
      travel in exports. A scheduled Claude routine calling `sync_tasks` avoids that (the token
      lives in the host's environment) but needs Claude routines. Neither is a thing to document as
      the answer.

- [ ] **A Monthly trigger for the Windows agent** *(surfaced 2026-08-18 by the schedule picker)*.
      `scheduler-conversion.ts` has no monthly pattern, so `0 9 1 * *` falls to the replaced-with-
      hourly fallback: ~8,760 runs a year for a schedule that asked for 12. That was tolerable
      while a monthly cron was something you had to know to type; the picker makes it a one-click
      choice, and the only thing standing between it and a wrong task is a warning. The work is a
      `Monthly` arm end to end — `WindowsTrigger` already declares the type, but `TriggerSpec`,
      `TriggerBuilder`, `canonicalizeTrigger`/`CanonicalizeTrigger` (both sides, byte-for-byte)
      and `convertWindowsTriggerToCron` do not have it. Until then the picker offers the shape and
      the server's warning is what tells the truth about it.

<a id="follow-ups-2026-08-13"></a>

### 🔴 2026-08-13 follow-ups — the unfixed remainder

Left open at the end of the 2026-08-13 MCP/Claude test pass. Ordered worst-first; the three items
of that list which have since shipped are in Part II.

- [ ] **A `MISSING` Claude row cannot be removed by anything.** Delete a routine at claude.ai and
      its Cronsole row is correctly detected as `MISSING`, but `untrack_task` 400s for
      `CLAUDE_CODE` and `disconnect_claude_routine` only reaches *declared* routines. OAuth mode
      now produces tracked Claude rows that nothing in `PlatformConnection.config` declares, so the
      documented escape hatch does not cover them. **Two such rows are stranded on the dev machine
      today.**
- [ ] **Two refusal messages point at each other.** `delete_task` on a Claude task says *"untrack
      it instead"*; `untrack_task` 400s for `CLAUDE_CODE`; neither names
      `disconnect_claude_routine`. Same pass: untrack's message promises that removing the routine
      *"also forgets its API token"*, which an OAuth-created routine never had.
- [>] **`list_platforms`' MCP tool description was stale** — fixed 2026-08-24 alongside the
      `access` field, see [Part II](#shipped-2026-08-24--source-onboarding).
- [ ] **`update_task_schedule` echoes a next-run time it computed** — the immediate response
      carries `computeNextRun(cron)` while the platform's real value (Anthropic's jitter, Windows'
      trigger) only lands on the next sync. Storage converges, so this is the response shape only —
      but it is the [#42](troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday)
      shape: a timestamp whose label does not name the event that produced it.
- [ ] **The sync response's `missing` is a delta, not a state** — it counts rows *newly* marked
      `MISSING` by that pass, so it reads `0` beside `count: 5` while two rows sit `MISSING`.
      Defensible, but it is presented next to a state field and invites the wrong reading.
- [ ] **Cronsole can refuse a multi-value hour honestly, but still cannot convert one**
      *(carved out of the `shiftCron` fix, 2026-08-15)*. `0 9-15 * * *` → `0 17-23 * * *` is
      expressible and would be a real improvement; ranges that cross midnight (`9-17` in Pacific)
      are not, and per-element weekday rolls make the general case sharp. Its own item deliberately
      — smuggling it into a warning fix is how the warning stops being trustworthy.

**Chores, not roadmap items** *(dev machine)*: the MCP host needs a restart to load a rebuilt
`mcp-server/dist/`; the Windows task `Cronsole conversion-response probe (safe to delete)` in
`\Cronsole` is disabled and wants deleting.

---

<a id="p0-security"></a>

## 🟡 P0 — Security hardening

<!--
  Linked as `#p0-security`, not by heading slug. This heading has carried dates and been edited
  twice; each edit silently broke every link to it (found 2026-08-17 by
  scripts/check-doc-links.mjs). A heading whose text is expected to change wants a stable anchor.
-->

*Closed 2026-07-09, reopened 2026-08-13 for one gap, **substantially closed again 2026-08-15**.
The five original items and the two shipped halves of the API-token work are in
[Part II](#completed--p0-security). One item remains, and it gates nothing.*

- [ ] **Resolve `req.user` from the database instead of trusting the `email` claim.**
      `authenticateToken` verifies the signature and assigns `req.user` straight from the payload;
      it never checks the `id` against the DB. A correctly-signed token for a deleted user stays
      valid for its full life, and the `email` claim is whatever the signer typed. Harmless today
      because only `id` is used for scoping — and exactly the kind of thing that stays harmless
      until something reads `req.user.email`. Small, and independent of everything else.

---

## 🟠 P1 — Correctness & honesty

New correctness work lands here as it is found. Everything logged before 2026-08-16 is closed —
see [Part II](#completed--p1-correctness--honesty).

- [ ] **The agent must report its own elevation, and MISSING must be bounded by what the agent can
      see** *(logged 2026-08-23, from a live incident)*. An agent started by hand from an ordinary
      shell runs **unelevated** and cannot enumerate the ACL-protected task folders —
      `\Microsoft\Windows\UpdateOrchestrator\`, `\TPM\`, `\Pluton\`, `\WindowsUpdate\`,
      `\License Manager\`, `\DeviceDirectoryClient\` and a dozen more. On this machine that is
      **86 of 371 tasks**. The next sync compared a 285-task snapshot against 374 tracked rows and
      marked the difference MISSING, and the dashboard offered to *Clear 89 missing*.
      **Every layer was individually honest and the product still lied.** The agent reported what it
      could see. `getHealth` correctly said connected-and-answering — elevation is not liveness.
      `reconcileMissingTasks` did exactly its job. The 50%-retention guard did not fire, because
      285/374 is 76%: the guard catches a *catastrophically* partial snapshot, not a
      systematically-blinded one, which is the more dangerous shape precisely because it looks
      plausible.
      **This is the "absence of evidence is `unknown`, never `ok`" rule with the sign flipped** —
      here absence of evidence rendered as a confident *"the platform no longer has this task"*.
      Three parts:
      **(a)** the agent sends its **integrity level** on the handshake (it knows its own token), and
      it lands beside health rather than inside it — *connected*, *answering* and *elevated* are
      three facts and collapsing them is how this hid;
      **(b)** the Platforms row and the health strip say **"agent is running unelevated — some task
      folders are not visible"**, which is a *fact about the reader*, not a verdict about the tasks;
      **(c)** `reconcileMissingTasks` **refuses to mark anything MISSING when the agent reports a
      narrower field of view than the snapshot it is being compared against** — an unelevated agent
      may add and refresh rows, never retire them. Retiring a row is the one operation that needs
      the reader to have been able to see everything.
      Cheap corroborating signal worth having either way: **a MISSING set concentrated in whole
      subtrees is structurally different from scattered attrition**, and the difference is
      computable. See [troubleshooting #74](troubleshooting/README.md#74-dozens-of-windows-tasks-go-missing-in-one-sync-and-the-agent-is-healthy).

- [ ] **`Clear N missing` states its scope in words, and its friction scales** *(logged
      2026-08-23, same incident)*. `DELETE /api/tasks/missing` makes **no platform call** — it drops
      Cronsole's rows and their `ExecutionLog`, writes no `TaskExclusion`, and the next sync
      re-imports everything as **new rows**. So the machine is never at risk and the headline damage
      is nil. What does **not** come back is everything hanging off the old row id: stars
      (`TaskFavorite`), collection membership, `TaskSecret`, run history, and any rename or custom
      category — silently, and only for the tasks a user cared enough about to have annotated.
      The route's own comment states the premise that fails: *"MISSING means the platform already
      reported the task gone, so there is nothing left to remove and no confirmation to obtain."*
      The platform reported nothing; a blinded agent did. **A control may not derive its own
      safety from a status whose trustworthiness it cannot check.**
      So: name the scope in words rather than as a bare count (*"89 tasks across
      `\Microsoft\Windows\UpdateOrchestrator`, `\TPM`, … "*), apply the
      `TYPE_TO_CONFIRM_THRESHOLD` rule the Mass Actions console already earns past 25, and **say
      what is lost that a re-import will not restore** — the count of stars, collection memberships
      and secrets about to be dropped, which is the only part that is not recoverable. Everything
      needed to compute that is already on the row.
      *(The route is otherwise written defensively and should stay that way — its guard against a
      stale Prisma client making `TaskStatus.MISSING` undefined, which would widen the `where` to
      every task the user owns, is exactly right.)*

- [ ] **The E2E suite writes real rows into live data** *(logged 2026-08-23)*. A run leaves
      `\E2E\Mock Nightly Backup` tracked against the developer's own account, which then goes
      MISSING when the mock agent disconnects and sits on the dashboard forever. Same family as
      [#5a](troubleshooting/README.md#5a-and-the-transient-agent-is-the-e2e-suite) — the suite drives
      the live stack and leaves something behind — and it lands in the same place as the fixtures
      work in the CI item below: the mock agent needs its **own user**, not the developer's.

- [ ] **Run the E2E suite in CI — it is the only thing that renders CSS, and nothing runs it**
      *(logged 2026-08-16)*. `npm run test:e2e` sat **100% broken for a day** (18 of 18) after the
      IA redesign moved a heading every test waited on, while backend 715, integration 223 and
      frontend 541 stayed green. **jsdom does not evaluate media queries**, so the unit suite passes
      whether `hidden md:flex` is right or wrong; Playwright is the only layer that can see a
      responsive layout, a real stylesheet, or a drawer that does not open.
      **The blocker is fixtures, not the runner.** Several assertions lean on this machine's live
      data — native job-type rows, a connected agent's health dot, source counts — and the visual
      baselines are Windows-rasterized while CI is Linux. It needs (a) a seeded deterministic
      dataset the assertions can name, (b) the mock agent from `mock-agent.spec.ts` promoted to the
      shared harness, and (c) a Linux baseline set, which the per-platform snapshot suffix already
      supports. **Doing it hastily is worse than not doing it** — a flaky visual job gets disabled,
      and a disabled suite is what produced this item. Until then, `workflows.md` states the
      obligation to run it after any dashboard change.

- [ ] **System-status honesty — the standing review** *(the mechanisms shipped 2026-07-08; this
      item is deliberately never closed)*. Periodically check that no status surface has drifted
      back to asserting something it cannot evidence. **The class has returned four times and each
      return sharpened the tell**, so the item is the review, not a fix:
      - a verdict derived from a **precondition** that cannot change when the subject fails
        ([#40](troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out));
      - a real timestamp of the **wrong event**
        ([#42](troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday));
      - an **expired** observation reported in the present tense
        ([#48](troubleshooting/README.md#48-windows-sits-at-degraded-for-hours-while-the-agent-is-perfectly-healthy));
      - a **cache whose only writer runs on another code path**
        ([#66](troubleshooting/README.md#66-two-cronsole-surfaces-disagree-about-the-agent-in-the-same-second)).

      The questions to ask of any status field: *what writes it, is that what the label names, and
      is that path running in the session doing the reading?*

---

## 🟡 P2 — Product value

Shipped P2 work is in [Part II](#completed--p2-product-value).

<a id="dashboard-ia-pass-2"></a>

### Dashboard IA redesign — pass 2 *(requested 2026-08-15; pass 1 shipped)*

- [ ] **Scoping.** Views filtered to the source they make sense for (*System* is Windows-only and
      reads `0` everywhere else); source-scoped header actions, so **Sync** and **Import** state
      which platform they mean; per-source empty states, so a connected platform with nothing
      imported says how to import from it.

### Open — UI & product

- [~] **Thin the first viewport** *(desktop and mobile both shipped 2026-08-12; the 375px
      verification is automated in `tests/e2e/layout.spec.ts`)*. **Left:** `--raised` exists and is
      applied to exactly one panel, the filter zone. Spending it across the app to build real
      hierarchy is the half of this item that has not been done.
- [ ] **Two Settings toggles are now vestigial** *(logged 2026-08-12, created by the same change)*.
      The dashboard opens on **All**, which hard-sets `status: any` and `system: include` — exactly
      what *Show disabled tasks* and the persisted system lens control, so neither affects the
      opening view any more (`defaultCategory` and `defaultPlatform` still do). **Not silently
      removed**, because the system lens is still written when you change it from the dashboard,
      and both may want to become "what the All view means for you" instead. Decide between making
      them apply again, repurposing them, or deleting them — but do not leave two settings that
      look like they do something and don't.
- [ ] **Restore's plan doesn't check that a task's action points at anything that exists**
      *(logged 2026-07-31)*: add an **advisory** column reporting, per file, whether the action's
      executable and file-looking arguments resolve on this machine. Not a refusal — an executable
      missing here may exist on the machine being restored to.
- [ ] **Task-detail trust indicators — say how old the truth is, per task**: last
      platform-confirmed sync, last agent result, and Windows' own `lastTaskResult` in the modal.
      *(The 2026-08-12 review adds a fourth: whether the displayed action was reported by the
      **current** agent version — an un-republished agent omits fields rather than erroring, so a
      stale panel and a correct one look identical.)* The dashboard health strip answers this at the
      *platform* level; the per-task half is open.
- [>] **Optional periodic Windows sync** — moved to
      [Next up](#import-sync-split) on 2026-08-18, alongside the Import/Sync split it belongs with.
- [ ] **UI polish pass**: full-path tooltip/copy on truncated task paths · Apply-modal footer
      crowding · Help Center reachability at ~720px · the two dev-mode Socket.IO console warnings
      (worth clearing before any demo capture — they bury real console errors).
- [ ] **Onboarding becomes contextual instead of global** *(sharpened 2026-08-12)*: the banner
      lives in `Dashboard.tsx` **above the tab switch**, so it rides along on Templates, Tools and
      Platforms too, and clears only on an explicit click. Auto-retire it once the user has
      imported, created or starred; replace it with per-tab first-use cards, which is where the
      advice is actually actionable.
- [ ] **Console noise in user-facing flows**: **37 backend + 3 frontend** `console.*` calls
      *(counted 2026-08-12)*, the worst carrying task names, native paths and full command lines —
      `routes/tasks.ts`, `WindowsAgentConnector.ts`, `NativeScheduler.ts`, `TaskService.ts`,
      `AgentManager.ts`, `Dashboard.tsx`. Do it with the structured-logging work under *Production
      operations*: levels + redaction, with full command lines behind an explicit diagnostics
      export rather than on by default.
- [ ] **Native task follow-ups**: a `CLAUDE_PROMPT` job type, and a Redis lock before
      multi-instance.
- [ ] **Template registry — optional follow-up**: index signing, beyond the per-file sha256.
- [ ] **Cross-platform template targets — follow-up (b)**: real export artifacts (cron line,
      launchd plist, Claude routine payload). Lands as connectors and the POSIX agent do.
- [ ] **Settings agent-pairing panel** *(deferred)*: waits on the per-user pairing-code flow.
- [ ] **Tools tab — further candidate tools** *(candidates only, none scheduled)*: scheduled
      automatic backups (backend writes, not the elevated agent) · snapshot diff ("what changed
      since your last backup"). Rule for the tab: everything on it must be genuinely cross-cutting,
      or it is a junk drawer.

---

<a id="-sources--where-a-task-comes-from"></a>

## 🔷 Sources — where a task comes from

> **The priority once *Next up* is clear** *(scoped 2026-08-12)*. The dashboard's first-level axis
> is the **source** a task comes from. Cronsole ships with three — Windows Task Scheduler,
> Cronsole-native (split into HTTP · Programs · Scripts · Checks) and Claude Code routines. This
> section is the plan for the rest; the built ones are in [Part II](#completed--sources).
>
> **Read the [guardrail change](#strategy-guardrails) first**: the capability matrix makes a
> **read-only observer** an honest, complete product state, so a source no longer has to be fully
> controllable to be worth shipping. Controllers stay gated on reliability; observers do not.
>
> **Ordering principle: prefer the build that unlocks several sources over the one that unlocks
> one.** A POSIX agent covers launchd, cron *and* systemd timers with one protocol and no new auth
> story. Each cloud scheduler costs its own OAuth surface, rate limit and mental model, for exactly
> one source.

- [ ] **POSIX agent — launchd · cron · systemd timers** *(the big one, and the one that actually
      broadens the product)*: all three are **local OS schedulers**, structurally identical to
      Windows Task Scheduler — read the machine, run a thing, enable/disable. One build reuses the
      whole existing protocol: outbound WebSocket, HMAC-signed commands, the sync model, folder and
      path handling, the capability matrix. **Three of the most universal developer schedulers, one
      auth story, zero new server surface.** Absorbs the former standalone *macOS agent (launchd)*
      P3 item and the 7 catalog templates waiting on it.
      Open sub-questions: whether the agent is a .NET port (the `ITaskScheduler` abstraction ports
      cleanly) or a separate binary; per-user vs system crontab; and how a systemd timer's
      `OnCalendar` maps onto 5-field cron, which is lossy in both directions and needs the same
      honest-warning treatment the Windows trigger conversion already has.

- [x] **Verify GitHub Actions against a real repository** *(2026-08-24 — see
      [Next up](#sources-onboarding))*. The observer shape is now proven end to end, and the two
      below inherit both the pattern and its one live lesson: a connector whose tracked set is
      **declared** must say so, or its first sync silently imports nothing.

- [ ] **Vercel Cron · Supabase `pg_cron` — read-only observers** *(next up in this section)*:
      increasingly the default for web and indie developers, and both have trivial APIs. Same
      observer shape as GitHub Actions, which **shipped 2026-08-23 and proved it end to end** —
      a fixed `unsupportedVerbs`, health from stored sync evidence with no probe, a hand-composed
      connection with a write-only token, and the repository/project as the category. The pieces
      those two need that GitHub did not have are their own auth surfaces and nothing else.

- [ ] **Deferred — Kubernetes CronJobs · AWS EventBridge Scheduler · Azure Functions · Google Cloud
      Scheduler**: common in *teams*, rare for a solo developer, and each is its own auth surface,
      rate limit and mental model for exactly one source. The gate was "revisit once the observer
      pattern has proven itself", and GitHub Actions did that on 2026-08-23 — but the gate's
      *second* half stands: these are common in teams and rare for a solo developer, so they wait
      on the two cheap ones above rather than on the pattern. Kept here rather than dropped so the
      omission stays a decision rather than an oversight.

- [ ] **Staying quick-links-only — ChatGPT · Gemini · Jules**: no public scheduled-task API exists.
      A connector would render a row of `unsupported` that says strictly less than the link already
      does. Revisit if an API appears.

- [ ] **Umbrella grouping for the hosted observers** *(reading (c) of the 2026-08-12 source
      decision, left open when (b) was chosen)*: group GitHub Actions / Vercel / Supabase under one
      two-level source node. A presentation question about the rail, not a data-model one — worth
      doing once three hosted observers exist, and it blocks nothing until then.

- [ ] **The last unedited attribute — a question, not a task** *(reported 2026-08-12)*. Category,
      schedule, action/command, job spec and name are all editable now. A task's **`externalId`**
      is not, and probably should not be: it is the identity the row is keyed on and the address
      every signed agent command uses. For Windows it is the Task Scheduler path, so "editing" it
      means moving the task on the machine; for Claude it is the routine id, which
      `edit_claude_routine` already re-points properly. **Is there a case for it that is not one of
      those two?**

---

## 🟢 P3 — Expansion

> **Launch posture (decided 2026-07-13): Cronsole ships and stays local-first.** Cloud/SaaS hosting
> is not a launch requirement. Remote access to your own instance is the final, optional
> enhancement; go-live does not depend on it.

Shipped P3 work is in [Part II](#completed--p3-expansion).

- [ ] **Guided repair verbs, on top of System diagnostics** *(logged 2026-08-17; deliberately
      sequenced after the read-only panel, which shipped)*. The diagnostics panel answers *what is
      wrong*; this is the *fix it* half. It stayed out of that change on purpose — three of the four
      agent-health entries in the troubleshooting log were the readout lying, so a repair button
      would have acted on a diagnosis nothing could yet check. Constraints, all established by the
      panel:
      - **A repair reports what it *observed afterwards*, never what it *did*.** "Spawned a
        process → Fixed!" is `success` without `ran`
        ([#59](troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check))
        in the one place a false green is most expensive. Every verb re-runs the check that prompted
        it and reports the **new** state.
      - **A fixed, named list — never a parameterized one.** The moment a repair takes a command,
        Cronsole has an elevated arbitrary-action primitive reachable from a browser, which is what
        "the agent gets no file-write verb" refuses. Candidates: republish the agent, restart the
        agent, re-register the `\Cronsole-Stack\` tasks.
      - **Not in the template registry.** Repairs are about Cronsole itself and must be
        version-locked to it; a managed template row can be pruned by `catalogSync` — the catalog
        could delete the thing that fixes the catalog.
      - **The genuinely useful half is outside the stack and already exists**: `\Cronsole-Stack\`
        survives the backend, Postgres and Docker all being down, because Windows Task Scheduler
        runs it. Productising *that* belongs with **Installer packages** below. Note the standing
        decision that those tasks are **not tracked** in the dashboard — disabling `CronsoleAgent`
        from the dashboard is also what breaks the dashboard's ability to re-enable it.

- [ ] **Installer packages (agent only)** — signed WiX MSI replacing the PowerShell setup script;
      macOS `.pkg`/Homebrew once the launchd agent exists.

- [ ] **Ship the whole application as a Windows installer (`.exe`)** — four jobs, not a packaging
      step: (1) Postgres bundled vs. SQLite *(open decision below; lean bundle)*, (2) drop Redis,
      (3) `vite build` served same-origin by Express, (4) bundle the Node + .NET runtimes. Secrets
      must be generated **per machine at install time**, and uninstall must sweep Task Scheduler.
      Signing is a hard prerequisite (SmartScreen), not polish. ~1 week to installable, ~1 more to
      trustworthy.

- [ ] **Split the files that have become fault lines** *(re-counted 2026-08-12; every one grew, and
      one was missing from the list)*: `DashboardScreen.tsx` (1,251), `routes/tasks.ts` (1,182),
      `mcp-server/src/tools.ts` (1,140), **`routes/tools.ts` (1,130 — newly listed)**,
      `TemplatesScreen.tsx` (794), `AgentService.cs` (782), `TaskModal.tsx` (757).
      **Still not a refactor sprint** — split along the named seams only when next touching that
      area. Seams: dashboard filters/saved views · dashboard bulk actions · dashboard view
      renderers · task mutation vs. sync/discovery routes · tools backup/restore routes · MCP task
      vs. template vs. diagnostic tools.

- [ ] **Route-level code-splitting** *(optional follow-up to the frontend refactor)*: the single
      bundle trips Vite's 500 kB hint; cheap now that the router and screen modules exist.

- [~] **Template gallery site** — parts 1, 2, 4 and 5 shipped *(2026-07-14 → 2026-07-28)*.
      **Left: part 3**, the one-click "Add to my Cronsole" deep-link / protocol handoff. Download
      and Copy JSON use the shipped Import path today.

- [~] **Remote access (self-hosted) — the final, optional enhancement.** Reach your **own** local
      instance from other devices (the code-server model) via Tailscale or Cloudflare Tunnel +
      Access. **The tooling shipped 2026-08-15 → 2026-08-17**; what remains is polish, not plumbing.
  - [ ] **PWA manifest + icons** so the dashboard installs to a phone home screen — the last piece
        of the "trigger from your phone in under 30 seconds" goal.
  - [ ] **Auth hardening for an internet-facing gate** *(deliberately deferred 2026-08-15 — the
        network gate does this job today)*: there is no password reset, so forgetting the one
        password while travelling is only fixable at the keyboard; and the 24h JWT lives in
        `localStorage` on a phone that can be lost, with no refresh flow. Both are acceptable behind
        Tailscale or Access, and are the first things to revisit if the gate is ever relaxed.

- [ ] **ChatGPT** — stays quick-links-only unless a public automations API appears.

- [ ] **Product bets — from "a better Task Scheduler UI" to "a local automation control plane"**
      *(directions, not scheduled work — each needs its own design pass first)*. ★ = recommended
      first. The shared constraint: this project's guardrail is reliability first, and every bet
      below is a feature that can be confidently wrong.
  - ★ Runbooks attached to tasks
  - ★ Task collections / playlists *(the first slice shipped 2026-08-16 as Collections)*
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

---

## 🚀 Go-public checklist

Everything required before the repo flips public and Cronsole is promoted beyond personal use.
**Cronsole launches local-first** — each user runs the whole stack on their own machine, so these
cover the repo and product going public, not standing up a multi-tenant cloud service.

### Repo goes public

- [~] **Secret & history audit** — audit clean *(2026-07-13)*. **Left:** squash to a fresh public
      root at publish time, and scrub personal machine paths from internal docs.
- [~] **Repo hygiene for outsiders** — done *(2026-07-13)*. **Left:** branch protection on `main`
      (a GitHub setting; do it at publish).
- [~] **Community scaffolding** — `SECURITY.md`, `CODE_OF_CONDUCT.md`, issue/PR templates and the
      CI badge shipped *(2026-07-13)*. **Left:** enable Discussions at publish.
- [~] **Final README/docs pass for a stranger audience** — the CLAUDE.md cloud-hosting row is fixed
      *(2026-07-31)* and four false README claims were corrected *(2026-08-17)*. **Left:** a
      quick-start that works on a machine that isn't Mike's, screenshots/GIF, an honest
      feature-status table, and the wider stale-claims sweep.

### Application goes public

- [ ] **Versioning & releases** ← *next*: semver across the four independently-versioned
      components, tagged releases, changelog discipline, so advertised versions are reproducible.
      Also unblocks the deliberately-skipped `version` fields in the package manifests.
- [ ] **Production operations**: error tracking, structured logs, uptime monitoring + status page,
      automated Postgres backups with a **tested restore**, broader API rate limiting, staging +
      deploy pipeline. *(Auth rate limiting shipped 2026-07-16.)*
- [ ] **Agent distribution & trust**: signed installer, a code-signing certificate to clear
      SmartScreen, versioned releases with an update channel, and a documented "what the agent can
      do / how to remove it" trust page. **The certificate is a hard prerequisite for the
      whole-stack installer.**
- [ ] **Legal minimum**: privacy policy, terms of service, account deletion + data export that
      actually purges tasks and logs, cookie handling on the public site.
- [ ] **Multi-user / hosted account system** *(deferred — not a local-first launch requirement)*:
      password reset (needs email infra), open registration as a *designed* invite/approval flow,
      JWT refresh tokens, per-user agent pairing, account management and roles.
- [~] **Launch surface** — one public page shipped *(2026-07-28, consolidated from two)*. **Left:**
      real install/download links once the app repo is public, and richer marketing content.

---

## Open decisions

- [ ] **Installed-app database: bundled Postgres vs. SQLite** *(opened 2026-07-28)* — blocks the
      whole-stack installer and only that. Bundled Postgres costs ~250 MB and a service lifecycle
      but needs **no schema or test changes**; SQLite gives a single-file install but
      `Template.tags String[]` is Postgres-only, forcing a migration and forking the integration
      suite. **Lean: bundle Postgres for v1.**
- [ ] **Agent transport** — WebSocket only, or hybrid with long-polling for restricted networks?
- [ ] **Template registry — static vs. dynamic at launch** — a static JSON registry is leading;
      earn a DB-backed API + admin/submission UI later. *(Format is already decided: target-agnostic
      JSON, compiled per target.)*

Resolved decisions are in [Part II](#completed--resolved-decisions).

---

<a id="part-ii--completed"></a>

# Part II — Completed

Everything below has shipped. One line per item with its date; the write-up for anything from
2026-08 onward is in [`CHANGELOG.md`](CHANGELOG.md) under that date, and the full narrative these
lines replaced is in that file's *Roadmap narrative archive* appendices.

<a id="shipped-2026-08-15--2026-08-17"></a>

## Shipped 2026-08-15 → 2026-08-18 — the current sprint

### Shipped 2026-08-24 — source onboarding

Four of the five [2026-08-24 requests](#sources-onboarding). The fifth — GitHub Actions' live
verification pass — is still open above, narrowed to the half that needs a token.

- [x] **A fresh install shows two sources, and the rest are opt-in** *(2026-08-24)*. Windows Task
      Scheduler and Cronsole-native; Claude Code and GitHub Actions are added from **Explore
      sources**. Visibility is the union of `settings.shownSources`, the platforms holding tasks and
      the platforms with a connection — one definition in `utils/sourceVisibility.ts`, shared by the
      rail and the Sources tab so "connected but hidden" cannot come to mean two things. A **show**
      list rather than a hide list, so a platform added to Cronsole later arrives opt-in with no
      migration. A source holding tasks cannot be hidden and its switch says which tasks are holding
      it; connecting one shows it without a second gesture.

- [x] **The Platforms tab is the Sources tab, with Explore and Manage in the rail** *(2026-08-24)*.
      The tab already held the capability matrix, both hand-composed connection panels and the quick
      links — it *was* the sources screen under a name that described the code. Rebuilt as **Your
      sources · Available · Quick links · Add a custom source**, rather than a second screen about
      the same four platforms. Two `RailAction` buttons under the rail's Sources tree deep-link into
      it (`?focus=`); **Add a custom source** lives on the screen, because three controls in a 240px
      rail is furniture and Explore/Manage are two views of one list. `/platforms` redirects.

- [x] **The Sources tab is three views, split on `configured`** *(2026-08-24, same day as the rename)*.
      The first pass kept the old seam — *Your sources* meant **listed in the sidebar**, so an added
      but unconnected source sat among the working ones wearing a grid of unproven capability chips
      and the words *Not connected*. That is the state with the most to do and the screen described
      it worst. Now **Connected · Available · Quick links**, with `?focus=` selecting a view rather
      than smooth-scrolling to an anchor (`yours` kept as an alias). `sourceVisibility` is untouched
      and still owns the sidebar; the tabs read `configured` and only the per-card eye switch reads
      `shown`, because collapsing the two would make *adding* a source *connect* it. *Available*
      leads with added-but-unconnected, and each such card states what would connect it
      (`sourceSetupHint`) — a panel to open for the two hand-composed sources, a sentence and no
      button for the two that connect themselves. Connected cards lead with the summary and put the
      chips and the evidence table behind one disclosure; **`healthReason` and any regressed verb
      still break out on the card**, since collapsing must never make the screen quieter when
      something is wrong. `sourceIcon` / `platformAccent` hoisted into `platform.ts` so the rail and
      the tab draw one identity. Quick links became a tile grid whose remove control is **rendered
      rather than revealed on hover** — a hover-only control does not exist on a phone — and shows a
      link's host instead of a URL that truncated into an ellipsis. Covered at 375px by a new
      Playwright case over all three views.

- [x] **Quick links moved out from under the matrix, and onto the account** *(2026-08-24)*. Their own
      view on the Sources tab, kept apart from the real sources and still carrying *"nothing is read
      or written"*. They were in `localStorage` under `cronsole_platform_links` — the pre-`UserPreference`
      shape, so one install kept two lists across two origins — and are now part of the synced
      settings document, migrated on first load (`utils/quickLinks.ts`, which clears the legacy key
      so it cannot become a second source of truth). Any link is removable now, not only added ones,
      and the defaults are restorable.

- [x] **A source declares whether it is a controller or an observer** *(2026-08-24)*.
      `PlatformDescriptor.access`, served on the matrix and read by the Sources tab and
      `list_platforms`. **Declared, not counted from the cells** — a finished read-only connector and
      one whose write verbs are merely unbuilt produce the same row of refusals, and only one is
      worth waiting for. GitHub Actions' struck-through cells now carry the sentence that says they
      were chosen. Of its three refusals only `setStatus` is named as a candidate to unlock, with
      its own scope and its own confirmation, and that is written in the guide rather than legible
      only from the connector.

- [x] **The Sources Guide says how to add a source** *(2026-08-24)*. New *Adding a source* section —
      the three shapes (controller · observer · quick link), what a connector must answer, where each
      piece of code goes, what will not be accepted, and what to put in the PR — plus *Choosing which
      sources you see*. The **Add a custom source** panel links to it, and says outright that a source
      is compiled in rather than a plugin, so the honest path is a pull request that may be declined.

- [x] **A watched GitHub repository could never be adopted by a plain Sync** *(2026-08-24, found by
      the live pass on its first run)*. `scope: 'tracked'` built its include-set from
      `TaskService.trackedCategories` — the categories of stored **rows** — for every platform. That
      encodes the Windows gesture: you pick a folder in the discovery modal, and the rows are the
      only record you did. GitHub records it in `PlatformConnection.config` instead, so a freshly
      watched repository had no rows, the set came back `[]`, every workflow it read was filtered
      out, and Sync reported success on every press. **No escape hatch either** — the discovery modal
      talks to the Windows agent. Fixed with an optional `PlatformConnector.trackedCategories(config)`
      the route asks first, implemented by the GitHub connector as its watched repositories, so the
      platform-specific half stays in the connector layer. Inclusion only: it never clears a
      `TaskExclusion`, or a refresh would undo a deliberate untrack.
      ([#75](troubleshooting/README.md#75-a-github-repository-is-watched-sync-succeeds-and-no-workflows-ever-arrive))

- [x] **A sync reports what it *looked at*, and a partial view retires nothing** *(2026-08-24,
      straight out of the confusion the fix above left behind)*. `SyncOutcome` gained `notes`
      (coverage — success information, obeys `toastOnSuccess`), `warnings` (never suppressible, the
      untracked sentence's rule) and `partial`. A bare `TaskInfo[]` stays legal, so three connectors
      are untouched. The reason: **"found nothing" and "looked at nothing" render identically** — a
      repository whose workflows are all push-triggered imports zero and is working perfectly, which
      is the same empty screen as a broken sync. `partial` generalizes #74's rule off the agent: a
      truncated listing or one unreadable repository is a *narrowed reader*, so
      `reconcileMissingTasks` is skipped rather than retiring what it could not see. That protection
      previously existed only by accident — a truncated read threw, but only when it also happened to
      find nothing scheduled. Surfaced in the sync toast and by `sync_tasks`.

- [x] **`list_platforms`' tool description stopped teaching a stale boundary** *(2026-08-24, carved
      out of the [2026-08-13 follow-ups](#follow-ups-2026-08-13))*. It still said Claude Code reports
      `create` and `setStatus` as unsupported "because Anthropic exposes exactly one routines
      endpoint"; the matrix has reported both as `verified` since OAuth mode landed. It now says the
      answer depends on the install, and explains `access` — which is the more useful thing for an
      agent to read before planning work.

### Shipped 2026-08-23

- [x] **A committed `.env*` file cannot quietly grow a secret** *(2026-08-23, from the cross-repo security audit)*. The audit flagged `frontend/.env.remote` as tracked. The value in it is public by construction and the file is a real build input, so untracking it — the suggested remediation — would have removed a build input and left the actual hazard untouched for the three `.env.example` files that must stay tracked. New `scripts/check-tracked-env.mjs` in the `repo-hygiene` CI job instead makes the `.gitignore`'s *“Keep it that way”* enforceable: unlisted tracked `.env*` paths are refused, `.env.remote` is pinned to `VITE_API_URL=same-origin`, example values must be placeholders, and every tracked env file is scanned for credentials. Credential patterns are now one shared definition (`scripts/secret-patterns.mjs`) with the build-output guard. See [DESIGN_NOTES › Security](DESIGN_NOTES.md#security).

- [x] **Preferences follow the account, not the browser** *(2026-08-23, reported from the
      Tailscale URL)*. `localStorage` is scoped to an **origin**, so the same install reached at
      `localhost:8080` and at a Tailscale name handed one person two stores — and the source rail
      was drawn from both kinds of storage at once. Collections and favorites are rows and crossed
      over; **rail pins and saved views did not**, which reads as a bug rather than as a boundary
      because both halves render in bands that look alike on purpose. The whole `cronsole.settings`
      blob now syncs through **`UserPreference`** — one JSON row per user, `userId` as the primary
      key so a second row is unrepresentable — behind `GET` / `PUT /api/preferences`.
      **The server stores it and never reads it**: a server-side `Settings` schema would be a
      second definition of a shape the frontend owns, and its drift is silent (a backend one
      release behind strips a field a newer browser just wrote). The boundary checks are only *is
      it an object* and *is it under 64 kB* — under Express's 100 kB default, so ours is the error
      that fires. **The client hydrates before it may ever push**, and a browser holding untouched
      defaults does not seed, so opening the dashboard once on a phone cannot flatten a curated
      desktop; `data: null` (never stored) and `{}` (stored defaults) are different answers and the
      client acts on the difference. Settings → Data & reset reports Synced / This browser / Not
      synced, as a **readout with no repair button** (the `/doctor` rule). Theme, the API-origin
      override and the session token stay per-browser deliberately — they describe the device, and
      theme is additionally read before login.
      **Known limit, not scheduled:** two devices editing at once resolve by recency over the whole
      document, never field-by-field, and there is no live push between open tabs — a second device
      picks up changes on its next load.
      ([troubleshooting #72](troubleshooting/README.md#72-the-sidebar-is-half-empty-at-a-second-address))

- [x] **`/doctor` can see the fourth stale thing now** *(2026-08-23,
      `scripts/check-dist-fresh.mjs`)*. `frontend/dist` is the only one of the four with **no
      keeper** — a stale backend 404s, a stale agent 502s, an unbuilt `mcp-server/dist` behaves
      like old code, but a stale `dist` serves a complete, working, correct-looking dashboard from
      another day while `:7373` stays current. It cost an hour the same day, in the worst possible
      form: preference sync shipped, passed 1,740 tests, was verified with `curl` against the
      backend, and was absent from the Tailscale URL because the proxy was serving a bundle from
      four days earlier. Every signal said the code was right. It was; nothing was serving it.
      The check compares `dist/assets` against `frontend/src/**` plus the four compiled-in inputs,
      **omits itself when the proxy is down** (nothing serves `dist` then, so its age is a fact
      about nothing) and reports `UNKNOWN` when Docker cannot be asked — neither rendered as a
      pass. Wired in as `/doctor` check 7, whose prose was **itself stale**: it still required
      `build:remote` and grepped the minified bundle for a `same-origin` *call*, both superseded by
      the 2026-08-17 fold. Corrected in the same change, along with the matching rows in `SKILL.md`
      and troubleshooting #53.
      **Deliberately not fixed by `cronsole up` rebuilding `dist`** — a start command that silently
      replaces what is being served is a worse property than a bundle you occasionally rebuild, and
      a diagnostic reports rather than repairs.

### Shipped 2026-08-21

- [x] **Per-job secrets — the unfinished half of the native job types** *(2026-08-21,
      [ADR 0003](adr/0003-per-job-secrets.md))*. A native job stores a **reference**,
      `${secret.NAME}`, and the value lives AES-256-GCM encrypted in its own `TaskSecret` row —
      a relation and not a `Task` column, so no default read can carry it. Legal in a url ·
      header value · body · arg · env value; refused by name in an executable, an interpreter or
      a check assertion. `executeJob` is the one place that substitutes *and* the one place that
      redacts the value back out of the log. Write-only by construction (no route returns a
      value); per-secret routes, so a job edit cannot destroy one; cascades away with the task,
      and is absent from the export and the archive. A referenced-but-unset secret is a run-time
      refusal (`ran: false`) reported as `missingSecrets` on every create, import and restore.
      New MCP tool `list_task_secrets` (names only) — and **no tool writes a value**, deliberately.
      **`NOTIFY` and `SQL` are unblocked**; neither is scheduled by this, and ADR 0002 asks that
      they be re-evaluated together.
      Left out, and tracked below: `EXEC`/`SCRIPT` `env` still has no editor in the browser.

### The 2026-08-15 requests

- [x] **Cronsole-native job types `SCRIPT` + `CHECK`** — native went from two types to four, with
      six templates (three core), MCP tools (`create_native_script_task` /
      `create_native_check_task`, old EXEC tool renamed `create_native_program_task`), per-source
      descriptions, help topics and the Sources Guide *(2026-08-15,
      [ADR 0002](adr/0002-native-job-types.md))*. `NOTIFY` and `SQL` remain deferred behind
      per-job secrets — **which shipped 2026-08-21, so both are now unblocked and neither is
      scheduled**; `SEQUENCE` is last and only if per-step verdicts are the goal.
- [x] **Both new job types driven end-to-end on a live stack** — including the negative cases and a
      check of `childEnv()` on a real child process *(2026-08-15)*.
- [x] **`runTask` returns `ran` alongside `success`** — a job that ran and failed is a `200` with
      `success: false`; only "could not start" is a `502`. `ran` is stamped once in `executeJob`
      *(2026-08-15,
      [#59](troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check))*.
- [x] **Collections — a named set of tasks you picked by hand** (`TaskCollection` +
      `TaskCollectionMember`, rail rows, manager, ordering) *(2026-08-16)*. Follow-up the same day:
      the bookmark button was portalled to `document.body` so it reaches all five task surfaces, not
      only the detail modal.
- [x] **The redesigned dashboard verified on a phone** — ten mobile Playwright tests at a viewport
      Playwright sets directly *(2026-08-16)*. It found the E2E suite itself was 18-of-18 broken and
      repaired it; wiring that suite into CI is the open P1 item.
- [x] **The four job-type buttons sized against their sibling below `md`** — `py-2` → `py-3`, with
      the test asserting ≥40px against the platform picker rather than an abstract guideline
      *(2026-08-16)*.
- [x] **The gallery renders a script body as code and a check as its assertion**, instead of escaped
      JSON — with the deliberate rule that a *partial* reading is worse than raw JSON, so an
      unrecognized or malformed shape declines the whole reading *(2026-08-17)*.
- [x] **A passing check now states the assertions it made** — the observed value, not "matched", so
      the passing and failing logs differ by outcome rather than by wording *(2026-08-17)*.

### Correctness, honesty and infrastructure

- [x] **`shiftCron`'s refusal states its reason** — declining to answer and answering "no problem
      here" are no longer the same code path *(2026-08-15,
      [#60](troubleshooting/README.md#60-a-schedule-is-stored-78-hours-off-and-the-ui-says-the-timezone-doesnt-matter))*.
- [x] **Every agent verb reported a timeout 15 seconds after succeeding** — one `agentRequest`
      helper now owns the deadline for all ten verbs *(2026-08-16,
      [#62](troubleshooting/README.md#62-windows-reports-not-responding-15-seconds-after-every-successful-request))*.
- [x] **Platform health is derived when asked, not read back from a cache** — `buildPlatformMatrix`
      calls `connector.getHealth`, so the matrix, the dashboard and diagnostics cannot disagree
      *(2026-08-17,
      [#66](troubleshooting/README.md#66-two-cronsole-surfaces-disagree-about-the-agent-in-the-same-second))*.
- [x] **Remote access stopped depending on which build command you typed** — `FALLBACK_API_ORIGIN`
      folds on `import.meta.env.DEV`, so every build defaults to same-origin *(2026-08-17,
      [#63](troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend))*.
- [x] **The native-executor tests are no longer flaky under parallel load** — both files that spawn
      real processes set a 30s file-level timeout *(2026-08-17)*. This closes the intermittent
      `NativeTaskExecutor` failure logged 2026-08-12.
- [x] **Doc links are checked by CI** — `scripts/check-doc-links.mjs` resolves every relative
      markdown link (1,307 across 147 files) to a real file *and* heading, plus repo-doc paths
      written as string literals in tracked source *(2026-08-17)*.
- [x] **A task detail is a round trip, not a one-way door** — opening a task carries the dashboard's
      query and closing returns to the screen it was opened from, so a collection or folder survives
      an edit or an export instead of dropping you on *All sources*; `utils/taskRoute.ts` owns both
      halves *(2026-08-18)*.
- [x] **Doc sweep behind the diagnostics ship** — four false README claims corrected; Connect Pack
      to v1.8, then v1.11 with the tool inventory regenerated *(2026-08-17)*.

### Features

- [x] **Collections and Pinned are two bands of their own** — the rail is four sections now
      (scopes · collections · pinned · sources) rather than one list with a rule computed under
      whichever row happened to be last. **Sources became a section like them**: its heading and
      help `?` moved down from the top of the rail, where the word named only the bottom quarter of
      what sat beneath it, leaving the panel's collapse button (now *Collapse sidebar*) alone up
      there. One `BandHeader` serves all three, since Sources' expandable rows keep it off `Band`
      itself. Each section folds independently and keeps its count while closed; *Manage collections* moved from the foot of the whole rail into the foot of the band
      it creates into. **Pinning** lifts a folder or job type out of the tree via a `+` on its row.
      A pin is deliberately **not** a collection — membership there is declared, a folder's is
      derived — so it is a `RailPin` preference in its own section that keeps tracking the folder,
      reads that node's own count rather than a second tally, stores no foreign key, and survives
      its target at `0`. One `Band` component renders both, so "these are the same kind of place"
      cannot drift into a lie *(2026-08-19, [DESIGN_NOTES](DESIGN_NOTES.md))*.
- [x] **A schedule can be picked, not only typed** — one `ScheduleBuilder` on all four cron
      surfaces (Edit task, New task, Apply template, Schedule tester): five shapes, a clock
      control and weekday toggles, with the cron it compiles to on screen and the Cron tab beside
      it. It compiles to the same 5-field-UTC contract and stops there — nothing downstream can
      tell a built expression from a typed one. Emits only on interaction (the round trip is not
      byte-identical), goes unavailable rather than approximate, and leaves the Windows-fidelity
      verdict to `/tasks/preview`. `describeCron` learned the monthly reading with it
      *(2026-08-18)*.
- [x] **Import means a file; Sync means a source** — the header buttons split on where a task comes
      from rather than on mechanism. Import takes a `.json` (rebuilt here), an `.xml` or a `.zip`
      (staged and opened in Tools › Restore with the plan already running); Sync is a split button
      whose primary click refreshes what is tracked and whose menu opens the folder picker. The two
      requests stay two — `{categories}` clears untrack exclusions, `scope: 'tracked'` must not
      — and the "N tasks aren't imported" toast now carries the control that adds them
      *(2026-08-18)*. Supersedes the 2026-08-17 chooser.
- [x] **The Tools tab collapsed to a menu** — each card shows icon, name and description with a
      **Show** strip at the bottom; open/closed persists (`Settings.openTools`) and a closed card's
      body has never mounted, so the tab no longer fires eight queries on arrival *(2026-08-18)*.
- [x] **System diagnostics — a read-only report on Cronsole itself.** `GET /api/tools/diagnostics`
      + `services/diagnostics.ts`, the `DiagnosticsModal` from two entry points, and the
      `get_diagnostics` MCP tool. Eight checks, each carrying the evidence behind its verdict
      *(2026-08-17)*. Read-only deliberately — repair verbs are the separate P3 item.
- [x] **Per-task export gained a portable `template` format** — `?format=template`, built by the
      same `buildTemplateFromTask` as save-as-template but writing nothing *(2026-08-17)*. Amended
      the same day: the `CLAUDE_CODE` half did not work at ship time, because a routine's command is
      its **prompt**; fixed with an `ai-prompt` branch.
- [x] **Task import and deleted-task restore — the export format finally has a reader.**
      `POST /api/tasks/import`, `POST /api/tools/task-archives/:id/restore`, a Tools card, a New
      Task link, and three MCP tools (`import_task`, `list_task_archives`, `restore_task_archive`)
      *(2026-08-17,
      [#65](troubleshooting/README.md#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it))*.
      With it: the UI's `DELETE /api/tasks/:id` archives native tasks too, and `createNativeTask`
      became the one definition of writing a native row.
- [x] **The Dashboard's Import button became a chooser** — adopting tasks that already exist vs.
      creating one from a file, named by consequence, with discovery gated on the choice
      *(2026-08-17)*.
- [x] **Dashboard IA redesign, pass 1 — the shell**: section links to a top toolbar, the left column
      to a two-level source rail, category out of the Filters popover, per-platform health as a dot
      on the rail row *(2026-08-15)*. Pass 2 is open.

<a id="completed--p0-security"></a>

## Completed — P0 Security

- [x] **API tokens (a) `JWT_EXPIRES_IN`** — defaults to `24h`, validated by probe-signing at boot
      rather than by pattern-matching; login and setup return `expiresIn`; the guide's hand-minting
      instructions are gone *(2026-08-15)*.
- [x] **API tokens (b) a real token surface** — `ApiToken` + `POST`/`GET`/`DELETE
      /api/auth/tokens`, a manager in Settings → Account, 30/60/90 days or never, individually
      revocable. The DB stores the `jti` and nothing else; `checkToken` is one definition shared by
      REST and the Socket.IO handshake and fails closed *(2026-08-15)*.
- [x] Agent WebSocket authentication — pairing-secret HMAC handshake, per-session command signing
      *(2026-07-09)*
- [x] Encrypt `PlatformConnection.config` at rest — AES-256-GCM, migration-free legacy read
      *(2026-07-09)*
- [x] Multi-tenancy route scoping + JWT fail-fast + dev-JWT rotation (IDOR closed) *(2026-07-09)*
- [x] Structured command handling — no `cmd.exe /c` shell wrap *(2026-07-09)*
- [x] Agent config file/env for server URL + WSS support *(2026-07-09)*

<a id="completed--p1-correctness--honesty"></a>

## Completed — P1 Correctness & honesty

- [x] **`get_task_health` summarized a different population than it listed** — `tier`,
      `includeSystem` and `limit` moved into the route, `counts` taken after the system lens but
      before the tier filter, and the response carries its `scope` *(2026-08-13,
      [#49](troubleshooting/README.md#49-get_task_healths-counts-describe-a-different-population-than-its-list))*.
- [x] **`missed-runs` was charged against disabled tasks** — suppressed, not forgotten; a health
      model that penalizes the safe fix pushes people toward the unsafe ones *(2026-08-13)*.
- [x] **The filter chips counted every task while the list showed the filtered ones** — both counts
      now come from `applyTaskFiltersExcept` *(2026-08-12)*.
- [x] **The dashboard reported a folder listing as a sync** — `ConnectorHealth.lastSync` deleted,
      connectors report `lastContactAt`, and `lastSync` has exactly one writer *(2026-08-12,
      [#42](troubleshooting/README.md#42-the-dashboard-says-synced-7m-ago-over-a-task-list-from-yesterday))*.
- [x] **The health strip changed its own height and shoved the page down** — now one scrolling line
      *(2026-08-12)*.
- [x] **`getHealth` asserted HEALTHY from a socket object existing** *(2026-08-11,
      [#40](troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out))*.

<details>
<summary>Earlier completed P1 items</summary>

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

<a id="completed--sources"></a>

## Completed — Sources & connectors

- [x] **GitHub Actions — the first read-only observer** *(2026-08-23)*. Connect a PAT on the
      Platforms tab, watch repositories by URL or `owner/name`, and sync brings in every workflow
      with an `on: schedule` trigger. **Every mutating verb is `unsupported`**, and two of them
      (`run`, `setStatus`) have real APIs behind them and are refused anyway: a `workflow_dispatch`
      run is not the scheduled run, and enabling a workflow is a repository-state change. `create`
      would mean committing to the user's default branch.
      Three things it settled for every observer that follows. **`unsupportedVerbs` is a fixed
      array here, not a getter** — Claude's answer changes with the install, this one is a property
      of the connector's design, and a constant is the honest shape when the boundary really is
      fixed. **Health reads back stored `PlatformCapability` evidence and never probes**, the same
      conclusion Windows and Claude reached by three different routes: `getHealth` polls every 45s
      per open tab, against a 5,000/hour rate limit. And **the repository is the category**, derived
      from the `externalId` (`owner/repo#<workflow id>`, keyed on the numeric id so a renamed file
      or a changed `name:` does not strand the row).
      Two honesty details worth carrying forward: an unreadable workflow file yields
      `schedule: null` **with a reason**, never an assumed cron (troubleshooting #60's shape); and
      a sync where *every* repository failed **throws** rather than returning `[]`, or
      `reconcileMissingTasks` would read one revoked scope as "every workflow was deleted".
      What it is unusually good at: GitHub reports a run's real `conclusion`, so
      `services/taskHealth.ts` scores it on the outcome of the work rather than on "the agent
      accepted a start" — better-founded health than the platform Cronsole controls most. It also
      surfaces GitHub's **silent 60-day inactivity disable** as its own signal.
- [x] **Native job types — scripts (`EXEC`)** *(2026-08-12)*: `StructuredAction {executable,
      args[]}` reused, containerization detected at boot so a task states where it executes, and
      real `ExecutionLog` rows.
- [x] **API / Web Services — resolved as a subtype split** *(2026-08-12)*: a source key is
      `PLATFORM` or `PLATFORM:SUBTYPE`, derived server-side in `services/taskSource.ts`. Platform
      and source are deliberately different things, so the Platforms tab does not split.
- [x] **Claude Code routines — full read/write connector** *(2026-08-13,
      [#50](troubleshooting/README.md#50-two-claude-routines-apis-and-the-documented-one-is-the-smaller-one))*:
      list, create, reschedule, pause and token-free run over the OAuth `/v1/code/triggers` API,
      with the documented per-routine fire token kept as a load-bearing fallback.
      `unsupportedVerbs` became a getter; the credential is read at call time, never stored, never
      refreshed; delete is impossible on both doors, verified by enumeration.
- [x] **Claude Code routines — promoted as far as the documented API allows** *(2026-08-12)*.
      Superseded 2026-08-13 by the above; kept as the record of a documentation search mistaken for
      an API audit.
- [x] **Claude connection config — the Routines panel that makes the connector reachable**
      *(2026-08-12)*: write-only token, re-adding an id rotates rather than 409s, a pasted fire URL
      normalizes to its `trig_` id, removing the last routine removes the connection.
- [x] **A Claude task is its declaration** *(2026-08-12,
      [#47](troubleshooting/README.md#47-a-claude-task-keeps-coming-back-after-remove-from-cronsole))*:
      untrack 400s for `CLAUDE_CODE`, disconnecting the routine removes its tasks and history and
      writes no exclusion.
- [x] **Cron→trigger conversion: multi-value hour and minute fields** *(2026-08-13,
      [#51](troubleshooting/README.md#51-a-schedule-edit-returns-502-for-a-cron-that-is-simply-not-expressible)
      / [#51a](troubleshooting/README.md#51a-the-same-bug-in-the-step-branch--and-this-one-never-errors-at-all))*:
      lists, ranges, step-with-list and the reverse direction all hardened; a lossy conversion now
      rides the **success** of a schedule edit, not only the refusal.
- [x] **The gallery's `describeCron` drops day-of-month values** — returns no reading rather than a
      confident wrong date *(2026-08-13)*.
- [x] **`HealthState` gained `UNKNOWN`** *(2026-08-13,
      [#48](troubleshooting/README.md#48-windows-sits-at-degraded-for-hours-while-the-agent-is-perfectly-healthy))*:
      "no current evidence" covers both never-checked and expired. Failure evidence ages out at 15
      minutes; connection evidence renews itself; `UNKNOWN` ranks above healthy in any summary.
      Closed all four instances of the shape, including the schema's `@default(HEALTHY)`.
- [x] **Renaming a task** *(2026-08-12)*: DB-only, every platform, `rename_task` over MCP. The
      three-way design fork turned out not to be one — a line of code is evidence that something was
      intended, not that it is reachable.
- [x] **Editing a Cronsole-native job spec** *(2026-08-12)*: `PATCH /api/tasks/:id/job`, an
      `update_native_job` MCP tool, sharing the create route's `buildNativeJob` + `validateJob`.

<a id="completed--p2-product-value"></a>

## Completed — P2 Product value

- [x] **Status colour is themeable** — 263 hard-coded Tailwind utilities replaced by `--x` /
      `--x-text` role pairs in `index.css`; light-theme status roles went from 1.67–2.77 to
      5.05–8.65 against a 4.5 AA bar *(2026-08-12)*.
- [x] **Thin the first viewport (desktop + mobile)** — one Filters popover with an active count,
      withheld constraints printed outside it, a scrolling sticky mobile toolbar, a FAB
      *(2026-08-12)*. See Part I for the `--raised` remainder.
- [x] **The Platforms tab grew into a capability matrix** — per-verb Verified / Declared /
      Unsupported over an evidence table, with reachability a property of the **route**
      (`services/platformCapabilities.ts`) rather than of the connector object *(2026-08-12)*.
- [x] **Dashboard health strip** — connection state, last real sync, newest recorded command
      outcome including failures *(2026-08-12)*.
- [x] **Icon-only controls have accessible names** — and the task card stopped being a clickable
      `<div>` *(2026-08-12)*.
- [x] **Screenshot regression coverage** (`tests/e2e/layout.spec.ts`) — split by what each surface
      can honestly assert; Platforms and the Import modal deliberately get no pixel baseline
      *(2026-08-12,
      [#43](troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself))*.
- [x] **In-app help, per control** — a `?` beside fourteen controls, one modal shared with the Help
      Center, `HelpTopic.doc` required, links pinned by `docsLinks.test.ts`, and the new
      [`Sources_Guide.md`](user-guides/guides/Sources_Guide.md) *(2026-08-12)*.
- [x] **Source-first dashboard** — the source bar as the first-level axis, an outer lens that
      survives clicking a view and scopes every view count *(2026-08-12)*.
- [x] **Mass Actions console on the Tools tab — now the only bulk surface** — action-first, plan
      before ask, typed confirmation at ≥25 tasks, chunked at 100 with halt propagation, per-task
      five-outcome report. Dashboard row selection removed entirely *(2026-08-12)*.
- [x] **One Edit button per task, instead of four** — `EditTaskModal`, fields extracted to
      `components/edit/`, prefill and gating in `utils/taskEditing.ts`; one gesture, still three
      routes, reporting per route *(2026-08-13,
      [#52](troubleshooting/README.md#52-an-open-edit-modal-closes-by-itself-discarding-what-you-typed))*.
- [x] **Cronsole Native pack (6) + Claude Routines pack (5)** — 55 → 66 templates, 7 core, 8 packs,
      shipped with the connector fix that makes them applicable *(2026-08-13)*.
- [x] **The Templates tab reads creatability from the capability matrix** — `CREATABLE_PLATFORMS` is
      gone; `unknown` asserts nothing while it loads *(2026-08-13)*.

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
- [x] Task schedule on every card — "Daily at 8:00 AM PDT", raw cron for shapes it won't guess at *(2026-08-11)*
- [x] Favorites — star any task (`TaskFavorite`, per-user, cascades with the row) + a sixth built-in view *(2026-08-11)*
- [x] Bulk enable/disable across all four views *(2026-07-31)*
- [x] Bulk task actions complete — recategorize, untrack, export-selected; the five-outcome convention extracted to one definition *(2026-08-04)*
- [x] Schedule timezone — author and display in your own zone, storage stays UTC *(2026-07-31)*
- [x] `createFolder` on `POST /api/tasks` + MCP `create_task` — opt-in, signed, reports what it created *(2026-08-04)*

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
- [x] One unreadable template no longer empties the whole hosted catalog *(2026-08-15, [#58](troubleshooting/README.md#58-one-unreadable-template-silently-empties-the-whole-hosted-catalog))*
- [x] Template registry — schema + ADR, catalog behind an interface, static registry + remote source, hosted, runtime refresh, prune-on-sync *(2026-07-13 → 2026-07-14)*. The optional **index signing** follow-up is its own open item in Part I.
- [x] Registry publishing is automatic and checked *(2026-08-19)* — merging to `main` mirrors the artifact (`publish-registry.yml`); a daily **Registry drift** workflow compares the live host to the committed artifact by id and sha256; `publish-registry.ps1` refuses to publish from a branch that is not up-to-date `main` *([#68](troubleshooting/README.md#68-the-hosted-registry-goes-backwards-after-a-successful-publish))*.
- [x] The front door is automatic and checked too *(2026-08-19)* — `publish-frontdoor.yml` mirrors the gallery page to `cronsole-site` on merge (refusing when the target has lost its `CNAME`), and **Front door drift** compares served sha256 at *both* hosts daily. Same branch guard on `publish-frontdoor.ps1`. Its first real run found the page was CRLF on Windows and LF everywhere it is served *([#69](troubleshooting/README.md#69-a-published-page-check-reports-both-hosts-stale-and-they-are-not))*. **Both published surfaces are now covered; nothing in this area is left manual.**

</details>

<details>
<summary>Tools tab, backup & restore</summary>

- [x] Tools tab — bulk export/backup + Connect Pack downloads *(2026-07-28)*
- [x] Restore tasks from an export — signed `task:import`, plan-before-write, four outcomes *(2026-07-28)*
- [x] Run history export (CSV) + automation health score *(2026-07-28)*
- [x] Schedule tester — shows what you asked for **and** what will actually run *(2026-07-31)*
- [x] Richer execution analytics — failure trend, duration trend, idle-task list *(2026-07-31)*
- [x] Live browser click-through of Execution analytics + the Import-defaults modal — four defects found and fixed *(2026-08-11)*

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

<a id="completed--p3-expansion"></a>

## Completed — P3 Expansion

- [x] **MCP delete is native-only, and archives before it destroys** *(2026-08-13)*: `delete_task`
      wraps `DELETE /api/tasks/:id/native`, which 400s every other platform — so **no MCP verb can
      destroy an artifact on the machine**. The archive is written first and the delete refuses if
      it fails; it lands in `DeletedTaskArchive` with the last 20 `ExecutionLog` rows and no cascade
      from `Task`. The env gate stays shut by default.
- [x] **Claude Code connector** — no longer an experimental scaffold *(2026-08-12, completed
      2026-08-13)*. See Sources above.
- [x] **Remote access tooling** *(2026-08-15 → 2026-08-17)*: `proxy/Caddyfile` + the `proxy` and
      `remote` Compose profiles bound to `127.0.0.1:8080`; same-origin frontend builds; a Cloudflare
      Tunnel profile plus Access instructions and `TRUST_PROXY`; and the `VITE_DEV_TOKEN` leak found
      while verifying it, gated on `import.meta.env.DEV` and guarded by `check-bundle-secrets.mjs`
      *([#55](troubleshooting/README.md#55-the-dashboard-is-already-signed-in-on-a-browser-that-never-logged-in))*.
- [x] **Automation health score** *(2026-07-28)* and **the Schedule tester**, the cheapest slice of
      the dry-run lab *(2026-07-31)* — two of the ★ product bets.

<details>
<summary>Earlier completed P3 items</summary>

- [x] MCP server — thin stdio wrapper over the REST API, 5 tools at first ship *(2026-07-13)*
- [x] MCP surface expansion — `create_task`, `list_folders`, 7 management verbs, tiered destructive gating *(2026-07-15)*
- [x] `untrack_task` on MCP, ungated *(2026-07-28)*
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

## Completed — Go-public

- [x] License decision — **Apache-2.0** *(2026-07-13)*
- [x] Package manifests say Apache-2.0, not the `npm init` ISC default *(2026-07-31)*
- [x] `check_db` pokes replaced by `npm run db:check` *(2026-07-31)*
- [x] Close the unauthenticated `POST /auth/register` primitive — **deleted**, 404 pinned *(2026-07-31)*
- [x] Align REST CORS with `ALLOWED_ORIGINS` + a refusal that explains itself *(2026-07-31)*
- [x] **Rename TaskHub → Cronsole** — all four stages *(2026-07-31)*: in-repo brand, this machine,
      the public surface (repos + registry URL + front door), and the local checkout folder.
      Deliberately **not** renamed: `PlatformType.TASKHUB_NATIVE` (a stored Postgres enum) and the
      historical CHANGELOG/ROADMAP entries.
- [x] Account/login system — single-user local login *(2026-07-16)*

<a id="completed--resolved-decisions"></a>

## Completed — Resolved decisions

- [x] **What shape is the "API / Web Services" source?** — **(b) a subtype split inside
      Cronsole-native** *(opened and resolved 2026-08-12)*. (a) a new `PlatformType` was rejected as
      indistinguishable from native at the point of creation; (c) the umbrella grouping stays open
      as a presentation question (Part I).
- [x] Cloud hosting choice — **moot; Cronsole launches local-first** *(2026-07-13)*
- [x] License model — **Apache-2.0** *(2026-07-13)*
- [x] Template distribution — **curated core locally + gallery with selective import** *(2026-07-13)*
- [x] Default theme — **dark** *(2026-07-28)*
- [x] Does untrack need an exclusion memory — **yes, subtractive-only `TaskExclusion`** *(2026-07-28)*
- [x] Keep the "TaskHub" name or rebrand — **rebrand to `Cronsole`** *(2026-07-31)*
- [x] Rename the Platforms tab, or grow it — **grow it** into a per-platform capability/status
      matrix *(opened 2026-07-28, decided 2026-08-12)*

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

---

## Strategy guardrails

- **Reliability control plane, not universal scheduler** — two excellent connectors beat six half
  connectors. **Sharpened 2026-08-12, because the capability matrix changed what "half" means.**
  A partial connector used to *lie*: the UI implied verbs it could not perform. Every verb now reads
  **verified / declared / unsupported** against this machine, which makes a **read-only observer** a
  complete and honest product state rather than an unfinished controller. So the gate splits by what
  a connector can *do*, not by how much of the interface it fills:
  - **Controllers** (read *and* write — sync, run, enable/disable, create) still unlock only when
    sync reliability >95% and crash rate <2% hold. These can break someone's machine.
  - **Observers** (read-only; every mutating verb `unsupported`) are **not** gated. They cannot
    damage anything and cannot overclaim, and refusing to show a scheduled job because Cronsole
    cannot yet *control* it is the invisible-fence failure at product scale.

  The guardrail's real content was never "few connectors" — it was "never imply a capability you do
  not have." That is now enforced by the matrix instead of by scarcity.
- **No fake data in the UI** — an automation tool earns trust by telling the truth.
- **Dogfood** — migrate real Task Scheduler jobs onto Cronsole-created tasks; every friction point
  is roadmap input.

---

## Appendix — Template & scheduler catalog (backlog reference)

> The **content backlog** the template registry will hold. The abstract catalog can grow freely via
> the registry, but **execution targets unlock only when reliable** (the guardrail above). The
> concrete near-term commitment is the MVP starter set + the Windows compiler; everything below that
> is a prioritized reference, not committed scope.

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
