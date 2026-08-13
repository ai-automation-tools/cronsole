<a id="docs-top"></a>

<h1 align="center">📚 Cronsole Documentation</h1>

<p align="center">
  <em>Everything you need to install, configure, use, and extend Cronsole.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/audience-users_&_builders-8B5CF6?style=for-the-badge" alt="Audience">
  <a href="ROADMAP.md"><img src="https://img.shields.io/badge/plan-ROADMAP-2ea44f?style=for-the-badge" alt="Roadmap"></a>
  <a href="../README.md"><img src="https://img.shields.io/badge/↩-repository_root-6B7280?style=for-the-badge" alt="Repo Root"></a>
</p>

---

This is the home for all Cronsole documentation. Every folder below has its own `README.md`
that explains what's inside and links to the individual documents.

## 🧭 Start here

New to Cronsole? Follow this path in order:

1. [**⬇️ Install**](install/README.md) — get the stack running (Windows, macOS, or clone-the-repo).
2. [**⚙️ Configure**](setup/README.md) — environment variables, backend connection, agent pairing.
3. [**🖥️ Use the dashboard**](user-guides/guides/UI_User_Guide.md) — views, categories, templates, Run Now. Per-source detail lives in the [**🧭 Sources Guide**](user-guides/guides/Sources_Guide.md).
4. [**🤖 Run the Windows agent**](user-guides/guides/Agent_Setup_Guide.md) — install, register, verify, troubleshoot.

## 🚀 Guides

| Folder | What's inside |
|:---|:---|
| [**⬇️ install/**](install/README.md) | Install Cronsole — Windows, macOS, and clone-the-repo paths. |
| [**⚙️ setup/**](setup/README.md) | Configure it — environment variables, Docker vs. manual, agent pairing. |
| [**🖥️ user-guides/**](user-guides/README.md) | Use it — dashboard walkthrough, the Windows agent guide, the [MCP server](user-guides/guides/MCP_Server_Guide.md) (drive Cronsole from Claude/Codex/Cursor), and remote access from other devices. |
| [**💬 prompts/**](prompts/README.md) | Talk to it — copy-paste prompts for driving Cronsole in natural language, grouped by what you're doing: [scheduled scripts](prompts/mcp-server/windows-tasks.md), [headless coding-agent runs](prompts/mcp-server/ai-agent-jobs.md), [HTTP and script jobs](prompts/mcp-server/native-tasks.md), [Claude routines](prompts/mcp-server/claude-routines.md), audits, cleanup — plus the `cronsole` skill and the REST API. |
| [**🧯 troubleshooting/**](troubleshooting/README.md) | Fix it — symptom → cause → fix for problems we've actually hit. |
| [**🧪 testing/**](testing/README.md) | Verify it — functional, integration, regression, and UAT: what to test, what covers it today, and how to run it. Includes copy-pasteable [manual runbooks](testing/manual-testing/README.md) for what no suite can prove (real Task Scheduler, agent resilience, security at rest). |

## 🧰 Reference & building blocks

| Folder | What's inside |
|:---|:---|
| [**📄 reports/**](reports/README.md) | Task templates (the two-tier catalog) and worked API examples. |
| [**🧩 Template registry**](reports/templates/Registry_Schema_v1.md) | The target-agnostic Registry v1 JSON schema for templates (the catalog is a decoupled, hosted registry). |
| [**🧠 adr/**](adr/0001-template-registry-schema.md) | Architecture decision records (ADR 0001: the template registry). |
| [**🛠️ agent-tools/**](agent-tools/README.md) | The AI tooling Cronsole is built with — MCP servers, CLIs, and subagents. |
| [**🧠 skills/**](../skills/README.md) | The Cronsole Agent Skill — architecture, invariants, and traps, so an AI agent knows the system before it edits it. |
| [**🌐 resources/**](resources/README.md) | Curated external links — native scheduler UIs and reference repos/sites. |

## 🗺️ Planning

| Doc | What's inside |
|:---|:---|
| [**🗺️ ROADMAP.md**](ROADMAP.md) | The living plan — what's shipped and what's next (P0 → P3), plus open decisions. |

> [!NOTE]
> Engineering specs, research, and the historical phase plans are kept locally under
> `docs/archive/` and are **not tracked in git**.

## 📂 Related

| Location | What's inside |
|:---|:---|
| [**📝 CHANGELOG.md**](CHANGELOG.md) | Notable changes to the repository. |
| [**🔧 scripts/**](../scripts/README.md) | Operational scripts — including the logon auto-start launcher. |
| [**📋 CONTRIBUTING.md**](../CONTRIBUTING.md) | Local setup, validation commands, and PR expectations. |
| [**🤖 CLAUDE.md**](../CLAUDE.md) | Project conventions and instructions for Claude Code. |

<p align="right">(<a href="#docs-top">back to top</a>)</p>

---

<p align="center">
  <a href="../README.md">Repository Root</a> ·
  <a href="ROADMAP.md">Roadmap</a> ·
  <a href="install/README.md">Install</a> ·
  <a href="user-guides/README.md">User Guides</a> ·
  <a href="prompts/README.md">Prompts</a> ·
  <a href="testing/README.md">Testing</a> ·
  <a href="troubleshooting/README.md">Troubleshooting</a>
</p>
