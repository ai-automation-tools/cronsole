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
/**
 * Body ceiling for a restore upload. 2000 tasks of Task Scheduler XML, UTF-16
 * and base64-expanded, lands well inside this; anything past it is refused by
 * the route with the real file count rather than by a parser with a 413.
 */
const RESTORE_BODY_LIMIT = '32mb';

export function createApp(): Express {
  const app = express();

  app.use(cors());

  // Restore uploads a whole archive of task XML — 95 tasks is comfortably past
  // the 100 kB default — so it gets its own parser with a much larger ceiling.
  //
  // Mounted BEFORE the global one and scoped to the single path on purpose:
  // body-parser skips a request another parser already consumed (it checks
  // `req._body`), so this widens the limit for exactly one route instead of
  // handing every endpoint in the API a 32 MB request budget.
  app.use('/api/tools/restore', express.json({ limit: RESTORE_BODY_LIMIT }));
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
