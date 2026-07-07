# Phase 4: Testing & QA

**Duration:** 2–3 weeks
**Status:** Active (Unit Testing & Template Conversions Complete; Integration & E2E Active)
**Master plan:** [`Project_Plan.md`](../Project_Plan.md)
**Predecessor:** [`Phase3.md`](Phase3.md)
**Informed by:** [`Business_Idea_Assessment.md`](Business_Idea_Assessment.md)

---

## Goal

Validate that the MVP meets every functional and non-functional requirement from [`Phase1.md`](Phase1.md), with particular focus on the agent's reliability under flaky-network conditions and the security of credential storage.

> **QA priority (per the assessment).** Reliability is the product, so the headline gates are the new reliability KPIs: **> 95% sync reliability** (NFR9), **connect 2 systems in < 15 min** (NFR10), failure alerting actually fires, and **conversion confidence scores are honest** (no silent lossy applies). These are release blockers, not nice-to-haves.

---

## Deliverables

- [x] [Test Plan](Test_Plan.md) covering unit, integration, E2E, and cross-platform scenarios.
- Security audit report (API keys, token storage, agent auth, encryption).
- Performance report (sync latency, mobile response times, agent resource usage).
- Beta-tester feedback summary (10–20 users).

---

## Test Strategy

### Unit (target ≥ 80% on business logic)

- **Backend** (`vitest`):
  - `scheduleConverter.ts` — every conversion direction, including DST edge cases.
  - `encryption.ts` — round-trip, tampered ciphertext, key rotation.
  - `connectors/registry.ts` — registration, lookup, missing connector errors.
- **Frontend** (`vitest` + `@testing-library/react`):
  - Hooks: `useTasks`, `useRunTask`, `useTheme`.
  - Components: `TaskRow`, `TaskDetailModal`, `PlatformStatusBar`.
- **Agent** (`xUnit`):
  - `TaskSchedulerWrapper` against a mock COM layer.
  - `WebSocketClient` reconnection backoff.

### Integration

- Spin up Postgres + backend via Docker Compose; run against real DB.
- WebSocket happy-path: agent connects → server requests list → agent replies → server stores.
- Run-trigger flow: backend → agent → COM execute → reply → log row written.
- Failure modes: agent disconnect mid-run, COM exception, HMAC mismatch, replay attempt.

### End-to-End (Playwright)

- **E2E.1** — Register → login → connect Claude → see routines.
- **E2E.2** — Pair Windows agent (mock or VM) → see tasks → click Run → see success toast within 5s.
- **E2E.3** — Apply "Daily backup" template → new task appears in Windows Task Scheduler.
- **E2E.4** — Mobile viewport (Pixel 7): full flow including run-from-phone.
- **E2E.5** — Agent offline banner appears within 60s of agent kill.
- **E2E.6** — Enable/disable a task → confirmation dialog → normalized status flips within 5s.
- **E2E.7** — Trigger a task that fails → in-app failure alert + execution-timeline entry with reason.
- **E2E.8** — Connector health diagnostics: revoke a Claude key → platform card shows "key invalid" reason, not just "disconnected".
- **E2E.9** — Onboarding stopwatch: fresh account connects Windows agent + Claude in < 15 min (NFR10).

### Network & Resilience

- Simulate agent network blips with `tc qdisc` (Linux) or Clumsy (Windows).
- Disconnect Postgres mid-request → backend returns 503, not 500.
- Kill backend pod mid-WebSocket → agent reconnects within 30s. *(✅ Validated in the wild 2026-07-07: a backend restart exposed exactly this failure — SocketIOClient gives up after 10 attempts — fixed with a 30s reconnect watchdog in the agent; re-test passed live.)*
- 24-hour soak test: 1 agent + 50 fake tasks, count reconnect events, target ≤ 3.

### Security Audit

Run the `security-review` skill, then manually verify:

- All `PlatformConnection.config` values encrypted at rest (inspect DB).
- JWT signature uses ≥ 256-bit secret from env, not a literal.
- Agent pairing secrets single-use; subsequent reuse rejected.
- HMAC replay protection: replaying a captured `task:run` envelope fails.
- TLS 1.3 only; HSTS header set.
- Rate limit on `/auth/login`: ≥ 5 attempts/min trips a 429.
- `helmet` middleware enabled.
- No secrets in logs (grep build artifacts).

### Performance

- **NFR1** Dashboard initial load < 2s on 3G Fast: measured via Lighthouse.
- **NFR2** Manual trigger latency phone → Windows < 3s on LAN.
- **NFR3** 100 concurrent users (k6 script): p95 `/tasks` < 500ms.
- **NFR4** Agent idle CPU < 0.5%: 1-hour Process Explorer sample.
- **NFR5** Agent RSS < 50MB: same sample.
- **NFR9** Sync reliability > 95%: 24h two-connector sample; count (tasks reflecting true platform state) / (total syncs). **Release blocker if missed.**
- **NFR10** Connect 2 systems < 15 min: timed fresh-account onboarding runs (median of ≥ 5 testers).

### Cross-Browser / Cross-Device

- Chrome 120+, Safari 17+, Firefox 120+, Edge.
- iPhone 13 / Pixel 7 / iPad Air (latest OS).
- Tab-killing test: switch tabs for 10 min, return — UI is still live and synced.

---

## Conversion Template Validation

Build a harness that asserts round-trip equivalence for every shipped template:

```
template → cron → Windows trigger → cron → assert equal
template → cron → Claude routine → assert equal
```

Any divergence is a release blocker unless it carries an explicit warning string in the conversion output.

**Confidence-score honesty check.** For every shipped template assert that:
- A lossless round-trip reports `confidence == 1.0`.
- Any conversion that diverges reports `confidence < 1.0` **and** at least one warning.
- A deliberately lossy conversion (`confidence < 0.7`) is gated behind the explicit acknowledgement and is never applied silently.

A confidence score that overstates fidelity (high score on a lossy conversion) is itself a release blocker — it defeats the trust mitigation for the semantic-mismatch risk.

---

## Beta Program

- **Scope:** 10–20 users from automation forums + Mike's network.
- **Duration:** 2 weeks overlapping with this phase's final sprint.
- **Telemetry:** opt-in anonymous error reporting via Sentry-style endpoint; no PII.
- **Feedback channel:** GitHub issues + in-app feedback widget.

### KPI Checks (from Phase 0)

- [ ] User connects 2 systems in < 15 min (median).
- [ ] Median time to first task trigger from phone < 30s.
- [ ] **Sync reliability > 95%** across connected tasks (raised from the original 90% "appear correctly" bar).
- [ ] Clear execution logs present for every run/trigger action (no silent runs).
- [ ] Conversion-template user-rated success ≥ 85%; confidence scores rated trustworthy.
- [ ] Agent crash rate < 2% over 7-day rolling window.

---

## Tools

- **`senior-qa`** skill — test strategy and authoring.
- **`security-review`** skill — full audit pass.
- **`web-performance-optimization`** skill — Lighthouse + bundle work.
- **`playwright`** MCP — E2E.
- **`code-reviewer`** skill — gate every fix PR.

---

## Phase 4 Exit Criteria

- [ ] All NFR targets met or have a documented waiver.
- [ ] Zero P0/P1 bugs open.
- [ ] Security audit issues triaged; all critical/high resolved.
- [ ] Beta feedback synthesized into Phase 5 release notes + backlog.
- [ ] Performance report and security report committed under `docs/reports/`.

→ Advance to **[Phase 5: Deployment & Rollout](Phase5.md)**.
