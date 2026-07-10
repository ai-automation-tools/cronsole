import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../db.js';
import { generateToken } from '../auth/auth.js';
import { HttpError } from '../middleware/errorHandler.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const registerSchema = z.object({
  email: z.email('A valid email is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().trim().min(1).optional()
});

// Register
router.post('/register', validateBody(registerSchema), async (req: Request, res: Response) => {
  const { email, password, name } = req.body;

  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
      }
    });
    const token = generateToken(user);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: any) {
    if (error.code === 'P2002') {
      throw new HttpError(400, 'Email already exists');
    }
    throw error;
  }
});

const loginSchema = z.object({
  email: z.string().min(1, 'Email and password required'),
  password: z.string().min(1, 'Email and password required')
});

// Login
router.post('/login', validateBody(loginSchema), async (req: Request, res: Response) => {
  const { email, password } = req.body;

  const user = await prisma.user.findUnique({ where: { email } });
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

export default router;
