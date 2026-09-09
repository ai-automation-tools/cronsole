import { PlatformType, TaskStatus } from '@prisma/client';
import { prisma } from '../../src/db.js';
import { generateToken } from '../../src/auth/auth.js';
import { serializeConfig } from '../../src/auth/connectionConfig.js';

/** Create a user directly in the DB and return it plus a valid bearer header. */
export async function createUser(email: string) {
  const user = await prisma.user.create({
    data: { email, name: email.split('@')[0] }
  });
  const token = generateToken({ id: user.id, email: user.email });
  return { user, token, auth: `Bearer ${token}` };
}

/**
 * Create a TASKHUB_NATIVE task owned by a user. Native tasks need no agent, so
 * they're the clean fixture for ownership/IDOR checks against the real routes.
 */
export async function createNativeTask(
  userId: string,
  overrides: { name?: string; externalId?: string } = {}
) {
  return prisma.task.create({
    data: {
      userId,
      platform: PlatformType.TASKHUB_NATIVE,
      externalId: overrides.externalId ?? `native_${Math.random().toString(36).slice(2, 10)}`,
      name: overrides.name ?? 'Fixture Task',
      category: 'Cronsole',
      schedule: '0 3 * * *',
      status: TaskStatus.ACTIVE,
      metadata: { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } }
    }
  });
}

/** Provision the native platform connection a run/health flow expects. */
export async function createNativeConnection(userId: string) {
  return prisma.platformConnection.create({
    data: {
      userId,
      platform: PlatformType.TASKHUB_NATIVE,
      config: serializeConfig({}),
      isActive: true,
      healthState: 'HEALTHY'
    }
  });
}
