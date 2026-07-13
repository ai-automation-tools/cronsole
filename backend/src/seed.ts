/**
 * Seed the template catalog into the DB.
 *
 * The catalog content no longer lives inline here — it's loaded through the
 * TemplateCatalogSource (currently the bundled v1 snapshot in src/catalog/).
 * This file is now just the materializer: pull normalized templates from the
 * source and upsert them under the placeholder user. Swapping in a
 * registry-backed source later requires no change here.
 */

import { prisma } from './db.js';
import { catalogSource } from './catalog/source.js';

async function main() {
  console.log(`Seeding data from the "${catalogSource.name}" catalog source...`);

  const user = await prisma.user.upsert({
    where: { email: 'mike@example.com' },
    update: {},
    create: {
      id: 'cli_user_placeholder',
      email: 'mike@example.com',
      name: 'Mike'
    }
  });

  const templates = await catalogSource.list();

  for (const { id, ...data } of templates) {
    await prisma.template.upsert({
      where: { id },
      update: data,
      create: { id, user: { connect: { id: user.id } }, ...data }
    });
  }

  const starters = templates.filter((t) => t.isStarter).length;
  const patterns = templates.length - starters;
  console.log(
    `Seeding complete. ${templates.length} templates upserted ` +
      `(${patterns} patterns, ${starters} starters).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
