import 'dotenv/config';
import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { PrismaClient, PlatformType, TaskStatus } from '@prisma/client';
import taskRoutes from './routes/tasks.js';
import templateRoutes from './routes/templates.js';
import authRoutes from './routes/auth.js';
import { authenticateToken } from './auth/auth.js';
import { agentManager } from './ws/AgentManager.js';
import { agentAuthMiddleware, assertAgentAuthConfig } from './ws/agentAuth.js';
import { serializeConfig } from './auth/connectionConfig.js';
import { TaskService } from './services/TaskService.js';
import { nativeScheduler } from './services/NativeScheduler.js';

// Fail fast if the agent pairing secret is missing/weak — the socket channel is
// remote command execution on the user's machine, so booting without it is unsafe.
assertAgentAuthConfig();

const prisma = new PrismaClient();
const app = express();
const server = createServer(app);

// Restrict Socket.IO CORS. Only the non-browser .NET agent connects today
// (CORS-exempt), so browser origins default to none; set ALLOWED_ORIGINS
// (comma-separated) once the frontend opens its own socket.
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

export const io = new Server(server, {
  cors: {
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ["GET", "POST"]
  }
});

// Authenticate the agent handshake before any connection is accepted.
io.use(agentAuthMiddleware);

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- Routes ---
app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
app.use('/api/auth', authRoutes);
app.use('/api/tasks', authenticateToken, taskRoutes);
app.use('/api/templates', authenticateToken, templateRoutes);

// --- WebSocket (Agent) ---

io.on('connection', (socket: Socket) => {
  // userId is set by agentAuthMiddleware after a verified handshake.
  const userId = socket.data.userId as string;
  console.log(`Agent connected: ${socket.id} (agent ${socket.data.agentId}, user ${userId})`);

  agentManager.registerAgent(userId, socket);

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
  // MVP Placeholder User
  await prisma.user.upsert({
    where: { email: 'mike@example.com' },
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

  await nativeScheduler.start();

  server.listen(PORT, () => {
    console.log(`TaskHub Backend running on http://localhost:${PORT}`);
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});