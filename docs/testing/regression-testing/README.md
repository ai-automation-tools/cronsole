<a id="regression-top"></a>

<h1 align="center">🛡️ Regression Testing</h1>

<p align="center">
  <em>Did we break something that used to work? The suite that earns the right to refactor.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/asks-did_we_break_it%3F-EF4444?style=for-the-badge" alt="Asks">
  <img src="https://img.shields.io/badge/runs-every_PR-2ea44f?style=for-the-badge" alt="Runs">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-testing_home-6B7280?style=for-the-badge" alt="Testing Home"></a>
</p>

---

Regression testing isn't a separate suite you go write — it's **what every other test becomes
the day after it's written**. A functional test proves a feature works. That same test, pinned
in CI forever, is the promise it keeps working.

The point is **freedom to change things**. Cronsole has a decoupled registry, an agent
protocol, and a security posture that all need to keep evolving. The regression suite is what
makes that safe.

**Legend:** ✅ automated in CI · 🟡 automated, not gated · ⬜ gap / manual only

## 🔁 The regression baseline

Everything that runs on every PR. This *is* the safety net — the whole list is the gate.

| # | Test type | What it protects | Status |
|:--|:---|:---|:--|
| R1.1 | **Backend unit sweep** | Services, connectors, auth, catalog, utils — the business logic | ✅ `backend` job |
| R1.2 | **Backend integration sweep** | Every seam against real Postgres | ✅ `backend-integration` job |
| R1.3 | **Frontend unit sweep** | Components, hooks, utils | ✅ `frontend` job |
| R1.4 | **Lint** | Style and correctness rules holding across the codebase | ✅ `frontend` job |
| R1.5 | **Type check / build** | `tsc` strict mode passing — no `any` creep | ✅ `backend` + `frontend` jobs |
| R1.6 | **Agent unit sweep** | Trigger building/reading, quoting, config, auth | ✅ `windows-agent` job |
| R1.7 | **MCP build** | The wrapper still compiles against the SDK | ✅ `mcp-server` job |
| R1.8 | **E2E sweep** | Full-stack flows: sync, run, apply, offline — **plus layout + visual regression at 1280px and 375px** (`layout.spec.ts`, 23 of the suite's 32 tests). **It is the only layer that renders CSS**: jsdom does not evaluate media queries, so no unit test can see a responsive layout | ⬜ **Not in CI** — run locally, and it **silently rotted for a day** on 2026-08-16 because of exactly that ([#61](../../troubleshooting/README.md#61-the-whole-e2e-suite-fails-and-every-other-suite-is-green)) |

## 🧬 Invariant guards

These aren't feature tests — they're **tripwires on rules that must never break**. They're the
highest-leverage regression tests in the repo because each one encodes a decision that's easy
to violate accidentally.

| # | Test type | The invariant | Status |
|:--|:---|:---|:--|
| R2.1 | **Registry drift** | `registry/` is byte-identical to what `bundled.ts` generates. Registry files are **content-addressed** — hand-editing or a CRLF flip breaks integrity | ✅ `registry.test.ts` |
| R2.2 | **Whole-catalog resolvability** | **Every** bundled `commandTemplate` survives the Apply pipeline. Adding a broken template fails CI | ✅ `test-templates.test.ts` |
| R2.3 | **Cron round-trip** | `cron → Windows → cron` is lossless | ✅ `test-templates.test.ts` |
| R2.4 | **Core/extended split** | The core count is what we intend (**5 core + 50 extended = 55**). A stray `core: true` silently bloats every fresh install | ✅ `catalogSync.test.ts` |
| R2.5 | **Prune safety** | `managed: false` rows are **never** pruned; an empty core **cannot** wipe the catalog | ✅ `catalogSync.test.ts` |
| R2.6 | **No DB field leakage** | `normalize.ts` whitelists Prisma fields — `core` must never reach the DB | ✅ `catalogSync.test.ts` |
| R2.7 | **LF line endings** | `.gitattributes` holds; registry hashes stay stable across machines | ⬜ |
| R2.8 | **Platform capability reachability** | The Platforms matrix says what the **route** would do, not what the connector object happens to implement. Pinned two ways: connector-derived verbs must agree with the connector, and Cronsole-native's three **route-level** carve-outs (reschedule / export / delete) are checked against the route source — delete that branch and the test fails, rather than the tab quietly promising something the API now 400s | ✅ `platformCapabilities.test.ts` |
| R2.9 | **A capability is never claimed without evidence** | `capabilitySupport` is `unsupported` when the route would refuse *regardless of a stale success*, `declared` when reachable but unobserved, `verified` only with a real timestamp behind it. Absence of evidence may never read as `ok` | ✅ `platformCapabilities.test.ts` |
| R2.10 | **A status line does not go quiet when things break** | `newestOutcome` takes the newest *event*, success **or** failure — a failure newer than the success on the same verb must surface as a failure | ✅ `usePlatformMatrix.test.ts` |

## 🔒 Security regression

P0 hardening is **complete**. These tests exist so it stays complete — a security fix without
a regression test is a fix with an expiry date.

| # | Test type | What must never come back | Status |
|:--|:---|:---|:--|
| R3.1 | **No implicit shell** | Structured `exec` stays `{executable, args[]}`. A shell is opted into explicitly, never implicit — **no `cmd.exe /c` creep** | ✅ `commandParser.test.ts` |
| R3.2 | **Injection resistance** | Hostile args (spaces, quotes, `&&`, `;`) can't escape into a shell | ✅ `ArgumentQuotingTests.cs` |
| R3.3 | **Agent WS auth** | Unauthenticated sockets rejected | ✅ `agentAuth.test.ts` |
| R3.4 | **Replay rejection** | Expired/duplicate HMAC envelopes rejected | ✅ `agentAuth.test.ts` |
| R3.5 | **Encryption at rest** | Config never lands in the DB as plaintext | ✅ `encryption-at-rest.integration.test.ts` |
| R3.6 | **Tenant isolation** | Cross-user access stays impossible as routes are added | ✅ `idor.integration.test.ts` |
| R3.6a | **Login rate limit** | Credential-guessing surfaces stay limited. Per-IP, **10 / 15 min**, on `/auth/login` **and** `/auth/setup` | ✅ `authLimiter.test.ts` |
| R3.7 | **Dependency audit** | Production `npm audit` stays at **0**, in **all three** packages — `backend/`, `frontend/`, `mcp-server/`. Checking only one is how it drifted: on 2026-07-31 backend and mcp-server were clean while frontend carried 2 high (`react-router` [GHSA-qwww-vcr4-c8h2](https://github.com/advisories/GHSA-qwww-vcr4-c8h2)) | ⬜ Not gated — run `npm audit --omit=dev` in each; see [`artifacts/taskhub_security_audit_2026-07-10.md`](../../../artifacts/taskhub_security_audit_2026-07-10.md) |
| R3.8 | **Secret scanning** | No `.env` values or keys committed | ⬜ |

## 🐛 Bug-fix regression

> [!IMPORTANT]
> **Every entry in [troubleshooting/](../../troubleshooting/README.md) is a bug that escaped to
> a human.** That file is the best-quality backlog of regression tests in the repo, because
> each entry is a *proven* failure, not a hypothetical one.

| # | Test type | What it means |
|:--|:---|:---|
| R4.1 | **Fix ships with a test** | Every bug fix adds a test that **fails before** the fix and passes after. No test, no merge |
| R4.2 | **Reproduce first** | Write the failing test before the fix, so you know it actually catches the bug |
| R4.3 | **Test the cause, not the symptom** | Troubleshooting #6 (em-dash in `.ps1`) is really "scripts must be pure ASCII" — guard *that* |
| R4.4 | **Backfill escaped bugs** | Anything that reached a user is a permanent test, not a one-off patch |

Candidates sitting in troubleshooting right now: **#5** (transient agent stranding the real
one), **#6** (non-ASCII in PowerShell scripts), **#7** (agent command with no handler).

## 📉 Non-functional regression

| # | Test type | What it protects | Status |
|:--|:---|:---|:--|
| R5.1 | **Performance budget** | Dashboard load **< 2s** (NFR1). A baseline exists; nothing fails when we drift past it | ⬜ See [`artifacts/taskhub_performance_2026-07-10.md`](../../../artifacts/taskhub_performance_2026-07-10.md) |
| R5.2 | **Bundle size** | Frontend bundle doesn't creep | ⬜ |
| R5.3 | **Resilience / soak** | Reconnect behavior + stale-pruning guard hold under network blips | 🟡 See [`artifacts/taskhub_resilience_2026-07-10.md`](../../../artifacts/taskhub_resilience_2026-07-10.md) |
| R5.4 | **Visual regression** | Layout and spacing on the dense surfaces don't break silently. **Chrome only** — Platforms, Import and the task-detail modal are asserted structurally, since masking hides colour but not geometry. **Theme pairs are still uncovered** | 🟡 `layout.spec.ts`, local (E2E is not in CI) |
| R5.5 | **Mobile layout** | Stays usable at 375px: no horizontal overflow, one-row views bar, sticky toolbar survives a long scroll, 44px FAB — **and, since the 2026-08-15 IA redesign**, the rail's drawer opening/closing, five toolbar sections on one row, the native job types as two rows of two, and collections reachable | ✅ `layout.spec.ts` — the resize finally *applies* (`page.setViewportSize`); a real device check (touch, iOS Safari) is still open |
| R5.8 | **A build cannot silently break remote access** | Every production build resolves the API against `window.location`; only the dev server defaults to `localhost:3000`. This is a regression row rather than a functional one because the bug it guards **shipped twice** and is invisible from the machine running the stack — there `localhost:3000` really is the backend, so the broken bundle is indistinguishable from the correct one ([#63](../../troubleshooting/README.md#63-the-proxied-dashboard-loads-on-the-phone-but-cannot-reach-the-backend)) | ✅ `apiSameOrigin.test.ts` — asserts **both** halves of the fold, build half **mutation-tested** |
| R5.6 | **Migration safety** | A migration applies cleanly to a **populated** DB, not just an empty one | ⬜ |
| R5.7 | **Dependency upgrade** | Full sweep after any dep bump — the suite is the upgrade gate | 🟡 |

## 🏃 Running the regression sweep

```bash
# What CI runs (minus E2E)
cd backend  && npm test && npm run test:integration && npm run build
cd ../frontend && npm run lint && npm test && npm run build
cd ../agent  && dotnet test

# The part CI can't: needs a live stack
cd ../frontend && npm run test:e2e
```

**Before any release**, run the E2E suite too. It's the only automated coverage of the
full-stack flows, and it's the one nothing forces you to run.

Then work the **manual** rows — the ⬜ entries above have step-by-step procedures in
[manual-testing/](../manual-testing/README.md):
[Security Checks](../manual-testing/runbooks/Security_Checks.md) covers R3.5–R3.8 (including
the `npm audit` and secret-scanning steps), and
[Agent Resilience](../manual-testing/runbooks/Agent_Resilience.md) covers R5.3.

## ✍️ Keeping the suite honest

1. **A green suite is a claim.** If CI passes while a shipped feature is broken, the suite is lying — fix the suite, not just the feature.
2. **Never delete a failing test to go green.** Either the test is wrong (fix it) or the code is (fix that). Deleting it converts a known bug into an unknown one.
3. **Prefer invariant guards over example tests.** R2.2 covers all 55 templates forever; a test for one template covers one.
4. **Watch for the stale-process trap.** Per [troubleshooting #4](../../troubleshooting/README.md#4-backend-source-edits-not-picked-up-in-docker) and [#7](../../troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished): if offline suites pass but a live check disagrees, the running process is stale — restart the backend and republish the agent **before** you debug the code.

<p align="right">(<a href="#regression-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">← Testing Home</a> ·
  <a href="../functional-testing/README.md">Functional</a> ·
  <a href="../integration-testing/README.md">Integration</a> ·
  <a href="../uat/README.md">UAT</a>
</p>
