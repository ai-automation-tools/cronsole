/**
 * Export the live DB catalog to a portable Registry v1 bundle.
 *
 * Export reads the *DB* (not the bundled/remote source) because the DB is what
 * the user actually sees in the Templates tab — including anything they've
 * imported. Each row is lowered via ./denormalize.ts and the bundle round-trips
 * straight back through ./importCatalog.ts.
 */

import { prisma } from '../db.js';
import { denormalizeTemplate } from './denormalize.js';
import { registryTemplateSchema, type RegistryTemplate } from './schema.js';

/** The download shape import accepts (also accepts a bare array / single object). */
export interface ExportBundle {
  cronsoleCatalogVersion: '1.0';
  exportedAt: string;
  templates: RegistryTemplate[];
}

/**
 * Build an export bundle. Pass `ids` to export a subset (e.g. a single selected
 * template); omit for the whole catalog. `exportedAt` is injected so the pure
 * mapping stays testable without a clock.
 */
export async function exportCatalog(
  exportedAt: string,
  ids?: string[]
): Promise<ExportBundle> {
  const rows = await prisma.template.findMany({
    where: ids && ids.length > 0 ? { id: { in: ids } } : undefined,
    orderBy: [{ isStarter: 'desc' }, { name: 'asc' }]
  });

  // Emit only rows that lower to a valid, round-trippable v1 template. A row
  // that can't be denormalized (no mappable target) or wouldn't pass the v1
  // schema (e.g. a degenerate empty command) is skipped rather than 500-ing the
  // whole download or poisoning the bundle with an entry import would reject.
  // The seeded/imported catalog never produces such rows; this only guards
  // legacy/foreign data.
  const templates: RegistryTemplate[] = [];
  for (const row of rows) {
    let lowered: RegistryTemplate;
    try {
      lowered = denormalizeTemplate(row);
    } catch {
      continue;
    }
    if (registryTemplateSchema.safeParse(lowered).success) templates.push(lowered);
  }

  return { cronsoleCatalogVersion: '1.0', exportedAt, templates };
}
