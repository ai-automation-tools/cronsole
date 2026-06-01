import { PrismaClient, PlatformType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding data...');

  const user = await prisma.user.upsert({
    where: { email: 'mike@example.com' },
    update: {},
    create: {
      id: 'cli_user_placeholder',
      email: 'mike@example.com',
      name: 'Mike'
    }
  });

  // Sample templates
  const templates = [
    {
      name: 'Daily Database Backup',
      description: 'Backs up a PostgreSQL database every night at 3 AM.',
      sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
      targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.CLAUDE_CODE],
      scheduleExpression: '0 3 * * *',
      command: 'pg_dump -U postgres my_db > backup.sql'
    },
    {
      name: 'Morning News Digest',
      description: 'Summarizes top news stories from specified RSS feeds.',
      sourcePlatform: PlatformType.CLAUDE_CODE,
      targetPlatforms: [PlatformType.CLAUDE_CODE, PlatformType.CHATGPT],
      scheduleExpression: '0 7 * * *',
      command: 'Fetch and summarize news'
    },
    {
      name: 'Weekly System Cleanup',
      description: 'Cleans up temporary files and logs every Sunday.',
      sourcePlatform: PlatformType.WINDOWS_TASK_SCHEDULER,
      targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
      scheduleExpression: '0 0 * * 0',
      command: 'del /q /s %temp%\\*'
    },
    {
      name: 'GitHub PR Triage',
      description: 'Triage new pull requests and label them based on content.',
      sourcePlatform: PlatformType.CLAUDE_CODE,
      targetPlatforms: [PlatformType.CLAUDE_CODE],
      scheduleExpression: '*/30 * * * *',
      command: 'Triage PRs'
    }
  ];

  for (const t of templates) {
    await prisma.template.upsert({
      where: { id: `tpl_${t.name.replace(/\s+/g, '_').toLowerCase()}` },
      update: t,
      create: {
        id: `tpl_${t.name.replace(/\s+/g, '_').toLowerCase()}`,
        userId: user.id,
        ...t
      }
    });
  }

  console.log('Seeding complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
