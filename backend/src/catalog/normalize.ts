/**
 * Normalize a Registry v1 template into the Prisma Template shape.
 *
 * This is the import boundary where the human-friendly lowercase-kebab registry
 * vocabulary maps to the UPPER Prisma enums (per the 2026-07-13 decision — no DB
 * migration). It's the only place that knows both vocabularies.
 *
 * Behavior contract: for the bundled snapshot (which uses `commandTemplate`
 * shorthand), the produced `command`/`commandTemplate`/`scheduleExpression`/
 * `parameters` are byte-for-byte what the previous inlined seed produced, so the
 * DB content is unchanged.
 */

import {
  PlatformType,
  ScriptType,
  OsTarget,
  TemplateCategory,
  Prisma
} from '@prisma/client';
import { formatCommandLine } from '../utils/templateCommand.js';
import type { RegistryTemplate } from './schema.js';

export const RUNTIME_TO_SCRIPT: Record<string, ScriptType> = {
  powershell: ScriptType.POWERSHELL,
  batch: ScriptType.BATCH,
  bash: ScriptType.BASH,
  zsh: ScriptType.ZSH,
  python: ScriptType.PYTHON,
  node: ScriptType.NODE,
  applescript: ScriptType.APPLESCRIPT,
  vbscript: ScriptType.VBSCRIPT,
  executable: ScriptType.EXECUTABLE,
  http: ScriptType.HTTP,
  'ai-prompt': ScriptType.AI_PROMPT
};

export const OS_TO_TARGET: Record<string, OsTarget> = {
  windows: OsTarget.WINDOWS,
  macos: OsTarget.MACOS,
  linux: OsTarget.LINUX,
  'cross-platform': OsTarget.CROSS_PLATFORM
};

export const CATEGORY_TO_ENUM: Record<string, TemplateCategory> = {
  backup: TemplateCategory.BACKUP,
  cleanup: TemplateCategory.CLEANUP,
  monitoring: TemplateCategory.MONITORING,
  'dev-workflow': TemplateCategory.DEV_WORKFLOW,
  'data-sync': TemplateCategory.DATA_SYNC,
  'ai-agent': TemplateCategory.AI_AGENT,
  notification: TemplateCategory.NOTIFICATION,
  media: TemplateCategory.MEDIA,
  system: TemplateCategory.SYSTEM,
  other: TemplateCategory.OTHER
};

// `linux` has no PlatformType today (no Linux agent) — it maps to nothing and is
// dropped from targetPlatforms, matching the current catalog which never used it.
export const TARGET_TO_PLATFORM: Record<string, PlatformType | undefined> = {
  windows: PlatformType.WINDOWS_TASK_SCHEDULER,
  'taskhub-native': PlatformType.TASKHUB_NATIVE,
  macos: PlatformType.MACOS_LAUNCHD,
  'claude-code': PlatformType.CLAUDE_CODE,
  chatgpt: PlatformType.CHATGPT,
  linux: undefined
};

/** The Prisma-ready fields for a Template (everything except the `user` relation). */
export interface NormalizedTemplate {
  id: string;
  name: string;
  description?: string;
  sourcePlatform: PlatformType;
  targetPlatforms: PlatformType[];
  scheduleExpression: string;
  command: string;
  commandTemplate: string;
  parameters: Prisma.InputJsonValue;
  tags: string[];
  scriptType: ScriptType;
  os: OsTarget;
  category: TemplateCategory;
  icon?: string;
  isStarter: boolean;
}

/**
 * Resolve the command string. The bundled snapshot uses `commandTemplate`
 * shorthand (passed through verbatim so the tokenizer's quote signals survive).
 * A structured `action` is lowered best-effort — used only by future
 * structured-action templates, not the current catalog.
 */
function deriveCommand(t: RegistryTemplate): string {
  if (t.commandTemplate !== undefined) return t.commandTemplate;
  const a = t.action!; // schema guarantees action || commandTemplate
  if (a.kind === 'exec') return formatCommandLine([a.program, ...a.args]);
  if (a.kind === 'prompt') return a.text;
  return a.url; // http
}

export function normalizeTemplate(t: RegistryTemplate): NormalizedTemplate {
  const targetPlatforms = [
    ...new Set(
      t.compatibleTargets
        .map((c) => TARGET_TO_PLATFORM[c])
        .filter((p): p is PlatformType => p !== undefined)
    )
  ];

  // sourcePlatform mirrors the previous seed: the first compatible target that
  // maps to a real platform.
  const sourcePlatform = t.compatibleTargets
    .map((c) => TARGET_TO_PLATFORM[c])
    .find((p): p is PlatformType => p !== undefined);

  if (!sourcePlatform) {
    throw new Error(
      `Template "${t.id}" has no compatibleTargets that map to a platform.`
    );
  }

  const command = deriveCommand(t);

  return {
    id: t.id,
    name: t.name,
    description: t.description,
    sourcePlatform,
    targetPlatforms,
    scheduleExpression: t.trigger.cron,
    command,
    commandTemplate: command,
    parameters: (t.parameters ?? []) as Prisma.InputJsonValue,
    tags: t.tags ?? [],
    scriptType: t.runtime ? RUNTIME_TO_SCRIPT[t.runtime] : ScriptType.AI_PROMPT,
    os: t.os ? OS_TO_TARGET[t.os] : OsTarget.CROSS_PLATFORM,
    category: t.category ? CATEGORY_TO_ENUM[t.category] : TemplateCategory.OTHER,
    icon: t.icon,
    isStarter: t.isStarter ?? false
  };
}
