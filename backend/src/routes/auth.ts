import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../db.js';
import { generateToken, authenticateToken, AuthRequest } from '../auth/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';
import { makeAuthLimiter } from '../middleware/authLimiter.js';

const router = Router();

const authLimiter = makeAuthLimiter();

const credentialsSchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).optional()
});

// A "real" owner account is one with a non-empty password. The boot seed always
// upserts a PASSWORD-LESS placeholder user (`cli_user_placeholder`, password '')
// to own the shared template catalog, so "has anyone set up an account?" is NOT
// "are there any users?" — it's "is there a user with a password?".
const OWNER_FILTER = { AND: [{ password: { not: null } }, { password: { not: '' } }] };

/**
 * First-run gate. Cronsole is local-first and single-user: a fresh install has
 * only the password-less catalog placeholder, so the frontend asks here whether
 * to show the "create your account" (setup) screen or the login screen. Public
 * and unthrottled — a boolean derived from a count, nothing sensitive.
 */
router.get('/status', async (_req: Request, res: Response) => {
  const ownerCount = await prisma.user.count({ where: OWNER_FILTER });
  res.json({ needsSetup: ownerCount === 0 });
});

/**
 * First-run account creation. Allowed only until a real (password-bearing)
 * account exists; after that it 409s and the caller must log in. This is the
 * ONLY account-creation path in the product (see the note where /register used
 * to be).
 *
 * It CLAIMS the existing password-less placeholder rather than creating a
 * second row: the app has always run as `cli_user_placeholder` (it owns the
 * seeded catalog, and the dev/MCP tokens are minted for it), so setting the
 * owner's email + password on that same user keeps task ownership, the catalog,
 * and any existing tokens coherent. Only if no placeholder is present (e.g. a DB
 * that never booted the seed) does it create a fresh user. Returns a token so
 * setup logs you straight in.
 */
router.post('/setup', authLimiter, validateBody(credentialsSchema), async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  // Guard first: never let setup run once a real account exists. (On a
  // single-user local app the tiny check-then-write race is immaterial, and the
  // unique-email constraint is the backstop.)
  const owner = await prisma.user.findFirst({ where: OWNER_FILTER });
  if (owner) {
    throw new HttpError(409, 'An account already exists on this instance. Log in instead.');
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const placeholder = await prisma.user.findFirst({
    where: { OR: [{ password: null }, { password: '' }] }
  });

  let user;
  try {
    user = placeholder
      ? await prisma.user.update({
          where: { id: placeholder.id },
          data: { email, password: hashedPassword, ...(name ? { name } : {}) }
        })
      : await prisma.user.create({ data: { email, password: hashedPassword, name } });
  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new HttpError(409, 'That email is already in use.');
    }
    throw error;
  }

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

// There is deliberately NO generic `POST /register` here.
//
// It existed until 2026-07-31 as an unauthenticated account-creation primitive —
// never surfaced in the UI, kept "for the tests and a future multi-user path".
// On a local-first install that is a public account-creation endpoint on a
// service whose whole job is creating and running commands on your machine, and
// the P3 remote-access work is specifically about making that service reachable
// from other devices. The single-user product already has the account paths it
// needs: /setup creates the one owner (409 afterwards) and /login authenticates.
//
// If multi-user is ever built, registration comes back as a designed flow with
// an invite or an owner-gated approval — not as a leftover primitive. See the
// deferred multi-tenant item in docs/ROADMAP.md, and the integration suite,
// which pins its absence.

const loginSchema = z.object({
  email: z.string().min(1, 'Email and password required'),
  password: z.string().min(1, 'Email and password required')
});

router.post('/login', authLimiter, validateBody(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
  // Same 401 whether the email is unknown or the password is wrong — don't leak
  // which accounts exist. `!user.password` covers a user row with no password set.
  if (!user || !user.password) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const validPassword = await bcrypt.compare(password, user.password);
  if (!validPassword) {
    throw new HttpError(401, 'Invalid email or password');
  }

  const token = generateToken(user);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters')
});

/**
 * Change the signed-in user's password. Requires a valid token AND the current
 * password (a stolen session alone can't lock the owner out). No email/reset
 * flow — that stays deferred with the rest of multi-tenant.
 */
router.patch('/password', authenticateToken, validateBody(changePasswordSchema), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).user!.id;
  const { currentPassword, newPassword } = req.body;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.password) {
    throw new HttpError(401, 'Not authenticated');
  }

  const validPassword = await bcrypt.compare(currentPassword, user.password);
  if (!validPassword) {
    throw new HttpError(401, 'Current password is incorrect');
  }

  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: userId }, data: { password: hashedPassword } });
  res.json({ success: true });
});

export default router;
