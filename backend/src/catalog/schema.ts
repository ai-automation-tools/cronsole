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
 * declares which execution targets it's Compatible with. TaskHub compiles it to
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
  'windows', 'taskhub-native', 'macos', 'linux', 'claude-code', 'chatgpt'
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
