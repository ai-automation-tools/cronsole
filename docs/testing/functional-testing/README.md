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
| F3.6 | **Every template resolves** | Whole-catalog sweep: all 55 bundled `commandTemplate`s survive the Apply pipeline | ✅ `test-templates.test.ts` |
| F3.7 | **Import / export** | Round-trip through `GET /api/templates/export` → `POST /api/templates/import` preserves the template | ✅ `template-import-export.integration.test.ts` |
| F3.8 | **Save task as template** | An existing task becomes a valid, re-appliable template | ✅ `save-as-template.integration.test.ts` |
| F3.9 | **Honest uncompiled targets** | A declared-but-uncompiled `compatibleTargets` entry shows the "copy to set up manually" path — **never a silent failure** | ⬜ |

## 🔐 Auth & security behavior

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F4.1 | **Register / login** | Credential validation, password hashing, token issuance | ✅ `auth.integration.test.ts` |
| F4.2 | **JWT access + refresh** | Refresh works; rotation invalidates the old token | ✅ `auth.integration.test.ts` |
| F4.3 | **Config encryption** | `PlatformConnection.config` is AES-256-GCM encrypted before write; decrypted values never logged | ✅ `encryption.test.ts`, `connectionConfig.test.ts` |
| F4.4 | **Route scoping** | A user cannot read or mutate another user's tasks | ✅ `idor.integration.test.ts` |
| F4.5 | **No-shell command handling** | Structured `exec` stays `{executable, args[]}` — no implicit shell, no `cmd.exe /c` | ✅ `commandParser.test.ts`, `ArgumentQuotingTests.cs` |
| F4.6 | **Login rate limit** | 10 login attempts in 10s returns **429** | ⬜ **Not implemented** — see [ROADMAP](../../ROADMAP.md) |

## 🖥️ UI & interaction

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| F5.1 | **Modal primitive** | Escape closes, focus traps, ARIA roles correct, nested-modal stack unwinds in order | ✅ `Modal` + `ConfirmProvider.test.tsx` |
| F5.2 | **Confirm gates** | Destructive actions prompt; cancel truly cancels, accept truly executes | ✅ `ConfirmProvider.test.tsx` |
| F5.3 | **Mobile viewport** | Primary dashboard stays usable and actionable below **375px** | ✅ E2E `mock-agent.spec.ts` |
| F5.4 | **Routing & deep links** | Bookmarkable sections; `/tasks/:id` and `/templates/:id` resolve cold | 🟡 |
| F5.5 | **Dark theme default** | Dark is default on a fresh install **even when the OS prefers light** (`system` is an explicit third choice, not the fallback); persists via `localStorage` key `taskhub.theme`; `index.html`'s pre-paint fallback matches the hook's, so the first frame agrees with the app | ✅ `useTheme.test.tsx` |
| F5.9 | **Closed mobile drawer is inert** | Below `md` a closed sidebar is out of the tab order **and** the accessibility tree (a transform hides it visually only); at and above `md` the same element is the real nav and must stay reachable | ✅ `Sidebar.test.tsx` |
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
| F6.5 | **MCP tool surface** | All 14 ungated tools (`list_tasks`, `run_task`, `list_templates`, `list_folders`, `create_task`, `create_native_task`, `create_task_from_template`, `convert_schedule`, `get_task_history`, `export_task`, `set_task_status`, `update_task_schedule`, `update_task_action`, `untrack_task`) register, validate their inputs, filter, and render honestly — driven through a real MCP client over an in-memory transport. The exact name list is a deliberate tripwire: changing it obligates both README tool tables and the skill (CLAUDE.md §11a) | ✅ `mcp-server/src/__tests__/tools.test.ts` |
| F6.6 | **MCP destructive-op gate** | `delete_task` is registered **only** when `CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true`, and is **absent** from `tools/list` otherwise (not present-and-erroring); the gate opens exactly one tool and changes nothing else; **`untrack_task` is available without the gate**, so gating deletion never leaves a tidy-up with only the irreversible verb | ✅ `mcp-server/src/__tests__/tools.test.ts` |
| F6.6 | **MCP config & error normalization** | An unexpanded `${CRONSOLE_TOKEN}` refuses to start; an API failure surfaces the backend's own message + status, never a stack trace | ✅ `mcp-server/src/__tests__/client.test.ts` |
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
