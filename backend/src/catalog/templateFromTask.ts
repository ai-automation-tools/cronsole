/**
 * Build a Registry v1 template from a real tracked Task — the "Save task as
 * template" path (the other non-reseed way the catalog grows, alongside import).
 *
 * A saved task is fully concrete (no {{placeholders}}), so the derived template
 * carries the task's exact command/schedule and no parameters. The route then
 * runs it through the same import pipeline (schema + resolvability + upsert), so
 * this file only has to *derive* a valid v1 template from the task's metadata,
 * mirroring how the task modal reconstructs the command for display.
 */

import { randomUUID } from 'node:crypto';
import { PlatformType } from '@prisma/client';
import type { RegistryTemplate } from './schema.js';

/** Raised when a task can't be turned into a template; mapped to a 400. */
export class SaveAsTemplateError extends Error {}

/** The subset of a Task the derivation needs. */
export interface TaskLike {
  name: string;
  category: string;
  platform: PlatformType;
  schedule: string | null;
  metadata: unknown;
}

export interface SaveAsTemplateOverrides {
  name?: string;
  description?: string;
  category?: string;
}

const asText = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v : undefined;

/** Infer the v1 runtime from an executable path's basename. */
function runtimeFromExecutable(exe: string): RegistryTemplate['runtime'] {
  const base = exe.toLowerCase().replace(/^.*[\\/]/, '').replace(/\.exe$/, '');
  if (base === 'powershell' || base === 'pwsh') return 'powershell';
  if (base === 'cmd') return 'batch';
  if (base === 'cscript' || base === 'wscript') return 'vbscript';
  if (base === 'bash' || base === 'sh') return 'bash';
  if (base === 'zsh') return 'zsh';
  if (base === 'python' || base === 'python3' || base === 'py') return 'python';
  if (base === 'node') return 'node';
  return 'executable';
}

/** Best-effort map of a task's free-text category to a v1 category. */
function categoryFromText(text: string | undefined): RegistryTemplate['category'] {
  const t = (text ?? '').toLowerCase();
  if (/backup/.test(t)) return 'backup';
  if (/clean/.test(t)) return 'cleanup';
  if (/monitor|health|check/.test(t)) return 'monitoring';
  if (/dev|build|test|git|ci/.test(t)) return 'dev-workflow';
  if (/sync/.test(t)) return 'data-sync';
  if (/ai|llm|agent|claude|codex|prompt/.test(t)) return 'ai-agent';
  if (/notify|alert|report|digest/.test(t)) return 'notification';
  if (/media|video|image|audio/.test(t)) return 'media';
  if (/system|maintenance|service/.test(t)) return 'system';
  return 'other';
}

/**
 * Derive the command string + runtime + targets from the task's metadata,
 * mirroring the task modal's actionInfo():
 *   - native HTTP job  -> the URL is the command (applies back to cronsole-native)
 *   - Windows exec     -> exe + args (exe quoted when it has whitespace, so it
 *                         re-tokenizes to the same {executable,args} on apply)
 *   - plain command    -> the stored command string verbatim
 */
function deriveAction(task: TaskLike): {
  command: string;
  runtime: RegistryTemplate['runtime'];
  compatibleTargets: RegistryTemplate['compatibleTargets'];
  os: RegistryTemplate['os'];
} {
  const meta = (task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
    ? task.metadata
    : {}) as Record<string, unknown>;

  // Native HTTP job → URL command.
  const job = meta.job as Record<string, unknown> | undefined;
  if (job && typeof job === 'object') {
    const url = asText(job.url);
    if (url) {
      return { command: url, runtime: 'http', compatibleTargets: ['cronsole-native'], os: 'cross-platform' };
    }
  }

  const isWindows = task.platform === PlatformType.WINDOWS_TASK_SCHEDULER;

  // Windows exec action(s): use the single exec action's exe + args.
  const actions = Array.isArray(meta.actions) ? meta.actions : [];
  const execActs = actions
    .map(a => (a && typeof a === 'object' ? a : {}) as Record<string, unknown>)
    .filter(a => asText(a.path) ?? asText(a.executable));
  if (execActs.length === 1) {
    const act = execActs[0];
    const exe = (asText(act.path) ?? asText(act.executable))!;
    const args = asText(act.arguments);
    const exeToken = /\s/.test(exe) ? `"${exe}"` : exe;
    return {
      command: args ? `${exeToken} ${args}` : exeToken,
      runtime: runtimeFromExecutable(exe),
      compatibleTargets: ['windows'],
      os: 'windows'
    };
  }

  // Plain stored command string (created/imported tasks).
  const command = asText(meta.command);
  if (command) {
    const exe = command.trim().split(/\s+/)[0];
    return {
      command,
      runtime: isWindows ? runtimeFromExecutable(exe) : 'executable',
      compatibleTargets: isWindows ? ['windows'] : ['cronsole-native'],
      os: isWindows ? 'windows' : 'cross-platform'
    };
  }

  throw new SaveAsTemplateError(
    execActs.length > 1
      ? "This task has multiple actions — saving multi-action tasks as templates isn't supported yet."
      : "This task has no command Cronsole can capture yet. Sync it and try again."
  );
}

/** Build a Registry v1 template from a task + optional field overrides. */
export function buildTemplateFromTask(
  task: TaskLike,
  overrides: SaveAsTemplateOverrides = {}
): RegistryTemplate {
  if (!task.schedule || task.schedule.trim().split(/\s+/).length !== 5) {
    throw new SaveAsTemplateError(
      'This task has no cron-expressible schedule to template (e.g. a boot/logon trigger).'
    );
  }

  const { command, runtime, compatibleTargets, os } = deriveAction(task);
  const name = asText(overrides.name) ?? task.name;

  const template: RegistryTemplate = {
    schemaVersion: '1.0',
    // A fresh id so saving never collides with or overwrites a catalog template.
    id: `tpl_saved_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name,
    trigger: { kind: 'schedule', cron: task.schedule.trim() },
    runtime,
    os,
    category: categoryFromText(overrides.category ?? task.category),
    commandTemplate: command,
    compatibleTargets,
    isStarter: false
  };
  const description = asText(overrides.description);
  if (description) template.description = description;

  return template;
}
