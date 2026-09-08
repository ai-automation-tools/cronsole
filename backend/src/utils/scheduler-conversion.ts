import { PlatformType, OsTarget } from '@prisma/client';

export interface WindowsTrigger {
  type: 'Daily' | 'Weekly' | 'Monthly' | 'Time';
  startBoundary: string; // "HH:mm"
  daysInterval?: number;
  daysOfWeek?: string[];
  /**
   * Days of the month a Monthly trigger fires on, 1-31, every month. Only ever
   * set on `type: 'Monthly'`.
   *
   * There is deliberately no `monthsOfYear` companion: cron's month field would
   * have to survive the round trip too, and a Monthly trigger whose months are
   * restricted has no honest 5-field cron here — `TriggerReader` returns null
   * for one rather than reporting it as "every month".
   */
  daysOfMonth?: number[];
  repetition?: {
    interval: string; // e.g. "PT30M"
    duration?: string; // e.g. "P1D"
  };
}

export interface ConversionResult {
  confidence: number;
  trigger: WindowsTrigger | null;
  warnings: string[];
  /**
   * Machine-readable companion to `confidence`, because `0.7` alone is a lie by
   * omission: it is returned for two *different* risks that a caller thresholding
   * on `>= 0.7` cannot tell apart.
   *   - `'approximated'` — a trigger that IS derived from the input but drifts
   *     (an uneven step, e.g. every 7 minutes: fires on time, then Windows and
   *     cron disagree after the first cycle).
   *   - `'replaced'` — the input was DISCARDED for a fixed hourly trigger not
   *     derived from it at all (any cron the pattern list doesn't match). It
   *     only ever runs MORE often than asked.
   * Absent on an exact (confidence 1.0) conversion and on a null-trigger refusal
   * (confidence 0 / 0.5) — there is no imperfect trigger to describe in either.
   * The wording in `warnings` distinguishes the two registers; this is the same
   * distinction as a value a program can branch on without re-tuning the score.
   */
  lossy?: 'approximated' | 'replaced';
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
  const fields = [
    'trigger',
    trigger.type,
    trigger.startBoundary,
    daysInterval,
    daysOfWeek,
    repInterval,
    repDuration
  ];
  // `daysOfMonth` is appended ONLY for a Monthly trigger, and that condition is
  // the whole point rather than a shortcut. Appending an eighth field
  // unconditionally would change the canonical string of every Daily, Weekly and
  // Time trigger, so every create would fail the signature check against any
  // agent that has not been republished — a schedule type nobody asked for
  // breaking every schedule type they did. Conditional, an old agent verifies
  // the signature and then refuses the Monthly trigger by name, which is the
  // error the user can act on.
  if (trigger.type === 'Monthly') {
    fields.push((trigger.daysOfMonth ?? []).join(','));
  }
  return fields.join('|');
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
 * Parses a cron day-of-month field into the 1-31 days a Windows Monthly trigger
 * expects, handling a single day (`1`), a list (`1,15`) and a range (`1-5`).
 *
 * Same contract as `parseCronDaysOfWeek` one field over, for the same reason:
 * `parseInt('1-5')` is `1`, which would turn "the first five days" into "the
 * first" at full confidence. Returns `null` for anything unparseable or out of
 * range, and for `*` — a wildcard day-of-month is not a monthly schedule at all,
 * it is the daily/weekly case the caller has already handled.
 */
function parseCronDaysOfMonth(dom: string): number[] | null {
  const days = new Set<number>();

  for (const part of dom.split(',')) {
    const range = part.match(/^(\d+)-(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (start < 1 || end > 31 || start > end) return null;
      for (let day = start; day <= end; day++) days.add(day);
      continue;
    }
    if (!/^\d+$/.test(part)) return null;
    const day = Number(part);
    if (day < 1 || day > 31) return null;
    days.add(day);
  }

  if (days.size === 0) return null;
  return [...days].sort((a, b) => a - b);
}

/**
 * Parses a cron minute or hour field that must name EXACTLY ONE value, returning
 * `null` for anything else — a list (`9,17`), a range (`9-17`), a step, or a
 * value outside the field's range.
 *
 * This exists for the same reason `parseCronDaysOfWeek` does, one field over, and
 * it was missed when that one was fixed. `startBoundary` is a single `"HH:mm"`
 * (see `WindowsTrigger`), so a multi-value time has no representation here at all
 * — but `parseInt('9-17')` is `9` and `parseInt('9,17')` is `9`, so both passed
 * the old `!isNaN()` guard and `padStart` then left the raw string untouched,
 * yielding boundaries like `"9-17:00"` and `"09:0,30"` at **confidence 1.0 with
 * no warnings**. `0 9-17 * * 1-5` — every hour, 9–5, weekdays — was reported as a
 * perfect conversion of a trigger that fires once a day.
 *
 * The saving grace was that the agent rejects a malformed boundary, so nothing
 * wrong ever reached Task Scheduler. But it surfaced as a 500/502 ("the platform
 * is having a moment, retry") for what is purely a schedule Cronsole cannot
 * express — a retry that can never succeed. Returning `null` drops these to the
 * honest `lossy: 'replaced'` fallback instead, which states the cost out loud.
 *
 * Range-checking here is part of the same job: `0 25 * * *` built `"25:00"` and
 * failed identically at the agent.
 */
function parseSingleTimeField(field: string, max: number): number | null {
  if (!/^\d+$/.test(field)) return null;
  const value = Number(field);
  if (value > max) return null;
  return value;
}

/**
 * Parses a pure step field — `*​/N` and nothing else — returning `null` for any
 * other shape.
 *
 * The same defect as `parseSingleTimeField` guards against, in the branch next
 * door and hiding better. `'*​/10,45'.startsWith('*​/')` is true and
 * `parseInt('10,45')` is `10`, so a step *combined with* a list or range was read
 * as a clean step: `*​/10,45 * * * *` (every 10 minutes AND at :45) returned
 * confidence 1.0 with no warnings, and `0 *​/6,13 * * *` quietly dropped the 13:00
 * run.
 *
 * These were the more dangerous half. The multi-value *time* bug produced a
 * malformed `startBoundary` that the agent refused, so it failed loudly; a
 * mis-parsed step produces a perfectly well-formed `PT10M` repetition that
 * Windows accepts and runs on the wrong schedule indefinitely. **A silent wrong
 * schedule beats a loud error only in how it looks.**
 */
function parseStepField(field: string): number | null {
  const match = field.match(/^\*\/(\d+)$/);
  if (!match) return null;
  const value = Number(match[1]);
  return value > 0 ? value : null;
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
  //
  // Both fields must name exactly one in-range value: a Windows startBoundary is
  // a single "HH:mm", so a list or a range has nowhere to go. See
  // parseSingleTimeField for what silently happened when this used parseInt.
  const minNum = parseSingleTimeField(min, 59);
  const hourNum = parseSingleTimeField(hour, 23);
  const isSpecificTime = minNum !== null && hourNum !== null;
  const timeOf = (h: number, m: number) =>
    `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  if (isSpecificTime && dom === '*' && month === '*' && dow === '*') {
    const timeStr = timeOf(hourNum, minNum);
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
      const timeStr = timeOf(hourNum, minNum);
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

  // 3. Monthly on one or more days of the month: "M H D[,D|-D] * *"
  //
  // The month field must be `*`: a Windows Monthly trigger can restrict its
  // months, but `WindowsTrigger` deliberately carries no `monthsOfYear`, so
  // "every January" falls through to the replaced fallback below rather than
  // being registered as "every month".
  if (isSpecificTime && dom !== '*' && month === '*' && dow === '*') {
    const daysOfMonth = parseCronDaysOfMonth(dom);
    if (daysOfMonth) {
      const timeStr = timeOf(hourNum, minNum);
      // A day past the 28th simply does not occur in every month, under cron or
      // under Windows — both skip it. Worth saying out loud because "monthly" is
      // read as "twelve times a year", and 31 means seven.
      const rare = daysOfMonth.filter(day => day > 28);
      if (rare.length > 0) {
        warnings.push(
          `Day ${rare.join(', ')} of the month does not exist in every month, so this ` +
          'schedule skips the months that are shorter — the same as cron. Use day 28 or ' +
          'earlier for a run in every month.'
        );
      }
      return {
        // Exact: Windows fires on these days of the month, every month, at this
        // time. The skipped short months are cron's behaviour too, so nothing is
        // lost in the conversion and the confidence stays 1.0.
        confidence: 1.0,
        trigger: {
          type: 'Monthly',
          startBoundary: timeStr,
          daysOfMonth
        },
        warnings
      };
    }
  }

  // 4. Hourly at specific minute: "M * * * *"
  if (minNum !== null && hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const timeStr = timeOf(0, minNum);
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

  // 5. Periodic minutes: "*/M * * * *"
  if (hour === '*' && dom === '*' && month === '*' && dow === '*') {
    const intervalMins = parseStepField(min);
    if (intervalMins !== null) {
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
        // 'approximated', not 'replaced': the trigger below IS built from the
        // step you gave — it merely drifts against cron's hourly realignment.
        lossy: divides ? undefined : 'approximated',
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

  // 6. Periodic hours: "0 */H * * *"
  if (minNum === 0 && dom === '*' && month === '*' && dow === '*') {
    const intervalHours = parseStepField(hour);
    if (intervalHours !== null) {
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
        // 'approximated', not 'replaced': the trigger below IS built from the
        // hour step you gave — it merely drifts against cron's daily realignment.
        lossy: divides ? undefined : 'approximated',
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
  // A list or a range in the minute or hour field is by far the most common way to
  // reach this fallback ("every hour 9–5 on weekdays" is an ordinary thing to ask
  // for), and the generic text below can't hint at the one workaround that exists:
  // a Windows trigger holds a single start time, so several times means several
  // tasks. Said first, because it is the actionable half.
  if (/[,-]/.test(min) || /[,-]/.test(hour)) {
    warnings.push(
      'A Windows trigger starts at exactly one time, so a list or range in the minute or hour ' +
      'field (e.g. "9,17" or "9-17") cannot be expressed and is not partially applied — only ' +
      'the whole expression is replaced, below. Use one task per start time, or an even step ' +
      '("0 */2 * * *") if the times are evenly spaced.'
    );
  }

  warnings.push(
    'This cron expression cannot be expressed as a Windows trigger, so the schedule will be ' +
    'REPLACED — not approximated — with a fixed hourly trigger: every hour from 00:00, about ' +
    '24 runs a day (~8,760 a year). The original expression is discarded entirely, and the ' +
    'replacement only ever runs MORE often than you asked. Use a schedule Windows can express ' +
    '(a daily/weekly/monthly time, or an even */N step), or create it disabled and enable it when ' +
    'needed ' +
    '— do not encode "rarely" in the cron.'
  );
  return {
    confidence: 0.7,
    // 'replaced', NOT 'approximated': the trigger below is a fixed hourly default
    // with no relation to the input — the same 0.7 an uneven step scores, which is
    // exactly why the number can't be trusted alone. See the `lossy` doc above.
    lossy: 'replaced',
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
 * Splits a trigger's `startBoundary` into an in-range hour and minute, or `null`.
 *
 * The reverse direction has the same duty of care as the forward one, and cannot
 * assume its input came from us: this reads triggers off real machines, where a
 * task may have been written by hand, by another tool, or by an older Cronsole
 * that emitted the malformed boundaries this module used to produce. Unguarded,
 * `parseInt` turned `"9-17:00"` into the cron `0 9 * * *` at **confidence 1.0** —
 * inventing a schedule the task does not have, which is worse than declining to
 * read it, and would then be shown as the task's schedule on the dashboard.
 */
function parseStartBoundary(boundary: string): { hour: number; min: number } | null {
  const match = boundary.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const min = Number(match[2]);
  if (hour > 23 || min > 59) return null;
  return { hour, min };
}

/**
 * Reverses a Windows trigger back to a 5-field cron string.
 */
export function convertWindowsTriggerToCron(trigger: WindowsTrigger): ReverseResult {
  const warnings: string[] = [];

  if (trigger.type === 'Daily') {
    const time = parseStartBoundary(trigger.startBoundary);
    if (time) {
      return {
        confidence: 1.0,
        cron: `${time.min} ${time.hour} * * *`,
        warnings
      };
    }
  }

  if (trigger.type === 'Weekly' && trigger.daysOfWeek && trigger.daysOfWeek.length > 0) {
    const time = parseStartBoundary(trigger.startBoundary);
    if (time) {
      // Every named day becomes a cron day — a Windows Weekly trigger routinely
      // names several, and keeping only the first would drop the rest silently.
      const days = trigger.daysOfWeek.map(day => CRON_DAY_NAMES.indexOf(
        day.charAt(0).toUpperCase() + day.slice(1).toLowerCase()
      ));
      const allRecognized = days.every(index => index !== -1);
      if (allRecognized) {
        const dow = [...new Set(days)].sort((a, b) => a - b).join(',');
        return {
          confidence: 1.0,
          cron: `${time.min} ${time.hour} * * ${dow}`,
          warnings
        };
      }
    }
  }

  if (trigger.type === 'Monthly' && trigger.daysOfMonth && trigger.daysOfMonth.length > 0) {
    const time = parseStartBoundary(trigger.startBoundary);
    // Every day the trigger names becomes a cron day, for the reason the weekly
    // arm above keeps all of its days: a Monthly trigger routinely names several
    // and keeping only the first would drop the rest silently. Out-of-range days
    // fall through to the fallback rather than being clamped — this reads real
    // machines, where the trigger was not necessarily written by us.
    const inRange = trigger.daysOfMonth.every(day => Number.isInteger(day) && day >= 1 && day <= 31);
    if (time && inRange) {
      const dom = [...new Set(trigger.daysOfMonth)].sort((a, b) => a - b).join(',');
      return {
        confidence: 1.0,
        cron: `${time.min} ${time.hour} ${dom} * *`,
        warnings
      };
    }
  }

  if (trigger.type === 'Time' && trigger.repetition) {
    const interval = trigger.repetition.interval;
    // An unreadable boundary means minute 0, not NaN: a repetition's start minute
    // is a detail of an otherwise-recoverable trigger, and "NaN * * * *" is not a
    // cron string any caller can do anything with.
    const startMin = parseStartBoundary(trigger.startBoundary)?.min ?? 0;

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
