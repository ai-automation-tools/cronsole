#!/usr/bin/env node
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { CronsoleClient, configFromEnv } from './client.js';
import { registerTools } from './tools.js';

/**
 * Cronsole MCP server. Exposes the Cronsole REST API as MCP tools over stdio so an
 * MCP host (Claude Code / Claude Desktop / Codex / Cursor) can list, run, and
 * create scheduled tasks. All I/O on stdout is the JSON-RPC stream — logging
 * MUST go to stderr (console.error) so it doesn't corrupt the protocol.
 */
// Read rather than written out: a literal here said 1.0.0 while the package was 0.9.0.
// Resolves from src/ and dist/ alike, since package.json sits one level above both.
const PACKAGE_VERSION: string = createRequire(import.meta.url)('../package.json').version;

async function main(): Promise<void> {
  const config = configFromEnv();
  const client = new CronsoleClient(config);

  const server = new McpServer({
    name: 'cronsole',
    version: PACKAGE_VERSION
  });

  registerTools(server, client, { allowDestructive: config.allowDestructive, readOnly: config.readOnly });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Say which surface is live, on stderr. The irreversible tools are absent
  // rather than erroring when the gate is closed, and a silently smaller tool
  // list is the kind of thing you debug for twenty minutes (troubleshooting #13
  // was exactly that shape) — so state it at boot instead.
  console.error(
    config.readOnly
      ? 'Cronsole MCP server running on stdio (READ-ONLY: CRONSOLE_MCP_READONLY is set, so only the ' +
        'tools that read are exposed; unset it to create, run and change tasks)'
      : 'Cronsole MCP server running on stdio ' +
        `(destructive tools ${config.allowDestructive ? 'ENABLED' : 'disabled'} — ` +
        'set CRONSOLE_MCP_ALLOW_DESTRUCTIVE=true to expose delete_task + delete_template)'
  );
}

main().catch(err => {
  console.error('Fatal: Cronsole MCP server failed to start.');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
