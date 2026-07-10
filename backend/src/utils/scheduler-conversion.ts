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

  // 2. Weekly at a specific hour/minute/day of week: "M H * * D"
  const dowNum = parseInt(dow, 10);
  if (isSpecificTime && dom === '*' && month === '*' && !isNaN(dowNum)) {
    const timeStr = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    const dayMap: Record<number, string> = {
      0: 'Sunday',
      1: 'Monday',
      2: 'Tuesday',
      3: 'Wednesday',
      4: 'Thursday',
      5: 'Friday',
      6: 'Saturday',
      7: 'Sunday' // Cron 7 is also Sunday
    };
    const targetDay = dayMap[dowNum];
    if (targetDay) {
      return {
        confidence: 1.0,
        trigger: {
          type: 'Weekly',
          startBoundary: timeStr,
          daysOfWeek: [targetDay]
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
    if (!isNaN(intervalMins)) {
      return {
        confidence: 1.0,
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
    if (!isNaN(intervalHours)) {
      return {
        confidence: 1.0,
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

  // Fallback / Complex cron
  warnings.push('Complex cron expression will be converted to a fallback interval trigger; execution times might not align 100%.');
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
      const dayMap: Record<string, number> = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6
      };
      const firstDay = trigger.daysOfWeek[0].toLowerCase();
      const dow = dayMap[firstDay];
      if (!isNaN(hour) && !isNaN(min) && dow !== undefined) {
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
