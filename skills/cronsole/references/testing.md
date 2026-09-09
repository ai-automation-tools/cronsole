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
cd ../frontend && npm run lint && npm test && npm run build
cd ../agent  && dotnet test
cd ../mcp-server && npm test
```

> **`npm run build` is the frontend's typecheck, and it is not optional.**
> `npx tsc --noEmit` in `frontend/` **always passes** — the root `tsconfig.json` is a solution
> file (`files: []` + `references`) and a plain `tsc` invocation doesn't follow references, so
> it compiles an empty program. Only `tsc -b` (what `npm run build` runs, and what CI runs)
> actually checks the app. [#25](../../../docs/troubleshooting/README.md#25-npx-tsc---noemit-in-frontend-passes-while-cis-build-fails-on-a-type-error)

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

## Visual regression — what it can and cannot assert

`frontend/tests/e2e/layout.spec.ts` covers the dense surfaces. It is **split on purpose**, and
the split is the lesson:

- **Pixels, only for chrome that does not move** — headers, the filter zone, the New Task modal.
  Live regions are masked (`data-testid="health-strip"`, `task-count-line`,
  `default-view-banner`, the saved-views bar, the Sync button).
- **Structure, for everything else** — the **Platforms matrix** and the **folder picker** get no
  baseline at all. Both are almost entirely live evidence, so a masked baseline is a picture of
  an empty frame that *still* breaks whenever a row's height changes.

Three things that look like flake and are not
([#43](../../../docs/troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)):

1. **`maxDiffPixels` defaults to 0** and GPU antialiasing is not deterministic. `playwright.config.ts`
   sets **40** — far above one-pixel noise, far below a one-character shift.
2. **Masking hides colour, not geometry.** A masked element whose text length varies still changes
   its own width and rewraps the row beside it.
3. **A wrapping status line changes its own height** — which is a real layout shift, not a test
   problem. Fix the component.

**Rule of thumb: screenshot the chrome, assert the content.** If choosing what to mask is getting
hard, the surface is telling you it wants a structural test.

The **375px verification lives here**, because it is the only place it can actually run — a
browser-driven resize does not reach the tab, `page.setViewportSize` does. It asserts no
horizontal overflow (walking *all* ancestors for a deliberate `overflow-x` scroller, not just the
parent), a one-row saved-views bar, the sticky toolbar surviving a 2000px scroll, and a 44px FAB.

**Baselines are per-platform** (Playwright's default suffix), so Windows and a Linux runner keep
separate sets — font rasterization differs too much to share one. A new surface writes its
baseline on first run and *fails that run by design*; re-run to confirm.

> **Renaming an accessible name breaks E2E locators.** `getByRole('button', { name })` matches the
> **accessible** name, so adding `aria-label="Import a task file"` to a button labelled *Import* silently
> broke `mock-agent.spec.ts`. Grep `tests/e2e` when you name an icon-only control.

## What CI enforces — and doesn't

`.github/workflows/ci.yml`, **5 jobs** on push to `main`/`mike_desktop` and every PR:
`backend` (vitest + tsc), `backend-integration` (real `postgres:16-alpine` service),
`frontend` (eslint + vitest + build), `windows-agent` (`dotnet build`/`test` on
`windows-latest`), `mcp-server` (vitest + typecheck + tsc build).

**Counts are deliberately not written here.** This line said `vitest 75` while the suite was at
**190** — a number nobody re-reads, presented as if it were a check. Get the real one by running
the suite; the count that *does* obligate something is the MCP tool census, and it is mechanical:
`grep -c 'server.registerTool' mcp-server/src/tools.ts` against the two tool tables.

> **The E2E suite is NOT in CI.** It needs a live stack CI doesn't stand up. It's a **local
> gate you must run by hand** — which makes it the suite most likely to rot unnoticed. Run it
> before any release.

> **Running it takes your real Windows agent offline, and it does not come back.** The suite drives
> the **live** stack, and `tests/e2e/helpers/mockAgent.ts` authenticates with the same pairing
> secret — so it registers as the same user, and `AgentManager` holds **one socket per user**. The
> mock evicts the real agent, then unregisters on exit, leaving none; the real agent cannot observe
> that it was displaced, so it never reconnects. **Restart the stack (`Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'`) after
> every E2E run**, then Sync. The tell is `grep "Agent connected" logs/backend.out.log | tail -1`
> naming `e2e-agent-<ts>` instead of your machine.
> ([#5a](../../../docs/troubleshooting/README.md#5a-and-the-transient-agent-is-the-e2e-suite))

## Known gaps

Honest list — real holes, not polish:

| Gap | Consequence |
|:---|:---|
| **Login rate limit (`429`) not implemented** | The archived Test Plan's brute-force mitigation has no code behind it. Tracked in the Go-public checklist. **Don't "fix the test" — the feature is missing.** |
| **E2E not in CI** | Full-stack regressions only surface locally |
| **The E2E mock agent shares the real agent's identity** | Running the suite knocks your Windows agent offline until you restart it — same pairing secret, same user, one socket per user. A separate pairing identity for the mock (or a second backend for E2E) is the durable fix; neither is a one-liner. [#5a](../../../docs/troubleshooting/README.md#5a-and-the-transient-agent-is-the-e2e-suite) |
| **MCP tools never run against a real backend** | The suite stubs the HTTP client, so it pins what the wrapper *does*, not that the wrapper and the API still **agree**. A route whose response shape moves keeps the stub green while the real tool breaks — [#9](../../../docs/troubleshooting/README.md#9-agent-payload-arrives-with-every-field-empty) one layer up: *both sides green while disagreeing about the wire.* Drive the tools by hand after touching a wrapped route — there is now a procedure for it: [MCP Tools runbook](../../../docs/testing/manual-testing/runbooks/MCP_Tools.md). |
| **The recovery paths rest on one live pass** | `POST /api/tasks/import`, `POST /api/tools/task-archives/:id/restore`, and `DELETE /api/tasks/:id` now archiving like the MCP route. The **parser** is well covered (`taskImport.test.ts`, refusals mutation-tested) and the components are too — but the routes themselves, and *the two delete doors behaving alike*, were proven end to end on 2026-08-17 and by nothing since. Bites late by construction: nobody exercises undo until they need it. |
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
| **Unexpanded `${CRONSOLE_TOKEN}`** (`mcp-server/.../client.test.ts`) | The literal-passthrough guard stops refusing to start — the bug that made every MCP tool 403 like an expired JWT ([#8](../../../docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)) |

## Where tests live

```
backend/src/**/__tests__/       unit (vitest)
backend/src/catalog/*.test.ts   catalog unit
backend/test/integration/       integration (real Postgres)
frontend/src/**/__tests__/      unit (vitest + RTL + jsdom)
frontend/tests/e2e/             Playwright (+ helpers/mockAgent.ts)
  smoke / mock-agent            full-stack flows
  layout.spec.ts                layout + visual regression, 1280px & 375px
  layout.spec.ts-snapshots/     per-platform baselines (never hand-edit)
agent/Cronsole.Agent.Tests/      xUnit
mcp-server/src/__tests__/       unit (vitest) — tools via a real MCP client
                                over InMemoryTransport with a stubbed
                                CronsoleClient; client.ts against a real
                                local http server
```

## Writing tests here

1. **Test the claim, not the code.** `rejects a duplicate Windows task name with 409` beats
   `test applyTemplate`.
2. **Test the error path.** Most Cronsole bugs are *honesty* bugs — the feature "works" but
   lies when it fails. Assert what the user is **told**.
3. **Prefer invariant guards over example tests.** One test that holds for **every** template
   forever beats one test per template — and it keeps holding as the catalog grows, which is the
   half that matters. (This line said "all 55 templates" until 2026-08-25, when there were 82. A
   number in prose ages badly even inside advice about not writing brittle tests.)
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
