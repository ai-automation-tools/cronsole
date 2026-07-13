/**
 * Seed the template catalog into the DB.
 *
 * Thin wrapper over the shared sync path (catalog/catalogSync.ts) — the same
 * upsert the backend's runtime refresh uses — so `npm run seed` and the running
 * server can't diverge. Catalog content is loaded through the TemplateCatalogSource
 * (bundled v1 snapshot, or the remote registry when TEMPLATE_REGISTRY_URL is set).
 */

import { prisma } from './db.js';
import { catalogSource } from './catalog/source.js';
import { syncCatalogToDb } from './catalog/catalogSync.js';

async function main() {
  console.log(`Seeding data from the "${catalogSource.name}" catalog source...`);
  const { count, source } = await syncCatalogToDb();
  console.log(`Seeding complete. ${count} templates upserted from "${source}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
