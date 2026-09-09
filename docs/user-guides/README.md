<h1 align="center">🖥️ User Guides</h1>

<p align="center">
  <em>Day-to-day guides for using Cronsole once it's running.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/for-end_users-2ea44f?style=for-the-badge" alt="For end users">
</p>

---

These walk through actually *using* Cronsole — navigating the dashboard and running the
Windows agent. If you haven't set Cronsole up yet, start with
[**⬇️ Installation**](../install/README.md) and [**⚙️ Setup**](../setup/README.md).

## 📚 Guides

| Guide | What it covers |
|:---|:---|
| [**🖥️ UI User Guide**](guides/UI_User_Guide.md) | Navigating the dashboard, task cards and views, renaming and editing tasks, categorization and overrides, applying templates, and the in-app **?** help. |
| [**🧭 Sources Guide**](guides/Sources_Guide.md) | All six sources compared in one place — what Cronsole can and can't do with each, quick links, and how to add a source. Read this when you're choosing between them. |
| [**🔌 Source Guides**](sources/README.md) | One document per source, in depth: connecting it, what each capability actually does, and the failures worth knowing about first. Read these once you've chosen. |
| [**🤖 Windows Agent Setup Guide**](guides/Agent_Setup_Guide.md) | Installing, registering, running, verifying, and troubleshooting the local .NET agent. |
| [**🧩 MCP Server Guide**](guides/MCP_Server_Guide.md) | Wiring the MCP server into Claude / Codex / Cursor to list, run, and create tasks in natural language. |
| [**🌐 Remote Access Guide**](guides/Remote_Access_Guide.md) <sub>· advanced · optional</sub> | Reach your own local Cronsole from your phone or another device — a single-origin reverse proxy behind **Tailscale** (private, no domain needed) or a **Cloudflare Tunnel + Access** (public HTTPS hostname, gated). Tooling ships in the repo; Cronsole stays local-first, and this is opt-in. |

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**💬 Prompt Library**](../prompts/README.md) | What to say once you're driving Cronsole from an assistant — scheduled scripts, headless agent runs, HTTP jobs, audits. |
| [**📄 Templates**](../reports/templates/README.md) | The catalog of ready-to-apply task templates. |
| [**🔧 Auto-start launcher**](../../scripts/startup-task/README.md) | Have the whole stack come up automatically at logon. |
| [**🗺️ Roadmap**](../ROADMAP.md) | What's shipped and what's coming next. |

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="../setup/README.md">Setup</a> ·
  <a href="../reports/templates/README.md">Templates</a>
</p>
