<a id="uat-top"></a>

<h1 align="center">👤 User Acceptance Testing</h1>

<p align="center">
  <em>Forget whether it passes. Would a real person, on a real machine, actually accept it?</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/asks-would_a_user_accept_it%3F-F59E0B?style=for-the-badge" alt="Asks">
  <img src="https://img.shields.io/badge/method-human_·_scripted-8B5CF6?style=for-the-badge" alt="Method">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-testing_home-6B7280?style=for-the-badge" alt="Testing Home"></a>
</p>

---

Every other layer asks *"does the code do what we said?"* UAT asks *"**did we say the right
thing?**"* It's the only layer that can catch a feature that works perfectly and still isn't
worth shipping.

UAT is **human and mostly manual by design**. Automating it away defeats the point — the value
is a person with real intent hitting real friction. Cronsole is **local-first**, so the tester
is running the same stack a user would: no staging environment stands between you and the
truth.

**Who runs it:** whoever is about to call something done. Today that's Mike — dogfooding is
Cronsole's primary UAT channel, and it has already produced real fixes (the PowerShell console
flash, the empty `\Cronsole\` folder, task export).

**Legend:** ✅ passing · 🟡 partial / needs re-run · ⬜ never formally run

## 🚪 Onboarding & first run

The highest-stakes UAT. A user who bounces here never sees anything else.

| # | Scenario | Acceptance criteria | Status |
|:--|:---|:---|:--|
| U1.1 | **Cold install, fresh machine** | Follow [Windows Install Guide](../../install/guides/Windows_Install_Guide.md) with **no prior knowledge**. Stack comes up without reading source | ⬜ |
| U1.2 | **Two platforms in < 15 min** | **NFR10** — connect Windows agent + Claude, timed by stopwatch, from zero | ⬜ |
| U1.3 | **Agent pairing** | [Agent Setup Guide](../../user-guides/guides/Agent_Setup_Guide.md) works start to finish; agent shows online | 🟡 |
| U1.4 | **First-run banner** | Dismissible banner appears once, points somewhere useful, stays dismissed | 🟡 |
| U1.5 | **Getting Started walkthrough** | The Help Center path actually gets a new user to a working first task | 🟡 |
| U1.6 | **Docs match reality** | Every command in the install/setup guides runs **as written** — no undocumented steps, no stale flags | ⬜ |
| U1.7 | **Clone-repo path** | [Clone Repo Guide](../../install/guides/Clone_Repo_Guide.md) works for a developer | 🟡 |

> [!TIP]
> **U1.6 rots fastest.** Docs drift from code silently and nothing in CI catches it. Re-run it
> whenever setup, env vars, or scripts change — the guides are a *product surface*.

## 🎯 Core job-to-be-done

Does Cronsole deliver the "single pane of glass" it promises?

| # | Scenario | Acceptance criteria | Status |
|:--|:---|:---|:--|
| U2.1 | **See everything at once** | All scheduled tasks across platforms, in one view, accurate on first paint | 🟡 |
| U2.2 | **Trust the state** | ≥ **95%** of scans reflect true platform state. Spot-check the dashboard against Task Scheduler directly | ⬜ |
| U2.3 | **Trigger from phone in < 30s** | **FR** — open on a phone, find a task, run it, see the result. Timed | ⬜ |
| U2.4 | **Import selectively** | User pulls in the tasks they care about and isn't drowned in Microsoft noise | 🟡 |
| U2.5 | **Organize meaningfully** | Categories and overrides make a real task list navigable, and survive re-sync | 🟡 |
| U2.6 | **Live updates feel live** | A change made elsewhere shows up without a manual refresh | ✅ |
| U2.7 | **Dashboard loads < 2s** | **NFR1**, on Fast 3G | 🟡 |

## 📄 Templates & the gallery

| # | Scenario | Acceptance criteria | Status |
|:--|:---|:---|:--|
| U3.1 | **Fresh install feels curated** | 5 core templates read as a useful sampler, not an empty shell or a wall of noise | ✅ |
| U3.2 | **Browse-and-import journey** | Find the [gallery](https://mikesailab.com/cronsole-registry) from in-app → browse → import → apply. The whole arc, as a user | 🟡 |
| U3.3 | **Apply a template for real** | Pick one, fill params, apply, and **confirm the task exists in Task Scheduler** and fires on schedule | 🟡 |
| U3.4 | **Params are understandable** | `{{placeholder}}` names and help text are guessable without reading the registry JSON | ⬜ |
| U3.5 | **Save as template** | An existing task round-trips into a template someone else could use | 🟡 |
| U3.6 | **AI Pack works unattended** | The Claude Code CLI templates actually run headless, fenced, and capture output | 🟡 |
| U3.7 | **Registry updates land** | A template published to the registry reaches an install without redeploying the app | ✅ |

## 🤝 Trust & honesty

Cronsole's core promise is that it **tells the truth**. These scenarios exist because a
confident lie is the worst possible failure mode here — worse than an error.

| # | Scenario | Acceptance criteria | Status |
|:--|:---|:---|:--|
| U4.1 | **Failures are legible** | A task fails → the user learns **what** failed and **why**, with stderr, not just a red dot | 🟡 |
| U4.2 | **Elevation refusal is honest** | An admin-ACL'd task says "needs elevation" — never a fake success | 🟡 |
| U4.3 | **Lossy conversion is disclosed** | Confidence `< 1.0` surfaces a warning; very lossy blocks auto-apply until acknowledged. **The user consents to loss** | ⬜ |
| U4.4 | **Uncompiled targets are honest** | A declared-but-uncompiled target offers "copy to set up manually" — never a silent no-op | ⬜ |
| U4.5 | **Offline is obvious** | Agent down → user sees it immediately and Run Now is disabled, not hanging | ✅ |
| U4.6 | **Notifications arrive** | A failed run actually reaches Discord / ntfy / webhook, in a readable shape | 🟡 |
| U4.7 | **Destructive actions confirm** | Delete prompts, cancel truly cancels, and the DB never diverges from the platform | ✅ |

## 🧩 Advanced & optional surfaces

| # | Scenario | Acceptance criteria | Status |
|:--|:---|:---|:--|
| U5.1 | **MCP in a real host** | Wire into Claude/Codex/Cursor per the [MCP Server Guide](../../user-guides/guides/MCP_Server_Guide.md) and drive Cronsole **in natural language** end to end | 🟡 |
| U5.2 | **Remote access** | [Remote Access Guide](../../user-guides/guides/Remote_Access_Guide.md) gets you to your own instance from another device | 🟡 Working on this machine over Tailscale (`docs/local/Remote_Access_Runbook.md`, re-verified 2026-08-17). What a *stranger* following the guide gets is still undriven — and the guide's build step changed on 2026-08-17, so the version that has been followed successfully is not the version now published |
| U5.3 | **Auto-start at logon** | Stack comes up at logon with **no console flash** | 🟡 |
| U5.4 | **Export → re-import** | Exported XML/JSON is genuinely usable outside Cronsole | 🟡 |
| U5.4e | **The portable export, as a user would use it** | Export a task with **Portable template**, then import it on the Templates tab and **apply it** — the point is not that a file downloads but that the task comes back on the other side. Do it once for a Windows task and once for a Claude routine (the platform with no native export at all). Check the menu says the loss **before** the click, and that nothing was added to the template library by the *export* itself | ⬜ Not driven. The API path and the import round trip are covered by `task-export.integration.test.ts`; the **apply** end, and the whole flow through a browser, are not |
| U5.4d | **Export → import, without leaving Cronsole** | Export a Cronsole-native task from the task modal, then bring it back through **Tools → Import a task** and through the Dashboard's **Import → a task file** — the two entry points must accept the same file and say the same thing about a bad one. Then delete a native task and **Restore** it from the same card. Check the three claims the UI makes about what you get: a **new** task (its id changed), **no** archived run history on it, and the archive **still listed** afterwards. Finally, hand it a Windows `.xml` and confirm the refusal names Tools → Restore rather than just failing | ⬜ Not driven from the browser. The API path was driven end to end on 2026-08-17 (create → export → import → UI delete → restore, plus the Windows / catalog / version refusals), and the components are unit-covered — but nobody has clicked it, and every browser pass so far has found something no suite did |
| U5.4a | **Backup → restore, as a user would do it** | Export the machine from the Tools tab, delete something on purpose, restore it, and confirm in **Task Scheduler** — not in Cronsole — that it came back intact. Then check the awkward part: a restored task is admin-owned, so removing it needs Cronsole or an elevated Task Scheduler ([#28](../../troubleshooting/README.md#28-a-restored-task-or-the-folder-it-landed-in-cant-be-deleted-access-is-denied)) | 🟡 API path done 2026-07-28. Other Tools cards have since been driven (2026-08-04, 2026-08-11), but **this round trip has not**: both ends of it are native dialogs — export's `showDirectoryPicker` and restore's file input — which is exactly why it keeps being the one left |
| U5.4b | **Execution analytics against the real machine** | Open Tools › Execution analytics on the 350-task machine. Check the three things a fixture can't show: the **Idle** list isn't dominated by `\Microsoft\` tasks once the lens is off, the **Duration** list's empty state explains itself rather than looking broken (this machine is nearly all Windows, so it *will* be empty), and the failure bars are legible at 90 days rather than 1px wide. Confirm the trend's day boundaries match local days, not UTC | 🟡 **driven 2026-08-11**, every rendered number cross-checked against `/api/tools/analytics` at 7/30/90 days. Duration's empty state explains itself and names the 4 excluded runs ✅. Bars at 90 days measure **5.86px** in a 711px chart, not 1px ✅. Day boundaries are local: `tz` is sent and the three non-zero days matched the API exactly ✅. Keyboard focus on a bar drives the `aria-live` readout ✅. **The idle lens could not be exercised** — this machine had `idle.tasks: 0`, so the list was empty in both lenses and the `\Microsoft\`-domination question stays open. The pass still found the idle view's real defect: with every idle task hidden it printed the all-clear beside "N system hidden" |
| U5.4c | **Import defaults against the real machine** | Open the folder picker — **now via Sync › *Add tasks from this machine***, since Import became the file importer on 2026-08-18 — and check the preset counts, the remembered selection, and that a manual toggle drops the preset to Custom | ✅ **driven 2026-08-11**: All = 269 tasks/13 folders, Non-system = 57/11, None disables the button — each matching `/api/tasks/discover`. The remembered 13-item selection correctly intersected against reality, dropping `AI-Tools` and `Cronsole`. Manual toggles recomputed exactly (−24 → 33/10, +189 → 222/11) and cleared every preset. Found two defects: a heading for a platform with no categories, and `1 tasks`. **The `excludedCount` "+N removed" badge was not exercised** — no exclusions existed at the time |
| U5.5 | **Accessibility** | Keyboard-only navigation works; focus is visible; screen reader announces modals | ⬜ |
| U5.6 | **Survives a reboot** | Everything reconnects on its own — no manual repair | 🟡 |

## 🧭 How to run a UAT pass

1. **Be the user, not the author.** Use the docs. Don't use knowledge only you have. The moment you reach for the source, log it as a finding — that's a docs bug.
2. **Script the intent, not the clicks.** "Get a nightly backup running" beats "click Templates, then…". You're testing whether the path is *findable*.
3. **Log friction, not just failures.** "Worked, but I had to guess" is a real finding. Confusion is a defect at this layer.
4. **Time the timed ones.** U1.2 (< 15 min), U2.3 (< 30s), U2.7 (< 2s) are *numbers*, not vibes. Use a stopwatch.
5. **Test on a cold machine when you can.** Your dev box has state a user won't have — env vars, published agent, warm caches.
6. **File findings where they live.** Feature gaps → [ROADMAP](../../ROADMAP.md). Setup/runtime traps → [troubleshooting](../../troubleshooting/README.md). Escaped bugs → a [regression test](../regression-testing/README.md).

## 🏁 Release sign-off

Before calling a release done:

- [ ] Full automated sweep green (see [Testing home](../README.md#-how-to-run-everything))
- [ ] **E2E run locally** — it's not in CI, so nothing else will catch it
- [ ] [Manual runbooks](../manual-testing/README.md) worked: [Smoke](../manual-testing/runbooks/Smoke_Test.md) → [Windows Lifecycle](../manual-testing/runbooks/Windows_Task_Lifecycle.md) → [Template Apply](../manual-testing/runbooks/Template_Apply.md) → [Agent Resilience](../manual-testing/runbooks/Agent_Resilience.md) → [Security Checks](../manual-testing/runbooks/Security_Checks.md)
- [ ] Onboarding pass (**U1**) on a machine that hasn't run Cronsole
- [ ] Core job-to-be-done (**U2**) — including the timed NFRs
- [ ] Trust & honesty (**U4**) — no silent failures, no confident lies
- [ ] Docs verified against reality (**U1.6**)
- [ ] Findings triaged: fixed, or logged in ROADMAP with a date

<p align="right">(<a href="#uat-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">← Testing Home</a> ·
  <a href="../functional-testing/README.md">Functional</a> ·
  <a href="../integration-testing/README.md">Integration</a> ·
  <a href="../regression-testing/README.md">Regression</a>
</p>
