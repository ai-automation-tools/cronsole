<h1 align="center">🧠 Architecture Decision Records</h1>

<p align="center">
  <em>The decisions that were hard enough to be worth writing down, and what they cost.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/records-3-8B5CF6?style=for-the-badge" alt="3 records">
  <img src="https://img.shields.io/badge/all-accepted-2ea44f?style=for-the-badge" alt="All accepted">
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-docs-6B7280?style=for-the-badge" alt="Docs home"></a>
</p>

---

An ADR captures one decision at the moment it was made — the options that were live, the one that
won, and what it rules out later. Each is dated and kept even after it ships, because the useful part
is the reasoning, not the outcome.

| Record | Decision | Status |
|:---|:---|:---|
| [**ADR 0001 — Template registry**](0001-template-registry-schema.md) | Templates are target-agnostic JSON compiled at apply time, served from a registry decoupled from the app. Freezes the registry base URL, which is why there is no second move. | Accepted · 2026-07-13 |
| [**ADR 0002 — Native job types**](0002-native-job-types.md) | Four types, not a growing list: HTTP, Programs, Scripts and Checks. The bar for a fifth is "a different *kind* of thing", not "useful". | Shipped · 2026-08-15 |
| [**ADR 0003 — Per-job secrets**](0003-per-job-secrets.md) | A job stores a *reference* to a credential, never the credential. `TaskSecret` is a relation rather than a column, so a secret cannot ride into an export or an archive. | Shipped · 2026-08-21 |

> [!NOTE]
> ADRs record a decision, not the current state of the code. When one disagrees with the repo, the
> repo wins and the ADR stays as it was — that is the whole point of dating them. The living rules
> are in [`CLAUDE.md`](../../CLAUDE.md) §9, with the longer arguments in
> [`DESIGN_NOTES.md`](../DESIGN_NOTES.md).

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="../DESIGN_NOTES.md">Design notes</a> ·
  <a href="../ROADMAP.md">Roadmap →</a>
</p>
