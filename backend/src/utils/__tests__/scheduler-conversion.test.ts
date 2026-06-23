import { describe, it, expect } from 'vitest';
import { PlatformType, OsTarget } from '@prisma/client';
import {
  convertCronToWindowsTrigger,
  convertWindowsTriggerToCron,
  getTemplateConfidence
} from '../scheduler-conversion.js';

describe('Schedule Conversion Utility', () => {
  describe('convertCronToWindowsTrigger', () => {
    it('converts standard daily cron correctly', () => {
      const res = convertCronToWindowsTrigger('0 3 * * *');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Daily',
        startBoundary: '03:00',
        daysInterval: 1
      });
      expect(res.warnings).toHaveLength(0);
    });

    it('converts standard weekly cron correctly', () => {
      const res = convertCronToWindowsTrigger('30 9 * * 1');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Weekly',
        startBoundary: '09:30',
        daysOfWeek: ['Monday']
      });
      expect(res.warnings).toHaveLength(0);
    });

    it('converts periodic minutes cron correctly', () => {
      const res = convertCronToWindowsTrigger('*/30 * * * *');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Time',
        startBoundary: '00:00',
        repetition: {
          interval: 'PT30M',
          duration: 'P1D'
        }
      });
      expect(res.warnings).toHaveLength(0);
    });

    it('converts periodic hours cron correctly', () => {
      const res = convertCronToWindowsTrigger('0 */6 * * *');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Time',
        startBoundary: '00:00',
        repetition: {
          interval: 'PT6H',
          duration: 'P1D'
        }
      });
      expect(res.warnings).toHaveLength(0);
    });

    it('rejects invalid or non-standard cron formats', () => {
      const invalid = convertCronToWindowsTrigger('0 0 * *'); // 4 fields
      expect(invalid.confidence).toBe(0.0);
      expect(invalid.trigger).toBeNull();

      const nonStandard = convertCronToWindowsTrigger('0 0 * * ?');
      expect(nonStandard.confidence).toBe(0.5);
      expect(nonStandard.trigger).toBeNull();
    });

    it('handles complex cron with a fallback trigger and warnings', () => {
      const res = convertCronToWindowsTrigger('5 4 1-5 * *');
      expect(res.confidence).toBe(0.7);
      expect(res.trigger?.type).toBe('Time');
      expect(res.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('convertWindowsTriggerToCron', () => {
    it('reverses daily trigger correctly', () => {
      const trigger = {
        type: 'Daily' as const,
        startBoundary: '03:15',
        daysInterval: 1
      };
      const res = convertWindowsTriggerToCron(trigger);
      expect(res.confidence).toBe(1.0);
      expect(res.cron).toBe('15 3 * * *');
    });

    it('reverses weekly trigger correctly', () => {
      const trigger = {
        type: 'Weekly' as const,
        startBoundary: '12:00',
        daysOfWeek: ['Wednesday']
      };
      const res = convertWindowsTriggerToCron(trigger);
      expect(res.confidence).toBe(1.0);
      expect(res.cron).toBe('0 12 * * 3');
    });

    it('reverses periodic repetition trigger correctly', () => {
      const trigger = {
        type: 'Time' as const,
        startBoundary: '00:00',
        repetition: {
          interval: 'PT15M'
        }
      };
      const res = convertWindowsTriggerToCron(trigger);
      expect(res.confidence).toBe(1.0);
      expect(res.cron).toBe('*/15 * * * *');
    });
  });

  describe('getTemplateConfidence', () => {
    it('gives 1.0 score for perfect cross-platform template matching target', () => {
      const template = {
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER, PlatformType.CLAUDE_CODE],
        os: OsTarget.CROSS_PLATFORM,
        scheduleExpression: '0 3 * * *',
        parameters: []
      };

      const res = getTemplateConfidence(template, PlatformType.WINDOWS_TASK_SCHEDULER);
      expect(res.score).toBe(1.0);
      expect(res.warnings).toHaveLength(0);
    });

    it('warns and reduces score for platform mismatch', () => {
      const template = {
        targetPlatforms: [PlatformType.CLAUDE_CODE],
        os: OsTarget.CROSS_PLATFORM,
        scheduleExpression: '0 3 * * *',
        parameters: []
      };

      const res = getTemplateConfidence(template, PlatformType.WINDOWS_TASK_SCHEDULER);
      expect(res.score).toBe(0.4);
      expect(res.warnings[0]).toContain('not optimized or tested');
    });

    it('warns and drops score for OS mismatch (e.g. macOS template applied to Windows)', () => {
      const template = {
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        os: OsTarget.MACOS,
        scheduleExpression: '0 3 * * *',
        parameters: []
      };

      const res = getTemplateConfidence(template, PlatformType.WINDOWS_TASK_SCHEDULER);
      expect(res.score).toBe(0.2);
      expect(res.warnings[0]).toContain('targets macOS/Linux specific binaries');
    });

    it('warns on path type parameters', () => {
      const template = {
        targetPlatforms: [PlatformType.WINDOWS_TASK_SCHEDULER],
        os: OsTarget.WINDOWS,
        scheduleExpression: '0 3 * * *',
        parameters: [
          { key: 'scriptPath', type: 'path' }
        ]
      };

      const res = getTemplateConfidence(template, PlatformType.WINDOWS_TASK_SCHEDULER);
      expect(res.score).toBe(0.85);
      expect(res.warnings[0]).toContain('contains absolute path parameters');
    });

    it('combines multiple warnings and takes the lowest score', () => {
      const template = {
        targetPlatforms: [PlatformType.CLAUDE_CODE],
        os: OsTarget.MACOS,
        scheduleExpression: '5 4 1-5 * *', // complex cron (0.7)
        parameters: [
          { key: 'scriptPath', type: 'path' } // path warning (0.85)
        ]
      };

      const res = getTemplateConfidence(template, PlatformType.WINDOWS_TASK_SCHEDULER);
      expect(res.score).toBe(0.2);
      expect(res.warnings.length).toBeGreaterThan(1);
    });
  });
});
