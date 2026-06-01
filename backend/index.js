require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // In production, restrict this to your frontend URL
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// --- REST API ---

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// List all tasks
app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    res.json(tasks);
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// Trigger a task
app.post('/api/tasks/:id/run', async (req, res) => {
  const { id } = req.params;
  try {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) return res.status(404).json({ error: 'Task not found' });

    if (task.platform === 'WINDOWS_TASK_SCHEDULER') {
        // Find the active agent socket
        // Note: For MVP we assume one agent for now. 
        // In a real system, we'd map agentId to specific socket rooms.
        io.emit('task:run', task.externalId, (response) => {
            console.log(`Agent response for task ${task.name}:`, response);
        });
        
        await prisma.executionLog.create({
            data: {
                taskId: id,
                status: 'PENDING',
                log: 'Triggered from web dashboard'
            }
        });

        res.json({ message: 'Task run command sent to agent' });
    } else {
        res.status(400).json({ error: 'Platform not yet supported for remote run' });
    }
  } catch (error) {
    console.error('Error running task:', error);
    res.status(500).json({ error: 'Failed to trigger task' });
  }
});

// --- WebSocket (Agent) ---

io.on('connection', (socket) => {
  console.log('Agent connected:', socket.id);

  // Trigger initial sync
  socket.emit('task:list');

  // When agent announces itself and sends machine info
  socket.on('agent:hello', async (payload) => {
    console.log('Agent hello:', payload);
    // Logic to register/update platform connection could go here
  });

  // When agent sends the full list of tasks
  socket.on('task:full_list', async (payload) => {
    const { tasks } = payload;
    console.log(`Received ${tasks?.length} tasks from agent.`);

    try {
      // Basic synchronization logic for MVP:
      // We'll upsert tasks based on (platform, externalId)
      for (const t of tasks) {
        await prisma.task.upsert({
          where: {
            platform_externalId: {
              platform: 'WINDOWS_TASK_SCHEDULER',
              externalId: t.path
            }
          },
          update: {
            name: t.name,
            status: t.state === 'Ready' || t.state === 'Running' ? 'ACTIVE' : 'DISABLED',
            metadata: t
          },
          create: {
            userId: 'cli_user_placeholder', // We'll need real auth later
            platform: 'WINDOWS_TASK_SCHEDULER',
            externalId: t.path,
            name: t.name,
            status: t.state === 'Ready' || t.state === 'Running' ? 'ACTIVE' : 'DISABLED',
            metadata: t
          }
        });
      }
    } catch (error) {
      console.error('Error syncing tasks:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('Agent disconnected');
  });
});

// --- Initialization ---

async function main() {
  // Ensure we have at least one user for the MVP sync to work
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
