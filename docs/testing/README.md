<a id="testing-top"></a>

<h1 align="center">🧪 Testing</h1>

<p align="center">
  <em>What we test, why each layer exists, and how to run it.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/layers-functional_·_integration_·_regression_·_UAT-8B5CF6?style=for-the-badge" alt="Layers">
  <img src="https://img.shields.io/badge/CI-5_jobs-2ea44f?style=for-the-badge" alt="CI">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-docs_home-6B7280?style=for-the-badge" alt="Docs Home"></a>
</p>

---

Cronsole is a **reliability control plane**. Its whole value proposition is that the state it
shows you is true and the actions you take actually happen on the real platform. That makes
testing a product feature, not a chore: a dashboard that *lies* about a task is worse than no
dashboard at all.

These four folders split testing by **the question each layer answers**, not by tooling. A
single Vitest file can be functional *or* regression depending on why it exists.

## 🧭 The four layers

| Folder | The question it answers | Runs when |
|:---|:---|:---|
| [**✅ functional-testing/**](functional-testing/README.md) | Does each feature do what it claims, on its own? | Per feature, as it's built |
| [**🔗 integration-testing/**](integration-testing/README.md) | Do the seams between components hold? | Per change touching a boundary |
| [**🛡️ regression-testing/**](regression-testing/README.md) | Did we break something that used to work? | Every commit / PR (CI) |
| [**👤 uat/**](uat/README.md) | Would a real user accept this? | Before a release or a "done" call |
| [**🖐️ manual-testing/**](manual-testing/README.md) | **The step-by-step runbooks** for what no suite can prove — real COM, real Windows, real eyes | Before a release; when closing a ⬜ gap |

> [!NOTE]
> **Layer ≠ tool.** A Playwright spec that proves "Run Now works" is *functional*. That same
> spec, pinned in CI so it never silently breaks, is *regression*. Read each folder for what
> it's asking, then pick the cheapest tool that answers it.

The first four folders are **catalogs** — what *should* be tested, and what covers it today
(✅ / 🟡 / ⬜). [**manual-testing/**](manual-testing/README.md) is different: it's the
**procedures**, with copy-pasteable commands and expected output, for the ⬜ rows the other
four can't automate.

## 🖐️ The manual runbooks

Real Task Scheduler COM, a stack booting from a clean checkout, whether a PowerShell window
flashes — some things need hands. These are written to be followed without thinking:

| Runbook | Verifies | Time |
|:---|:---|:--|
| [**🔥 Smoke Test**](manual-testing/runbooks/Smoke_Test.md) | Stack alive, agent talking. **Gateway for the rest** | ~10 min |
| [**🪟 Windows Task Lifecycle**](manual-testing/runbooks/Windows_Task_Lifecycle.md) | Create → run → edit → delete against **real Task Scheduler** | ~25 min |
| [**📄 Template Apply**](manual-testing/runbooks/Template_Apply.md) | Params, preview, the 409 duplicate guard, honest lossy conversion | ~20 min |
| [**🔌 Agent Resilience**](manual-testing/runbooks/Agent_Resilience.md) | Offline detection, reconnect/backoff, the transient-agent trap | ~20 min |
| [**🔐 Security Checks**](manual-testing/runbooks/Security_Checks.md) | Encryption at rest, tenant isolation, no-shell — **verified in the DB** | ~20 min |

Start with the [preflight](manual-testing/README.md#-preflight--do-this-once-per-session) — it
gets you a running stack and an auth token, which every runbook assumes.

## 🏃 How to run everything

| Suite | Command | Where | Needs |
|:---|:---|:---|:---|
| **Backend unit** | `npm test` | `backend/` | Nothing (mocked) |
| **Backend integration** | `npm run test:integration` | `backend/` | Real Postgres + `TEST_DATABASE_URL` |
| **Frontend unit** | `npm test` | `frontend/` | Nothing (jsdom) |
| **Frontend E2E** | `npm run test:e2e` | `frontend/` | **A live stack** (backend + frontend + mock agent) |
| **Windows agent** | `dotnet test` | `agent/` | .NET 10 SDK; Windows for COM-backed paths |
| **MCP server** | `npm test` | `mcp-server/` | Nothing (stubbed client + a local HTTP server) |

Full sweep before a release (from the repo root):

```bash
cd backend  && npm test && npm run test:integration
cd ../frontend && npm run lint && npm test
cd ../agent  && dotnet test
cd ../mcp-server && npm test
```

## 🤖 What CI actually enforces

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs **5 jobs** on every push to
`main` / `mike_desktop` and on every PR:

| Job | What it does |
|:---|:---|
| `backend` | Vitest unit suite + `tsc` build |
| `backend-integration` | Vitest integration suite against a real `postgres:16-alpine` service container |
| `frontend` | ESLint + Vitest + Vite build |
| `windows-agent` | `dotnet build` + `dotnet test` on `windows-latest` |
| `mcp-server` | Vitest suite + `tsc` typecheck (incl. tests) + build |

> [!IMPORTANT]
> **The E2E suite is not in CI.** Playwright needs a live stack (backend, frontend, and the
> mock agent), which CI doesn't stand up. E2E is a **local gate you have to run by hand** —
> which means it's the suite most likely to rot unnoticed. Run it before any release.

### ⚠️ E2E preflight — two things that will waste your afternoon

Both of these were hit on 2026-07-31. Neither announces itself.

**1. An empty `VITE_DEV_TOKEN` makes every test fail on the login screen.** The suite has no
login step by design — the browser authenticates with `frontend/.env.local`'s
`VITE_DEV_TOKEN`. If that value is empty or signed with a **rotated** `JWT_SECRET`, the app
falls through to `AuthScreen` and each spec dies on a missing dashboard heading. The failure
reads like a broken frontend, not a missing credential; the tell is the page snapshot in
`test-results/*/error-context.md` showing a **Sign in** form. Mint a fresh one:

```bash
cd backend && node --input-type=module -e "
import 'dotenv/config'; import jwt from 'jsonwebtoken';
console.log(jwt.sign({ id: 'cli_user_placeholder', email: '<your login email>' }, process.env.JWT_SECRET, { expiresIn: '3650d' }));"
# paste into frontend/.env.local as VITE_DEV_TOKEN="…" — Vite restarts and picks it up
```

The `id` must be a **real `User.id`** in the dev DB, or every request 401s with a valid token.

**2. Running E2E knocks your real Windows agent offline.** The mock agent takes the
single per-user agent socket; when the suite disconnects it, the backend clears the mapping
and the real agent — whose socket is still alive from *its* side — never re-registers. This is
[troubleshooting #5](../troubleshooting/README.md#5-windows-offline-after-running-a-transient-test-agent),
reached through the suite rather than a hand-started dogfood agent. It does **not** self-heal;
polling for minutes won't recover it. Afterwards:

```bash
pwsh scripts/cronsole.ps1 restart   # drops all agent sockets; the real agent reconnects
curl -s http://localhost:3000/api/tasks/health -H "Authorization: Bearer <dev token>"
# expect WINDOWS_TASK_SCHEDULER: HEALTHY
```

Treat that health check as **part of the E2E run**, not an optional follow-up — the agent
being down is silent until the next thing you try to do needs it.

## 📊 Known coverage gaps

Honest list. These are real holes, not aspirational polish:

| Gap | Impact | Tracked |
|:---|:---|:---|
| **E2E not wired into CI** | Regressions in full-stack flows only surface if someone runs it locally — **and it can fail to run at all without failing loudly** (see the preflight below) | This doc |
| **MCP tools are never exercised against a real backend** | The suite stubs the HTTP client, so it pins what the wrapper *does* — not that the wrapper and the API still **agree**. If a route's response shape moves (`conversion.warnings`, `task`, `score`), the stub keeps passing while the real tool breaks. This is the [#9](../troubleshooting/README.md#9-agent-payload-arrives-with-every-field-empty) failure mode one layer up: *both sides green while disagreeing about the wire.* Covered today only by driving the tools by hand (see the MCP runbook row below) | This doc |
| **The sync route's exclusion wiring has no suite** | `TaskService.excludedExternalIds` / `filterExcluded` / `clearExclusionsForCategories` are unit-tested, and the untrack route is integration-tested — but the **order they run in inside `POST /tasks/sync`** (clear before read, so an import isn't skipped for one more cycle) is proven only by the live round-trip done at ship time. A reordering would pass every suite and make untrack look broken one sync later | This doc |
| **~~The `<375px` mobile layout is unverified in a browser~~** *(closed 2026-08-12)* | It is now rendered and asserted at 375px by `frontend/tests/e2e/layout.spec.ts`: no horizontal overflow (walking every ancestor for a deliberate `overflow-x` scroller), a one-row saved-views bar, the sticky toolbar surviving a 2000px scroll, and a 44px FAB. **The blocker was the tool, not the effort** — a browser-driven window resize reports success while `innerWidth` stays 2124; Playwright's `page.setViewportSize` actually applies. A real *device* check (touch, iOS Safari) is still not done | Closed |
| **`Win32TaskScheduler.ImportTaskXml` has no automated test** | Restore's actual write to Windows talks to COM, so nothing in any suite exercises it — the agent tests mock `ITaskScheduler`, which pins the *handler* (signature verification, flag pass-through, the four outcomes) and not the registration. Everything it decides *before* COM is covered by `TaskFolderPath` tests, and the write itself was proven by a live pass on 2026-07-28 (principal preserved, skip left the registration date untouched, `\Microsoft\` refused). But a change to that method would pass every suite. **Same family as the MCP row above: when the bug can only live in the layer your suite replaces, drive the real path once.** | This doc + the [Windows Task Lifecycle runbook](manual-testing/runbooks/Windows_Task_Lifecycle.md) §12b |
| **The Tools tab's native file dialogs have never been driven** *(narrowed 2026-08-11)* | The cards themselves have now been clicked through — the three bulk verbs on 2026-08-04 and **Execution analytics + the Import-defaults modal on 2026-08-11**, both of which found real defects. What remains is the part that **cannot** be automated: `showDirectoryPicker` is a native dialog ([#24](../troubleshooting/README.md#24-showdirectorypicker-throws-must-be-handling-a-user-gesture-after-an-await)), and so is the restore file/folder input — so bulk export's save-to-folder branch and restore's file input are still unexercised end-to-end from the UI | This doc + [UAT U5.4a](uat/README.md), [U5.4b](uat/README.md) |
| **A live click-through keeps out-finding the suites, and that is the finding** | Every browser pass so far has produced a defect no test could: markdown rendered literally in a `useConfirm` message (2026-08-04), and on 2026-08-11 **four at once** — platform health asserting `HEALTHY`/"synced just now" from socket presence ([#40](../troubleshooting/README.md#40-the-sidebar-says-windows-is-online-and-synced-just-now-while-every-agent-request-times-out)), the idle report printing the all-clear beside its own contradiction, an empty platform heading in the Import modal, and `1 tasks`. Three of the four are **claims**, not computations — a suite checks that the value you chose arrived, never that it was the right value to choose, and no fixture contains a 354-task machine with a wedged agent. **Treat a browser pass as a required step when shipping a card that states a verdict**, not as optional polish | This doc |
| **Visual regression covers chrome, not content** *(narrowed 2026-08-12)* | `layout.spec.ts` now baselines the dense surfaces at 1280px and 375px, so a spacing regression fails. **What it deliberately does not cover:** anything mostly live evidence — the Platforms matrix, the Import modal and the task-detail modal are asserted structurally instead, because masking hides colour but not geometry, so their baselines would be pictures of empty frames that still break when a row's height moves ([#43](../troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)). **Theme breaks are still caught by eye** — there is no light/dark baseline pair. And it is E2E, so it is not in CI | This doc |
| **No performance gate** | A baseline exists as an artifact; nothing fails when we regress past it | This doc |

## 📁 Related

| Location | What's inside |
|:---|:---|
| [**🗺️ ROADMAP.md**](../ROADMAP.md) | Testing status of record — P1 correctness (the QA suite) and open items. |
| [**🧯 troubleshooting/**](../troubleshooting/README.md) | Every entry is a bug that escaped. Good source of regression test ideas. |
| [**📦 artifacts/**](../../artifacts) | Dated QA evidence: security audit, performance baseline, resilience, notifications. |
| `docs/archive/specs/Test_Plan.md` | The original Phase 4 test plan. **Local-only, gitignored, and frozen** — history, not the live spec. |

<p align="right">(<a href="#testing-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">Docs Home</a> ·
  <a href="functional-testing/README.md">Functional</a> ·
  <a href="integration-testing/README.md">Integration</a> ·
  <a href="regression-testing/README.md">Regression</a> ·
  <a href="uat/README.md">UAT</a>
</p>
