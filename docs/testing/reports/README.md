<h1 align="center">📦 Test Reports</h1>

<p align="center">
  <em>Dated QA evidence: what was measured, on which day, and what it found.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/reports-4-8B5CF6?style=for-the-badge" alt="Four reports">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-testing-6B7280?style=for-the-badge" alt="Testing"></a>
</p>

---

Each report is a record of one run and is kept as written. They predate the rename from TaskHub to
Cronsole, which is why the filenames still say `taskhub`. For what is tested today, start at
[Testing](../README.md); a report is the evidence behind a row there, not the current state.

| Report | What it measured |
|:---|:---|
| [**🔐 Security audit**](taskhub_security_audit_2026-07-10.md) | REST auth, validation, CORS and errors; the agent socket's authentication and command path; sync's stale-pruning safety; token storage and XSS-prone patterns in the frontend. |
| [**⏱️ Performance baseline**](taskhub_performance_2026-07-10.md) | A local dev-stack baseline taken after the P1 hygiene and security work. Nothing fails a build when performance drifts past it. |
| [**🔌 Resilience**](taskhub_resilience_2026-07-10.md) | Sync, Run now and template create, looped against a mock agent; offline detection; and pruning when a connector returns a bad partial snapshot. |
| [**🔔 Failure notifications**](taskhub_failure_notifications_2026-07-10.md) | The work log for failure notifications (generic, Discord and ntfy webhooks), with what was verified. |

---

<p align="center">
  <a href="../README.md">← Testing</a> ·
  <a href="../manual-testing/README.md">Manual runbooks</a> ·
  <a href="../regression-testing/README.md">Regression</a>
</p>
