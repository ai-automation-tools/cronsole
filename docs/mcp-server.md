# MCP server

The one-page card for Cronsole's MCP server: what it is, how it connects, and every tool it exposes.
The full reference (each tool's route, parameters and traps) is
[`mcp-server/README.md`](../mcp-server/README.md); setup and token minting are in the
[MCP Server Guide](user-guides/guides/MCP_Server_Guide.md).

| | |
|:---|:---|
| **Package** | [`mcp-server/`](../mcp-server/README.md) (`cronsole-mcp-server`, installs on its own) |
| **Entry file** | [`mcp-server/src/index.ts`](../mcp-server/src/index.ts), built to `mcp-server/dist/index.js` |
| **Tools** | [`mcp-server/src/tools.ts`](../mcp-server/src/tools.ts), each one a call through [`client.ts`](../mcp-server/src/client.ts) to a backend REST route |
| **Transport** | stdio |
| **Auth** | One user's API token, sent as `Authorization: Bearer` to the backend |

The server owns no logic. Every tool wraps a backend route, so owner scoping, no-shell command
structuring and signed agent commands stay in the backend.

## Install

Build it, then register it with your host. The backend must be running.

```bash
cd mcp-server && npm install && npm run build
```

Claude Code:

```bash
claude mcp add cronsole \
  --env CRONSOLE_TOKEN=<your-jwt> \
  --env CRONSOLE_API_URL=http://localhost:3000/api \
  -- node /absolute/path/to/cronsole/mcp-server/dist/index.js
```

Any JSON-config host (Claude Desktop and others):

```json
{
  "mcpServers": {
    "cronsole": {
      "command": "node",
      "args": ["/absolute/path/to/cronsole/mcp-server/dist/index.js"],
      "env": {
        "CRONSOLE_TOKEN": "<your-jwt>",
        "CRONSOLE_API_URL": "http://localhost:3000/api"
      }
    }
  }
}
```

Get the token from **Settings › Account › API tokens** in the dashboard. In this repo, `.mcp.json`
(seeded from [`.mcp.json.example`](../.mcp.json.example)) already carries a `cronsole` entry that
reads `${CRONSOLE_TOKEN}` from your environment.

## Environment

Read from the process environment only; the server does not load a `.env` file. Names and
defaults are in [`mcp-server/.env.example`](../mcp-server/.env.example).

| Variable | Required | Purpose |
|:---|:---:|:---|
| `CRONSOLE_TOKEN` | yes | The API token the server acts as |
| `CRONSOLE_API_URL` | | Backend REST base URL, including `/api` |
| `CRONSOLE_TIMEOUT_MS` | | Per-request timeout |
| `CRONSOLE_MCP_ALLOW_DESTRUCTIVE` | | `true` or `1` registers the two delete tools; anything else leaves them out |

## Tools

**Gated** tools are registered only when `CRONSOLE_MCP_ALLOW_DESTRUCTIVE` is `true` or `1`. When it
is off they are absent from `tools/list`, not present and refusing. Everything else is reversible or
read-only and ships ungated.

### Read

| Tool | Purpose |
|:---|:---|
| `list_tasks` | List tracked tasks with schedule, status, next run and last result |
| `list_templates` | Browse the template catalog and each template's placeholders |
| `list_folders` | List the real Windows Task Scheduler folders and whether each is writable |
| `convert_schedule` | Validate a UTC cron and show the trigger and run times it really becomes |
| `get_task_history` | A task's recent runs that Cronsole performed |
| `list_platform_runs` | Runs the platform itself recorded, including ones Cronsole never triggered |
| `get_run_output` | What one platform run produced: its text and the steps it took |
| `list_run_history` | Run history across every task |
| `export_task` | Export a task as native XML/JSON or as a portable template |
| `list_task_secrets` | Which secrets a native task references, holds and is missing, by name only |
| `list_platforms` | Per platform, which verbs Cronsole can perform and the evidence for each |
| `list_claude_routines` | Which Claude API this install can reach, and the routines declared with tokens |
| `get_task_health` | Score every task and rank the worst first |
| `get_diagnostics` | Check whether Cronsole itself (agent, database, scheduler, catalog) is working |
| `list_task_archives` | Deleted tasks that were archived, and whether each can be restored |

### Create and run

| Tool | Purpose |
|:---|:---|
| `run_task` | Run a task now |
| `create_task` | Create a task from a command and a schedule |
| `create_task_from_template` | Create a task from a catalog template |
| `create_native_task` | Create a Cronsole-native HTTP task |
| `create_native_program_task` | Create a Cronsole-native task that runs an existing program |
| `create_native_script_task` | Create a Cronsole-native task from a script you supply |
| `create_native_check_task` | Create a monitoring check (HTTP, TCP, file freshness, disk free) |
| `create_gemini_trigger` | Create a scheduled Gemini agent trigger |
| `create_claude_routine` | Create a Claude Code routine on a schedule |
| `connect_claude_routine` | Store an existing routine's id and token so Cronsole can fire it |
| `import_task` | Create a task from an exported Cronsole task file |
| `restore_task_archive` | Rebuild a deleted native task from its archive as a new task |
| `sync_tasks` | Import or refresh tasks from their platforms |

### Change

| Tool | Purpose |
|:---|:---|
| `set_task_status` | Enable or disable a task (the safe way to stop one) |
| `update_task_schedule` | Change a task's schedule, or make it run on demand |
| `update_task_action` | Replace what a Windows task runs |
| `update_native_job` | Replace what a Cronsole-native task runs |
| `rename_task` | Change the name Cronsole shows, leaving the platform untouched |
| `edit_claude_routine` | Correct a connected routine's id or name, keeping its token |

### Remove

| Tool | Gated | Purpose |
|:---|:---:|:---|
| `untrack_task` | | Stop tracking a task; it keeps running on its platform |
| `disconnect_claude_routine` | | Forget a declared Claude routine and its token; it keeps running at claude.ai |
| `delete_task` | yes | Delete a Cronsole-native task, archived first; refuses every other platform |
| `delete_template` | yes | Delete an imported or saved template; refuses catalog-synced ones |

The tool list is pinned by `mcp-server/src/__tests__/tools.test.ts`. Adding, removing or renaming a
tool updates this page too ([AGENTS.md §11a](../AGENTS.md)).

## Related

| Doc | What's inside |
|:---|:---|
| [`mcp-server/README.md`](../mcp-server/README.md) | Each tool's route and full behavior, design notes, build and test |
| [MCP Server Guide](user-guides/guides/MCP_Server_Guide.md) | Setup, token minting, host wiring and its own troubleshooting |
| [MCP prompts](../prompts/mcp-server/README.md) | What to say to an assistant once it's connected |
| [Troubleshooting #8](troubleshooting/README.md#8-every-mcp-tool-returns-403-invalid-or-expired-token) | Every tool returns 403 |

<p align="center">
  <a href="README.md">← Docs home</a>
</p>
