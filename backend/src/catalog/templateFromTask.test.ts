import { describe, it, expect } from 'vitest';
import { PlatformType } from '@prisma/client';
import { registryTemplateSchema } from './schema.js';
import { buildTemplateFromTask, SaveAsTemplateError, type TaskLike } from './templateFromTask.js';

const baseWindows = (metadata: unknown, schedule: string | null = '0 9 * * *'): TaskLike => ({
  name: 'Nightly Backup',
  category: 'Backup',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  schedule,
  metadata
});

describe('buildTemplateFromTask', () => {
  it('derives a valid v1 template from a Windows exec action', () => {
    const t = buildTemplateFromTask(
      baseWindows({ actions: [{ path: 'powershell.exe', arguments: '-File backup.ps1', workingDirectory: 'C:\\jobs' }] })
    );
    expect(registryTemplateSchema.safeParse(t).success).toBe(true);
    expect(t.commandTemplate).toBe('powershell.exe -File backup.ps1');
    expect(t.runtime).toBe('powershell');
    expect(t.os).toBe('windows');
    expect(t.category).toBe('backup');
    expect(t.compatibleTargets).toEqual(['windows']);
    expect(t.isStarter).toBe(false);
    expect(t.id).toMatch(/^tpl_saved_[a-f0-9]{12}$/);
  });

  it('quotes an executable path with spaces so it re-tokenizes to one arg', () => {
    const t = buildTemplateFromTask(
      baseWindows({ actions: [{ path: 'C:\\Program Files\\app\\run.exe', arguments: '--once' }] })
    );
    expect(t.commandTemplate).toBe('"C:\\Program Files\\app\\run.exe" --once');
    expect(t.runtime).toBe('executable');
  });

  it('derives an HTTP template from a native job', () => {
    const t = buildTemplateFromTask({
      name: 'Health Check',
      category: 'Monitoring',
      platform: PlatformType.TASKHUB_NATIVE,
      schedule: '*/5 * * * *',
      metadata: { job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' } }
    });
    expect(registryTemplateSchema.safeParse(t).success).toBe(true);
    expect(t.commandTemplate).toBe('https://example.com/health');
    expect(t.runtime).toBe('http');
    expect(t.compatibleTargets).toEqual(['cronsole-native']);
    expect(t.category).toBe('monitoring');
  });

  /**
   * The two-format export's documented headline is that `template` works where
   * `native` cannot — with the agent offline, and **for a Claude routine, whose
   * definition lives at claude.ai**. That was false on a live install until
   * `deriveAction` learned this branch: every Claude routine was refused with
   * "no command Cronsole can capture yet", because a routine has no exec action,
   * no native job and no `metadata.command` — its command is its prompt.
   */
  it('templates a Claude routine from its saved prompt', () => {
    const t = buildTemplateFromTask({
      name: 'Weekly planner',
      category: 'Claude',
      platform: PlatformType.CLAUDE_CODE,
      schedule: '0 15 * * 1',
      metadata: { declared: false, prompt: 'Review the backlog and write next week\'s plan.' }
    });
    expect(registryTemplateSchema.safeParse(t).success).toBe(true);
    expect(t.commandTemplate).toBe('Review the backlog and write next week\'s plan.');
    expect(t.runtime).toBe('ai-prompt');
    expect(t.os).toBe('cross-platform');
    expect(t.compatibleTargets).toEqual(['claude-code']);
  });

  it('refuses a declared Claude routine by naming why the prompt is missing', () => {
    // Cronsole holds an id and a token for a declared routine and never saw its
    // prompt, so "sync and try again" would be advice that cannot work. The
    // refusal has to say that instead.
    const build = () =>
      buildTemplateFromTask({
        name: 'Declared routine',
        category: 'Claude',
        platform: PlatformType.CLAUDE_CODE,
        schedule: '0 15 * * 1',
        metadata: { declared: true }
      });
    expect(build).toThrow(SaveAsTemplateError);
    expect(build).toThrow(/lives at claude\.ai/);
  });

  it('falls back to a plain stored command string', () => {
    const t = buildTemplateFromTask(baseWindows({ command: 'cmd.exe /c echo hi' }));
    expect(t.commandTemplate).toBe('cmd.exe /c echo hi');
    expect(t.runtime).toBe('batch');
  });

  it('applies name/description/category overrides', () => {
    const t = buildTemplateFromTask(baseWindows({ command: 'node job.js' }), {
      name: 'My Template',
      description: 'does a thing',
      category: 'dev'
    });
    expect(t.name).toBe('My Template');
    expect(t.description).toBe('does a thing');
    expect(t.category).toBe('dev-workflow');
    expect(t.runtime).toBe('node');
  });

  it('rejects a task with no cron-expressible schedule', () => {
    expect(() => buildTemplateFromTask(baseWindows({ command: 'x' }, null)))
      .toThrow(SaveAsTemplateError);
    expect(() => buildTemplateFromTask(baseWindows({ command: 'x' }, '@reboot')))
      .toThrow(/cron-expressible/);
  });

  it('rejects a task with no capturable command', () => {
    expect(() => buildTemplateFromTask(baseWindows({})))
      .toThrow(/no command Cronsole can capture/);
  });

  it('rejects a multi-action task with an honest reason', () => {
    expect(() => buildTemplateFromTask(
      baseWindows({ actions: [{ path: 'a.exe' }, { path: 'b.exe' }] })
    )).toThrow(/multi-action/);
  });
});
