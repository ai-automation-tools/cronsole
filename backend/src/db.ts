import { PrismaClient } from '@prisma/client';

/**
 * Shared Prisma client. Every module must import this instance instead of
 * constructing its own — each PrismaClient owns a connection pool, so the old
 * one-client-per-file pattern multiplied idle Postgres connections and made
 * transaction/middleware behavior inconsistent across the app.
 */
export const prisma = new PrismaClient();
