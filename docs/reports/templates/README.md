<h1 align="center">🧩 Templates</h1>

<p align="center">
  <em>Ready-to-apply scheduled-task templates and the catalog spec behind them.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/tiers-2-2ea44f?style=for-the-badge" alt="Two tiers">
  <img src="https://img.shields.io/badge/starters-20-8B5CF6?style=for-the-badge" alt="20 script starters">
</p>

---

TaskHub ships a **two-tier template catalog**. Pick a template, fill in its
`{{placeholder}}` parameters in the Apply modal, and TaskHub creates a real scheduled task —
converting the cron to the platform's native trigger for you.

- **Tier A — script starters:** ~20 curated starters across PowerShell, Python, Bash/zsh,
  Node, and more.
- **Tier B — use-case patterns:** higher-level patterns for common automation scenarios.

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
