import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AuthRequest } from '../auth/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';

/**
 * The browser-preferences blob — one opaque JSON document per user.
 *
 * **Why this exists at all.** Every preference the dashboard keeps — rail pins,
 * saved views, which bands are folded, the authoring timezone, the system lens —
 * lived in `localStorage`, which is scoped to an **origin**. Reaching the same
 * install from `http://localhost:8080` and from
 * `http://desktop.tail-scale.ts.net:8080` therefore hands the same person two
 * different stores. Collections and favorites are rows, so they followed the
 * user across; pins and views did not. Both halves draw into the same sidebar,
 * so the result reads as a bug rather than as a boundary.
 *
 * **This does not promote a preference to a resource.** `utils/railPins.ts`
 * argues a pin references no row by id, names no platform and means nothing to
 * another account — all still true, and none of it is what broke. What that
 * argument did not consider is one user at two origins.
 *
 * **The server stores this; it does not read it.** There is deliberately no
 * schema for the contents here, and that is a decision rather than an omission:
 * a server-side `Settings` schema would be a *second definition* of a shape the
 * frontend already owns, and the failure when the two drift is silent — a
 * backend one release behind would strip or reject a field a newer browser had
 * just written, losing a preference the user set with nothing anywhere reporting
 * it. So the boundary check is the two things that are genuinely the server's
 * business: it is a JSON **object** (not an array, not a scalar), and it is
 * small. Everything inside is the client's.
 *
 * That is the same call `PlatformConnection.config` makes, minus the encryption:
 * this holds no credential, only a description of somebody's sidebar.
 *
 * **Conflicts resolve by recency, not by merge.** Two browsers editing
 * preferences at once is a real scenario and last-write-wins genuinely loses the
 * earlier edit — but the alternative is field-level merge over a shape this
 * layer has just refused to know, and a merge of `railPins` arrays has no
 * correct answer anyway (are two pins to the same folder one pin or two?). The
 * client keeps this honest at the only point that matters: it **hydrates before
 * it ever pushes**, so a fresh browser adopts the account's preferences rather
 * than overwriting them with its own defaults (`hooks/useSettings.ts`).
 */
const router = Router();

/**
 * The ceiling on a stored blob, in bytes of UTF-8 JSON.
 *
 * 64 kB rather than something rounder because it has to sit **under Express's
 * 100 kB default body limit** to be the error the user sees: past that,
 * body-parser 413s first and the message is about a request being too large
 * rather than about preferences. A cap enforced by a layer that cannot name what
 * it is capping is a worse cap.
 *
 * It is not tight. The whole `Settings` shape with fifty saved views and two
 * hundred pins is comfortably under 40 kB; anything larger is a client bug or an
 * attempt to use this row as free storage, and both want to fail loudly here
 * rather than grow a table nobody looks at.
 */
const MAX_BYTES = 64 * 1024;

/**
 * An object, and nothing further.
 *
 * `z.record(z.string(), z.unknown())` rejects an array, a string and `null`
 * while accepting any set of keys — which is exactly the line drawn above. The
 * client merges what comes back over its own defaults, so an unknown key is
 * inert on read and a missing one falls back.
 */
const putSchema = z.object({
  data: z.record(z.string(), z.unknown())
});

interface PreferenceRow {
  data: Record<string, unknown> | null;
  updatedAt: Date | null;
}

/**
 * `data: null` is the answer for a user who has never stored preferences, and it
 * is a **different answer from `{}`**.
 *
 * The client acts on the distinction: null means "this account has nothing yet,
 * so seed it from what is in this browser", while an empty object means "the
 * account's preferences are the defaults", which must overwrite a local blob
 * rather than be overwritten by it. Collapsing the two into `{}` would make a
 * first visit from a second device silently re-seed the account from that
 * device's defaults — the exact clobber this route is arranged to avoid.
 */
const EMPTY: PreferenceRow = { data: null, updatedAt: null };

router.get('/', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const row = await prisma.userPreference.findUnique({ where: { userId } });
  if (!row) {
    res.json(EMPTY);
    return;
  }
  res.json({ data: row.data as Record<string, unknown>, updatedAt: row.updatedAt });
});

router.put('/', validateBody(putSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { data } = req.body as { data: Record<string, unknown> };

  // Measured on the serialized bytes rather than on key count or nesting depth,
  // because bytes are the thing the column and the request actually cost.
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > MAX_BYTES) {
    throw new HttpError(
      413,
      `Preferences are ${Math.round(bytes / 1024)} kB, over the ${MAX_BYTES / 1024} kB limit.`
    );
  }

  // Prisma types a Json write as `InputJsonValue`, which a `Record<string,
  // unknown>` does not structurally satisfy — `unknown` could be a function or a
  // symbol. Zod has already proved this parsed from JSON, so it cannot be, and
  // the cast is asserting exactly what the parse established.
  const blob = data as Prisma.InputJsonObject;

  const saved = await prisma.userPreference.upsert({
    where: { userId },
    create: { userId, data: blob },
    update: { data: blob }
  });

  res.json({ data: saved.data as Record<string, unknown>, updatedAt: saved.updatedAt });
});

export default router;
