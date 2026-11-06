<h1 align="center">🔌 MCP Servers</h1>

<p align="center">
  <em>Model Context Protocol servers that give the Cronsole build agent live capabilities.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/config-.mcp.json-2ea44f?style=for-the-badge" alt=".mcp.json">
  <img src="https://img.shields.io/badge/servers-7-8B5CF6?style=for-the-badge" alt="7 servers">
</p>

---

These are the MCP servers seeded by [`.mcp.json.example`](../../../.mcp.json.example), which you copy to the
gitignored `.mcp.json` at the repo root. The example file is the source of truth; this table explains it.
They extend Claude Code with abilities it uses while working on Cronsole — fetching current
library docs, opening PRs, driving a browser for E2E checks, and more. Secrets are supplied
via environment variables (never committed).

## 🧩 Configured servers

| Server | What it's for | Required env |
|:---|:---|:---|
| [**cronsole**](../../user-guides/guides/MCP_Server_Guide.md) | Cronsole's own server: lets an agent *use* a running Cronsole (list, run, create tasks). Needs a built `mcp-server/dist/` and a running backend. | `CRONSOLE_TOKEN`, exported in the shell the host was launched from |
| [**context7**](https://github.com/upstash/context7) | Fetch up-to-date docs for React, Prisma, Express, Socket.io, Tailwind, .NET, WiX — used **before** writing code against a library. | — |
| [**github**](https://github.com/github/github-mcp-server) | PR creation and review, issues, and repo operations once the project is on GitHub. | `GITHUB_COPILOT_TOKEN` |
| [**playwright**](https://github.com/microsoft/playwright-mcp) | Browser automation for Phase 4 end-to-end testing of the dashboard. | — |
| [**serper**](https://serper.dev) | Google search for research (competitive landscape, API availability, etc.). | *(server-side key)* |
| [**notion**](https://github.com/suekou/mcp-notion-server) | Optionally mirror phase docs / risk register into a Notion workspace. | `NOTION_API_TOKEN` |
| [**nanobanana**](https://pypi.org/project/nanobanana-mcp-server/) | Image generation for marketing / landing-page assets when needed. | `GEMINI_API_KEY` |
| [**elevenlabs**](https://github.com/elevenlabs/elevenlabs-mcp) | Voice generation (rarely used for this project). | `ELEVENLABS_API_KEY` |

> [!TIP]
> Use **context7** before writing any code that touches an external library — your training
> data may lag the library's current API. It's the highest-value server here for Cronsole.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🛠️ Agent Tools home**](../README.md) | MCP servers, CLIs, and subagents overview. |
| [**🤖 AGENTS.md** (§8)](../../../AGENTS.md) | §8 › MCP: the two surfaces (dev tooling vs `cronsole`) and the rules for the `cronsole` server. |

---

<p align="center">
  <a href="../README.md">← Agent Tools</a> ·
  <a href="../clis/README.md">CLIs</a> ·
  <a href="../agents/README.md">Subagents</a>
</p>
