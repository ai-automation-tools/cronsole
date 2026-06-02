import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const taskCount = await prisma.task.count();
  const templateCount = await prisma.template.count();
  const userCount = await prisma.user.count();
  console.log('Task count:', taskCount);
  console.log('Template count:', templateCount);
  console.log('User count:', userCount);
}
main().catch(console.error).finally(() => prisma.$disconnect());
