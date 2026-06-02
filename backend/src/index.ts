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
import { TaskService } from './services/TaskService.js';

const prisma = new PrismaClient();
const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
  console.log('Agent connected:', socket.id);

  // For MVP, we auto-register all agents to the placeholder user
  agentManager.registerAgent('cli_user_placeholder', socket);

  // We no longer emit 'task:list' here to prevent auto-sync on startup/connection.
  // Sync is now explicitly triggered by the user via the frontend.

  socket.on('disconnect', () => {
    console.log('Agent disconnected');
    agentManager.unregisterAgent('cli_user_placeholder');
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

  server.listen(PORT, () => {
    console.log(`TaskHub Backend running on http://localhost:${PORT}`);
  });
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});