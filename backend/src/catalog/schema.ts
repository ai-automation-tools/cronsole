/**
 * Template Registry — v1 schema (in code).
 *
 * The canonical spec + rationale live in
 * docs/reports/templates/Registry_Schema_v1.md and the decision record in
 * docs/adr/0001-template-registry-schema.md. This is the Zod validator every
 * registry template is checked against before it's normalized into the Prisma
 * Template shape (see ./normalize.ts) — whether it comes from the bundled
 * fallback snapshot (./bundled.ts) or, later, a fetched remote registry.
 *
 * A template is target-agnostic: it describes Trigger -> Action abstractly and
 * declares which execution targets it's Compatible with. Cronsole compiles it to
 * a target's native config at apply time; a declared-but-uncompiled target is
 * the honest "copy to set up manually" path, never a silent failure.
 */

import { z } from 'zod';

// --- v1 vocabulary (lowercase-kebab; mapped to the UPPER Prisma enums at the
// import boundary in ./normalize.ts, so the DB needs no migration). ---
export const RUNTIMES = [
  'powershell', 'batch', 'bash', 'zsh', 'python', 'node',
  'applescript', 'vbscript', 'executable', 'http', 'ai-prompt'
] as const;

export const OS_TARGETS = ['windows', 'macos', 'linux', 'cross-platform'] as const;

// Full TemplateCategory coverage (the schema doc lists the common subset; the
// registry vocab covers every Prisma category so nothing is unmappable).
export const CATEGORIES = [
  'backup', 'cleanup', 'monitoring', 'dev-workflow', 'data-sync',
  'ai-agent', 'notification', 'media', 'system', 'other'
] as const;

export const COMPAT_TARGETS = [
  'windows', 'cronsole-native', 'macos', 'linux', 'claude-code', 'chatgpt'
] as const;

export const registryParameterSchema = z.object({
  key: z.string().regex(/^\w+$/, 'Parameter key must be a bare identifier.'),
  label: z.string().optional(),
  type: z.string().optional(),
  default: z.string().optional(),
  required: z.boolean().optional(),
  options: z.array(z.string()).optional(),
  help: z.string().optional()
});

// v1 compiles "schedule"; the `kind` discriminator leaves room for event/manual
// triggers later without a schema break.
export const registryTriggerSchema = z.object({
  kind: z.literal('schedule'),
  cron: z.string()
});

// The canonical, secure action form is `exec` ({program, args[]}), mapping
// straight to the no-shell structured ExecAction. `http` -> native HTTP job;
// `prompt` -> natural-language routine for AI targets.
export const registryActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('exec'),
    program: z.string(),
    args: z.array(z.string()).default([])
  }),
  z.object({
    kind: z.literal('http'),
    method: z.string().optional(),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
    body: z.string().optional()
  }),
  z.object({
    kind: z.literal('prompt'),
    text: z.string()
  }),
  // `script` and `check` -> the Cronsole-native SCRIPT and CHECK jobs added
  // 2026-08-15 (ADR 0002). Added as new union members rather than by widening
  // `exec`, because a discriminated union is how a consumer tells "a kind I do
  // not implement" from "a malformed exec" — and only the first of those is
  // safe to skip.
  //
  // Safe to publish because `RegistryCatalogSource` now skips a template it
  // cannot parse instead of dropping the whole catalog. Before that fix, adding
  // a kind here would have blanked the hosted registry for every older install.
  z.object({
    kind: z.literal('script'),
    interpreter: z.enum(['powershell', 'pwsh', 'bash', 'sh', 'python', 'node']),
    body: z.string()
  }),
  z.object({
    kind: z.literal('check'),
    // Held as a passthrough object and validated by the backend's own
    // `validateJob` at apply time. The probe shape is the *executor's* contract,
    // and a second Zod copy of it here would be a second definition that agrees
    // until it doesn't — the same argument that keeps `buildNativeJob` single.
    probe: z.record(z.string(), z.unknown())
  })
]);

export const registryExecutionSchema = z.object({
  runLevel: z.enum(['limited', 'highest']).optional(),
  workingDir: z.string().optional(),
  timeoutSec: z.number().int().nullable().optional(),
  retries: z.number().int().min(0).optional()
});

export const registryTemplateSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    // Relaxed from the strict kebab pattern in the spec so the legacy `tpl_*`
    // IDs survive (keeping the same DB rows / TemplateFavorite FKs). New
    // registry templates should use plain kebab.
    id: z.string().regex(/^[a-z0-9]+([_-][a-z0-9]+)*$/, 'Invalid template id.'),
    name: z.string().min(1),
    description: z.string().optional(),
    runtime: z.enum(RUNTIMES).optional(),
    os: z.enum(OS_TARGETS).optional(),
    category: z.enum(CATEGORIES).optional(),
    tags: z.array(z.string()).optional(),
    icon: z.string().optional(),
    isStarter: z.boolean().optional(),
    // Distribution tier. `core: true` templates are the curated set the app
    // bundles and auto-syncs into every install's DB by default; everything else
    // is "extended" — it lives in the registry/gallery and is pulled into a DB
    // only when a user imports it. Absent ⇒ extended. (The full registry always
    // contains both; only the *auto-sync* is limited to core — see catalogSync.)
    core: z.boolean().optional(),
    trigger: registryTriggerSchema,
    action: registryActionSchema.optional(),
    // Authoring shorthand (kept per the 2026-07-13 decision): a command string
    // with {{placeholders}} that the substitution pipeline tokenizes. The
    // bundled snapshot uses this so the exact current strings survive
    // byte-for-byte (the quote-around-{{placeholder}} signal the tokenizer
    // relies on must not change).
    commandTemplate: z.string().optional(),
    parameters: z.array(registryParameterSchema).optional(),
    compatibleTargets: z.array(z.enum(COMPAT_TARGETS)).min(1),
    execution: registryExecutionSchema.optional(),
    author: z.string().optional(),
    version: z.string().optional()
  })
  .refine((t) => Boolean(t.action) || Boolean(t.commandTemplate), {
    message: 'A template must define either `action` or `commandTemplate`.'
  });

export type RegistryTemplate = z.infer<typeof registryTemplateSchema>;
export type RegistryParameter = z.infer<typeof registryParameterSchema>;
export type RegistryAction = z.infer<typeof registryActionSchema>;

// --- Registry index (index.json) ---------------------------------------------
// One lightweight entry per template — enough to render the Templates tab
// (search/filter/group) without fetching every template file. `sha256` is the
// integrity hash of the referenced template file's bytes; a consumer verifies
// it before parsing the fetched file as executable content.
export const registryIndexEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isStarter: z.boolean().optional(),
  // Mirrors the template's `core` flag so the gallery can badge "built-in" vs
  // "import" without fetching every template file. Absent ⇒ extended.
  core: z.boolean().optional(),
  runtime: z.string().optional(),
  os: z.string().optional(),
  compatibleTargets: z.array(z.string()),
  path: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex chars.')
});

// --- Packs -------------------------------------------------------------------
// A curated set of templates a user can import in one go. Membership is
// declared (see catalog/packs.ts), never derived from tags — once a pack is a
// downloadable artifact, "the Developer Pack quietly gained a member because
// someone added a tag" changes what lands in someone's catalog.
//
// `path` points at a self-contained bundle in the *shape import already
// accepts*, so downloading a pack and importing it is one step, not two.
export const registryPackSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'Pack id must be lowercase kebab-case.'),
  name: z.string(),
  description: z.string().optional(),
  /** Ids of the templates in this pack. Every one must exist in `templates`. */
  templateIds: z.array(z.string()).min(1, 'A pack must contain at least one template.'),
  /** Registry-relative path to the bundle, e.g. "packs/developer.json". */
  path: z.string(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex chars.')
});

export const registryIndexSchema = z.object({
  registryVersion: z.literal('1.0'),
  updatedAt: z.string().optional(),
  templates: z.array(registryIndexEntrySchema),
  /**
   * Optional on purpose, in both directions:
   *  - a registry published before packs existed has no `packs` key and must
   *    still parse, and
   *  - an app built before packs existed parses a registry that has one, because
   *    `z.object()` strips unknown keys rather than rejecting them.
   * So the key can roll out without a coordinated release.
   */
  packs: z.array(registryPackSchema).optional()
});

/**
 * A downloadable pack bundle (`packs/<id>.json`).
 *
 * Deliberately shaped like the catalog export bundle (`cronsoleCatalogVersion` +
 * `templates`) so import accepts it untouched, with a `pack` block added for
 * provenance — import reads `.templates` and ignores the rest.
 *
 * Note there is **no timestamp**: registry files are content-addressed by
 * sha256 over their exact bytes, so a clock in the payload would change the
 * hash on every build and make the drift test meaningless.
 */
export const registryPackBundleSchema = z.object({
  cronsoleCatalogVersion: z.literal('1.0'),
  pack: z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional()
  }),
  templates: z.array(registryTemplateSchema)
});

export type RegistryIndex = z.infer<typeof registryIndexSchema>;
export type RegistryIndexEntry = z.infer<typeof registryIndexEntrySchema>;
export type RegistryPack = z.infer<typeof registryPackSchema>;
export type RegistryPackBundle = z.infer<typeof registryPackBundleSchema>;
