<h1 align="center">🛠️ Agent Tools</h1>

<p align="center">
  <em>The AI-assisted tooling TaskHub is built and maintained with.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/built_with-Claude_Code-8B5CF6?style=for-the-badge&logo=anthropic&logoColor=white" alt="Claude Code">
  <img src="https://img.shields.io/badge/MCP-7_servers-2ea44f?style=for-the-badge" alt="MCP servers">
  <img src="https://img.shields.io/badge/subagents-7-F97316?style=for-the-badge" alt="Subagents">
</p>

---

TaskHub is developed with an AI-agent workflow (Claude Code). This section documents the
tooling that workflow relies on — the **MCP servers** that give the agent live capabilities,
the **CLIs** used to build and run the stack, and the project-scoped **subagents** that
handle specialized work. It's meta-documentation: how the project gets built, not how the
app runs.

## 🧰 In this section

| Area | What's inside |
|:---|:---|
| [**🔌 MCP Servers**](mcp/README.md) | The Model Context Protocol servers configured in [`.mcp.json`](../../.mcp.json) — docs, GitHub, browser automation, search, and more. |
| [**⌨️ CLIs**](clis/README.md) | Command-line tools used to develop, run, and ship TaskHub. |
| [**🤖 Subagents**](agents/README.md) | The project-scoped Claude Code subagents in [`.claude/agents/`](../../.claude/agents). |

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**🤖 CLAUDE.md**](../../CLAUDE.md) | The authoritative project conventions, skills, and subagent list. |
| [**📋 CONTRIBUTING.md**](../../CONTRIBUTING.md) | Local setup and validation commands. |

---

<p align="center">
  <a href="../README.md">← Docs home</a> ·
  <a href="mcp/README.md">MCP</a> ·
  <a href="clis/README.md">CLIs</a> ·
  <a href="agents/README.md">Subagents</a>
</p>
