/**
 * "What does the database actually contain?" — a read-only snapshot.
 *
 *   cd backend && npm run db:check
 *
 * This exists because that question has already diagnosed a real bug. In
 * troubleshooting #22 the sync route reported `missing: 56` while the DB was
 * byte-identical before and after: the container's generated Prisma client
 * predated the `MISSING` enum member, so `TaskStatus.MISSING` was `undefined`
 * and Prisma dropped the field. Nothing in the app said so — the only way
 * through it was to look at the rows directly.
 *
 * So it leads with the stale-client check (the thing that makes every count
 * below untrustworthy) and then prints counts by the dimensions the app makes
 * decisions on. It writes nothing.
 */
import { prisma, missingTaskStatusMembers } from '../src/db.js';

function table(rows: Array<[string, string | number]>, indent = '  '): void {
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    console.log(`${indent}${label.padEnd(width)}  ${value}`);
  }
}

async function main(): Promise<void> {
  console.log(`\nCronsole DB snapshot — ${new Date().toISOString()}`);

  // First, because a stale client makes every number below a claim rather than
  // a fact: it silently drops enum values it doesn't know.
  const absentStatuses = missingTaskStatusMembers();
  console.log('\nGenerated Prisma client');
  if (absentStatuses.length === 0) {
    console.log('  current (all TaskStatus members present)');
  } else {
    console.log(`  STALE — TaskStatus is missing: ${absentStatuses.join(', ')}`);
    console.log('  Writes to those values are silently dropped. See troubleshooting #22.');
  }

  const [users, owners, tasks, exclusions, templates, managed, favorites, connections, runs] =
    await Promise.all([
      prisma.user.count(),
      // An "account" is a user with a password — the boot seed's password-less
      // catalog placeholder is not one (see routes/auth.ts).
      prisma.user.count({ where: { AND: [{ password: { not: null } }, { password: { not: '' } }] } }),
      prisma.task.count(),
      prisma.taskExclusion.count(),
      prisma.template.count(),
      prisma.template.count({ where: { managed: true } }),
      prisma.templateFavorite.count(),
      prisma.platformConnection.count(),
      prisma.executionLog.count()
    ]);

  console.log('\nAccounts');
  table([
    ['users', users],
    ['with a password (real accounts)', owners]
  ]);

  console.log('\nTasks');
  const byPlatform = await prisma.task.groupBy({ by: ['platform'], _count: { _all: true } });
  const byStatus = await prisma.task.groupBy({ by: ['status'], _count: { _all: true } });
  table([
    ['total', tasks],
    ...byPlatform.map(r => [`  by platform · ${r.platform}`, r._count._all] as [string, number]),
    ...byStatus.map(r => [`  by status · ${r.status}`, r._count._all] as [string, number]),
    ['untracked exclusions', exclusions]
  ]);

  console.log('\nTemplates');
  table([
    ['total', templates],
    ['managed (auto-synced core — pruned on sync)', managed],
    ['unmanaged (imported / saved-as-template)', templates - managed],
    ['favorites', favorites]
  ]);

  console.log('\nOther');
  const latestRun = await prisma.executionLog.findFirst({
    orderBy: { triggeredAt: 'desc' },
    select: { triggeredAt: true, status: true }
  });
  table([
    ['platform connections', connections],
    // ExecutionLog records runs Cronsole PERFORMED, not runs that happened — a
    // Windows task firing on its own schedule writes nothing here.
    ['execution log rows (Cronsole-performed runs)', runs],
    ['latest run', latestRun ? `${latestRun.triggeredAt.toISOString()} (${latestRun.status})` : 'none']
  ]);

  console.log('');
}

main()
  .catch(e => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
