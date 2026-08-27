import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledCatalog } from './bundled.js';
import { bundledPacks } from './packs.js';
import { buildRegistry } from './registryBuild.js';
import { extractTemplateCandidates } from './importCatalog.js';
import { registryIndexSchema, registryPackBundleSchema } from './schema.js';
import { BundledCatalogSource } from './source.js';
import { RegistryCatalogSource } from './registrySource.js';

const here = dirname(fileURLToPath(import.meta.url));
const registryDir = resolve(here, '..', '..', '..', 'registry');

const UPDATED_AT = '2026-07-13T00:00:00Z';

/**
 * Serve a map of "/path" -> content over http on an ephemeral port. Content is
 * built in-memory (guaranteed LF) so the source tests never depend on the
 * on-disk / git line endings.
 */
function serve(files: Map<string, string>): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const body = req.url ? files.get(req.url) : undefined;
    if (body === undefined) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(body);
  });
  return new Promise((res) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      res({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r()))
      });
    });
  });
}

function registryFiles(): Map<string, string> {
  const built = buildRegistry(bundledCatalog, UPDATED_AT);
  const map = new Map<string, string>();
  map.set('/index.json', built.indexJson);
  for (const f of built.files) map.set(`/${f.path}`, f.content);
  return map;
}

let running: { close: () => Promise<void> } | undefined;
afterEach(async () => {
  await running?.close();
  running = undefined;
});

describe('RegistryCatalogSource — happy path', () => {
  it('fetches, verifies checksums, and returns the same catalog as bundled', async () => {
    const srv = await serve(registryFiles());
    running = srv;
    const src = new RegistryCatalogSource({
      baseUrl: srv.url,
      fallback: new BundledCatalogSource()
    });
    const [fromRegistry, fromBundled] = await Promise.all([
      src.list(),
      new BundledCatalogSource().list()
    ]);
    expect(fromRegistry).toHaveLength(86);
    // The registry is generated from the same snapshot, so normalized output is
    // identical — proves the fetch/verify/normalize path is faithful.
    expect(fromRegistry).toEqual(fromBundled);
  });

  it('serves from cache when the registry goes away after a good fetch', async () => {
    const srv = await serve(registryFiles());
    const src = new RegistryCatalogSource({
      baseUrl: srv.url,
      fallback: new BundledCatalogSource(),
      cacheTtlMs: 60_000
    });
    expect(await src.list()).toHaveLength(86);
    await srv.close(); // registry now unreachable
    // Still served from the fresh cache, not the fallback.
    expect(await src.list()).toHaveLength(86);
  });
});

describe('RegistryCatalogSource — failure handling', () => {
  it('falls back to bundled on a checksum mismatch (tampered file)', async () => {
    const files = registryFiles();
    // Tamper one template's bytes without updating its index sha256.
    const key = '/templates/tpl_starter_powershell_script.json';
    files.set(key, files.get(key)! + ' ');
    const srv = await serve(files);
    running = srv;

    const fallback = new BundledCatalogSource();
    const logs: string[] = [];
    const src = new RegistryCatalogSource({
      baseUrl: srv.url,
      fallback,
      logger: (m) => logs.push(m)
    });
    const list = await src.list();
    expect(list).toEqual(await fallback.list()); // fell back, didn't seed tampered data
    expect(logs.join('\n')).toMatch(/checksum mismatch/);
  });

  it('falls back to bundled when the registry is unreachable', async () => {
    // Nothing listening on this port.
    const src = new RegistryCatalogSource({
      baseUrl: 'http://127.0.0.1:1',
      fallback: new BundledCatalogSource()
    });
    expect(await src.list()).toHaveLength(86);
  });
});

describe('committed registry artifact', () => {
  it('index.json is valid and lists all 86 templates', () => {
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(join(registryDir, 'index.json'), 'utf8'))
    );
    expect(index.registryVersion).toBe('1.0');
    expect(index.templates).toHaveLength(86);
  });

  it('is in sync with the bundled snapshot (regenerate + compare, EOL-normalized)', () => {
    const committedIndexRaw = readFileSync(join(registryDir, 'index.json'), 'utf8');
    const committedUpdatedAt =
      JSON.parse(committedIndexRaw).updatedAt ?? UPDATED_AT;
    const built = buildRegistry(bundledCatalog, committedUpdatedAt, bundledPacks);

    const norm = (s: string) => s.replace(/\r\n/g, '\n');
    expect(norm(committedIndexRaw)).toBe(norm(built.indexJson));

    for (const f of built.files) {
      const onDisk = readFileSync(join(registryDir, f.path), 'utf8');
      expect(norm(onDisk), `stale registry file: ${f.path} — run "npm run registry:build"`)
        .toBe(norm(f.content));
    }
  });

  it('every declared pack has a committed bundle whose sha256 matches its bytes', () => {
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(join(registryDir, 'index.json'), 'utf8'))
    );
    expect(index.packs).toBeDefined();
    expect(index.packs).toHaveLength(bundledPacks.length);

    for (const pack of index.packs!) {
      const raw = readFileSync(join(registryDir, pack.path), 'utf8').replace(/\r\n/g, '\n');
      // Content-addressed: a consumer verifies this before parsing the bundle
      // as content it will import. A pack whose hash doesn't match its bytes is
      // exactly the tampering case the templates are already protected against.
      const actual = createHash('sha256').update(raw, 'utf8').digest('hex');
      expect(actual, `sha256 mismatch for ${pack.path}`).toBe(pack.sha256);
    }
  });

  it('pack bundles are importable as-is and contain exactly what the index claims', () => {
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(join(registryDir, 'index.json'), 'utf8'))
    );

    for (const pack of index.packs!) {
      const bundle = registryPackBundleSchema.parse(
        JSON.parse(readFileSync(join(registryDir, pack.path), 'utf8'))
      );
      expect(bundle.pack.id).toBe(pack.id);
      expect(bundle.templates.map(t => t.id)).toEqual(pack.templateIds);

      // The real contract: import must accept the file untouched. If this ever
      // diverges, "download a pack" becomes "download a pack and then fix it".
      expect(extractTemplateCandidates(bundle)).toHaveLength(pack.templateIds.length);
    }
  });

  it('every pack member is a real template in the same registry', () => {
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(join(registryDir, 'index.json'), 'utf8'))
    );
    const known = new Set(index.templates.map(t => t.id));
    for (const pack of index.packs!) {
      for (const id of pack.templateIds) {
        expect(known.has(id), `pack "${pack.id}" references unknown template "${id}"`).toBe(true);
      }
    }
  });

  it('every template belongs to at least one pack', () => {
    // Not a schema rule — a curation one. Packs are how the gallery groups the
    // catalog, so a template in no pack is unreachable by browsing collections
    // and makes "download every pack" quietly less than the catalog.
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(join(registryDir, 'index.json'), 'utf8'))
    );
    const covered = new Set(index.packs!.flatMap(p => p.templateIds));
    const orphans = index.templates.map(t => t.id).filter(id => !covered.has(id));
    expect(orphans, `templates in no pack: ${orphans.join(', ')}`).toEqual([]);
  });
});

describe('buildRegistry — pack validation', () => {
  it('refuses to build a pack referencing a template that does not exist', () => {
    // The reason membership is declared rather than derived: a typo becomes a
    // build failure instead of a bundle that silently ships fewer templates
    // than it advertises.
    expect(() =>
      buildRegistry(bundledCatalog, UPDATED_AT, [
        { id: 'broken', name: 'Broken', description: 'x', templateIds: ['does-not-exist'] }
      ])
    ).toThrow(/unknown template id/i);
  });

  it('refuses to build a pack listing the same template twice', () => {
    expect(() =>
      buildRegistry(bundledCatalog, UPDATED_AT, [
        {
          id: 'dupe',
          name: 'Dupe',
          description: 'x',
          templateIds: ['dev-git-fetch-prune', 'dev-git-fetch-prune']
        }
      ])
    ).toThrow(/duplicate template id/i);
  });

  it('omits the packs key entirely when no packs are declared', () => {
    // Keeps a pre-packs registry byte-identical, so adding the feature does not
    // churn every consumer's cached index.
    const built = buildRegistry(bundledCatalog, UPDATED_AT);
    expect(built.index.packs).toBeUndefined();
    expect(built.indexJson).not.toContain('"packs"');
  });

  it('preserves declared order rather than catalog order', () => {
    const built = buildRegistry(bundledCatalog, UPDATED_AT, [
      {
        id: 'ordered',
        name: 'Ordered',
        description: 'x',
        templateIds: ['dev-docker-prune', 'dev-git-fetch-prune']
      }
    ]);
    const bundle = JSON.parse(built.files.find(f => f.path === 'packs/ordered.json')!.content);
    expect(bundle.templates.map((t: { id: string }) => t.id)).toEqual([
      'dev-docker-prune',
      'dev-git-fetch-prune'
    ]);
  });

  it('a pack bundle is deterministic — no clock in the payload', () => {
    // Registry files are content-addressed; a timestamp inside would change the
    // hash on every build and make the drift test meaningless.
    const a = buildRegistry(bundledCatalog, '2020-01-01T00:00:00.000Z', bundledPacks);
    const b = buildRegistry(bundledCatalog, '2030-12-31T00:00:00.000Z', bundledPacks);
    const packOf = (r: typeof a) => r.files.filter(f => f.path.startsWith('packs/'));
    expect(packOf(a).map(f => f.sha256)).toEqual(packOf(b).map(f => f.sha256));
  });
});
