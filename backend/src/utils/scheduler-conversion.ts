import { PlatformType, OsTarget } from '@prisma/client';

export interface WindowsTrigger {
  type: 'Daily' | 'Weekly' | 'Monthly' | 'Time';
  startBoundary: string; // "HH:mm"
  daysInterval?: number;
  daysOfWeek?: string[];
  repetition?: {
    interval: string; // e.g. "PT30M"
    duration?: string; // e.g. "P1D"
  };
}

export interface ConversionResult {
  confidence: number;
  trigger: WindowsTrigger | null;
  warnings: string[];
}

/**
 * Canonical string a trigger contributes to the task:create HMAC, so the agent
 * verifies the schedule it's about to register — not just the command. MUST
 * match the C# `AgentAuthenticator.CanonicalizeTrigger` byte-for-byte. Every
 * field the agent reads back off the wire is included, in a fixed order; a null
 * trigger (non-Windows create, or an unconverted schedule) canonicalizes to the
 * literal "none". Optional fields collapse to empty so a present-but-empty and
 * an absent value serialize identically on both sides.
 */
export function canonicalizeTrigger(trigger: WindowsTrigger | null | undefined): string {
  if (!trigger) return 'none';
  const daysInterval = trigger.daysInterval ?? '';
  const daysOfWeek = (trigger.daysOfWeek ?? []).join(',');
  const repInterval = trigger.repetition?.interval ?? '';
  const repDuration = trigger.repetition?.duration ?? '';
  return [
    'trigger',
    trigger.type,
    trigger.startBoundary,
    daysInterval,
    daysOfWeek,
    repInterval,
    repDuration
  ].join('|');
}

export interface ReverseResult {
  confidence: number;
  cron: string;
  warnings: string[];
}

/** Cron day-of-week index → the day name a Windows Weekly trigger expects. */
const CRON_DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday'
];

/**
 * Parses a cron day-of-week field into Windows day names, handling the forms a
 * weekly schedule actually uses: a single day (`1`), a list (`1,3,5`), a range
 * (`1-5`), or a mix (`1-3,5`). Cron accepts both `0` and `7` for Sunday, so both
 * fold onto one Sunday.
 *
 * Returns `null` — never a guess — when any part is unparseable, so the caller
 * falls through to the warned fallback instead of inventing a day. This must not
 * use `parseInt` on the whole field: `parseInt('1-5')` is `1`, which silently
 * turned "every weekday" into "Mondays only" at full confidence.
 */
function parseCronDaysOfWeek(dow: string): string[] | null {
  const indices = new Set<number>();

  for (const part of dow.split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start > 7 || end > 7 || start > end) return null;
      for (let day = start; day <= end; day++) indices.add(day % 7); // 7 → Sunday
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    const day = Number(part);
    if (day > 7) return null;
    indices.add(day % 7);
  }

  if (indices.size === 0) return null;
  return [...indices].sort((a, b) => a - b).map(index => CRON_DAY_NAMES[index]);
}

/**
 * Converts a 5-field cron string to a Windows Task Scheduler trigger configuration.
 */
export function convertCronToWindowsTrigger(cron: string): ConversionResult {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    return {
      confidence: 0.0,
      trigger: null,
      warnings: ['Cron expression must have exactly 5 fields.']
    };
  }

  const [min, hour, dom, month, dow] = fields;
  const warnings: string[] = [];

  // Check for non-standard cron features
  if (cron.includes('?') || cron.includes('L') || cron.includes('W') || cron.includes('#')) {
    return {
      confidence: 0.5,
      trigger: null,
      warnings: ['Non-standard cron characters (?, L, W, #) are not supported by Windows triggers.']
    };
  }

  // 1. Daily at a specific hour/minute: "M H * * *"
  const minNum = parseInt(min, 10);
  const hourNum = parseInt(hour, 10);
  const isSpecificTime = !isNaN(minNum) && !isNaN(hourNum);

  if (isSpecificTime && dom === '*' && month === '*' && dow === '*') {
    const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    return {
      confidence: 1.0,
      trigger: {
        type: 'Daily',
        startBoundary: timeStr,
        daysInterval: 1
      },
      warnings
    };
  }

  // 2. Weekly at a specific hour/minute on one or more days: "M H * * D[,D|-D]"
  if (isSpecificTime && dom === '*' && month === '*') {
    const targetDays = parseCronDaysOfWeek(dow);
    if (targetDays) {
      const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
      return {
        confidence: 1.0,
        trigger: {
          type: 'Weekly',
          startBoundary: timeStr,
          daysOfWeek: targetDays
        },
        warnings
      };
    }
  }

  // 3. Hourly at specific minute: "M * * * *"
  if (!isNaN(minNum) && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const timeStr = `00:${min.padStart(2, '0')}`;
    return {
      confidence: 1.0,
      trigger: {
        type: 'Time',
        startBoundary: timeStr,
        repetition: {
          interval: 'PT1H',
          duration: 'P1D'
        }
      },
      warnings
    };
  }

  // 4. Periodic minutes: "*/M * * * *"
  if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const intervalMins = parseInt(min.substring(2), 10);
    if (!isNaN(intervalMins) && intervalMins > 0) {
      // Windows repeats on a fixed interval from the start boundary; cron restarts
      // its cycle every hour. They only agree when the step divides 60 evenly —
      // "*/7" fires at :00,:07…:56 then :00 under cron (a 4-minute seam), but
      // rolls straight across the hour under Windows.
      const divides = intervalMins < 60 && 60 % intervalMins === 0;
      if (!divides) {
        warnings.push(
          `A ${intervalMins}-minute step does not divide 60 evenly, so Windows repeats it ` +
          'continuously from midnight while cron realigns every hour; run times drift apart ' +
          'after the first hour.'
        );
      }
      return {
        confidence: divides ? 1.0 : 0.7,
        trigger: {
          type: 'Time',
          startBoundary: '00:00',
          repetition: {
            interval: `PT${intervalMins}M`,
            duration: 'P1D'
          }
        },
        warnings
      };
    }
  }

  // 5. Periodic hours: "0 */H * * *"
  if (minNum === 0 && hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') {
    const intervalHours = parseInt(hour.substring(2), 10);
    if (!isNaN(intervalHours) && intervalHours > 0) {
      // Same seam as the minute step, against a 24-hour day: cron realigns at
      // midnight, Windows does not.
      const divides = intervalHours < 24 && 24 % intervalHours === 0;
      if (!divides) {
        warnings.push(
          `A ${intervalHours}-hour step does not divide 24 evenly, so Windows repeats it ` +
          'continuously from midnight while cron realigns each day; run times drift apart ' +
          'after the first day.'
        );
      }
      return {
        confidence: divides ? 1.0 : 0.7,
        trigger: {
          type: 'Time',
          startBoundary: '00:00',
          repetition: {
            interval: `PT${intervalHours}H`,
            duration: 'P1D'
          }
        },
        warnings
      };
    }
  }

  // Fallback / Complex cron.
  //
  // This trigger is NOT derived from the input — the expression is discarded and
  // replaced wholesale with a fixed hourly repetition. So the warning must say
  // "replaced", not "might not align": the previous wording described *drift*,
  // which made `0 4 1 1 *` (once a year) becoming ~8,760 runs a year read like a
  // rounding error. Naming the resulting frequency is the whole point — a caller
  // can't weigh a cost nobody stated.
  //
  // Two asymmetries worth keeping in the text, because they invert the usual
  // intuition: the fallback only ever runs MORE often than asked (never less),
  // and a deliberately *rare* schedule is the input most likely to miss the
  // pattern list above — so being careful is exactly what triggers this.
  warnings.push(
    'This cron expression cannot be expressed as a Windows trigger, so the schedule will be ' +
    'REPLACED — not approximated — with a fixed hourly trigger: every hour from 00:00, about ' +
    '24 runs a day (~8,760 a year). The original expression is discarded entirely, and the ' +
    'replacement only ever runs MORE often than you asked. Use a schedule Windows can express ' +
    '(a daily/weekly time, or an even */N step), or create it disabled and enable it when needed ' +
    '— do not encode "rarely" in the cron.'
  );
  return {
    confidence: 0.7,
    trigger: {
      type: 'Time',
      startBoundary: '00:00',
      repetition: {
        interval: 'PT1H',
        duration: 'P1D'
      }
    },
    warnings
  };
}

/**
 * Reverses a Windows trigger back to a 5-field cron string.
 */
export function convertWindowsTriggerToCron(trigger: WindowsTrigger): ReverseResult {
  const warnings: string[] = [];

  if (trigger.type === 'Daily') {
    const parts = trigger.startBoundary.split(':');
    if (parts.length >= 2) {
      const hour = parseInt(parts[0], 10);
      const min = parseInt(parts[1], 10);
      if (!isNaN(hour) && !isNaN(min)) {
        return {
          confidence: 1.0,
          cron: `${min} ${hour} * * *`,
          warnings
        };
      }
    }
  }

  if (trigger.type === 'Weekly' && trigger.daysOfWeek && trigger.daysOfWeek.length > 0) {
    const parts = trigger.startBoundary.split(':');
    if (parts.length >= 2) {
      const hour = parseInt(parts[0], 10);
      const min = parseInt(parts[1], 10);
      // Every named day becomes a cron day — a Windows Weekly trigger routinely
      // names several, and keeping only the first would drop the rest silently.
      const days = trigger.daysOfWeek.map(day => CRON_DAY_NAMES.indexOf(
        day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()
      ));
      const allRecognized = days.every(index => index !== -1);
      if (!isNaN(hour) && !isNaN(min) && allRecognized) {
        const dow = [...new Set(days)].sort((a, b) => a - b).join(',');
        return {
          confidence: 1.0,
          cron: `${min} ${hour} * * ${dow}`,
          warnings
        };
      }
    }
  }

  if (trigger.type === 'Time' && trigger.repetition) {
    const interval = trigger.repetition.interval;
    const parts = trigger.startBoundary.split(':');
    const startMin = parts.length >= 2 ? parseInt(parts[1], 10) : 0;
    
    // PT30M -> minute is */30
    const minMatch = interval.match(/^PT(\d+)M$/);
    if (minMatch) {
      const mins = parseInt(minMatch[1], 10);
      return {
        confidence: 1.0,
        cron: `*/${mins} * * * *`,
        warnings
      };
    }

    // PT6H -> hour is */6, min is startMin
    const hourMatch = interval.match(/^PT(\d+)H$/);
    if (hourMatch) {
      const hours = parseInt(hourMatch[1], 10);
      return {
        confidence: 1.0,
        cron: `${startMin} ${hours === 1 ? '*' : `*/${hours}`} * * *`,
        warnings
      };
    }
  }

  return {
    confidence: 0.6,
    cron: '0 * * * *',
    warnings: ['Fallback default hourly cron applied due to unrecognized trigger options.']
  };
}

/**
 * Computes the compatibility score and warnings when applying a template to a specific platform.
 */
export function getTemplateConfidence(
  template: {
    targetPlatforms: PlatformType[];
    os: OsTarget;
    parameters?: any;
    scheduleExpression: string;
  },
  targetPlatform: PlatformType
): { score: number; warnings: string[] } {
  const warnings: string[] = [];
  let score = 1.0;

  // 1. Direct platform mismatch
  if (!template.targetPlatforms.includes(targetPlatform)) {
    warnings.push(`This template is not optimized or tested for ${targetPlatform}.`);
    score = Math.min(score, 0.4);
  }

  // 2. OS incompatibilities
  if (targetPlatform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    if (template.os === OsTarget.MACOS || template.os === OsTarget.LINUX) {
      warnings.push('This script targets macOS/Linux specific binaries (e.g. bash/zsh/applescript) and may fail on Windows.');
      score = Math.min(score, 0.2);
    }
  } else if (targetPlatform === PlatformType.MACOS_LAUNCHD) {
    if (template.os === OsTarget.WINDOWS) {
      warnings.push('This script targets Windows-specific binaries (e.g. PowerShell/Batch/VBScript) and will fail on macOS.');
      score = Math.min(score, 0.1);
    }
  }

  // 3. Path parameter warnings (path syntax difference Windows vs POSIX)
  const paramsList = Array.isArray(template.parameters) ? template.parameters : [];
  const hasPathParams = paramsList.some((p: any) => p && p.type === 'path');
  if (hasPathParams) {
    warnings.push('Template contains absolute path parameters. Make sure to specify paths relative to the target host environment.');
    score = Math.min(score, 0.85);
  }

  // 4. Cron trigger conversion checks
  const cronResult = convertCronToWindowsTrigger(template.scheduleExpression);
  if (cronResult.confidence < 1.0 && targetPlatform === PlatformType.WINDOWS_TASK_SCHEDULER) {
    warnings.push(...cronResult.warnings);
    score = Math.min(score, cronResult.confidence);
  }

  return {
    score,
    warnings
  };
}
