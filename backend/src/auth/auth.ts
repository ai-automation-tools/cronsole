import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Fail fast on a missing/weak JWT secret. A signing key is what stands between
// an anonymous request and a forged identity — booting with a hardcoded fallback
// would let anyone mint a valid token, so refuse to start without a real one.
const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 16) {
  throw new Error(
    'JWT_SECRET must be set to a strong value (>= 16 chars). Refusing to start with a missing or weak secret.'
  );
}
const JWT_SECRET: string = secret;

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
  };
}

/**
 * Middleware to verify JWT token
 */
export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

/**
 * Verify a JWT and return its payload, or null if invalid/expired. Used by the
 * Socket.IO UI channel, which authenticates on the handshake instead of a header.
 */
export function verifyToken(token: string): { id: string; email: string } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { id: string; email: string };
  } catch {
    return null;
  }
}

/**
 * Generate JWT token
 */
export const generateToken = (user: { id: string; email: string }) => {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
};
