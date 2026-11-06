# Testing

Load when running, writing, or debugging tests.

**Canonical: [`docs/testing/README.md`](../../../docs/testing/README.md)** — the four layers, the
run table and full sweep, the CI jobs, the E2E preflight (including why a run knocks your real
agent offline), and the known coverage gaps. Read it there; it is not repeated here. The manual
procedures are the [runbooks](../../../docs/testing/manual-testing/README.md).

This file holds only the developer traps and guards the docs do not.

## Traps when running the suites

> **`npm run build` is the frontend's typecheck, and it is not optional.**
> `npx tsc --noEmit` in `frontend/` **always passes** — the root `tsconfig.json` is a solution
> file (`files: []` + `references`) and a plain `tsc` invocation doesn't follow references, so
> it compiles an empty program. Only `tsc -b` (what `npm run build` runs, and what CI runs)
> actually checks the app. [#25](../../../docs/troubleshooting/README.md#25-npx-tsc---noemit-in-frontend-passes-while-cis-build-fails-on-a-type-error)

- **Integration setup:** `tests/integration/globalSetup.ts` creates and migrates `taskhub_test` on
  the server named by `TEST_DATABASE_URL`; `setupEach.ts` gives each test a clean slate.
- **Renaming an accessible name breaks E2E locators.** `getByRole('button', { name })` matches
  the **accessible** name, so adding `aria-label="Import a task file"` to a button labelled
  *Import* silently broke `mock-agent.spec.ts`. Grep `tests/e2e` when you name an icon-only
  control.
- **Counts are deliberately not written down.** A test count in prose said `vitest 75` while the
  suite was at 190. Run the suite for the number. The one count that obligates something is the
  MCP tool census, and it is mechanical: `grep -c 'server.registerTool' mcp-server/src/tools.ts`
  against the two tool tables.

## Visual regression — what it can and cannot assert

`frontend/tests/e2e/layout.spec.ts` covers the dense surfaces. It is **split on purpose**:

- **Pixels, only for chrome that does not move** — headers, the filter zone, the New Task modal.
  Live regions are masked (`data-testid="health-strip"`, `task-count-line`,
  `default-view-banner`, the saved-views bar, the Sync button).
- **Structure, for everything else** — the **Platforms matrix** and the **folder picker** get no
  baseline at all. Both are almost entirely live evidence, so a masked baseline is a picture of
  an empty frame that *still* breaks whenever a row's height changes.

Three things that look like flake and are not
([#43](../../../docs/troubleshooting/README.md#43-a-visual-regression-baseline-fails-on-one-pixel-or-on-a-layout-that-moved-by-itself)):

1. **`maxDiffPixels` defaults to 0** and GPU antialiasing is not deterministic.
   `playwright.config.ts` sets **40** — far above one-pixel noise, far below a one-character shift.
2. **Masking hides colour, not geometry.** A masked element whose text length varies still changes
   its own width and rewraps the row beside it.
3. **A wrapping status line changes its own height** — a real layout shift, not a test problem.
   Fix the component.

**Rule of thumb: screenshot the chrome, assert the content.** If choosing what to mask is getting
hard, the surface wants a structural test.

The **375px check lives here** because it is the only place it can run — a browser-driven resize
does not reach the tab, `page.setViewportSize` does.

**Baselines are per-platform** (Playwright's default suffix), so Windows and a Linux runner keep
separate sets. A new surface writes its baseline on first run and *fails that run by design*;
re-run to confirm.

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
| **Connect Pack drift** (`connectPack.test.ts`) | `connectPackBundled.ts` doesn't match `connect-pack/` — run `npm run connectpack:build` |
| **MCP tool surface** (`mcp-server/.../tools.test.ts`) | A tool is added, removed, or renamed. Deliberate: that change obligates both README tool tables + the skill (AGENTS.md §11a), and those surfaces never break loudly on their own. **Update the expected list *and* the docs in the same change** — don't just make it pass. |
| **Unexpanded `${CRONSOLE_TOKEN}`** (`mcp-server/.../client.test.ts`) | The literal-passthrough guard stops refusing to start — the bug that made every MCP tool 403 like an expired JWT ([#8](../../../docs/troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token)) |

## Where tests live

```
backend/src/**/__tests__/       unit (vitest)
backend/src/catalog/*.test.ts   catalog unit
backend/tests/integration/      integration (real Postgres)
frontend/src/**/__tests__/      unit (vitest + RTL + jsdom)
frontend/tests/e2e/             Playwright (+ helpers/mockAgent.ts)
  smoke / mock-agent            full-stack flows
  layout.spec.ts                layout + visual regression, 1280px & 375px
  layout.spec.ts-snapshots/     per-platform baselines (never hand-edit)
agent/Cronsole.Agent.Tests/     xUnit
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
   forever beats one test per template — and it keeps holding as the catalog grows.
4. **A bug fix ships with a test that failed before the fix.** Write it first so you know it
   catches the bug.
5. **Every `docs/troubleshooting/` entry is a candidate** — each is a *proven* escape, not a
   hypothetical.
6. **Never delete a failing test to go green.** Either the test is wrong (fix it) or the code
   is (fix that). Deleting converts a known bug into an unknown one.
7. **Mocks agree with your assumptions; production doesn't.** Integration tests use real
   Postgres for a reason. Every automated test of the Windows seam uses a **mock agent** — so
   it proves the protocol, not the platform. That's what the manual runbooks are for.

## Before concluding "the code is broken"

Two processes run stale and will lie to you:

1. **The backend** — host mode (default): `Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRestart'`; Docker mode: `docker restart taskhub-backend-1`
2. **Published .NET agent** — `Start-ScheduledTask -TaskPath '\Cronsole-Stack\' -TaskName 'CronsoleRepublish'`, then wait for `DONE` in `$env:TEMP\cronsole-republish.log`

If offline suites pass but a live check disagrees, it's one of these — or one of the other
stale layers `/doctor` checks (`mcp-server/dist/`, `frontend/dist/` behind the proxy, an
unapplied migration).
