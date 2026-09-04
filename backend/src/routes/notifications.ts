import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { AuthRequest } from '../auth/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
import {
  getNotificationChannel,
  redactChannel,
  saveNotificationChannel
} from '../services/notificationChannels.js';

/**
 * A user's own run-outcome webhook — GET/PUT `/api/notifications/webhook`.
 * Off by default; see `NotificationChannel` (schema.prisma) and
 * `notifyRunOutcome` (services/FailureNotificationService.ts).
 */
const router = Router();

const putSchema = z
  .object({
    enabled: z.boolean(),
    notifyOnFailure: z.boolean(),
    notifyOnSuccess: z.boolean(),
    // Empty (or omitted) = every task you own — "I only want to hear about
    // these one or two" is the point, so this is an allowlist, never a
    // blocklist. Capped well above any realistic "just a couple of tasks" ask.
    taskIds: z.array(z.string()).max(200).optional(),
    url: z.string().trim().url().max(2000).optional(),
    type: z.enum(['generic', 'discord', 'ntfy', 'resend']).optional(),
    // Omitting this keeps whatever headers are already stored — the same
    // rule the Gemini MCP preset route follows, because there is no reveal
    // endpoint to show what's there. Send `{}` to explicitly clear them.
    headers: z.record(z.string(), z.string()).optional(),
    // `resend` only. Not sensitive on their own (the API key is a header),
    // so they round-trip through GET like `url` does, unlike `headers`.
    to: z.string().trim().email().max(320).optional(),
    from: z.string().trim().max(320).optional()
  })
  .refine((data) => !data.enabled || !!data.url, {
    message: 'A webhook URL is required to turn notifications on.',
    path: ['url']
  })
  .refine((data) => !data.enabled || data.type !== 'resend' || !!data.to, {
    message: 'A recipient address is required to send email through Resend.',
    path: ['to']
  });

router.get('/webhook', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const row = await getNotificationChannel(userId);
  res.json(redactChannel(row));
});

router.put('/webhook', validateBody(putSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const body = req.body as z.infer<typeof putSchema>;

  if (body.taskIds?.length) {
    const owned = await prisma.task.findMany({
      where: { id: { in: body.taskIds }, userId },
      select: { id: true }
    });
    if (owned.length !== body.taskIds.length) {
      const ownedIds = new Set(owned.map(t => t.id));
      const unknown = body.taskIds.filter(id => !ownedIds.has(id));
      throw new HttpError(400, `Not your task(s), or they no longer exist: ${unknown.join(', ')}`);
    }
  }

  const row = await saveNotificationChannel(userId, {
    enabled: body.enabled,
    notifyOnFailure: body.notifyOnFailure,
    notifyOnSuccess: body.notifyOnSuccess,
    taskIds: body.taskIds,
    url: body.url,
    type: body.type ?? 'generic',
    headers: body.headers,
    to: body.to,
    from: body.from
  });
  res.json(redactChannel(row));
});

export default router;
