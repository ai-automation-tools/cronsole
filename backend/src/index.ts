import 'dotenv/config';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import { PlatformType } from '@prisma/client';
import { prisma, warnOnStaleGeneratedClient } from './db.js';
import { createApp } from './app.js';
import { agentManager } from './ws/AgentManager.js';
import { agentAuthMiddleware, assertAgentAuthConfig } from './ws/agentAuth.js';
import { registerUiChannel } from './ws/uiChannel.js';
import { serializeConfig } from './auth/connectionConfig.js';
import { nativeScheduler } from './services/NativeScheduler.js';
import { startCatalogRefresh } from './catalog/catalogSync.js';
import { parseAllowedOrigins, warnOnPermissiveCors } from './config/origins.js';

// Fail fast if the agent pairing secret is missing/weak — the socket channel is
// remote command execution on the user's machine, so booting without it is unsafe.
assertAgentAuthConfig();

const app = createApp();
const server = createServer(app);

// Restrict Socket.IO CORS. Only the non-browser .NET agent connects today
// (CORS-exempt), so browser origins default to none; set ALLOWED_ORIGINS
// (comma-separated) once the frontend opens its own socket. Parsed by the same
// module the REST layer uses, so the two can't drift apart.
const allowedOrigins = parseAllowedOrigins();
warnOnPermissiveCors(allowedOrigins);

export const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ["GET", "POST"]
  }
});

// Authenticate the agent handshake before any connection is accepted (default
// namespace = agents). Browser dashboards connect to the separate JWT-authed
// `/ui` namespace for receive-only live task updates.
io.use(agentAuthMiddleware);
registerUiChannel(io);

const PORT = process.env.PORT || 3000;

// --- WebSocket (Agent) ---

io.on('connection', (socket: Socket) => {
  // userId is set by agentAuthMiddleware after a verified handshake.
  const userId = socket.data.userId as string;
  console.log(`Agent connected: ${socket.id} (agent ${socket.data.agentId}, user ${userId})`);

  agentManager.registerAgent(userId, socket);

  // Every inbound event is evidence this agent is still answering. Hooked once
  // here rather than in each connector handler: the connectors already listen
  // per-request and would each have to remember, and a verb that forgot would
  // make an active agent look wedged. `onAny` cannot miss one.
  socket.onAny(() => agentManager.markResponsive(userId));

  // We no longer emit 'task:list' here to prevent auto-sync on startup/connection.
  // Sync is now explicitly triggered by the user via the frontend.

  socket.on('disconnect', () => {
    console.log('Agent disconnected');
    // Only clear the mapping if THIS socket is still the registered one. On a
    // reconnect the new socket overwrites the map; a stale socket's late
    // disconnect must not delete the live one.
    if (agentManager.getSocket(userId) === socket) {
      agentManager.unregisterAgent(userId);
    }
  });
});

// --- Initialization ---

async function main() {
  // Before anything reads or writes: a stale generated client silently drops
  // enum values it doesn't know (troubleshooting #22), so say so loudly at boot
  // rather than letting the first sync report work it didn't do.
  warnOnStaleGeneratedClient();

  // MVP Placeholder User. Key the upsert on the stable primary key, not email:
  // the single-user login flow lets the user change this row's email, which would
  // orphan an email-keyed upsert and make it try to re-create the fixed id (P2002).
  await prisma.user.upsert({
    where: { id: 'cli_user_placeholder' },
    update: {},
    create: {
      id: 'cli_user_placeholder', email: 'mike@example.com',
      name: 'Mike',
      password: '' // No password for placeholder
    }
  });

  // The native platform needs no external config; auto-provision its connection
  // so run/health flows resolve it like any other platform.
  await prisma.platformConnection.upsert({
    where: {
      userId_platform: {
        userId: 'cli_user_placeholder',
        platform: PlatformType.TASKHUB_NATIVE
      }
    },
    update: {},
    create: {
      userId: 'cli_user_placeholder',
      platform: PlatformType.TASKHUB_NATIVE,
      config: serializeConfig({}),
      isActive: true,
      healthState: 'HEALTHY'
    }
  });

  // Populate the template catalog from the configured source (bundled snapshot
  // or the remote registry) and, when pointed at a registry, keep it fresh on an
  // interval — so catalog updates land without a manual reseed. Non-fatal.
  await startCatalogRefresh();

  await nativeScheduler.start();

  server.listen(PORT, () => {
    console.log(`Cronsole Backend running on http://localhost:${PORT}`);
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});