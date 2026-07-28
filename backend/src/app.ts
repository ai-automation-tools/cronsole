import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import taskRoutes from './routes/tasks.js';
import templateRoutes from './routes/templates.js';
import toolsRoutes from './routes/tools.js';
import authRoutes from './routes/auth.js';
import { authenticateToken } from './auth/auth.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Build the Express app: middleware, routes, and the single error boundary.
 *
 * Kept separate from index.ts (which owns the HTTP + Socket.IO server, the agent
 * channel, the native scheduler, and the listen() bootstrap) so integration
 * tests can drive the real routes via supertest without opening a socket or
 * starting the scheduler.
 */
export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date() });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', authenticateToken, taskRoutes);
  app.use('/api/templates', authenticateToken, templateRoutes);
  app.use('/api/tools', authenticateToken, toolsRoutes);

  // Single error boundary — mounted after all routes. Express 5 forwards
  // rejected promises from async handlers here automatically.
  app.use(errorHandler);

  return app;
}
