import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { AuthRequest } from '../auth/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
import { notifyTasksChanged } from '../ws/uiChannel.js';

/**
 * Collections — named, hand-picked sets of tasks.
 *
 * **A collection is a set; a saved view is a query.** That distinction is the
 * reason this exists at all. A view stores filters, so its contents are whatever
 * matches *today* — which can never express "these two Claude routines and these
 * two Windows tasks", because the four share no property a filter can name. A
 * collection stores the membership itself.
 *
 * Everything here is a Cronsole-side preference: **nothing touches a platform**,
 * so every route works with the agent offline, and none of them can change what
 * runs on the user's machine. Adding a task to a collection is the same class of
 * act as starring one.
 *
 * Mounted at `/api/collections` rather than under `/api/tasks`, which keeps it
 * clear of the `/:id` declaration-order trap that put every cross-task route on
 * `/api/tools` (CLAUDE.md §9).
 */
const router = Router();

/**
 * Names are trimmed and length-capped, and `Uncategorized`-style empties are
 * refused outright: the rail renders this string, and a whitespace-only row is
 * an unclickable gap the user cannot identify or delete by name.
 */
const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(60, 'Name must be 60 characters or fewer');

const createSchema = z.object({
  name: nameSchema,
  /**
   * Optional seed membership, so "make a collection out of these" is one call
   * rather than a create followed by N adds — each of which would be a separate
   * failure point on a list the user has already assembled.
   */
  taskIds: z.array(z.string()).max(500).optional()
});

const patchSchema = z
  .object({
    name: nameSchema.optional(),
    position: z.number().int().min(0).max(9999).optional()
  })
  .refine(v => v.name !== undefined || v.position !== undefined, {
    message: 'Provide a name, a position, or both'
  });

const membersSchema = z.object({
  add: z.array(z.string()).max(500).optional(),
  remove: z.array(z.string()).max(500).optional()
});

/** Rail order: explicit position first, then oldest-first as a stable tiebreak. */
const ORDER: Prisma.TaskCollectionOrderByWithRelationInput[] = [
  { position: 'asc' },
  { createdAt: 'asc' }
];

interface CollectionRow {
  id: string;
  name: string;
  position: number;
  taskIds: string[];
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const shape = (c: {
  id: string;
  name: string;
  position: number;
  createdAt: Date;
  updatedAt: Date;
  members: { taskId: string }[];
}): CollectionRow => ({
  id: c.id,
  name: c.name,
  position: c.position,
  taskIds: c.members.map(m => m.taskId),
  // Sent alongside the ids rather than derived by the caller: the rail needs a
  // count before it needs the members, and two ways to compute one number is how
  // a badge and its list start disagreeing.
  count: c.members.length,
  createdAt: c.createdAt,
  updatedAt: c.updatedAt
});

/**
 * Every task id in `ids` that this user actually owns.
 *
 * Filtering rather than rejecting is deliberate for membership writes: the ids
 * come from a list the user assembled in a browser, and a task can be untracked
 * or deleted in another tab between assembling and saving. Failing the whole
 * request would lose the other nineteen. What must never happen is a membership
 * row pointing at another tenant's task (IDOR), and scoping the lookup by
 * `userId` is what prevents that.
 */
async function ownedTaskIds(userId: string, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await prisma.task.findMany({
    where: { userId, id: { in: [...new Set(ids)] } },
    select: { id: true }
  });
  return rows.map(r => r.id);
}

/** The caller's collection, or a 404 — never another user's, and never a probe. */
async function ownedCollection(userId: string, id: string) {
  const found = await prisma.taskCollection.findFirst({ where: { id, userId } });
  if (!found) throw new HttpError(404, 'Collection not found');
  return found;
}

/**
 * A duplicate name is a `409`, not a 500.
 *
 * `@@unique([userId, name])` is what actually enforces it — checking first and
 * inserting after is a race, and this is the one path where two browser tabs
 * plausibly do the same thing at once.
 */
function asDuplicateName(err: unknown): HttpError | null {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return new HttpError(409, 'You already have a collection with that name');
  }
  return null;
}

// List every collection, with its membership.
router.get('/', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const collections = await prisma.taskCollection.findMany({
    where: { userId },
    orderBy: ORDER,
    include: { members: { select: { taskId: true } } }
  });
  res.json(collections.map(shape));
});

// Create one, optionally seeded with tasks.
router.post('/', validateBody(createSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { name, taskIds } = req.body as { name: string; taskIds?: string[] };

  const seed = await ownedTaskIds(userId, taskIds ?? []);
  // New collections land at the end of the rail. `count` is cheap and this is
  // not a hot path, so it stays a plain query rather than a maintained counter.
  const position = await prisma.taskCollection.count({ where: { userId } });

  try {
    const created = await prisma.taskCollection.create({
      data: {
        userId,
        name,
        position,
        members: { create: seed.map(taskId => ({ taskId })) }
      },
      include: { members: { select: { taskId: true } } }
    });
    notifyTasksChanged(userId);
    res.status(201).json(shape(created));
  } catch (err) {
    const duplicate = asDuplicateName(err);
    if (duplicate) throw duplicate;
    throw err;
  }
});

// Rename and/or reorder.
router.patch('/:id', validateBody(patchSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = req.params.id as string;
  const { name, position } = req.body as { name?: string; position?: number };

  await ownedCollection(userId, id);

  try {
    const updated = await prisma.taskCollection.update({
      where: { id },
      data: { ...(name !== undefined && { name }), ...(position !== undefined && { position }) },
      include: { members: { select: { taskId: true } } }
    });
    notifyTasksChanged(userId);
    res.json(shape(updated));
  } catch (err) {
    const duplicate = asDuplicateName(err);
    if (duplicate) throw duplicate;
    throw err;
  }
});

/**
 * Delete a collection.
 *
 * **This removes a grouping, never a task.** The memberships cascade because
 * they describe nothing once the collection is gone; the tasks themselves are
 * untouched and keep running. That asymmetry is why this needs no confirmation
 * ceremony of the kind bulk untrack has — nothing on the machine changes, and
 * nothing stops being tracked.
 */
router.delete('/:id', async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = req.params.id as string;

  await ownedCollection(userId, id);
  await prisma.taskCollection.delete({ where: { id } });
  notifyTasksChanged(userId);
  res.json({ id, deleted: true });
});

/**
 * Add and/or remove members in one call.
 *
 * One route rather than a POST and a DELETE per task, because the gesture it
 * serves is "here is what belongs in this collection now" — a checklist the user
 * ticks and saves. Splitting it would turn one edit into N requests, any of
 * which can fail on its own, leaving a collection in a state the user never
 * chose. Idempotent in both directions: adding a member twice and removing a
 * non-member are both successes, since the desired end state already holds.
 *
 * The response is the whole collection, so the caller never has to reconstruct
 * membership from what it *asked for* — which would silently disagree with the
 * server whenever an id was dropped for not being the caller's.
 */
router.post('/:id/members', validateBody(membersSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const id = req.params.id as string;
  const { add, remove } = req.body as { add?: string[]; remove?: string[] };

  await ownedCollection(userId, id);
  const toAdd = await ownedTaskIds(userId, add ?? []);
  const toRemove = [...new Set(remove ?? [])];

  // One transaction: a half-applied checklist is a collection the user did not
  // assemble, and there is no platform round-trip in here that would make
  // atomicity unaffordable (bulk status cannot do this; untrack can, and does).
  const updated = await prisma.$transaction(async tx => {
    if (toRemove.length) {
      await tx.taskCollectionMember.deleteMany({
        where: { collectionId: id, taskId: { in: toRemove } }
      });
    }
    if (toAdd.length) {
      await tx.taskCollectionMember.createMany({
        data: toAdd.map(taskId => ({ collectionId: id, taskId })),
        skipDuplicates: true
      });
    }
    return tx.taskCollection.findUniqueOrThrow({
      where: { id },
      include: { members: { select: { taskId: true } } }
    });
  });

  notifyTasksChanged(userId);
  res.json({
    ...shape(updated),
    // Named, not silent: an id the user asked to add that is not theirs (or no
    // longer exists) is a fact about the request, the same reason bulk export
    // reports `requestedMissing` rather than quietly shipping a smaller archive.
    ignored: (add ?? []).filter(taskId => !toAdd.includes(taskId))
  });
});

export default router;
