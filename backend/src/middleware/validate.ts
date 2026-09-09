import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';
import { HttpError } from './errorHandler.js';

/**
 * Validate (and normalize) a request body against a Zod schema at the route
 * boundary. On failure the first issue becomes a 400 with a field-qualified
 * message; on success `req.body` is replaced with the parsed value, so
 * handlers downstream can trust its shape and defaults.
 */
export const validateBody =
  (schema: ZodType) => (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
      return next(new HttpError(400, `${path}${issue.message}`));
    }
    req.body = result.data;
    next();
  };
