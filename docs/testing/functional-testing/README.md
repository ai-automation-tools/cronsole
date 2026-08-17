<a id="functional-top"></a>

<h1 align="center">✅ Functional Testing</h1>

<p align="center">
  <em>Does each feature do what it claims — on its own, on purpose, and when abused?</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/asks-does_it_work%3F-2ea44f?style=for-the-badge" alt="Asks">
  <img src="https://img.shields.io/badge/tools-Vitest_·_RTL_·_xUnit_·_Playwright-8B5CF6?style=for-the-badge" alt="Tools">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-testing_home-6B7280?style=for-the-badge" alt="Testing Home"></a>
</p>

---

Functional tests take **one feature** and prove it behaves per spec — the happy path, the
error paths, and the boundaries. They're written **as the feature is built**, and they're the
first thing that should exist for anything user-facing.

**This layer is not:** wiring between components (that's [integration](../integration-testing/README.md)),
protecting old features (that's [regression](../regression-testing/README.md)), or judging
whether the feature was worth building (that's [UAT](../uat/README.md)).

**Legend:** ✅ automated today · 🟡 partial · ⬜ gap / manual only

> [!TIP]
> **The ⬜ rows aren't untested — they're hand-tested.** Concrete steps for them live in
> [manual-testing/](../manual-testing/README.md): the [Windows Task Lifecycle](../manual-testing/runbooks/Windows_Task_Lifecycle.md)
> runbook covers the real-COM rows (F1.3–F1.5, F1.8, F2.8), [Template Apply](../manual-testing/runbooks/Template_Apply.md)
> covers F2.7 / F3.4 / F3.9, and [Security Checks](../manual-testing/runbooks/Security_Checks.md)
> covers F4.3–F4.6.

## 🗂️ Task lifecycle

The core loop. If any of this lies, the product has no reason to exist.

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F1.1 | **List & view** | Tasks render with correct name, platform, schedule, last-run, next-run, and enabled state | ✅ `TaskCard.test.tsx`, `TaskModal.test.tsx` |
| F1.2 | **Selective import** | Import modal defaults `Microsoft` and `Uncategorized` to **unchecked**, but both toggle; only checked items import | ✅ `ImportModal.test.tsx` |
| F1.3 | **Run Now (manual trigger)** | Command reaches the platform, result returns, UI shows success/failure honestly | ✅ E2E `mock-agent.spec.ts` |
| F1.4 | **Enable / disable** | Toggle flips real platform state, not just the DB row | ✅ `task-status.integration.test.ts` |
| F1.5 | **Delete** | Windows delete removes the real Task Scheduler entry; **DB row only goes after platform confirms**; admin-ACL'd tasks get an honest "needs elevation" refusal (not a fake success) | ✅ `task-delete.integration.test.ts` |
| F1.6 | **Local categorization** | User categories and overrides persist and survive a re-sync | 🟡 |
| F1.7 | **Search & filter** | Query matching, view tabs, active/disabled filters | ✅ `taskSearch.test.ts` |
| F1.8 | **Export a task** | Windows → native Task Scheduler XML (**UTF-16 LE + BOM**); Cronsole-native → JSON | ✅ `task-export.integration.test.ts` |
| F1.8a | **Bulk export** | Exports what is **on the machine**, not just tracked tasks; `\Microsoft\` excluded by default but **counted out loud**; every file is UTF-16 LE + BOM and byte-identical on both the ZIP and base64 paths; a manifest records what was saved, skipped and failed | ✅ `bulkExport.test.ts`, `BulkExportTool.test.tsx` |
| F1.8b | **Restore plans before it writes** | A `dryRun` returns create / overwrite / skip / refuse per file, computed from the machine's real tasks and folders, and **writes nothing**; an offline agent is a 502 rather than a blind restore; the destination resolves manifest › `<URI>` › filename and says which | ✅ `taskRestore.test.ts`, `task-restore.integration.test.ts`, `RestoreTool.test.tsx` |
| F1.8c | **Restore refuses by default** | An existing task reports the third state **`exists`** — neither success nor failure — and is left untouched unless `overwrite`; `\Microsoft\` is refused; two files targeting one path refuse the second; a missing folder is refused unless `createFolders`, naming the **shallowest** missing folder | ✅ `taskRestore.test.ts` · ✅ live pass 2026-07-28 (registration date unchanged on a skip; Defrag untouched) |
| F1.8d | **Cross-task run history** | Owner-scoped through the task relation (ExecutionLog has no userId of its own); range/status filters; counts describe the **whole match**, not the returned page; every row carries a `runKind` so `status` is readable | ✅ `runHistory.test.ts`, `run-history.integration.test.ts` |
| F1.8e | **CSV is safe to open** | Formula injection neutralized (a task named `=cmd|'/c calc'!A1` cannot execute on open), RFC 4180 escaping for logs containing commas/quotes/newlines, UTF-8 **BOM** so Excel reads non-ASCII names | ✅ `runHistory.test.ts`, `run-history.integration.test.ts` · ✅ live pass 2026-07-28 (parsed back by a real CSV reader) |
| F1.8f | **Health score is evidenced** | Every signal names its source; **no evidence scores `unknown`, never `ok`**; disabled is informational and weighs 0; Task Scheduler status codes are not read as exit codes; duration drift never raised for a fire-and-forget Windows trigger; system tasks flagged so the personal lens applies | ✅ `taskHealth.test.ts`, `run-history.integration.test.ts`, `TaskHealthTool.test.tsx` |
| F1.9 | **Untrack ≠ delete** | Untrack removes Cronsole's row **and makes no platform call** — the scheduled task survives; the two verbs are distinct in label, styling and confirm copy, and the confirm names **what survives**; `TASKHUB_NATIVE` is refused rather than silently deleted | ✅ `task-untrack.integration.test.ts`, `TaskModal.test.tsx` |
| F1.10 | **An untrack survives the next sync** | `scope: 'tracked'` sync does **not** re-import an untracked task (that re-import is correct by the sync's logic and reads as "untrack is broken"); an explicit **category import** clears the exclusion, and both `/discover` and the sync response say how many rows that moves | ✅ `TaskService.test.ts`, `syncSummary.test.ts` · 🟡 the sync-route wiring itself is covered live, not by a suite |
| F1.11 | **Collections — declared membership** | A named set holds tasks a filter could not describe (a Claude routine beside a Windows task). Per-user join, never a column; **cascades with the task** (the `TaskFavorite` rule, not `TaskExclusion`'s), so untracking takes the membership; unique name per user (`409`); and an id the caller does not own is **filtered out and named**, never silently dropped | ✅ `collections.integration.test.ts` (13) + `sourceTree` / `taskFilters` / `savedViews` unit tests |
| F1.12 | **A run that failed ≠ a run that could not start** | A Cronsole-native job that executed and failed returns **200 with `success: false`**; only a genuine failure-to-start is a `502`. `ran` is stamped once in `executeJob`, so a spec rejected by `validateJob` keeps the 502. Both consumers read the transport, so the dashboard toast and `run_task`'s result-vs-error move with it ([#59](../../troubleshooting/README.md#59-a-check-that-correctly-finds-a-problem-is-reported-as-could-not-run-the-check)) | ✅ `native-job.integration.test.ts` (mutation-tested) + `NativeTaskExecutor.test.ts` |
| F1.13 | **Import a task file** | A `cronsoleTaskVersion` bundle becomes a real task, and everything that is *not* one is refused **by name**: a Windows bundle points at Tools → Restore, a template catalog at the Templates tab, a settings export at Settings, a future major version names both versions, an array says one-file-one-task, and `job: null` (*never captured*) is a different sentence from a malformed job. The round-trip case builds its input with `buildNativeTaskBundle` — the same function the export route and the pre-delete archive use — so a change to the export shape fails **here** rather than silently producing files nothing can read | ✅ `taskImport.test.ts` (16) · `ImportTaskTool.test.tsx` · `ImportModal.test.tsx` |
| F1.14 | **Restore a deleted task from its archive** | The archive yields a **new** task (new id, same schedule); the archived run history is **not** reattached; the archive **survives** the restore, so a second call honestly makes a second task. `restorable` travels with **its reason** on the list as well as the detail, derived from the same parser the route uses — so a Restore control is never offered where the route would refuse | ✅ `ImportTaskTool.test.tsx` · 🟡 the route itself is proven by the live pass of 2026-08-17, not by a suite |
| F1.15 | **A native delete archives first, through *either* door** | `DELETE /api/tasks/:id` (the UI) and `DELETE /api/tasks/:id/native` (MCP) both archive before destroying, and both refuse the delete if the archive write fails. Only the second did until 2026-08-17, which made recoverability a property of **which door the user came through** — stated on neither screen and guessable from neither | 🟡 `taskArchive` is unit-covered; *the two routes agreeing* is proven by the live pass, not a suite |

## ⏰ Schedules & conversion

Every schedule is stored as **5-field cron in UTC** and displayed local. Conversion is where
silent data loss lives.

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F2.1 | **Cron parsing & validation** | Valid expressions accepted, invalid rejected at the boundary with a usable message | ✅ `scheduler-conversion.test.ts` |
| F2.2 | **Cron → Windows trigger** | Each cron shape compiles to the correct native trigger | ✅ `TriggerBuilderTests.cs` |
| F2.3 | **Windows trigger → cron** | Native triggers read back into the right expression | ✅ `TriggerReaderTests.cs` |
| F2.4 | **Round-trip fidelity** | `cron → Windows → cron` returns the **identical** expression | ✅ `test-templates.test.ts` |
| F2.5 | **Next-run calculation** | Next fire time is correct across DST boundaries and month ends | ✅ `cron-next.test.ts` |
| F2.6 | **UTC ↔ local display** | Preview shows both, and they agree with the stored UTC | ✅ `schedule.test.ts` |
| F2.7 | **Honest confidence scoring** | Lossy conversions return confidence `< 1.0` **with** a warning payload; very lossy (`< 0.7`) blocks auto-apply until acknowledged | ⬜ **Verify this still holds** |
| F2.8 | **Schedule edit** | Editing a Windows task's schedule applies to the real entry | ✅ `task-schedule.integration.test.ts` |

## 📄 Template catalog

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F3.1 | **Browse & facets** | Category, Tags, and Availability (Built-in / Import) facets filter correctly | ✅ E2E `smoke.spec.ts` |
| F3.2 | **Favorites** | Favoriting persists, keyed by template id, and survives a catalog re-sync | ✅ `template-favorites.integration.test.ts` |
| F3.3 | **Apply modal** | `{{placeholder}}` params render, live preview updates, cron preset chips work | ✅ `ApplyTemplateModal.test.tsx` |
| F3.4 | **Duplicate-name guard** | Applying a name that already exists returns **409** — Windows must never silently overwrite | ✅ `task-name.integration.test.ts` |
| F3.5 | **Apply → real task** | The compiled command creates an actual Windows task via the signed socket command | ✅ E2E `mock-agent.spec.ts` |
| F3.6 | **Every template resolves** | Whole-catalog sweep: every bundled `commandTemplate` survives the Apply pipeline (**72** as of 2026-08-15 — the test counts them itself; this number is prose and goes stale, `registry/index.json` does not) | ✅ `test-templates.test.ts` |
| F3.7 | **Import / export** | Round-trip through `GET /api/templates/export` → `POST /api/templates/import` preserves the template | ✅ `template-import-export.integration.test.ts` |
| F3.8 | **Save task as template** | An existing task becomes a valid, re-appliable template | ✅ `save-as-template.integration.test.ts` |
| F3.9 | **Honest uncompiled targets** | A declared-but-uncompiled `compatibleTargets` entry shows the "copy to set up manually" path — **never a silent failure** | ⬜ |

## 🔐 Auth & security behavior

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F4.1 | **Register / login** | Credential validation, password hashing, token issuance | ✅ `auth.integration.test.ts` |
| F4.2 | **Token lifetimes — two kinds** | A **browser session** is a `JWT_EXPIRES_IN` token (default `24h`), carries no `jti`, and **cannot be revoked individually**; there is still **no refresh flow**, so expiry means logging in again. An **API token** (`POST`/`GET`/`DELETE /api/auth/tokens`, Settings → Account) is named, 30/60/90 days or never, and **revocable** — the DB stores its `jti` and nothing else. `checkToken` is **one definition shared by the REST middleware and the Socket.IO handshake**, and **fails closed** on a DB error | ✅ `auth.integration.test.ts` + `api-tokens.integration.test.ts` *(this row claimed "Refresh works; rotation invalidates the old token" until 2026-07-31 — an aspiration in the present tense — and then described a login-only auth surface until 2026-08-16, five weeks after the token routes shipped)* |
| F4.3 | **Config encryption** | `PlatformConnection.config` is AES-256-GCM encrypted before write; decrypted values never logged | ✅ `encryption.test.ts`, `connectionConfig.test.ts` |
| F4.4 | **Route scoping** | A user cannot read or mutate another user's tasks | ✅ `idor.integration.test.ts` |
| F4.5 | **No-shell command handling** | Structured `exec` stays `{executable, args[]}` — no implicit shell, no `cmd.exe /c` | ✅ `commandParser.test.ts`, `ArgumentQuotingTests.cs` |
| F4.6 | **Login rate limit** | Repeated credential guesses return **429**. Shipped 2026-07-31: `makeAuthLimiter()` is a per-IP limiter (**10 attempts / 15 min**) on **both** `/auth/login` and `/auth/setup` — setup is a credential-creation surface, so leaving it unlimited would just move the target. Skipped under `NODE_ENV=test` and `DISABLE_AUTH_RATE_LIMIT=true` so the suites aren't throttled | ✅ `authLimiter.test.ts` |

## 🖥️ UI & interaction

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F5.1 | **Modal primitive** | Escape closes, focus traps, ARIA roles correct, nested-modal stack unwinds in order | ✅ `Modal` + `ConfirmProvider.test.tsx` |
| F5.2 | **Confirm gates** | Destructive actions prompt; cancel truly cancels, accept truly executes | ✅ `ConfirmProvider.test.tsx` |
| F5.3 | **Mobile viewport** | Primary dashboard stays usable and actionable below **375px**: the rail hides and its **drawer** opens from beside the heading, closing on a pick or Escape; all five toolbar sections fit one row with their accessible names intact; the four native job types render as two rows of two at a real tap height; collections are reachable; nothing overflows horizontally; the FAB is 44px+. **jsdom cannot cover any of this** — it does not evaluate media queries, so a responsive class is invisible to the unit suite | ✅ E2E `layout.spec.ts` (10 mobile tests) + `mock-agent.spec.ts` |
| F5.4 | **Routing & deep links** | Bookmarkable sections; `/tasks/:id` and `/templates/:id` resolve cold | 🟡 |
| F5.5 | **Dark theme default** | Dark is default on a fresh install **even when the OS prefers light** (`system` is an explicit third choice, not the fallback); persists via `localStorage` key **`cronsole.theme`** (`taskhub.theme` is *read* as a legacy fallback so the rename didn't reset anyone's theme); `index.html`'s pre-paint fallback matches the hook's, so the first frame agrees with the app | ✅ `useTheme.test.tsx` |
| F5.11 | **The brand is right on the logged-out screens** | The login / first-run setup heading says **Cronsole**. It said `TaskHub` from the rename until 2026-07-31 because the markup split it as `Task<span>Hub</span>` — **ungreppable, so a rename sweep can't see it**, and the E2E suite authenticates past this screen with the dev token so it never rendered there either. Asserted on the *rendered* heading, both modes | ✅ `AuthFlow.test.tsx` |
| F5.12 | **Import asks which kind of import you mean** | The Dashboard's Import opens on a choice — adopt the machine's existing tasks, or create one from a file — labelled by **consequence** (*"nothing is created"* vs *"this creates a task"*) rather than by source, naming where a Windows `.xml` goes so it is not discovered as a refusal, and **not fetching discovery until that path is chosen**: an agent round trip that fails outright when the agent is offline must not be spent on the path that never touches it. Either option can be backed out of | ✅ `ImportModal.test.tsx` (9 chooser cases) + E2E `layout.spec.ts` |
| F5.9 | **The mobile drawer holds the rail, not the nav** | The app's five sections became a **top toolbar** on 2026-08-15, so the off-canvas nav this row described — and its `inert`/tab-order dance — is **gone with `Sidebar.tsx`**. What is a drawer now is the **source rail**, which genuinely cannot fit: it mounts only when opened (so nothing hidden sits in the tab order), is a `role="dialog"` labelled *Sources*, and closes on a pick or Escape | ✅ E2E `layout.spec.ts` + `SourceRail.test.tsx` *(this row cited `Sidebar.test.tsx` until 2026-08-16 — a ✅ pointing at a file deleted with the component, which is the worst shape a coverage claim can take)* |
| F5.10 | **System/personal split** | OS-owned tasks are hidden by default from **every** count, chip, facet and view (one outermost lens, not per-place filtering); the toggle **says what it hides** and persists; the hidden count is taken over all tasks so it can't read 0 while hiding 257; `isSystem` is the server's verdict, never re-derived in the browser | ✅ `systemTasks.test.ts`, `TaskService.test.ts` |
| F5.6 | **Live updates** | A WebSocket `task:updated` invalidates the TanStack Query cache and repaints | ✅ E2E `smoke.spec.ts` |
| F5.7 | **Agent offline guard** | Socket drops → badge flips to Offline and Run Now disables | ✅ E2E `mock-agent.spec.ts` |
| F5.8 | **Onboarding surfaces** | Help Center walkthrough renders; first-run banner dismisses and stays dismissed | ✅ `HelpModal.test.tsx` |

## 🤖 Agent & MCP surfaces

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F6.1 | **Agent command handlers** | `task:run`, `task:scan`, `task:create`, `task:delete`, `task:export`, `task:import` each behave per contract | ✅ `AgentServiceTests.cs` |
| F6.1a | **`task:import` signs the definition, not just the path** | The task's whole XML is inside the signature as a sha256, so a **swapped definition** with an untouched path and flags fails verification and never registers; both blast-radius flags (`overwrite`, `createFolders`) are signed too; the digest itself matches Node byte-for-byte | ✅ `AgentServiceTests.cs`, `AgentAuthenticatorTests.cs` + the shared golden vector in `agentAuth.test.ts` |
| F6.2 | **Agent config & auth** | Pairing config parses; authenticator derives the right token | ✅ `AgentConfigTests.cs`, `AgentAuthenticatorTests.cs` |
| F6.3 | **Health diagnostics** | An invalid Claude key surfaces "Key authentication failed" **with** corrective instructions | ⬜ |
| F6.4 | **Failure notifications** | Failed manual + scheduled native runs fire generic / Discord / ntfy webhooks | ✅ `FailureNotificationService.test.ts` |
| F6.5 | **MCP tool surface** | Every registered tool registers, validates its inputs, filters, and renders honestly — driven through a real MCP client over an in-memory transport. **Count and names are deliberately NOT listed here.** They were, as "a deliberate tripwire" naming 14 tools — and the surface reached **29** without this row changing (**33** as of 2026-08-17), so the tripwire recorded a number nobody re-read rather than obligating anything. The real tripwire is mechanical: `grep -c 'server.registerTool' mcp-server/src/tools.ts` against the two tool tables (`mcp-server/README.md`, `MCP_Server_Guide.md`), which `/sync-surfaces` diffs by name. `delete_task` is the only gated verb (`CRONSOLE_MCP_ALLOW_DESTRUCTIVE`) and is **absent** from `tools/list` when off | ✅ `mcp-server/src/__tests__/tools.test.ts` |
| F6.6 | **MCP destructive-op gate** | `delete_task` is registered **only** when `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`, and is **absent** from `tools/list` otherwise (not present-and-erroring); the gate opens exactly one tool and changes nothing else; **`untrack_task` is available without the gate**, so gating deletion never leaves a tidy-up with only the irreversible verb | ✅ `mcp-server/src/__tests__/tools.test.ts` |
| F6.6a | **MCP config & error normalization** | An unexpanded `${CRONSOLE_TOKEN}` refuses to start; an API failure surfaces the backend's own message + status, never a stack trace | ✅ `mcp-server/src/__tests__/client.test.ts` |
| F6.7 | **MCP tools against a *real* backend** | The stub and the API still agree on response shape (`conversion.warnings`, `task`, `score`) — the suite above can't prove this, since it stubs the client | 🟡 **Manual only** — hand-driven; see the note in [testing/README](../README.md#-known-coverage-gaps) |

## ✍️ Writing a good functional test

1. **Name the claim, not the code.** `rejects a duplicate Windows task name with 409` beats `test applyTemplate`.
2. **Test the error path too.** Most Cronsole bugs are honesty bugs — the feature "works" but lies when it fails. Assert what the user is *told*.
3. **Validate at boundaries.** Per CLAUDE.md, Zod guards the edges; trust internal code. Test the edge, not every internal hop.
4. **Prefer the cheapest layer.** If a Vitest unit test can prove it, don't spend an E2E run.
5. **A new feature ships with its functional test.** Once it's merged, that test becomes [regression](../regression-testing/README.md) coverage for free.

<p align="right">(<a href="#functional-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">← Testing Home</a> ·
  <a href="../integration-testing/README.md">Integration</a> ·
  <a href="../regression-testing/README.md">Regression</a> ·
  <a href="../uat/README.md">UAT</a>
</p>
