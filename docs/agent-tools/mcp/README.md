<h1 align="center">🔌 MCP Servers</h1>

<p align="center">
  <em>Model Context Protocol servers that give the Cronsole build agent live capabilities.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/config-.mcp.json-2ea44f?style=for-the-badge" alt=".mcp.json">
  <img src="https://img.shields.io/badge/servers-7-8B5CF6?style=for-the-badge" alt="7 servers">
</p>

---

These are the MCP servers wired up in [`.mcp.json`](../../../.mcp.json) at the repo root.
They extend Claude Code with abilities it uses while working on Cronsole — fetching current
library docs, opening PRs, driving a browser for E2E checks, and more. Secrets are supplied
via environment variables (never committed).

## 🧩 Configured servers

| Server | What it's for | Required env |
|:---|:---|:---|
| [**context7**](https://github.com/upstash/context7) | Fetch up-to-date docs for React, Prisma, Express, Socket.io, Tailwind, .NET, WiX — used **before** writing code against a library. | — |
| [**github**](https://github.com/github/github-mcp-server) | PR creation and review, issues, and repo operations once the project is on GitHub. | `GITHUB_COPILOT_TOKEN` |
| [**playwright**](https://github.com/microsoft/playwright-mcp) | Browser automation for Phase 4 end-to-end testing of the dashboard. | — |
| [**serper**](https://serper.dev) | Google search for research (competitive landscape, API availability, etc.). | *(server-side key)* |
| [**notion**](https://github.com/suekou/mcp-notion-server) | Optionally mirror phase docs / risk register into a Notion workspace. | `NOTION_API_TOKEN` |
| [**nanobanana**](https://github.com/) | Image generation for marketing / landing-page assets when needed. | `GEMINI_API_KEY` |
| [**elevenlabs**](https://github.com/elevenlabs/elevenlabs-mcp) | Voice generation (rarely used for this project). | `ELEVENLABS_API_KEY` |

> [!TIP]
> Use **context7** before writing any code that touches an external library — your training
> data may lag the library's current API. It's the highest-value server here for Cronsole.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🛠️ Agent Tools home**](../README.md) | MCP servers, CLIs, and subagents overview. |
| [**🤖 CLAUDE.md** (§8)](../../../CLAUDE.md) | The canonical description of each MCP server and when to use it. |

---

<p align="center">
  <a href="../README.md">← Agent Tools</a> ·
  <a href="../clis/README.md">CLIs</a> ·
  <a href="../agents/README.md">Subagents</a>
</p>
