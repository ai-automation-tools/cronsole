<h1 align="center">🛠️ Contributing</h1>

<p align="center">
  <em>Guides for writing code that extends Cronsole, rather than for using it.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/extension_point-connectors-8B5CF6?style=for-the-badge" alt="Extension point: connectors">
  <a href="../../CONTRIBUTING.md"><img src="https://img.shields.io/badge/setup_&_PR_rules-CONTRIBUTING-2ea44f?style=for-the-badge" alt="CONTRIBUTING.md"></a>
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-docs-6B7280?style=for-the-badge" alt="Docs home"></a>
</p>

---

Branch roles, commit format, local setup and the checks CI runs are in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md) at the repo root. This folder holds the longer guidance
for the parts of Cronsole built to be extended.

| Guide | What's inside |
|:---|:---|
| [**🔌 Adding a source**](Adding_A_Source.md) | Make Cronsole read scheduled work from a platform it doesn't support yet. Which of the three shapes it is and how to pick, the contract a connector must meet, the ten files to touch in order, which existing connector to copy, and what gets declined. |

## 🧩 Why there is no plugin folder

Every extension point here is **compiled in**. That is a decision, not an unfinished feature: a
connector holds third-party credentials, issues commands to the user's own machine, and decides what
a sync may retire. Loading that off disk unreviewed would put arbitrary code inside Cronsole's trust
boundary.

So extending Cronsole means opening a pull request. The tradeoff is stated in the app itself rather
than only here — the **Add a custom source** panel on the Sources tab says the same thing before it
sends you to the guide.

What you get back for it: an extension cannot quietly disagree with the interface it implements. The
type checker and the test suite see every connector, so a contract change breaks the build instead of
breaking somebody's install.

> [!TIP]
> Start with a [source proposal issue](../../.github/ISSUE_TEMPLATE/new_source.md). It asks the four
> questions that decide whether a connector is worth building — shape, auth surface, which verbs are
> *cannot* versus *not yet*, and whether the platform reports run outcomes. Five minutes there beats
> discovering the answer four hundred lines in.

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="../../CONTRIBUTING.md">CONTRIBUTING.md</a> ·
  <a href="../user-guides/guides/Sources_Guide.md">Sources Guide →</a>
</p>
