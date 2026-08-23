<h1 align="center">🤖 Subagents</h1>

<p align="center">
  <em>The Claude Code subagents that handle specialized Cronsole work — three carried by this
  repo, the generic set resolved from user scope.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/location-.claude/agents-8B5CF6?style=for-the-badge" alt=".claude/agents">
  <img src="https://img.shields.io/badge/project--scoped-3-2ea44f?style=for-the-badge" alt="3 project-scoped subagents">
  <img src="https://img.shields.io/badge/user--scoped-7-6B7280?style=for-the-badge" alt="7 user-scoped subagents">
</p>

---

Spawn any of these via the `Agent` tool with the matching `subagent_type`, and run them in
parallel when the work is independent. **Where a subagent lives decides who it can help.**
The three below are specific to Cronsole and ship with the repo, so a fresh clone has them;
the generic seven were byte-identical copies carried by eight or more projects, so on
**2026-08-23** they moved to user scope (`~/.claude/agents/`) where one improvement improves
every project — don't re-add copies here.

## 🧑‍💻 Project-scoped — in [`.claude/agents/`](../../../.claude/agents)

| Subagent | When to use it |
|:---|:---|
| [**native-agent-engineer**](../../../.claude/agents/native-agent-engineer.md) | Anything under `agent/` — the .NET Windows agent, Task Scheduler COM, trigger construction, the WebSocket + HMAC protocol, installer packaging, and the coming launchd agent. |
| [**template-curator**](../../../.claude/agents/template-curator.md) | Catalog and registry work — `bundled.ts`, the content-addressed registry artifact, core vs extended tiers, `catalogSync`, publishing. |
| [**test-engineer**](../../../.claude/agents/test-engineer.md) | Characterization, contract, and equivalence tests that pin down behavior before a rewrite. |

## 🌍 User-scoped — in `~/.claude/agents/`

Available in every repo on this machine, not just Cronsole. They are **not** in this repo, so
they are listed rather than linked.

| Subagent | When to use it |
|:---|:---|
| **api-designer** | OpenAPI contracts; MCP tool schemas. |
| **backend-designer** | Prisma schema, Express service layer, WebSocket server design, auth middleware. |
| **frontend-designer** | Component architecture, design tokens, dark-theme CSS variables. |
| **frontend-developer** | Full React build-out during frontend sprints. |
| **fullstack-developer** | Cross-cutting features spanning DB → API → UI (e.g. the template apply flow). |
| **project-manager** | Sprint planning, dependency mapping, scope negotiation. |
| **technical-writer** | User docs and the template contribution guide. |

`Explore` and `Plan` are built into Claude Code and need no definition file.

> [!TIP]
> The full mapping of subagents to skills and MCP servers is maintained in
> [`CLAUDE.md`](../../../CLAUDE.md) (§8). Treat that as the source of truth; this page is the
> quick index.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🛠️ Agent Tools home**](../README.md) | MCP servers, CLIs, and subagents overview. |
| [**🤖 CLAUDE.md** (§8)](../../../CLAUDE.md) | Skills, subagents, and MCP servers in full. |

---

<p align="center">
  <a href="../README.md">← Agent Tools</a> ·
  <a href="../mcp/README.md">MCP</a> ·
  <a href="../clis/README.md">CLIs</a>
</p>
