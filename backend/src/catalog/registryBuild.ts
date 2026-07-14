/**
 * Pure builder that turns a Registry v1 catalog into the static-registry
 * artifact: an `index.json` plus one `templates/<id>.json` file per template,
 * each with a sha256 of its exact bytes recorded in the index.
 *
 * Kept pure (no fs, no clock) so both the generator CLI (generate-registry.ts,
 * which writes the files) and the drift test (which regenerates in memory and
 * compares to the committed artifact) share one implementation and can't drift.
 */

import { createHash } from 'node:crypto';
import {
  registryTemplateSchema,
  type RegistryTemplate,
  type RegistryIndex,
  type RegistryIndexEntry
} from './schema.js';

export interface RegistryFile {
  /** Registry-relative path, e.g. "templates/tpl_starter_powershell_script.json". */
  path: string;
  /** Exact file bytes (UTF-8 string) that get written and hashed. */
  content: string;
  sha256: string;
}

export interface BuiltRegistry {
  index: RegistryIndex;
  indexJson: string;
  files: RegistryFile[];
}

/** JSON with a trailing newline — stable across editors and `git diff`-friendly. */
function toJsonFile(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Build the registry artifact from a catalog. `updatedAt` is injected (not read
 * from a clock) so output is deterministic for a given input.
 */
export function buildRegistry(
  catalog: RegistryTemplate[],
  updatedAt: string
): BuiltRegistry {
  const files: RegistryFile[] = [];
  const entries: RegistryIndexEntry[] = [];

  for (const template of catalog) {
    const parsed = registryTemplateSchema.safeParse(template);
    if (!parsed.success) {
      const id = (template as { id?: string }).id ?? '<unknown>';
      throw new Error(
        `Cannot build registry: template "${id}" fails v1 schema — ${parsed.error.message}`
      );
    }
    const t = parsed.data;
    const path = `templates/${t.id}.json`;
    const content = toJsonFile(t);
    const sha256 = sha256Hex(content);

    files.push({ path, content, sha256 });
    entries.push({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      tags: t.tags,
      isStarter: t.isStarter,
      core: t.core,
      runtime: t.runtime,
      os: t.os,
      compatibleTargets: t.compatibleTargets,
      path,
      sha256
    });
  }

  const index: RegistryIndex = {
    registryVersion: '1.0',
    updatedAt,
    templates: entries
  };

  return { index, indexJson: toJsonFile(index), files };
}
