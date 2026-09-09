/**
 * Generate the static template registry from the bundled v1 snapshot.
 *
 *   npm run registry:build            # writes <repo>/registry
 *   npm run registry:build -- <dir>   # writes a custom directory
 *
 * Output:
 *   <dir>/index.json
 *   <dir>/templates/<id>.json   (one per template)
 *
 * This is the artifact that gets pushed to the static host / separate content
 * repo the app fetches from (RegistryCatalogSource). Re-run it after editing
 * the catalog; the drift test fails if the committed registry is stale.
 *
 * `updatedAt` comes from REGISTRY_UPDATED_AT if set (so a publish pipeline can
 * pin it) — otherwise the current time.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledCatalog } from './bundled.js';
import { bundledPacks } from './packs.js';
import { buildRegistry } from './registryBuild.js';

const here = dirname(fileURLToPath(import.meta.url)); // backend/src/catalog
const repoRoot = resolve(here, '..', '..', '..'); // -> repo root
const outDir = resolve(process.argv[2] ?? join(repoRoot, 'registry'));

const updatedAt = process.env.REGISTRY_UPDATED_AT || new Date().toISOString();
const built = buildRegistry(bundledCatalog, updatedAt, bundledPacks);

// Start templates/ and packs/ clean so a renamed or removed entry doesn't leave
// a stale file behind — a deleted pack that keeps serving its old bundle is a
// URL that still works and no longer should.
for (const dir of ['templates', 'packs']) {
  const full = join(outDir, dir);
  if (existsSync(full)) rmSync(full, { recursive: true, force: true });
  mkdirSync(full, { recursive: true });
}

for (const file of built.files) {
  writeFileSync(join(outDir, file.path), file.content, 'utf8');
}
writeFileSync(join(outDir, 'index.json'), built.indexJson, 'utf8');

const packCount = built.index.packs?.length ?? 0;
const templateCount = built.files.length - packCount;

console.log(
  `Registry generated at ${outDir}\n` +
    `  index.json + ${templateCount} template file(s) + ${packCount} pack bundle(s), updatedAt=${updatedAt}`
);
