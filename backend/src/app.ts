import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import taskRoutes from './routes/tasks.js';
import templateRoutes from './routes/templates.js';
import toolsRoutes from './routes/tools.js';
import collectionRoutes from './routes/collections.js';
import preferenceRoutes from './routes/preferences.js';
import notificationRoutes from './routes/notifications.js';
import authRoutes from './routes/auth.js';
import { authenticateToken } from './auth/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import { corsOptions } from './config/origins.js';
import { createRequire } from 'node:module';

/**
 * The app version — backend and frontend ship as one deployable, so there is one
 * number for the pair (docs/contributing/Versioning.md).
 *
 * Read from package.json at runtime rather than imported, because `rootDir` is
 * `./src` and a JSON import would land the manifest inside `dist/`. The relative
 * path resolves to `backend/package.json` from both `src/` under tsx and `dist/`
 * under node, which is the only reason this is safe.
 */
const APP_VERSION: string =
  createRequire(import.meta.url)('../package.json').version ?? 'unknown';

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

  // Who the login rate-limiter thinks it is throttling.
  //
  // UNSET BY DEFAULT, and that default is the safe one: Express reads `req.ip`
  // from the socket, so a forged `X-Forwarded-For` cannot move a caller into a
  // different bucket. Trusting the header is the *widening* choice, which is why
  // it is opt-in rather than inferred.
  //
  // Set it ONLY behind the single-origin reverse proxy (TRUST_PROXY=1, one hop —
  // Caddy), where the backend is not directly reachable. There, every request
  // arrives from the proxy's address, so without this the per-IP limiter in
  // `makeAuthLimiter` collapses to ONE global bucket — ten wrong passwords from
  // anywhere lock the owner out of their own dashboard — and express-rate-limit
  // v8 logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR because it can see the header it
  // has been told not to believe.
  //
  // The caveat is the whole reason it isn't just switched on: if `:3000` is
  // reachable directly, anyone who can hit it can forge the header and evade the
  // limiter entirely. Trust a proxy only when it is genuinely the only way in.
  // See docs/user-guides/guides/Remote_Access_Guide.md.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    // Numeric hop counts must not be passed as strings — Express treats a string
    // as a subnet/hostname list, so '1' would be read as an IP to trust rather
    // than "one hop", and `req.ip` would silently stay the proxy's.
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }

  // Same origin list Socket.IO enforces (see config/origins.ts). This was a bare
  // `cors()` — reflect-any-origin — while the socket channel was restricted, so
  // the two halves of the same API disagreed about who may call it.
  app.use(cors(corsOptions()));

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
    // `version` is the app's (backend + frontend ship as one), read from the
    // manifest so there is no second string to drift. Unauthenticated on
    // purpose: it is the same number the repo publishes, and a caller who
    // cannot reach the version cannot tell a wrong build from an unreachable
    // one — which is the whole question this endpoint exists to answer.
    res.json({ status: 'ok', version: APP_VERSION, timestamp: new Date() });
  });
  app.use('/api/auth', authRoutes);
  app.use('/api/tasks', authenticateToken, taskRoutes);
  app.use('/api/templates', authenticateToken, templateRoutes);
  app.use('/api/tools', authenticateToken, toolsRoutes);
  app.use('/api/collections', authenticateToken, collectionRoutes);
  app.use('/api/preferences', authenticateToken, preferenceRoutes);
  app.use('/api/notifications', authenticateToken, notificationRoutes);

  // Single error boundary — mounted after all routes. Express 5 forwards
  // rejected promises from async handlers here automatically.
  app.use(errorHandler);

  return app;
}
