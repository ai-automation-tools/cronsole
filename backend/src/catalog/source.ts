/**
 * Template catalog source — the interface the app loads templates through.
 *
 * This is the seam the Template Registry hangs off (ROADMAP: "refactor the app
 * to load from a catalog source behind an interface with the current seeded set
 * as the bundled fallback"). Today the only implementation is
 * `BundledCatalogSource` (the compiled-in v1 snapshot); a future
 * `RegistryCatalogSource` will fetch a remote `index.json` + template files,
 * cache them, and fall back to the bundled source on any failure — behind this
 * same interface, so nothing downstream changes.
 */

import { bundledCatalog } from './bundled.js';
import { registryTemplateSchema, type RegistryTemplate } from './schema.js';
import { normalizeTemplate, type NormalizedTemplate } from './normalize.js';

export interface TemplateCatalogSource {
  /** A short identifier for logs/diagnostics (e.g. "bundled", "registry"). */
  readonly name: string;
  /** Validated raw v1 templates. */
  listRaw(): Promise<RegistryTemplate[]>;
  /** Templates normalized into the Prisma Template shape, ready to upsert. */
  list(): Promise<NormalizedTemplate[]>;
}

export class BundledCatalogSource implements TemplateCatalogSource {
  readonly name = 'bundled';

  async listRaw(): Promise<RegistryTemplate[]> {
    // Validate every entry against the v1 schema so a malformed snapshot fails
    // loudly here rather than silently seeding bad data. The bundled snapshot is
    // trusted, but validating it keeps the snapshot honest to the schema and
    // exercises the exact path a fetched remote template will take.
    return bundledCatalog.map((t) => {
      const parsed = registryTemplateSchema.safeParse(t);
      if (!parsed.success) {
        const id = (t as { id?: string }).id ?? '<unknown>';
        throw new Error(
          `Bundled template "${id}" failed v1 schema validation: ${parsed.error.message}`
        );
      }
      return parsed.data;
    });
  }

  async list(): Promise<NormalizedTemplate[]> {
    const raw = await this.listRaw();
    return raw.map(normalizeTemplate);
  }
}

/**
 * The default catalog source. Swappable for a registry-backed source later
 * without touching the seed or routes.
 */
export const catalogSource: TemplateCatalogSource = new BundledCatalogSource();
