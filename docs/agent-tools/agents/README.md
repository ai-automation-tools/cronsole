<h1 align="center">🤖 Subagents</h1>

<p align="center">
  <em>Project-scoped Claude Code subagents that handle specialized TaskHub work.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/location-.claude/agents-8B5CF6?style=for-the-badge" alt=".claude/agents">
  <img src="https://img.shields.io/badge/count-7-2ea44f?style=for-the-badge" alt="7 subagents">
</p>

---

These subagents live in [`.claude/agents/`](../../../.claude/agents) and are scoped to this
project (they override any same-named global agent). Spawn them via the `Agent` tool with
the matching `subagent_type`, and run them in parallel when the work is independent.

## 🧑‍💻 Available subagents

| Subagent | When to use it |
|:---|:---|
| [**api-designer**](../../../.claude/agents/api-designer.md) | OpenAPI contracts; MCP tool schemas for the Phase 6 server. |
| [**backend-designer**](../../../.claude/agents/backend-designer.md) | Prisma schema, Express service layer, WebSocket server design, auth middleware. |
| [**frontend-designer**](../../../.claude/agents/frontend-designer.md) | Component architecture, design tokens, dark-theme CSS variables. |
| [**frontend-developer**](../../../.claude/agents/frontend-developer.md) | Full React build-out during frontend sprints. |
| [**fullstack-developer**](../../../.claude/agents/fullstack-developer.md) | Cross-cutting features spanning DB → API → UI (e.g. the template apply flow). |
| [**project-manager**](../../../.claude/agents/project-manager.md) | Sprint planning, dependency mapping, scope negotiation. |
| [**technical-writer**](../../../.claude/agents/technical-writer.md) | User docs and the template contribution guide. |

> [!TIP]
> The full mapping of subagents to project phases — plus the available skills and MCP
> servers — is maintained in [`CLAUDE.md`](../../../CLAUDE.md) (§7). Treat that as the
> source of truth; this page is the quick index.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🛠️ Agent Tools home**](../README.md) | MCP servers, CLIs, and subagents overview. |
| [**🤖 CLAUDE.md** (§6–§8)](../../../CLAUDE.md) | Skills, subagents, and MCP servers in full. |

---

<p align="center">
  <a href="../README.md">← Agent Tools</a> ·
  <a href="../mcp/README.md">MCP</a> ·
  <a href="../clis/README.md">CLIs</a>
</p>
