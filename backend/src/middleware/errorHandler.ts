import { NextFunction, Request, Response } from 'express';
import { TemplateParamError } from '../utils/templateCommand.js';

/**
 * Throw from any route handler to produce a specific HTTP error response.
 * Express 5 forwards rejected promises here automatically, so async handlers
 * need no try/catch of their own.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Extra fields merged into the JSON body (e.g. conversion warnings). */
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

/**
 * The app's single error boundary (mounted after all routes). Known error
 * types map to their status; anything unexpected is logged with its route and
 * returned as a generic 500 so internals never leak to the client.
 */
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) return next(err);

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.details });
  }
  if (err instanceof TemplateParamError) {
    return res.status(400).json({ error: err.message });
  }
  // Malformed JSON from express.json() (body-parser tags it with status 400).
  if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in (err as any)) {
    return res.status(400).json({ error: 'Malformed JSON body' });
  }

  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: 'Internal server error' });
}
