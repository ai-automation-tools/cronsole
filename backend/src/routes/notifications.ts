import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../auth/auth.js';
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
  const row = await saveNotificationChannel(userId, {
    enabled: body.enabled,
    notifyOnFailure: body.notifyOnFailure,
    notifyOnSuccess: body.notifyOnSuccess,
    url: body.url,
    type: body.type ?? 'generic',
    headers: body.headers,
    to: body.to,
    from: body.from
  });
  res.json(redactChannel(row));
});

export default router;
