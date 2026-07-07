import { CronExpressionParser } from 'cron-parser';

/**
 * Next occurrence of a 5-field cron expression (UTC) strictly after `from`.
 * Returns null for unparseable expressions.
 */
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
