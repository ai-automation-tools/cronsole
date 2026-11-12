# MCP server

The one-page card for Cronsole's MCP server: where it lives, how it connects, and the name of every
tool. **For setup** (token, environment, every host) see the
[MCP Server Guide](user-guides/guides/MCP_Server_Guide.md). **For the package** (each tool's route
and behavior, build, test, design) see [`mcp-server/README.md`](../mcp-server/README.md).

| | |
|:---|:---|
| **Package** | [`mcp-server/`](../mcp-server/README.md) (`cronsole-mcp-server`, installs on its own) |
| **Entry file** | [`mcp-server/src/index.ts`](../mcp-server/src/index.ts), built to `mcp-server/dist/index.js` |
| **Tools** | [`mcp-server/src/tools.ts`](../mcp-server/src/tools.ts), each a call through [`client.ts`](../mcp-server/src/client.ts) to a backend REST route |
| **Transport** | stdio |
| **Auth** | One user's API token in `CRONSOLE_TOKEN`, sent as `Authorization: Bearer` |
| **Config** | Process environment only; names and defaults in [`mcp-server/.env.example`](../mcp-server/.env.example) |

The server owns no logic: owner scoping, no-shell commands and signed agent commands all stay in the
backend.

## Install

Build once (`cd mcp-server && npm install && npm run build`), with the backend running. Then:

| Client | Install |
|:---|:---|
| Claude Code | `claude mcp add cronsole --env CRONSOLE_TOKEN=<token> -- node /abs/path/cronsole/mcp-server/dist/index.js` |
| Codex | `codex mcp add cronsole --env CRONSOLE_TOKEN=<token> -- node /abs/path/cronsole/mcp-server/dist/index.js` |
| opencode | `"mcp": { "cronsole": { "type": "local", "command": ["node", "/abs/path/cronsole/mcp-server/dist/index.js"], "environment": { "CRONSOLE_TOKEN": "<token>" } } }` in `opencode.json` |
| Antigravity | A `cronsole` entry under `mcpServers` in its `mcp_config.json`, same shape as Claude Desktop's |

Full blocks, `CRONSOLE_API_URL`, and the fresh-terminal rule are in
[Wire it into your assistant](user-guides/guides/MCP_Server_Guide.md#wire-it-into-your-assistant).

## Tools

**Gated** tools are registered only when `CRONSOLE_MCP_ALLOW_DESTRUCTIVE` is `true` or `1`; when it
is off they are absent from `tools/list`. Everything else ships ungated.

**Everything else includes creating and running tasks**, which means running programs on the
machine, as administrator if a Windows task asks for `runLevel: highest`. Set
`CRONSOLE_MCP_READONLY` (any value except empty, `false` or `0`) to register only the reading
tools; it wins over the gate above.

| Tool | Purpose |
|:---|:---|
| `list_tasks` | Tracked tasks with schedule, status, next run and last result |
| `list_templates` | The template catalog and each template's placeholders |
| `list_folders` | Real Task Scheduler folders and whether each is writable |
| `convert_schedule` | What a UTC cron really becomes on the platform, with run times |
| `get_task_history` | A task's runs that Cronsole performed |
| `list_platform_runs` | Runs the platform itself recorded |
| `get_run_output` | One platform run's text and steps |
| `list_run_history` | Run history across every task |
| `export_task` | Export a task as native XML/JSON or a portable template |
| `list_task_secrets` | Which secrets a native task references, holds and is missing (names only) |
| `list_platforms` | Per platform, which verbs work and the evidence for each |
| `list_claude_routines` | Which Claude API this install reaches, and declared scheduled tasks |
| `get_task_health` | Every task scored, worst first |
| `get_diagnostics` | Whether Cronsole itself (agent, database, scheduler, catalog) is working |
| `list_task_archives` | Archived deleted tasks and whether each can be restored |
| `run_task` | Run a task now |
| `create_task` | Create a Windows or native task from a command |
| `create_task_from_template` | Create a task from a catalog template |
| `create_native_task` | Create a native HTTP task |
| `create_native_program_task` | Create a native task that runs an existing program |
| `create_native_script_task` | Create a native task from a supplied script |
| `create_native_check_task` | Create a monitoring check (HTTP, TCP, file freshness, disk free) |
| `create_gemini_trigger` | Create a scheduled Gemini agent trigger |
| `create_claude_routine` | Create a Claude Code scheduled task |
| `connect_claude_routine` | Store an existing Claude scheduled task's id and token |
| `import_task` | Create a native task from an exported file |
| `restore_task_archive` | Rebuild a deleted native task as a new task |
| `sync_tasks` | Import or refresh tasks from their platforms |
| `set_task_status` | Enable or disable a task |
| `update_task_schedule` | Change a task's schedule, or make it on-demand |
| `update_task_action` | Replace what a Windows task runs |
| `update_native_job` | Replace what a native task runs |
| `rename_task` | Change the Cronsole label (refused where the platform owns the name) |
| `edit_claude_routine` | Fix a connected scheduled task's id or name, keeping its token |
| `untrack_task` | Stop tracking a task; it keeps running on its platform |
| `disconnect_claude_routine` | Forget a declared scheduled task and its token; it keeps running at claude.ai |
| `delete_task` **(gated)** | Delete a Cronsole-native task, archived first; refuses every other platform |
| `delete_template` **(gated)** | Delete an imported or saved template; refuses catalog-synced ones |

The list is pinned by `mcp-server/src/__tests__/tools.test.ts`; adding, removing or renaming a tool
updates this page too ([AGENTS.md §11a](../AGENTS.md)).

## Related

| Doc | What's inside |
|:---|:---|
| [MCP Server Guide](user-guides/guides/MCP_Server_Guide.md) | Setup, token, environment, every host, troubleshooting |
| [`mcp-server/README.md`](../mcp-server/README.md) | Each tool's route and behavior, gating rationale, build and test |
| [MCP prompts](../prompts/mcp-server/README.md) | What to say to an assistant once it's connected |

<p align="center">
  <a href="README.md">← Docs home</a>
</p>
