/**
 * Denormalize a Prisma Template back into a Registry v1 template — the inverse of
 * ./normalize.ts.
 *
 * This is what template *export* is built on: a user's live catalog (the DB) is
 * the source of truth for what they see, so exporting reads the DB rows and
 * lowers them to the portable, target-agnostic v1 JSON that ./schema.ts
 * validates and that import (./importCatalog.ts) round-trips back in.
 *
 * The inverse enum maps are derived from the forward maps in ./normalize.ts so
 * the two can't drift. A few v1 fields aren't persisted on the Prisma model
 * (tags, author, version, execution, structured `action`) — they're optional in
 * the schema and simply omitted; the catalog uses `commandTemplate` shorthand,
 * which round-trips exactly.
 */

import { PlatformType, ScriptType, OsTarget, TemplateCategory } from '@prisma/client';
import {
  RUNTIME_TO_SCRIPT,
  OS_TO_TARGET,
  CATEGORY_TO_ENUM,
  TARGET_TO_PLATFORM
} from './normalize.js';
import type {
  RegistryTemplate,
  RegistryParameter
} from './schema.js';

/** Invert a forward `{ key -> enumValue }` map into `{ enumValue -> key }`. */
function invert<V extends string>(
  forward: Record<string, V | undefined>
): Record<V, string> {
  const out = {} as Record<V, string>;
  for (const [key, value] of Object.entries(forward)) {
    if (value !== undefined && !(value in out)) out[value] = key;
  }
  return out;
}

const SCRIPT_TO_RUNTIME = invert<ScriptType>(RUNTIME_TO_SCRIPT);
const TARGET_TO_OS = invert<OsTarget>(OS_TO_TARGET);
const ENUM_TO_CATEGORY = invert<TemplateCategory>(CATEGORY_TO_ENUM);
const PLATFORM_TO_TARGET = invert<PlatformType>(
  // TARGET_TO_PLATFORM's value type includes undefined (linux -> nothing); the
  // undefined entries are skipped by invert(), so no `linux` target is produced.
  TARGET_TO_PLATFORM as Record<string, PlatformType | undefined>
);

/** The subset of Prisma Template fields export needs. */
export interface DbTemplateLike {
  id: string;
  name: string;
  description?: string | null;
  sourcePlatform: PlatformType;
  targetPlatforms: PlatformType[];
  scheduleExpression: string;
  command?: string | null;
  commandTemplate?: string | null;
  parameters?: unknown;
  scriptType: ScriptType;
  os: OsTarget;
  category: TemplateCategory;
  icon?: string | null;
  isStarter: boolean;
}

/**
 * Map the DB's PlatformType[] back to v1 `compatibleTargets`. sourcePlatform is
 * included first so the primary target leads (mirroring how normalize picks
 * sourcePlatform as the first mappable target). Platforms with no v1 target
 * (Jules/OpenClaw/Hermes — never used by the catalog) are dropped; the schema
 * requires at least one, which sourcePlatform always satisfies for a real row.
 */
function compatibleTargets(t: DbTemplateLike): RegistryTemplate['compatibleTargets'] {
  const ordered = [t.sourcePlatform, ...t.targetPlatforms];
  const seen = new Set<string>();
  const targets: string[] = [];
  for (const platform of ordered) {
    const target = PLATFORM_TO_TARGET[platform];
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
  }
  if (targets.length === 0) {
    throw new Error(
      `Template "${t.id}" has no platforms that map to a v1 compatible target.`
    );
  }
  return targets as RegistryTemplate['compatibleTargets'];
}

/** Normalize the stored `parameters` JSON into the v1 parameter array shape. */
function toRegistryParameters(raw: unknown): RegistryParameter[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p) => {
      const param: RegistryParameter = { key: String(p.key) };
      if (typeof p.label === 'string') param.label = p.label;
      if (typeof p.type === 'string') param.type = p.type;
      if (typeof p.default === 'string') param.default = p.default;
      if (typeof p.required === 'boolean') param.required = p.required;
      if (Array.isArray(p.options)) param.options = p.options.map(String);
      if (typeof p.help === 'string') param.help = p.help;
      return param;
    });
}

/**
 * Lower a Prisma Template row to a Registry v1 template. The result is guaranteed
 * to satisfy `registryTemplateSchema` for any well-formed catalog row (callers
 * that export a whole catalog should still validate, since the DB can in
 * principle hold hand-edited rows).
 */
export function denormalizeTemplate(t: DbTemplateLike): RegistryTemplate {
  const commandTemplate = t.commandTemplate ?? t.command ?? '';
  const template: RegistryTemplate = {
    schemaVersion: '1.0',
    id: t.id,
    name: t.name,
    trigger: { kind: 'schedule', cron: t.scheduleExpression },
    commandTemplate,
    compatibleTargets: compatibleTargets(t)
  };

  if (t.description) template.description = t.description;
  const runtime = SCRIPT_TO_RUNTIME[t.scriptType];
  if (runtime) template.runtime = runtime as RegistryTemplate['runtime'];
  const os = TARGET_TO_OS[t.os];
  if (os) template.os = os as RegistryTemplate['os'];
  const category = ENUM_TO_CATEGORY[t.category];
  if (category) template.category = category as RegistryTemplate['category'];
  if (t.icon) template.icon = t.icon;
  if (t.isStarter) template.isStarter = true;
  const parameters = toRegistryParameters(t.parameters);
  if (parameters) template.parameters = parameters;

  return template;
}
