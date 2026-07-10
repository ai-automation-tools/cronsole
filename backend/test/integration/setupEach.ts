import { beforeEach, afterAll } from 'vitest';
import { prisma } from '../../src/db.js';

// Each test starts from an empty database. TRUNCATE ... CASCADE clears the FK
// graph in one statement; RESTART IDENTITY resets sequences. Listed leaf-first
// for readability (CASCADE makes the order immaterial).
beforeEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "ExecutionLog", "Task", "PlatformConnection", "Template", "User" RESTART IDENTITY CASCADE'
  );
});

afterAll(async () => {
  await prisma.$disconnect();
});
