/**
 * Import Registry v1 templates into the DB catalog — the inverse of export
 * (./denormalize.ts) and the way a user (or an agent) grows/edits the catalog
 * without a reseed or redeploy.
 *
 * A registry template is *untrusted, executable* content, so import applies the
 * same defenses as everything else the catalog touches:
 *   1. structural validation against `registryTemplateSchema` (./schema.ts);
 *   2. the same `{{placeholder}}` resolvability check the Apply flow enforces —
 *      every placeholder in the command must be a declared parameter and the
 *      command must resolve to a non-empty, no-shell structured action;
 *   3. normalize + upsert-by-id (favorites, applied tasks untouched — mirrors
 *      catalogSync).
 *
 * Bad templates don't fail the whole batch: each is validated independently and
 * reported in `errors`, so a hand-authored file with one typo still imports the
 * rest. Imports join the *shared* catalog (owner = CATALOG_OWNER_ID), matching
 * how the seeded library is stored and read globally.
 */

import { prisma } from '../db.js';
import { registryTemplateSchema, type RegistryTemplate } from './schema.js';
import { normalizeTemplate } from './normalize.js';
import { ensureCatalogOwner, CATALOG_OWNER_ID } from './catalogSync.js';
import {
  resolveTemplateParams,
  substituteStructuredCommand,
  TemplateParamError,
  type TemplateParameterDef
} from '../utils/templateCommand.js';

export interface ImportResult {
  /** Number of template entries seen in the payload. */
  total: number;
  /** Ids of templates that did not previously exist. */
  created: string[];
  /** Ids of templates that were overwritten in place. */
  updated: string[];
  /** Per-entry failures (schema/resolvability), keyed by id when known. */
  errors: { id?: string; error: string }[];
}

/**
 * Coerce an import payload into a flat list of candidate template objects.
 * Accepts a single template object, a bare array, or an envelope with a
 * `templates` array (what export produces). Anything else yields an empty list
 * and a top-level error at the caller.
 */
export function extractTemplateCandidates(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const envelope = payload as { templates?: unknown };
    if (Array.isArray(envelope.templates)) return envelope.templates;
    // A single bare template object.
    return [payload];
  }
  return [];
}

/**
 * Run the same {{placeholder}} validation Apply uses, so an imported template
 * can never carry an unfillable placeholder or resolve to an empty command.
 * Synthesizes a value for every declared parameter (default → first select
 * option → a dummy) and drives the real substitution pipeline.
 */
function assertResolvable(t: RegistryTemplate): void {
  const commandTemplate = t.commandTemplate ?? '';
  // Templates that carry only a structured `action` (no commandTemplate) aren't
  // produced by the current catalog; the schema's action||commandTemplate refine
  // already guarantees one exists. We only resolvability-check the command form.
  if (!commandTemplate) return;

  const defs = (t.parameters ?? []) as TemplateParameterDef[];
  const provided: Record<string, string> = {};
  for (const def of defs) {
    if (!def || typeof def.key !== 'string') continue;
    provided[def.key] =
      (def.default && def.default.trim() ? def.default : undefined) ??
      def.options?.[0] ??
      'x';
  }

  const values = resolveTemplateParams(defs, provided);
  // Throws TemplateParamError on an undeclared placeholder or an empty command.
  substituteStructuredCommand(commandTemplate, values);
}

/**
 * Validate + upsert a batch of candidate templates. Never throws for a bad
 * entry — collects failures in `errors` and imports the rest.
 */
export async function importTemplates(payload: unknown): Promise<ImportResult> {
  const candidates = extractTemplateCandidates(payload);
  const result: ImportResult = { total: candidates.length, created: [], updated: [], errors: [] };

  if (candidates.length === 0) {
    result.errors.push({
      error: 'No templates found. Provide a template object, an array, or an { templates: [...] } file.'
    });
    return result;
  }

  await ensureCatalogOwner();

  // One existence query for the whole batch (instead of a findUnique per entry)
  // so created-vs-updated labeling costs a single round-trip regardless of size.
  const candidateIds = candidates
    .map((c) => (c as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === 'string');
  const existingRows = await prisma.template.findMany({
    where: { id: { in: candidateIds } },
    select: { id: true }
  });
  const existingIds = new Set(existingRows.map((r) => r.id));

  for (const candidate of candidates) {
    const id = (candidate as { id?: unknown })?.id;
    const idStr = typeof id === 'string' ? id : undefined;

    const parsed = registryTemplateSchema.safeParse(candidate);
    if (!parsed.success) {
      result.errors.push({
        id: idStr,
        error: `Schema validation failed: ${parsed.error.issues[0]?.message ?? parsed.error.message}`
      });
      continue;
    }
    const template = parsed.data;

    try {
      assertResolvable(template);
    } catch (err) {
      const message = err instanceof TemplateParamError ? err.message : String(err);
      result.errors.push({ id: template.id, error: message });
      continue;
    }

    let normalized;
    try {
      normalized = normalizeTemplate(template);
    } catch (err) {
      result.errors.push({ id: template.id, error: (err as Error).message });
      continue;
    }

    const { id: templateId, ...data } = normalized;
    const existed = existingIds.has(templateId);
    await prisma.template.upsert({
      where: { id: templateId },
      update: data,
      create: { id: templateId, user: { connect: { id: CATALOG_OWNER_ID } }, ...data }
    });
    (existed ? result.updated : result.created).push(templateId);
  }

  return result;
}
