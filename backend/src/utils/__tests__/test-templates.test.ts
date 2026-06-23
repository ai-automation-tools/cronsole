import { describe, it, expect } from 'vitest';
import { PlatformType, OsTarget } from '@prisma/client';
import {
  convertCronToWindowsTrigger,
  convertWindowsTriggerToCron,
  getTemplateConfidence
} from '../scheduler-conversion.js';

interface CatalogTemplateTest {
  id: string;
  targetPlatforms: PlatformType[];
  os: OsTarget;
  scheduleExpression: string;
  parameters: { key: string; type: string }[];
}

// The 24 catalog templates defined in seed.ts / Templates.md
const mockCatalogTemplates: CatalogTemplateTest[] = [
  // Curated patterns (Tier B)
  {
    id: 'tpl_daily_database_backup',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.CLAUDE_CODE],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 3 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_morning_news_digest',
    targetPlatforms: [PlatformType.CLAUDE_CODE, PlatformType.CHATGPT],
    os: OsTarget.CROSS_PLATFORM,
    scheduleExpression: '0 7 * * *',
    parameters: []
  },
  {
    id: 'tpl_weekly_system_cleanup',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 0 * * 0',
    parameters: []
  },
  {
    id: 'tpl_github_pr_triage',
    targetPlatforms: [PlatformType.CLAUDE_CODE],
    os: OsTarget.CROSS_PLATFORM,
    scheduleExpression: '*/30 * * * *',
    parameters: []
  },
  // Script Starters (Tier A)
  // Windows
  {
    id: 'tpl_starter_powershell_script',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 9 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_powershell_inline',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 * * * *',
    parameters: [{ key: 'command', type: 'text' }]
  },
  {
    id: 'tpl_starter_batch_script',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 0 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_python_windows',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 8 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_node_windows',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '*/30 * * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_exe_windows',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 7 * * 1',
    parameters: [{ key: 'exePath', type: 'path' }]
  },
  {
    id: 'tpl_starter_http_windows',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '*/15 * * * *',
    parameters: [{ key: 'url', type: 'url' }]
  },
  {
    id: 'tpl_starter_vbscript_windows',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
    os: OsTarget.WINDOWS,
    scheduleExpression: '0 6 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  // macOS
  {
    id: 'tpl_starter_zsh_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '0 9 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_bash_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '0 9 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_python_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '0 8 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_node_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '*/30 * * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_applescript_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '0 18 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_zsh_inline_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '0 * * * *',
    parameters: [{ key: 'command', type: 'text' }]
  },
  {
    id: 'tpl_starter_http_macos',
    targetPlatforms: [PlatformType.MACOS_LAUNCHD],
    os: OsTarget.MACOS,
    scheduleExpression: '*/15 * * * *',
    parameters: [{ key: 'url', type: 'url' }]
  },
  // Cross-Platform
  {
    id: 'tpl_starter_python_cross',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.MACOS_LAUNCHD],
    os: OsTarget.CROSS_PLATFORM,
    scheduleExpression: '0 8 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_node_cross',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.MACOS_LAUNCHD],
    os: OsTarget.CROSS_PLATFORM,
    scheduleExpression: '0 8 * * *',
    parameters: [{ key: 'scriptPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_git_sync',
    targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.MACOS_LAUNCHD],
    os: OsTarget.CROSS_PLATFORM,
    scheduleExpression: '0 */6 * * *',
    parameters: [{ key: 'repoPath', type: 'path' }]
  },
  {
    id: 'tpl_starter_claude_routine',
    targetPlatforms: [PlatformType.CLAUDE_CODE],
    os: OsTarget.CROSS_PLATFORM,
    scheduleExpression: '0 7 * * *',
    parameters: [{ key: 'prompt', type: 'text' }]
  }
];

describe('Catalog Template Validation', () => {
  it('validates reversible cron conversions for all catalog schedules', () => {
    for (const t of mockCatalogTemplates) {
      const cron = t.scheduleExpression;
      const convertRes = convertCronToWindowsTrigger(cron);
      
      // All schedules in our catalog should be fully convertible
      expect(convertRes.confidence).toBe(1.0);
      expect(convertRes.trigger).not.toBeNull();

      if (convertRes.trigger) {
        const reverseRes = convertWindowsTriggerToCron(convertRes.trigger);
        expect(reverseRes.confidence).toBe(1.0);
        
        // Assert round-trip equality
        expect(reverseRes.cron).toBe(cron);
      }
    }
  });

  it('validates honest confidence scoring on platform mismatch', () => {
    for (const t of mockCatalogTemplates) {
      // If target is WINDOWS but template only supports MACOS:
      if (t.os === OsTarget.MACOS) {
        const res = getTemplateConfidence(t, PlatformType.WINDOWS_TASK_SCHEDULER);
        expect(res.score).toBeLessThanOrEqual(0.2);
        expect(res.warnings.length).toBeGreaterThan(0);
        expect(res.warnings.some(w => w.includes('targets macOS/Linux specific binaries'))).toBe(true);
      }
    }
  });

  it('validates path parameter warnings lower confidence score to 0.85', () => {
    for (const t of mockCatalogTemplates) {
      const hasPath = t.parameters.some(p => p.type === 'path');
      if (hasPath && t.targetPlatforms.includes(PlatformType.WINDOWS_TASK_SCHEDULER) && t.os === OsTarget.WINDOWS) {
        const res = getTemplateConfidence(t, PlatformType.WINDOWS_TASK_SCHEDULER);
        expect(res.score).toBe(0.85);
        expect(res.warnings.length).toBeGreaterThan(0);
        expect(res.warnings[0]).toContain('contains absolute path parameters');
      }
    }
  });
});
