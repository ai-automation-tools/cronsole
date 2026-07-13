<h1 align="center">⌨️ CLIs</h1>

<p align="center">
  <em>The command-line tools used to develop, run, and ship TaskHub.</em>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/shell-PowerShell_&_bash-4EAA25?style=for-the-badge&logo=gnubash&logoColor=white" alt="Shells">
</p>

---

A quick reference to the CLIs you'll invoke while working in this repo. Installation and
versions are covered in [**⬇️ Installation**](../../install/README.md).

## 🧰 Toolbelt

| Tool | Used for |
|:---|:---|
| [**Claude Code**](https://claude.com/claude-code) | The AI development agent — runs skills, subagents, and MCP servers per [`CLAUDE.md`](../../../CLAUDE.md). |
| [**Codex CLI**](https://developers.openai.com/codex) | OpenAI coding agent CLI. TaskHub templates use `codex --ask-for-approval never exec` for unattended scheduled runs with explicit sandboxing and captured output. |
| [**docker / docker compose**](https://docs.docker.com/) | Bring up the dev stack (`docker compose up --build`): Postgres + Redis + backend + frontend. |
| [**npm**](https://docs.npmjs.com/cli) | Install deps and run scripts for the frontend and backend (`npm install`, `npm run dev`, `npm start`). |
| [**npx prisma**](https://www.prisma.io/docs/orm/tools/prisma-cli) | Database schema and migrations (`npx prisma migrate dev`, `prisma studio`). |
| [**dotnet**](https://learn.microsoft.com/en-us/dotnet/core/tools/) | Build and run the .NET 10 Windows agent (`dotnet run`, `dotnet publish`). |
| [**gh**](https://cli.github.com/) | GitHub operations from the terminal — PRs, issues, releases. |
| [**PowerShell**](https://learn.microsoft.com/en-us/powershell/) | Windows agent setup and the auto-start launcher ([`scripts/startup-task/`](../../../scripts/startup-task/README.md)). |

> [!NOTE]
> On Windows, agent setup scripts run in **PowerShell** (often elevated); most Node/Prisma
> commands are cross-platform. See each guide for the exact invocation.

## 🔗 Related

| Resource | Why you'd go there |
|:---|:---|
| [**⬇️ Installation**](../../install/README.md) | Install these tools and get the stack running. |
| [**🔧 scripts/**](../../../scripts/README.md) | Operational scripts that wrap these CLIs. |

---

<p align="center">
  <a href="../README.md">← Agent Tools</a> ·
  <a href="../mcp/README.md">MCP</a> ·
  <a href="../agents/README.md">Subagents</a>
</p>
