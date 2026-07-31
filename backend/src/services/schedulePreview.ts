import { PlatformType } from '@prisma/client';
import {
  convertCronToWindowsTrigger,
  convertWindowsTriggerToCron,
  WindowsTrigger
} from '../utils/scheduler-conversion.js';
import { computeNextRuns } from '../utils/cron-next.js';
import { isValidCron } from '../utils/cron.js';

/** How many upcoming occurrences a preview reports. */
export const PREVIEW_RUN_COUNT = 5;

export interface SchedulePreview {
  score: number;
  warnings: string[];
  trigger: WindowsTrigger | null;
  lossy?: 'approximated' | 'replaced';
  /** Occurrences of the cron the user typed, UTC ISO strings. What they asked for. */
  requestedRuns: string[];
  /**
   * Occurrences of the trigger that will actually be registered. Null when
   * there is nothing to simulate (no trigger, or a platform that runs the cron
   * itself). Present and *different* from `requestedRuns` is the finding.
   */
  effectiveRuns: string[] | null;
  /** True when the two lists disagree — the whole point of the tester. */
  diverges: boolean;
}

/**
 * Answer "what will this schedule actually do?" before a task exists.
 *
 * The load-bearing idea is `effectiveRuns`. A cron does not run on Windows — a
 * *trigger* does, and the conversion between them can silently discard the cron
 * entirely: any expression the pattern list doesn't match is replaced with a
 * fixed hourly trigger (troubleshooting #14), so `0 4 1 1 *` — chosen precisely
 * because it can't fire during a test — registers as **8,760 runs a year**. The
 * `lossy` discriminator and the warnings already say so in words; this says it
 * in dates, which is the register people actually read.
 *
 * `effectiveRuns` is derived by round-tripping the trigger back through
 * `convertWindowsTriggerToCron` rather than by simulating Windows triggers
 * directly. That reuses two already-tested converters instead of introducing a
 * third scheduler implementation — and a second, subtly-wrong simulation of what
 * the machine does is precisely the confident lie this feature exists to expose.
 */
export function previewSchedule(
  platform: PlatformType,
  schedule: unknown,
  from: Date = new Date()
): SchedulePreview {
  if (typeof schedule !== 'string' || !isValidCron(schedule)) {
    return {
      score: 0,
      warnings: ['Schedule must be a 5-field cron expression (min hour dom month dow).'],
      trigger: null,
      requestedRuns: [],
      effectiveRuns: null,
      diverges: false
    };
  }

  const cron = schedule.trim();
  const requested = computeNextRuns(cron, PREVIEW_RUN_COUNT, from);
  const requestedRuns = requested.map(d => d.toISOString());

  // Non-Windows platforms run the cron as given — Cronsole-native is scheduled by
  // NativeScheduler off this very expression — so there is no second schedule to
  // compare against and no divergence to warn about.
  if (platform !== PlatformType.WINDOWS_TASK_SCHEDULER) {
    return {
      score: 1,
      warnings: [],
      trigger: null,
      requestedRuns,
      effectiveRuns: null,
      diverges: false
    };
  }

  const conversion = convertCronToWindowsTrigger(cron);
  const effectiveRuns = canSimulate(conversion.lossy) && conversion.trigger
    ? effectiveRunsFor(conversion.trigger, from)
    : null;

  return {
    score: conversion.confidence,
    warnings: conversion.warnings,
    trigger: conversion.trigger,
    lossy: conversion.lossy,
    requestedRuns,
    effectiveRuns,
    diverges: effectiveRuns !== null && !sameRuns(requestedRuns, effectiveRuns)
  };
}

/**
 * Whether run times for the registered trigger can be *read* rather than guessed.
 *
 * `'approximated'` is deliberately excluded, and finding out why is the reason
 * this function exists. An uneven minute step (every 7 minutes) converts to a
 * Windows repetition of `PT7M`, and the reverse converter maps that straight
 * back to the same step expression — so a round-trip reports the two schedules
 * as identical when the drift is precisely the point. They are not identical:
 * Windows repeats continuously from a start boundary (…:56, then 1:03), while
 * cron restarts every hour (…:56, then 1:00). Showing the cron's dates as "what
 * Windows will do" would print a plausible, wrong answer in the one place built
 * to be trusted.
 *
 * Simulating Windows repetition properly means writing a second scheduler, which
 * is the thing this service explicitly refuses to do. So the drift stays where it
 * is already stated honestly — in `lossy` and the warnings — and no dates are
 * offered. **The dates are only shown where they can be derived, never inferred.**
 */
function canSimulate(lossy: 'approximated' | 'replaced' | undefined): boolean {
  return lossy !== 'approximated';
}

/**
 * Occurrences of a Windows trigger, via the reverse converter. Returns null when
 * the trigger cannot be expressed as a cron — better to show nothing than to
 * show a guess, since the entire value here is that the dates are trustworthy.
 */
function effectiveRunsFor(trigger: WindowsTrigger, from: Date): string[] | null {
  const reverse = convertWindowsTriggerToCron(trigger);

  // The reverse converter has its own fallback: an unrecognized trigger becomes
  // a hard-coded hourly cron at confidence 0.6 — a guess, not a reading. Feeding
  // that into a list of dates would print invented run times in the one place
  // built to be trusted, so anything short of an exact reading shows nothing.
  if (!reverse.cron || reverse.confidence < 1) return null;

  const runs = computeNextRuns(reverse.cron, PREVIEW_RUN_COUNT, from);
  return runs.length > 0 ? runs.map(d => d.toISOString()) : null;
}

function sameRuns(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
