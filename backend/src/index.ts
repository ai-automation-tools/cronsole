import 'dotenv/config';
import express, { Request, Response } from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import { PrismaClient, PlatformType, TaskStatus } from '@prisma/client';
import taskRoutes from './routes/tasks.js';
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
app.use('/api/tasks', taskRoutes);

// --- WebSocket (Agent) ---

io.on('connection', (socket: Socket) => {
  console.log('Agent connected:', socket.id);

  // For MVP, we auto-register all agents to the placeholder user
  agentManager.registerAgent('cli_user_placeholder', socket);

  socket.emit('task:list');

  socket.on('task:full_list', async (payload: { tasks: any[] }) => {
    const { tasks } = payload;
    console.log(`Received ${tasks?.length} tasks from agent.`);
    if (!tasks) return;

    try {
      const normalizedTasks = tasks.map(t => ({
        externalId: t.path,
        name: t.name,
        status: (t.state === 'Ready' || t.state === 'Running') ? 'ACTIVE' as const : 'DISABLED' as const,
        metadata: t
      }));
      await TaskService.upsertTasks('cli_user_placeholder', PlatformType.WINDOWS_TASK_SCHEDULER, normalizedTasks);
    } catch (error) {
      console.error('Error syncing tasks:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Agent disconnected');
    agentManager.unregisterAgent('cli_user_placeholder');
  });
});

// --- Initialization ---

async function main() {
  await prisma.user.upsert({
    where: { email: 'mike@example.com' },
    update: {},
    create: {
      id: 'cli_user_placeholder',
      email: 'mike@example.com',
      name: 'Mike'
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
