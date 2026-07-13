import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundledCatalog } from './bundled.js';
import { buildRegistry } from './registryBuild.js';
import { registryIndexSchema } from './schema.js';
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
    expect(fromRegistry).toHaveLength(33);
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
    expect(await src.list()).toHaveLength(33);
    await srv.close(); // registry now unreachable
    // Still served from the fresh cache, not the fallback.
    expect(await src.list()).toHaveLength(33);
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
    expect(await src.list()).toHaveLength(33);
  });
});

describe('committed registry artifact', () => {
  it('index.json is valid and lists all 33 templates', () => {
    const index = registryIndexSchema.parse(
      JSON.parse(readFileSync(join(registryDir, 'index.json'), 'utf8'))
    );
    expect(index.registryVersion).toBe('1.0');
    expect(index.templates).toHaveLength(33);
  });

  it('is in sync with the bundled snapshot (regenerate + compare, EOL-normalized)', () => {
    const committedIndexRaw = readFileSync(join(registryDir, 'index.json'), 'utf8');
    const committedUpdatedAt =
      JSON.parse(committedIndexRaw).updatedAt ?? UPDATED_AT;
    const built = buildRegistry(bundledCatalog, committedUpdatedAt);

    const norm = (s: string) => s.replace(/\r\n/g, '\n');
    expect(norm(committedIndexRaw)).toBe(norm(built.indexJson));

    for (const f of built.files) {
      const onDisk = readFileSync(join(registryDir, f.path), 'utf8');
      expect(norm(onDisk), `stale registry file: ${f.path} — run "npm run registry:build"`)
        .toBe(norm(f.content));
    }
  });
});
