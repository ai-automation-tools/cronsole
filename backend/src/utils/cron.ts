/**
 * The project's cron shape check: 5 fields, `min hour dom month dow`, UTC.
 *
 * One definition, imported — it was previously a `const` copy-pasted into
 * `routes/tasks.ts` and `routes/templates.ts`, which is two places to change a
 * rule that must be identical in both. It is deliberately a *shape* check and
 * not a full parse: the parse belongs to `cron-parser` at the point of use, and
 * the routes want to distinguish "not a cron at all" (a 400) from "a cron that
 * converts imperfectly" (a low-confidence preview).
 */
export function isValidCron(cron: string): boolean {
  return cron.trim().split(/\s+/).length === 5;
}
