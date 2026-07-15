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

TaskHub is a **reliability control plane**. Its whole value proposition is that the state it
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
| **MCP server** | `npm run build` | `mcp-server/` | Nothing (build only — no test suite yet) |

Full sweep before a release (from the repo root):

```bash
cd backend  && npm test && npm run test:integration
cd ../frontend && npm run lint && npm test
cd ../agent  && dotnet test
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
| `mcp-server` | Build only |

> [!IMPORTANT]
> **The E2E suite is not in CI.** Playwright needs a live stack (backend, frontend, and the
> mock agent), which CI doesn't stand up. E2E is a **local gate you have to run by hand** —
> which means it's the suite most likely to rot unnoticed. Run it before any release.

## 📊 Known coverage gaps

Honest list. These are real holes, not aspirational polish:

| Gap | Impact | Tracked |
|:---|:---|:---|
| **Login rate limit (`429`) not implemented** | The archived Test Plan's brute-force mitigation has no code behind it — so nothing to test | Go-public checklist in [ROADMAP](../ROADMAP.md) |
| **E2E not wired into CI** | Regressions in full-stack flows only surface if someone runs it locally | This doc |
| **MCP server has no test suite** | Its 6 tools are covered only by the REST endpoints underneath them | This doc |
| **No visual regression** | Dark/light theme and layout breaks are caught by eye only | This doc |
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
