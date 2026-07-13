/**
 * RegistryCatalogSource — loads templates from a remote static registry
 * (index.json + templates/*.json), verifying each template's sha256 before it's
 * parsed, caching the last good result, and falling back to a bundled source on
 * any failure. This is what lets the catalog update without shipping the app:
 * push new template files to the registry host, and the next fetch picks them up.
 *
 * Security: fetched templates are untrusted, executable content. Each is (1)
 * integrity-checked against the index sha256 and (2) validated against the v1
 * schema before use — a mismatch or malformed file aborts the whole fetch and
 * falls back rather than seeding partial/unverified data.
 */

import { createHash } from 'node:crypto';
import {
  registryIndexSchema,
  registryTemplateSchema,
  type RegistryTemplate
} from './schema.js';
import { normalizeTemplate, type NormalizedTemplate } from './normalize.js';
import type { TemplateCatalogSource } from './source.js';

type FetchImpl = typeof fetch;

export interface RegistrySourceOptions {
  /** Base URL of the registry, e.g. https://cdn.example.com/taskhub-registry */
  baseUrl: string;
  /** Used when a fetch/verify fails and there's no fresh cache (e.g. bundled). */
  fallback: TemplateCatalogSource;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: FetchImpl;
  /** Cache lifetime for a successful fetch. Default 5 minutes. */
  cacheTtlMs?: number;
  logger?: (message: string) => void;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export class RegistryCatalogSource implements TemplateCatalogSource {
  readonly name = 'registry';

  private readonly baseUrl: string;
  private readonly fallback: TemplateCatalogSource;
  private readonly fetchImpl: FetchImpl;
  private readonly cacheTtlMs: number;
  private readonly log: (message: string) => void;

  private cache?: { at: number; raw: RegistryTemplate[] };

  constructor(opts: RegistrySourceOptions) {
    this.baseUrl = opts.baseUrl;
    this.fallback = opts.fallback;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.cacheTtlMs = opts.cacheTtlMs ?? 5 * 60 * 1000;
    this.log = opts.logger ?? (() => {});
  }

  async listRaw(): Promise<RegistryTemplate[]> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < this.cacheTtlMs) {
      return this.cache.raw;
    }
    try {
      const raw = await this.fetchAll();
      this.cache = { at: now, raw };
      return raw;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (this.cache) {
        this.log(`registry fetch failed (${reason}); serving last cached catalog.`);
        return this.cache.raw;
      }
      this.log(`registry fetch failed (${reason}); falling back to "${this.fallback.name}".`);
      return this.fallback.listRaw();
    }
  }

  async list(): Promise<NormalizedTemplate[]> {
    const raw = await this.listRaw();
    return raw.map(normalizeTemplate);
  }

  private async fetchAll(): Promise<RegistryTemplate[]> {
    const indexRes = await this.fetchImpl(joinUrl(this.baseUrl, 'index.json'));
    if (!indexRes.ok) {
      throw new Error(`index.json HTTP ${indexRes.status}`);
    }
    const index = registryIndexSchema.parse(await indexRes.json());

    const templates: RegistryTemplate[] = [];
    for (const entry of index.templates) {
      const res = await this.fetchImpl(joinUrl(this.baseUrl, entry.path));
      if (!res.ok) {
        throw new Error(`${entry.path} HTTP ${res.status}`);
      }
      const text = await res.text();
      const actual = sha256Hex(text);
      if (actual !== entry.sha256) {
        throw new Error(
          `checksum mismatch for ${entry.id} (${entry.path}): expected ${entry.sha256}, got ${actual}`
        );
      }
      templates.push(registryTemplateSchema.parse(JSON.parse(text)));
    }
    return templates;
  }
}
