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

**[Sources](#-sources--where-a-task-comes-from) is the top priority** *(scoped 2026-08-12)* — the
dashboard's first-level axis is now where a task comes from, and the plan is to fill it in. In order:

1. **Native job types — scripts.** Smallest, and it makes the source you already own genuinely
   useful instead of HTTP-only.
2. **API / Web Services source** — *blocked on an open decision about its shape.*
3. **POSIX agent** — launchd · cron · systemd timers in one build. The one that actually broadens
   the product.
4. **Claude Code routines** — promote the connector out of scaffold.
5. **GitHub Actions** — read-only observer, ~a day.

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

- [ ] **Native job types — scripts** *(smallest, highest immediate value)*: Cronsole-native runs
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

- [ ] **API / Web Services source** *(shape undecided — see [Open decisions](#open-decisions))*:
      requested 2026-08-12. The decision that blocks it is whether this is a **new platform**, a
      **job-type split inside Cronsole-native**, or an **umbrella grouping** over the hosted
      schedulers below; the three produce different data models and are not refinements of each
      other. Do not start until that is settled.

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

- [ ] **Claude Code routines — promote the connector** *(requested 2026-08-12)*: `CLAUDE_CODE` has
      been an experimental scaffold since the MVP. Promote to production-ready: real sync, run,
      enable/disable and health from evidence. Increasingly common among developers already using
      Claude Code, and the one source on this list Cronsole can dogfood immediately.
      **Verify the API surface before scoping** — the scaffold predates the current routines
      feature, so what it assumes may no longer be what exists.

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

## 🔴 P0 — Security hardening — ✅ COMPLETE (2026-07-09)

- [x] Agent WebSocket authentication — pairing-secret HMAC handshake, per-session command signing *(2026-07-09)*
- [x] Encrypt `PlatformConnection.config` at rest (AES-256-GCM, migration-free legacy read) *(2026-07-09)*
- [x] Multi-tenancy route scoping + JWT fail-fast + dev-JWT rotation (IDOR closed) *(2026-07-09)*
- [x] Structured command handling — no `cmd.exe /c` shell wrap *(2026-07-09)*
- [x] Agent config file/env for server URL + WSS support *(2026-07-09)*

## 🟠 P1 — Correctness & honesty

New correctness work lands here as it is found. Everything logged before 2026-08-12 is closed.

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
- [ ] **Remote access (self-hosted) — the final, optional enhancement** *(do everything else
      first)*: reach your **own** local instance from other devices (the code-server model) via
      Tailscale or Cloudflare Tunnel + Access. Delivered as docs + optional tooling
      ([Remote Access Guide](user-guides/guides/Remote_Access_Guide.md)); optional bundled
      single-origin reverse proxy. Not part of the local-first launch.

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
- [ ] **What shape is the "API / Web Services" source?** *(opened 2026-08-12, requested the same
      day; blocks that item under [Sources](#-sources--where-a-task-comes-from))*. Three readings,
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
