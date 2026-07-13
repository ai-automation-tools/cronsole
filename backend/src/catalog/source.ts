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
// registrySource imports only the *type* from this module (erased at runtime),
// so this static import creates no load-time cycle.
import { RegistryCatalogSource } from './registrySource.js';

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
 * Resolve the process-wide catalog source. When `TEMPLATE_REGISTRY_URL` is set,
 * templates are fetched from that remote static registry (integrity-checked,
 * cached) with the bundled snapshot as the fallback; otherwise the bundled
 * snapshot is used directly. Either way the seed/routes just call `.list()`.
 */
export function buildCatalogSource(env: NodeJS.ProcessEnv = process.env): TemplateCatalogSource {
  const bundled = new BundledCatalogSource();
  const url = env.TEMPLATE_REGISTRY_URL?.trim();
  if (!url) return bundled;

  return new RegistryCatalogSource({
    baseUrl: url,
    fallback: bundled,
    logger: (m: string) => console.log(`[catalog] ${m}`)
  });
}

export const catalogSource: TemplateCatalogSource = buildCatalogSource();
