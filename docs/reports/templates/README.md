<h1 align="center">🧩 Templates</h1>

<p align="center">
  <em>Ready-to-apply scheduled-task templates and the catalog spec behind them.</em>
</p>

<p align="center">
  <a href="https://cronsole.mikesailab.com"><img src="https://img.shields.io/badge/catalog-browse_the_gallery-2ea44f?style=for-the-badge" alt="Browse the catalog"></a>
  <img src="https://img.shields.io/badge/tiers-core_+_extended-8B5CF6?style=for-the-badge" alt="Core and extended tiers">
  <img src="https://img.shields.io/badge/schema-Registry_v1-0EA5E9?style=for-the-badge" alt="Registry v1">
</p>

---

Cronsole ships a **two-tier template catalog**. Pick a template, fill in its
`{{placeholder}}` parameters in the Apply modal, and Cronsole creates a real scheduled task —
converting the cron to the platform's native trigger for you.

- **Tier A — script starters:** 20 curated starters across PowerShell, Python, Bash/zsh,
  Node, and more.
- **Tier B — use-case patterns:** 20 higher-level patterns for common automation scenarios,
  including the **Developer Pack** (9 dev-workflow templates — git hygiene, npm
  dependency-check/build/test, .NET build, Docker cleanup + compose self-heal — all
  discoverable via the free-form `dev`/`git`/`build`/`test`/`docker` tags) and the
  **AI CLI packs**: Claude Code (4 templates — headless run, repo digest, auto-fix &
  commit, log cleanup) and Codex (3 templates — headless run, repo digest, auto-fix
  workspace), all real Windows tasks tagged for `ai`/`llm`/`cli`/`agents`.

## 📄 Documents

| Document | What's inside |
|:---|:---|
| [**Templates.md**](Templates.md) | The full catalog specification — tiers, parameter schema, `{{placeholder}}` handling, and validation rules. |

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🧪 Examples**](../examples/README.md) | Sample `GET /templates` and `POST /templates/{id}/apply` payloads. |
| [**🖥️ UI User Guide**](../../user-guides/guides/UI_User_Guide.md) | Applying a template from the dashboard. |
| [**💬 Template prompts**](../../prompts/mcp-server/templates.md) | Finding and applying a template by asking an assistant. |

---

<p align="center">
  <a href="../README.md">← Reports</a> ·
  <a href="Templates.md">Catalog spec</a> ·
  <a href="../examples/README.md">Examples</a>
</p>
