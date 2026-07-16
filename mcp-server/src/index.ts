#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TaskHubClient, configFromEnv } from './client.js';
import { registerTools } from './tools.js';

/**
 * TaskHub MCP server. Exposes the TaskHub REST API as MCP tools over stdio so an
 * MCP host (Claude Code / Claude Desktop / Codex / Cursor) can list, run, and
 * create scheduled tasks. All I/O on stdout is the JSON-RPC stream — logging
 * MUST go to stderr (console.error) so it doesn't corrupt the protocol.
 */
async function main(): Promise<void> {
  const config = configFromEnv();
  const client = new TaskHubClient(config);

  const server = new McpServer({
    name: 'taskhub',
    version: '1.0.0'
  });

  registerTools(server, client, { allowDestructive: config.allowDestructive });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Say which surface is live, on stderr. The irreversible tools are absent
  // rather than erroring when the gate is closed, and a silently smaller tool
  // list is the kind of thing you debug for twenty minutes (troubleshooting #13
  // was exactly that shape) — so state it at boot instead.
  console.error(
    'TaskHub MCP server running on stdio ' +
    `(destructive tools ${config.allowDestructive ? 'ENABLED' : 'disabled'} — ` +
    'set TASKHUB_MCP_ALLOW_DESTRUCTIVE=true to expose delete_task)'
  );
}

main().catch(err => {
  console.error('Fatal: TaskHub MCP server failed to start.');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
