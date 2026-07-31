import { CronExpressionParser } from 'cron-parser';

/**
 * Next occurrence of a 5-field cron expression (UTC) strictly after `from`.
 * Returns null for unparseable expressions.
 */
export function computeNextRuns(cron: string, count: number, from: Date = new Date()): Date[] {
  if (cron.trim().split(/\s+/).length !== 5 || count <= 0) {
    return [];
  }
  // Declared outside the try so a cron that runs out mid-sequence keeps the
  // occurrences it did produce. A cron can legally have no further ones
  // (`0 0 30 2 *` — February 30th never comes) and cron-parser signals that by
  // throwing on `next()`; "it stops after these three" is exactly the thing a
  // schedule tester exists to show you, so discarding the partial answer would
  // be the least useful possible response.
  const runs: Date[] = [];
  try {
    const expression = CronExpressionParser.parse(cron.trim(), {
      currentDate: from,
      tz: 'UTC'
    });
    for (let i = 0; i < count; i++) {
      runs.push(expression.next().toDate());
    }
  } catch {
    // Unparseable (nothing collected) or exhausted (partial) — same handling.
  }
  return runs;
}

export function computeNextRun(cron: string, from: Date = new Date()): Date | null {
  // cron-parser tolerates other field counts; enforce the project's 5-field convention.
  if (cron.trim().split(/\s+/).length !== 5) {
    return null;
  }
  try {
    const expression = CronExpressionParser.parse(cron.trim(), {
      currentDate: from,
      tz: 'UTC'
    });
    return expression.next().toDate();
  } catch {
    return null;
  }
}
