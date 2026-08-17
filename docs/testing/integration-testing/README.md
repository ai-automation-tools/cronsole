<a id="integration-top"></a>

<h1 align="center">🔗 Integration Testing</h1>

<p align="center">
  <em>Do the seams hold? Every component in Cronsole is fine alone — the bugs live between them.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/asks-do_the_seams_hold%3F-0EA5E9?style=for-the-badge" alt="Asks">
  <img src="https://img.shields.io/badge/needs-real_Postgres-336791?style=for-the-badge" alt="Needs">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-testing_home-6B7280?style=for-the-badge" alt="Testing Home"></a>
</p>

---

Cronsole is four processes talking to each other — **React frontend**, **Express backend**,
**PostgreSQL**, and a **.NET agent** on the user's own machine — plus outbound calls to the
hosted registry, webhooks, and platform APIs. Integration tests exercise those boundaries
**with the real thing on the other side**, because mocks agree with your assumptions and
production doesn't.

**The rule:** if a bug could only be found by two components disagreeing, it belongs here.

```
┌─ Frontend ──┐  REST/JWT + Socket.io   ┌─ Backend ──┐   Prisma    ┌──────────┐
│  React 19   │ ──────────────────────► │  Express   │ ──────────► │ Postgres │
└─────────────┘                         └────────────┘             └──────────┘
                                          ▲       │  HTTP (sha256-verified)
                       WS + HMAC (agent   │       └──────────────► Registry / Webhooks
                       always dials out)  │
                                    ┌─────┴──────┐   COM    ┌──────────────────┐
                                    │ .NET Agent │ ───────► │ Win Task Sched.  │
                                    └────────────┘          └──────────────────┘
```

**Legend:** ✅ automated today · 🟡 partial · ⬜ gap / manual only

> [!TIP]
> **The agent ↔ Windows seam (I4.x) is the one nothing automates well** — every automated test
> of it uses a mock agent, which proves the protocol, not the platform. The
> [Windows Task Lifecycle](../manual-testing/runbooks/Windows_Task_Lifecycle.md) runbook is
> the real check. [Agent Resilience](../manual-testing/runbooks/Agent_Resilience.md) covers
> I3.4–I3.7, and [Security Checks](../manual-testing/runbooks/Security_Checks.md) covers
> I2.2 / I2.4 / I6.3 against the running system.

## 🗄️ Backend ↔ PostgreSQL

Run against a **real** `postgres:16-alpine` — never an in-memory stand-in. Prisma's behavior
against real SQL is the entire point.

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| I1.1 | **CRUD round-trip** | Every model writes and reads back intact through Prisma | ✅ `data-flow.integration.test.ts` |
| I1.2 | **Encryption at rest** | Inspect the actual `PlatformConnection` row: config is **ciphertext**, and decrypts back to the original | ✅ `encryption-at-rest.integration.test.ts` |
| I1.3 | **Unique constraints** | `(platform, externalId)` uniqueness is enforced **by the DB**, not just app logic | 🟡 |
| I1.4 | **Transactional writes** | Multi-step writes roll back fully on failure — no half-applied task | 🟡 |
| I1.5 | **Batch upsert** | `TaskService.upsertTasks` batching handles large scans without N+1 or partial state | ✅ `data-flow.integration.test.ts` |
| I1.6 | **Migrations** | `prisma migrate` applies cleanly to an empty DB **and** to a populated one | 🟡 `globalSetup.ts` migrates the test DB |
| I1.7 | **Index coverage** | Every `WHERE` / `JOIN` / `ORDER BY` column is indexed (per CLAUDE.md) | ⬜ |

## 🔐 API ↔ Auth ↔ Tenancy

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| I2.1 | **Full auth flow** | First-run setup → login → authed request, end to end over HTTP. **There is no refresh or rotation step** — one 24h token, and the second `/auth/setup` returns 409. `POST /auth/register` is gone; a test pins its 404 | ✅ `auth.integration.test.ts` *(read "→ refresh → rotate" until 2026-07-31, describing a flow that has never existed)* |
| I2.2 | **Route scoping / IDOR** | User A gets **404/403**, never User B's data — on every route, including ones added later | ✅ `idor.integration.test.ts` |
| I2.3 | **Token rejection** | Expired, malformed, and wrong-secret tokens are refused | ✅ `auth.integration.test.ts` |
| I2.4 | **Middleware order** | Auth runs before handlers — no route accidentally left open | ⬜ |

> [!TIP]
> **I2.2 is the highest-value integration test in the repo.** Every new route is a new chance
> to leak across tenants. When you add a route, add it to the IDOR sweep in the same PR.

## 🔌 Backend ↔ Agent (WebSocket)

The agent **always dials out** — the server never connects in. Envelope is
`{ type, payload }` with `noun:verb` types.

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| I3.1 | **Pairing handshake** | `agent:hello` with a valid pairing-derived token registers; a bad one is rejected | ✅ `agentAuth.test.ts` |
| I3.2 | **HMAC command signing** | Signed run commands accepted; **unsigned, expired, or replayed** signatures rejected `401` | ✅ `agentAuth.test.ts` |
| I3.3 | **Sync state machine** | Sync Now → server `task:scan` → agent `agent:tasks:list` → DB update → `tasks:updated` pushed to the frontend. The **whole chain**, in order | ✅ E2E `mock-agent.spec.ts` |
| I3.4 | **Socket registry** | `AgentManager` maps sockets correctly; a transient second agent doesn't strand the real one ([troubleshooting #5](../../troubleshooting/README.md#5-windows-offline-after-running-a-transient-test-agent)) | 🟡 `AgentManager.test.ts` |
| I3.5 | **Heartbeat & reconnect** | 30s ping; exponential backoff 1s → 5min cap on drop | 🟡 |
| I3.6 | **Command timeout** | An agent with no handler for a command times out to a clean **502**, not a hang ([troubleshooting #7](../../troubleshooting/README.md#7-new-agent-command-502-times-out-until-the-agent-is-republished)) | ⬜ |
| I3.7 | **Version skew** | Backend and agent deployed at different versions fail **loudly**, not silently | ⬜ |

## 🪟 Agent ↔ Windows Task Scheduler

The only seam that touches real COM. Windows-only, and the hardest to fake.

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| I4.1 | **Real task create** | A created task appears in Task Scheduler with the right trigger and action | 🟡 E2E `mock-agent.spec.ts` (mock agent) · ⬜ real COM |
| I4.1b | **Action & settings edit** | Editing a Windows task's command/settings applies to the real entry | ✅ `task-actions.integration.test.ts` |
| I4.2 | **Real task delete** | Entry actually disappears; the empty `\Cronsole\` folder auto-prunes on last delete | 🟡 |
| I4.3 | **Elevation refusal** | An admin-ACL'd task returns an honest "needs elevation" — never a false success | 🟡 |
| I4.4 | **XML export fidelity** | Exported XML is valid Task Scheduler XML, **UTF-16 LE + BOM**, and re-importable into Windows | ✅ `task-export.integration.test.ts` |
| I4.4a | **XML restore fidelity** | A restored task round-trips: action, trigger, description **and principal** (run-as account, logon type, run level) match what was exported — `TaskLogonType.None` must not silently re-register the task as somebody else | ✅ live pass 2026-07-28 (verified with `Get-ScheduledTask`, not Cronsole's own report) · ⬜ automated — `ImportTaskXml` talks to COM |
| I4.4b | **Restore's write guards hold against real Task Scheduler** | Overwrite off leaves an existing task's **registration date unchanged**; overwrite on replaces it; a real `\Microsoft\Windows\Defrag\` export is refused and Defrag is untouched | ✅ live pass 2026-07-28 |
| I4.4e | **The portable export round-trips through the template routes** | `GET /api/tasks/:id/export?format=template` → `POST /api/templates/import` is accepted verbatim, landing as `managed: false`. **The third round trip, and the only cross-platform one** — I4.4 covers Windows XML, I4.4d covers Cronsole JSON, and both are same-platform by construction. Without this the two ends could drift into separate dialects of Registry v1 while every unit suite stayed green | ✅ `task-export.integration.test.ts` |
| I4.4d | **Cronsole JSON round-trips through its own routes** | `GET /api/tasks/:id/export` → `POST /api/tasks/import` reproduces the task (name, category, schedule, job spec), and `DELETE /api/tasks/:id` → `POST /api/tools/task-archives/:id/restore` brings a deleted one back. **The counterpart of I4.4 for the other half of the export format** — that row has covered Windows XML since it shipped, while the JSON side had no reader at all until 2026-08-17 ([#65](../../troubleshooting/README.md#65-an-exported-task-file-has-nowhere-to-go--and-restore-refuses-it)) | ✅ live pass 2026-08-17 (create → export → import → UI delete → restore, plus the Windows / catalog / version refusals) · ⬜ automated |
| I4.4c | **A restored task is admin-owned** | Because the agent is elevated, the restored task and any folder it creates carry an administrator ACE — an unelevated `Unregister-ScheduledTask` / `DeleteFolder` gets `Access is denied` ([troubleshooting #28](../../troubleshooting/README.md#28-a-restored-task-or-the-folder-it-landed-in-cant-be-deleted-access-is-denied)) | ✅ observed live 2026-07-28 — documented behavior, not a defect |
| I4.4d | **Windows reports its own run results** | After an agent republish, every synced Windows task carries `lastTaskResult` + `numberOfMissedRuns` in metadata, and an **absent** key (old agent) stays distinguishable from a null one | ✅ live pass 2026-07-28 (354/354 tasks reporting) · ✅ `taskHealth.test.ts` for the absent/null distinction |
| I4.5 | **Argument quoting** | Args with spaces/quotes survive the trip without a shell injecting itself | ✅ `ArgumentQuotingTests.cs` |
| I4.6 | **No console flash** | Scheduled runs don't pop a PowerShell window (the `run-hidden.vbs` path) | ⬜ Manual |

## 🌐 Backend ↔ Registry & outbound

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| I5.1 | **Registry fetch** | `RegistryCatalogSource` pulls `index.json` + `templates/*.json` from the hosted registry | ✅ `registry.test.ts` |
| I5.2 | **Integrity check** | Per-file **sha256** mismatch is rejected — a tampered registry never loads | ✅ `registry.test.ts` |
| I5.3 | **Bundled fallback** | Registry unreachable → falls back to the compiled-in catalog, app still boots | ✅ `registry.test.ts` |
| I5.4 | **Catalog sync** | `catalogSync` upserts on boot + interval; **favorites and applied tasks are untouched** | ✅ `catalogSync.test.ts` |
| I5.5 | **Prune-on-sync** | Managed rows outside core are deleted; `managed: false` (imported / saved-as-template) rows **never** pruned; empty core can't wipe the catalog | ✅ `catalogSync.test.ts` |
| I5.6 | **Webhook delivery** | Generic / Discord / ntfy webhooks fire with the right shape; a dead endpoint doesn't take the run down | 🟡 `FailureNotificationService.test.ts` |
| I5.7 | **Claude connector** | Real API contract for the routines connector | 🟡 `ClaudeConnector.test.ts` (mocked) |

## 🧩 Frontend ↔ Backend · MCP ↔ REST · Stack

| # | Test type | What it must prove | Status |
|:--|:---|:---|:--|
| I6.1 | **Live query invalidation** | A `task:updated` socket event invalidates TanStack Query and the UI repaints | ✅ E2E `smoke.spec.ts` |
| I6.2 | **API client contract** | Frontend request/response shapes match what the backend actually returns | ✅ `api.test.ts` |
| I6.3 | **CORS / origins** | `ALLOWED_ORIGINS` admits the dev frontend and refuses others — for the **REST API and** the socket, from one definition | ✅ `src/config/__tests__/origins.test.ts` (asserts response *headers*, not status codes) + manual [Security Checks §10](../manual-testing/runbooks/Security_Checks.md) |
| I6.4 | **MCP → REST** | Every MCP tool drives the real API under `CRONSOLE_TOKEN`. **The count is deliberately not written here** — it said `15` while the surface was `33`, which is a number nobody re-reads pretending to be a check. Get it from `grep -c 'server.registerTool' mcp-server/src/tools.ts` and work the [MCP Tools runbook](../manual-testing/runbooks/MCP_Tools.md), which enumerates by name | ⬜ Manual — the standing gap: `mcp-server`'s own suite stubs the HTTP client, so it can prove what the wrapper does, never that the wrapper and the API still *agree* |
| I6.5 | **Docker Compose stack** | `docker compose up` yields a working stack from a clean checkout, secrets aligned ([troubleshooting #2](../../troubleshooting/README.md#2-403-invalid-or-expired-token-or-agent-rejected)) | ⬜ Manual |

## 🏃 Running these

```bash
# Backend integration — needs a real Postgres
cd backend
export TEST_DATABASE_URL="postgresql://taskhub:password@localhost:5432/taskhub_test"
npm run test:integration
```

`test/integration/globalSetup.ts` creates and migrates `taskhub_test` on that server;
`setupEach.ts` gives each test a clean slate. CI does the same against a
`postgres:16-alpine` service container.

The **full-stack** seams (I3.3, I6.1) live in the Playwright E2E suite instead — it needs a
live backend, frontend, and mock agent, so it runs locally, not in CI:

```bash
cd frontend && npm run test:e2e
```

## ✍️ Adding an integration test

1. **Name the two sides.** "Backend ↔ Postgres," not "test the service." If you can't name two, it's a [functional test](../functional-testing/README.md).
2. **Use the real dependency.** A mocked Postgres proves nothing about Prisma; a mocked agent proves nothing about COM.
3. **Assert the observable end state**, not the intermediate calls — check the DB row, not that a function got called.
4. **Every troubleshooting entry is a candidate.** Entries [#2](../../troubleshooting/README.md), [#5](../../troubleshooting/README.md), and [#7](../../troubleshooting/README.md) are all seam failures that shipped. Encode the ones you can.

<p align="right">(<a href="#integration-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">← Testing Home</a> ·
  <a href="../functional-testing/README.md">Functional</a> ·
  <a href="../regression-testing/README.md">Regression</a> ·
  <a href="../uat/README.md">UAT</a>
</p>
