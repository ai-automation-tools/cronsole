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

1. **UX & UI refinement pass** — tokenize status colour, thin the first viewport, grow Platforms
   into a real capability matrix (see P2 Open; logged from the 2026-08-12 review).
2. **Versioning & releases** — semver, tagged releases, changelog discipline. Also unblocks the
   deliberately-skipped `version` fields in the package manifests.
3. **Restore's plan doesn't check that a task's action points at anything that exists** — the
   advisory resolvability column, logged 2026-07-31 (see P2 Open).
4. **Bulk export's directory-picker branch is still undriven** — the one part of the Tools tab no
   click-through has reached, because it opens a native dialog. Low priority; noted so its absence
   stays visible rather than being mistaken for coverage.

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

- [ ] **System-status honesty — residual** *(mostly shipped 2026-07-08)*: live per-platform health,
      the "synced N ago" chip and the honest Sync/Import split all ship; what remains is periodic
      review that no status surface has drifted back to asserting something it can't evidence.
      **The review found one on 2026-08-11 and it is fixed** — `getHealth` reported `HEALTHY` from a
      socket object existing and stamped `lastSync: new Date()`, so a wedged agent read as online and
      "synced just now" while every request against it timed out
      ([#40](troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)).
      Keep the item open: the lesson is that this class returns, and the tell is a status field
      derived from a precondition that cannot change when the subject fails.

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
- [ ] **Thin the first viewport.** Desktop stacks onboarding banner · title+sync · Help Center ·
      status chip · system chip · New Task · Import · Sync Now · saved views · search · category
      chips · view switcher · select-all · favorites banner before any task. Several are
      conditional, but on a real machine (269 tasks, system tasks present) nearly all render.
      Keep title, primary action, health and search always visible; move secondary filters behind
      one **Filters** control showing the active-filter count; make category chips a compact
      scroller. Saved views stay as the top-level navigation — they already are it.
      **Constraint:** whatever moves into a drawer must keep saying what it is hiding — the
      hidden-count on each chip is the invisible-fence guard, not decoration, so the drawer
      trigger has to carry it out to the surface.
- [ ] **Grow the Platforms tab into a capability matrix** *(the open decision is now resolved —
      **grow**, 2026-08-12)*. Today `PlatformsScreen.tsx` is 167 lines of `localStorage`
      bookmarks to Claude / ChatGPT / Gemini, and **does not mention Windows Task Scheduler or
      Cronsole-native at all** — the two platforms that actually work are visible only as a sidebar
      chip. Replace with a per-platform row: connection, sync, and which verbs are real
      (run / create / edit schedule / edit action / export / delete), plus last-verified. Every
      cell must be evidence, not a spec table — same rule as `getHealth` ([#40](troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)):
      a capability the connector declares but has never demonstrated says *declared*, not *yes*.
      Keep the custom-links section; it is the honest home for link-only platforms.
- [ ] **Dashboard health strip** *(pairs with the task-detail trust indicators below)*: agent
      online / last sync / last command outcome in the header, so "what should I do next" doesn't
      require reading the sidebar. Bound by the same rule — no field a health probe can stamp itself.
- [ ] **Icon-only controls need tooltips and accessible names**, everywhere. Task cards carry
      select / star / clone / enable / run plus the card-open target; the review flagged misclick
      risk, and the cheap half of that is naming every control. A hover/focus "Open details"
      affordance makes the card's default click discoverable without redesigning the card.
- [ ] **Screenshot regression coverage** on the dense surfaces — dashboard desktop + 375px, task
      detail, New Task, Import, Templates, Tools. The UI is tight enough that spacing regressions
      are real regressions, and there is currently nothing that would catch one.

### Open

- [x] **Mass Actions console on the Tools tab — and a scale cap on dashboard selection**
      *(requested and shipped 2026-08-12)*. Scope-first (all / category / platform / status /
      health tier), plan visible before anything is asked of a platform, typed confirmation at
      **≥25 tasks**, chunked at the server's 100-task ceiling with halt propagation, per-task
      five-outcome report, and undo for enable/disable only. No backend added — every verb is an
      existing `/api/tools/tasks/*` route. Dashboard select-all now capped at what one bulk request
      can accept (it previously offered `Select all 269`, which every button then 400'd on) and
      hands off to the console; per-task selection is untouched, so Untrack stays beside Delete as
      the safe neighbour. Absorbed *bulk enable/disable by folder*. Export and import stay in their
      own tools rather than being duplicated here. Verified live at zero mutation — see CHANGELOG.
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

- [ ] **macOS agent (launchd)** — 7 catalog templates already wait on it; the `ITaskScheduler`
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
- [ ] **Claude Code connector** — promote from experimental scaffold to production-ready.
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
  connectors; new connectors unlock only when sync reliability >95% and crash rate <2% hold.
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
