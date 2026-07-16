import { describe, it, expect } from 'vitest';
import { PlatformType, OsTarget } from '@prisma/client';
import {
  convertCronToWindowsTrigger,
  convertWindowsTriggerToCron,
  getTemplateConfidence,
  canonicalizeTrigger
} from '../scheduler-conversion.js';

describe('canonicalizeTrigger', () => {
  it('canonicalizes a null/undefined trigger to "none"', () => {
    expect(canonicalizeTrigger(null)).toBe('none');
    expect(canonicalizeTrigger(undefined)).toBe('none');
  });

  it('collapses optional fields to empty in a fixed order', () => {
    // 7 fields: trigger|type|start|daysInterval|daysOfWeek|repInterval|repDuration
    expect(canonicalizeTrigger({ type: 'Daily', startBoundary: '03:00', daysInterval: 1 }))
      .toBe('trigger|Daily|03:00|1|||');
  });

  it('serializes a full weekly trigger deterministically', () => {
    expect(
      canonicalizeTrigger({
        type: 'Weekly',
        startBoundary: '09:30',
        daysOfWeek: ['Monday', 'Wednesday'],
        repetition: { interval: 'PT30M', duration: 'P1D' }
      })
    ).toBe('trigger|Weekly|09:30||Monday,Wednesday|PT30M|P1D');
  });

  it('round-trips a real converted trigger through the canonical form', () => {
    const { trigger } = convertCronToWindowsTrigger('0 3 * * *');
    // Daily 03:00 → no days/repetition, so trailing fields are empty.
    expect(canonicalizeTrigger(trigger)).toBe('trigger|Daily|03:00|1|||');
  });
});

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

    // A weekly cron may name several days, as a list ("1,3,5"), a range ("1-5"),
    // or a mix. Dropping any of them silently would report a Mon–Fri task as a
    // full-confidence success while it only ever runs on Monday.
    it('converts a day-of-week list to every named day', () => {
      const res = convertCronToWindowsTrigger('15 10 * * 1,3,5');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Weekly',
        startBoundary: '10:15',
        daysOfWeek: ['Monday', 'Wednesday', 'Friday']
      });
      expect(res.warnings).toHaveLength(0);
    });

    it('converts a day-of-week range to every day it spans', () => {
      const res = convertCronToWindowsTrigger('0 9 * * 1-5');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Weekly',
        startBoundary: '09:00',
        daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
      });
      expect(res.warnings).toHaveLength(0);
    });

    it('normalizes cron 7 and 0 to a single Sunday without duplicating it', () => {
      const res = convertCronToWindowsTrigger('30 8 * * 6,0');
      expect(res.confidence).toBe(1.0);
      expect(res.trigger).toEqual({
        type: 'Weekly',
        startBoundary: '08:30',
        daysOfWeek: ['Sunday', 'Saturday']
      });
      expect(res.warnings).toHaveLength(0);

      // 0 and 7 both mean Sunday — naming both must not yield it twice.
      const both = convertCronToWindowsTrigger('30 8 * * 0,7');
      expect(both.trigger?.daysOfWeek).toEqual(['Sunday']);
    });

    it('emits every day of a wildcard-equivalent range exactly once', () => {
      const res = convertCronToWindowsTrigger('0 6 * * 0-6');
      expect(res.trigger?.daysOfWeek).toEqual([
        'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
      ]);
      expect(res.confidence).toBe(1.0);
    });

    it('refuses a day-of-week it cannot parse rather than guessing a day', () => {
      // parseInt('MON') is NaN, but parseInt('8xyz') is 8 — neither may silently
      // become a real weekday.
      for (const bad of ['0 9 * * 8', '0 9 * * 1-99', '0 9 * * 1,,3']) {
        const res = convertCronToWindowsTrigger(bad);
        expect(res.trigger?.type, `${bad} must not produce a Weekly trigger`).not.toBe('Weekly');
      }
    });

    // Windows repeats a Time trigger on a fixed interval from the start boundary,
    // so it only reproduces cron's per-hour restart when the step divides 60.
    it('warns that a minute step which does not divide 60 drifts from cron', () => {
      const res = convertCronToWindowsTrigger('*/7 * * * *');
      expect(res.confidence).toBeLessThan(1.0);
      expect(res.warnings.join(' ')).toMatch(/60|drift|align/i);
      // The machine-readable half of the wording assertion below: a derived step.
      expect(res.lossy).toBe('approximated');
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
      // An exact conversion carries no lossy tag — nothing was traded away.
      expect(res.lossy).toBeUndefined();
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
      // The score is 0.7 for BOTH registers; only `lossy` says which. This one
      // is the discarded fallback, not a derived step.
      expect(res.lossy).toBe('replaced');
    });

    // The fallback trigger is not derived from the input at all — the expression
    // is dropped and replaced with a fixed hourly repetition. Counting warnings
    // (above) cannot tell an honest warning from a misleading one, and the old
    // wording ("might not align 100%") described drift, so a once-a-year cron
    // becoming ~8,760 runs a year read as a rounding error (troubleshooting #14).
    // These pin the substance a caller needs to make a decision.
    it('says the schedule is REPLACED, not approximated, and names the frequency', () => {
      const res = convertCronToWindowsTrigger('0 4 1 1 *'); // once a year → hourly
      const warning = res.warnings.join(' ');

      expect(warning).toMatch(/REPLACED/);
      expect(warning).toMatch(/hourly/i);
      // The cost, stated as a number. "Might not align" never said this.
      expect(warning).toMatch(/8,760|24 runs a day/);
      // The asymmetry that inverts the usual intuition about an approximation.
      expect(warning).toMatch(/MORE often/);
      // The honest alternative, so the warning isn't a dead end.
      expect(warning).toMatch(/disabled|do not encode/i);
    });

    it('does not describe the replacement as mere drift', () => {
      // Guards the regression directly: this phrasing is what let #14 slip past.
      const res = convertCronToWindowsTrigger('0 4 1 1 *');
      expect(res.warnings.join(' ')).not.toMatch(/might not align/i);
    });

    // The two 0.7 paths must not be confused: a */7 step really IS approximate
    // (the trigger is derived from the input and drifts), while an unrecognized
    // cron is discarded. They share a score, so the WORDING is the only thing
    // telling them apart — asserting the step path keeps its drift language is
    // what stops a future edit from collapsing both into one vague message.
    it('still describes an uneven step as drift, not replacement', () => {
      const res = convertCronToWindowsTrigger('*/7 * * * *');
      const warning = res.warnings.join(' ');
      expect(res.confidence).toBe(0.7);
      expect(warning).toMatch(/drift/i);
      expect(warning).not.toMatch(/REPLACED/);
    });

    // `lossy` is the machine-readable half of the wording split above: the score
    // (0.7) is identical for a derived-but-drifting step and a discarded-and-
    // replaced cron, so a program thresholding on the number cannot tell them
    // apart — only this field can. Pin all three registers in one place so a
    // future edit can't quietly merge them (troubleshooting #14).
    it('sets `lossy` to distinguish the two 0.7 registers from an exact conversion', () => {
      // Exact (score 1.0) — nothing traded away.
      expect(convertCronToWindowsTrigger('30 9 * * *').lossy).toBeUndefined();
      expect(convertCronToWindowsTrigger('0 9 * * 1-5').lossy).toBeUndefined();
      // Approximated (0.7) — trigger derived from the input, drifts.
      expect(convertCronToWindowsTrigger('*/7 * * * *').lossy).toBe('approximated');
      expect(convertCronToWindowsTrigger('0 */5 * * *').lossy).toBe('approximated');
      // Replaced (0.7) — input discarded for a fixed hourly trigger.
      expect(convertCronToWindowsTrigger('0 4 1 1 *').lossy).toBe('replaced');
      // Null-trigger refusals carry no lossy tag — there is no trigger to describe.
      expect(convertCronToWindowsTrigger('0 0 * *').lossy).toBeUndefined();
      expect(convertCronToWindowsTrigger('0 0 * * ?').lossy).toBeUndefined();
    });
  });

  describe('convertWindowsTriggerToCron', () => {
    // The read path: WindowsAgentConnector reverses a real task's trigger to store
    // it as cron. Keeping only the first day would import a Mon/Wed/Fri task and
    // display it as Mondays-only, at full confidence.
    it('reverses a multi-day weekly trigger to every day it names', () => {
      const res = convertWindowsTriggerToCron({
        type: 'Weekly',
        startBoundary: '09:00',
        daysOfWeek: ['Monday', 'Wednesday', 'Friday']
      });
      expect(res.confidence).toBe(1.0);
      expect(res.cron).toBe('0 9 * * 1,3,5');
      expect(res.warnings).toHaveLength(0);
    });

    it('round-trips a multi-day weekly schedule without losing days', () => {
      const forward = convertCronToWindowsTrigger('0 9 * * 1-5');
      const back = convertWindowsTriggerToCron(forward.trigger!);
      expect(back.cron).toBe('0 9 * * 1,2,3,4,5');
    });

    it('refuses an unrecognized day name rather than guessing', () => {
      const res = convertWindowsTriggerToCron({
        type: 'Weekly',
        startBoundary: '09:00',
        daysOfWeek: ['Funday']
      });
      expect(res.confidence).toBeLessThan(1.0);
      expect(res.warnings.length).toBeGreaterThan(0);
    });

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
