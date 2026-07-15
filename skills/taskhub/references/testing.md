# Testing

Load when running, writing, or debugging tests.

**Canonical:** [`docs/testing/`](../../../docs/testing/README.md) — four layers plus
[manual runbooks](../../../docs/testing/manual-testing/README.md). Read those for *what* to
test; this is the operational summary.

## Run it

| Suite | Command | Where | Needs |
|:---|:---|:---|:---|
| Backend unit | `npm test` | `backend/` | Nothing (mocked) |
| Backend integration | `npm run test:integration` | `backend/` | **Real Postgres** + `TEST_DATABASE_URL` |
| Frontend unit | `npm test` | `frontend/` | Nothing (jsdom) |
| Frontend E2E | `npm run test:e2e` | `frontend/` | **A live stack** (backend + frontend + mock agent) |
| Agent | `dotnet test` | `agent/` | .NET 10; Windows for COM paths |
| MCP server | `npm test` | `mcp-server/` | Nothing (stubbed client + a local HTTP server) |

Full sweep:

```bash
cd backend  && npm test && npm run test:integration
cd ../frontend && npm run lint && npm test
cd ../agent  && dotnet test
cd ../mcp-server && npm test
```

Integration setup: `test/integration/globalSetup.ts` creates + migrates `taskhub_test` on the
server named by `TEST_DATABASE_URL`; `setupEach.ts` gives each test a clean slate.

## The four layers

Split by **the question each answers**, not by tooling — a single Playwright spec is
*functional* the day it's written and *regression* the day after.

| Layer | Question | When |
|:---|:---|:---|
| **Functional** | Does the feature do what it claims, alone? | Per feature, as built |
| **Integration** | Do the seams hold? | Per boundary change |
| **Regression** | Did we break what worked? | Every PR (CI) |
| **UAT** | Would a real user accept it? | Before a release |
| **Manual runbooks** | *(procedures, not a layer)* — the ⬜ gaps: real COM, real Windows | Before a release |

## What CI enforces — and doesn't

`.github/workflows/ci.yml`, **5 jobs** on push to `main`/`mike_desktop` and every PR:
`backend` (vitest + tsc), `backend-integration` (real `postgres:16-alpine` service),
`frontend` (eslint + vitest + build), `windows-agent` (`dotnet build`/`test` on
`windows-latest`), `mcp-server` (vitest 75 + typecheck + tsc build).

> **The E2E suite is NOT in CI.** It needs a live stack CI doesn't stand up. It's a **local
> gate you must run by hand** — which makes it the suite most likely to rot unnoticed. Run it
> before any release.

## Known gaps

Honest list — real holes, not polish:

| Gap | Consequence |
|:---|:---|
| **Login rate limit (`429`) not implemented** | The archived Test Plan's brute-force mitigation has no code behind it. Tracked in the Go-public checklist. **Don't "fix the test" — the feature is missing.** |
| **E2E not in CI** | Full-stack regressions only surface locally |
| **MCP tools never run against a real backend** | The suite stubs the HTTP client, so it pins what the wrapper *does*, not that the wrapper and the API still **agree**. A route whose response shape moves keeps the stub green while the real tool breaks — [#9](../../../docs/troubleshooting/README.md#9-agent-payload-arrives-with-every-field-empty) one layer up: *both sides green while disagreeing about the wire.* Drive the tools by hand after touching a wrapped route. |
| **No visual regression** | Theme/layout breaks caught by eye only |
| **No performance gate** | A baseline exists in `artifacts/`; nothing fails on drift |

## The invariant guards

The highest-leverage tests in the repo — tripwires on rules that are easy to violate
accidentally. **Know these before changing the catalog.**

| Guard | Fails when |
|:---|:---|
| **Registry drift** (`registry.test.ts`) | `registry/` doesn't match what `bundled.ts` generates |
| **Whole-catalog resolvability** (`test-templates.test.ts`) | Any bundled `commandTemplate` breaks the Apply pipeline |
| **Cron round-trip** (`test-templates.test.ts`) | `cron → Windows → cron` isn't lossless |
| **Core/extended split** (`catalogSync.test.ts`) | A stray `core: true` bloats fresh installs |
| **Prune safety** (`catalogSync.test.ts`) | `managed: false` gets pruned, or an empty core wipes the catalog |
| **No field leakage** (`catalogSync.test.ts`) | `core` reaches the DB |
| **IDOR sweep** (`idor.integration.test.ts`) | A route leaks across tenants — **add every new route here** |
| **MCP tool surface** (`mcp-server/.../tools.test.ts`) | A tool is added, removed, or renamed. Deliberate: that change obligates both README tool tables + the skill (CLAUDE.md §11a), and those surfaces never break loudly on their own. **Update the expected list *and* the docs in the same change** — don't just make it pass. |
| **Unexpanded `${TASKHUB_TOKEN}`** (`mcp-server/.../client.test.ts`) | The literal-passthrough guard stops refusing to start — the bug that made every MCP tool 403 like an expired JWT ([#8](../../../docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)) |

## Where tests live

```
backend/src/**/__tests__/       unit (vitest)
backend/src/catalog/*.test.ts   catalog unit
backend/test/integration/       integration (real Postgres)
frontend/src/**/__tests__/      unit (vitest + RTL + jsdom)
frontend/tests/e2e/             Playwright (+ helpers/mockAgent.ts)
agent/TaskHub.Agent.Tests/      xUnit
mcp-server/src/__tests__/       unit (vitest) — tools via a real MCP client
                                over InMemoryTransport with a stubbed
                                TaskHubClient; client.ts against a real
                                local http server
```

## Writing tests here

1. **Test the claim, not the code.** `rejects a duplicate Windows task name with 409` beats
   `test applyTemplate`.
2. **Test the error path.** Most TaskHub bugs are *honesty* bugs — the feature "works" but
   lies when it fails. Assert what the user is **told**.
3. **Prefer invariant guards over example tests.** One test covering all 55 templates forever
   beats 55 tests.
4. **A bug fix ships with a test that failed before the fix.** Write it first so you know it
   catches the bug.
5. **Every `docs/troubleshooting/` entry is a candidate** — each is a *proven* escape, not a
   hypothetical.
6. **Never delete a failing test to go green.** Either the test is wrong (fix it) or the code
   is (fix that). Deleting converts a known bug into an unknown one.
7. **Mocks agree with your assumptions; production doesn't.** Integration tests use real
   Postgres for a reason. Every automated test of the Windows seam uses a **mock agent** — so
   it proves the protocol, not the platform. That's what the manual runbook is for.

## Before concluding "the code is broken"

Two processes run stale and will lie to you:

1. **Dockerized backend** — `docker restart taskhub-backend-1`
2. **Published .NET agent** — republish from an admin prompt

If offline suites pass but a live check disagrees, it's one of these. Always.
