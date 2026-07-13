<h1 align="center">🧩 Templates</h1>

<p align="center">
  <em>Ready-to-apply scheduled-task templates and the catalog spec behind them.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/templates-37-2ea44f?style=for-the-badge" alt="37 templates">
  <img src="https://img.shields.io/badge/starters-20-8B5CF6?style=for-the-badge" alt="20 script starters">
  <img src="https://img.shields.io/badge/patterns-17-0EA5E9?style=for-the-badge" alt="17 use-case patterns">
</p>

---

TaskHub ships a **two-tier template catalog** (37 templates). Pick a template, fill in its
`{{placeholder}}` parameters in the Apply modal, and TaskHub creates a real scheduled task —
converting the cron to the platform's native trigger for you.

- **Tier A — script starters:** 20 curated starters across PowerShell, Python, Bash/zsh,
  Node, and more.
- **Tier B — use-case patterns:** 17 higher-level patterns for common automation scenarios,
  including the **Developer Pack** (9 dev-workflow templates — git hygiene, npm
  dependency-check/build/test, .NET build, Docker cleanup + compose self-heal — all
  discoverable via the free-form `dev`/`git`/`build`/`test`/`docker` tags) and the
  **AI Pack — Claude Code** (4 templates that run the Claude Code CLI unattended as real
  Windows tasks — headless run, repo digest, auto-fix & commit, log cleanup — tagged
  `ai`/`llm`/`cli`/`agents`/`claude-code`).

## 📄 Documents

| Document | What's inside |
|:---|:---|
| [**Templates.md**](Templates.md) | The full catalog specification — tiers, parameter schema, `{{placeholder}}` handling, and validation rules. |

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧪 Examples**](../examples/README.md) | Sample `GET /templates` and `POST /templates/{id}/apply` payloads. |
| [**🖥️ UI User Guide**](../../user-guides/guides/UI_User_Guide.md) | Applying a template from the dashboard. |

---

<p align="center">
  <a href="../README.md">← Reports</a> ·
  <a href="Templates.md">Catalog spec</a> ·
  <a href="../examples/README.md">Examples</a>
</p>
