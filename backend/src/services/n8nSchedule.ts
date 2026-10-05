import { shiftCronToUtc } from '../utils/cron.js';

/**
 * **Reading an n8n Schedule Trigger as a 5-field UTC cron — or saying why not.**
 *
 * n8n does not store a cron. A Schedule Trigger holds a list of *rules*
 * (`parameters.rule.interval[]`), each a `{ field, …Interval, triggerAt… }`
 * object, and n8n compiles them to a 6-field cron (seconds first) at
 * activation. Three facts about that shape decide everything below, and all
 * three were read off a live instance rather than the docs:
 *
 * **The body omits defaults.** A weekly rule reads `{ field: "weeks",
 * triggerAtHour: 6 }` — the Sunday it fires on is `triggerAtDay`'s default and
 * appears nowhere. So the defaults are carried here, per field, from the node
 * definition (`n8n-nodes-base.scheduleTrigger` v1.4). An absent minute is read
 * as the UI's `0`: the live weekly rule has none and fires at `:00:51`, the
 * `51` being n8n's random second.
 *
 * **"Every N" is not cron for most units.** For days, weeks and months, n8n
 * emits a cron that fires *more* often than asked and filters each fire by the
 * time since the last run (`recurrenceCheck`). That is a stateful schedule —
 * its phase depends on when the workflow was activated — and no 5-field cron
 * says it. Those rules are `null` with the reason. Hours use the same filter,
 * and it agrees with cron's `*\/N` exactly when N divides 24; otherwise the
 * wrap at midnight diverges, so that is refused too. Minutes have no filter:
 * n8n's own cron *is* `*\/N`.
 *
 * **The zone is not in the API.** A rule is wall-clock time in the workflow's
 * `settings.timezone`, which is usually absent, falling back to the instance's
 * `GENERIC_TIMEZONE` — which the public API does not expose at all. The
 * connection therefore *declares* the instance zone, and with neither known the
 * schedule is `null` with that reason. Reading it as UTC instead would be the
 * #60 shape: a schedule stored hours off, with nothing on screen to say so.
 */

/** Node types that schedule a workflow on time. */
export const N8N_SCHEDULE_NODE_TYPES = ['n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.cron'] as const;

/** The legacy `Cron` node — recognised as a schedule, not read. */
const LEGACY_CRON_NODE = 'n8n-nodes-base.cron';

/** n8n's own spelling of "no per-workflow zone, use the instance's". */
const DEFAULT_ZONE = 'DEFAULT';

/** The subset of a workflow node this module reads. */
export interface N8nScheduleNode {
  name: string;
  type: string;
  disabled?: boolean;
  parameters?: Record<string, unknown>;
}

/** One rule, read in the workflow's own zone. */
export interface N8nRuleReading {
  /** The node the rule belongs to. */
  node: string;
  /** 5-field cron in the **workflow's zone**, or null when the rule has none. */
  localCron: string | null;
  /** Why `localCron` is null. Present exactly when it is. */
  reason?: string;
}

export interface N8nWorkflowSchedule {
  /** Does the workflow have an enabled schedule node at all? */
  scheduled: boolean;
  /** 5-field cron in **UTC** — the storage contract — or null. */
  cron: string | null;
  /** Why `cron` is null on a scheduled workflow. */
  reason?: string;
  /** The zone the rules were read in, or null when none was known. */
  timeZone: string | null;
  /** Every rule found, so a refused multi-rule schedule still shows what it holds. */
  rules: N8nRuleReading[];
}

/** Where the zone may come from, most specific first. */
export interface N8nZoneSources {
  /** The workflow's `settings.timezone`; `DEFAULT` or absent means "the instance's". */
  workflowZone?: string | null;
  /** The instance zone the user declared on the connection. */
  instanceZone?: string | null;
}

type Read = { cron: string; reason?: undefined } | { cron: null; reason: string };

/**
 * A non-negative integer field, or the default when it is absent.
 *
 * An `=…` string is an n8n *expression*, evaluated at activation — Cronsole
 * cannot know its value, so it is a refusal rather than a guess at the default.
 */
function intField(
  rule: Record<string, unknown>,
  key: string,
  fallback: number
): { ok: true; value: number } | { ok: false; reason: string } {
  const raw = rule[key];
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: fallback };
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return { ok: true, value: raw };
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return { ok: true, value: Number(raw.trim()) };
  return {
    ok: false,
    reason:
      typeof raw === 'string' && raw.startsWith('=')
        ? `"${key}" is an n8n expression, evaluated when the workflow is published — Cronsole cannot know its value.`
        : `"${key}" holds ${JSON.stringify(raw)}, which is not a whole number.`
  };
}

/** "Every N <unit>" with N > 1, which n8n filters by time since the last run. */
function everyNRefusal(n: number, unit: string): Read {
  return {
    cron: null,
    reason:
      `Runs every ${n} ${unit}. n8n counts that from the previous run rather than from the calendar, ` +
      'so when it fires depends on when the workflow was published — no cron expression says that.'
  };
}

/**
 * One `rule.interval[]` entry as a 5-field cron in the workflow's zone.
 *
 * Exported for its own test; the connector calls {@link readWorkflowSchedule}.
 */
export function readRule(rawRule: unknown): Read {
  const rule = (rawRule && typeof rawRule === 'object' ? rawRule : {}) as Record<string, unknown>;
  const field = typeof rule.field === 'string' && rule.field ? rule.field : 'days';

  if (field === 'cronExpression') return readCronExpression(rule.expression);
  if (field === 'seconds') {
    return { cron: null, reason: 'Runs every few seconds; cron cannot express anything finer than a minute.' };
  }

  if (field === 'minutes') {
    const n = intField(rule, 'minutesInterval', 5);
    if (!n.ok) return { cron: null, reason: n.reason };
    return { cron: n.value <= 1 ? '* * * * *' : `*/${n.value} * * * *` };
  }

  const minute = intField(rule, 'triggerAtMinute', 0);
  if (!minute.ok) return { cron: null, reason: minute.reason };
  const m = minute.value;

  if (field === 'hours') {
    const n = intField(rule, 'hoursInterval', 1);
    if (!n.ok) return { cron: null, reason: n.reason };
    if (n.value <= 1) return { cron: `${m} * * * *` };
    // n8n fires on `*/N` and drops any fire closer than N hours to the last
    // one. Those agree only when N divides the day: with N=5, 20:00 → 00:00 is
    // four hours, so n8n skips the midnight run cron would report.
    if (24 % n.value !== 0) return everyNRefusal(n.value, 'hours');
    return { cron: `${m} */${n.value} * * *` };
  }

  const hour = intField(rule, 'triggerAtHour', 0);
  if (!hour.ok) return { cron: null, reason: hour.reason };
  const h = hour.value;

  if (field === 'days') {
    const n = intField(rule, 'daysInterval', 1);
    if (!n.ok) return { cron: null, reason: n.reason };
    if (n.value > 1) return everyNRefusal(n.value, 'days');
    return { cron: `${m} ${h} * * *` };
  }

  if (field === 'weeks') {
    const n = intField(rule, 'weeksInterval', 1);
    if (!n.ok) return { cron: null, reason: n.reason };
    if (n.value > 1) return everyNRefusal(n.value, 'weeks');
    const days = readWeekdays(rule.triggerAtDay);
    if (days === null) {
      return { cron: null, reason: `"triggerAtDay" holds ${JSON.stringify(rule.triggerAtDay)}, which is not a list of weekdays.` };
    }
    return { cron: `${m} ${h} * * ${days}` };
  }

  if (field === 'months') {
    const n = intField(rule, 'monthsInterval', 1);
    if (!n.ok) return { cron: null, reason: n.reason };
    if (n.value > 1) return everyNRefusal(n.value, 'months');
    const dom = intField(rule, 'triggerAtDayOfMonth', 1);
    if (!dom.ok) return { cron: null, reason: dom.reason };
    return { cron: `${m} ${h} ${dom.value} * *` };
  }

  return { cron: null, reason: `Unrecognised trigger interval "${field}".` };
}

/**
 * `triggerAtDay` as a cron day-of-week field. Absent is the node default,
 * Sunday; an explicitly empty list is n8n's "every day" (`*`).
 */
function readWeekdays(raw: unknown): string | null {
  if (raw === undefined || raw === null) return '0';
  if (!Array.isArray(raw)) return null;
  if (raw.length === 0) return '*';
  const days = new Set<number>();
  for (const d of raw) {
    const n = typeof d === 'number' ? d : typeof d === 'string' && /^\d$/.test(d) ? Number(d) : NaN;
    if (!Number.isInteger(n) || n < 0 || n > 7) return null;
    days.add(n % 7);
  }
  return [...days].sort((a, b) => a - b).join(',');
}

/**
 * A "Custom (Cron)" rule. n8n accepts 5 or 6 fields, seconds first when 6.
 *
 * A single-valued seconds field is dropped: it moves the run within its minute
 * and nothing else, so the 5-field reading names the same runs. Any other
 * seconds field fires more than once a minute, which is the seconds refusal.
 */
function readCronExpression(raw: unknown): Read {
  const expression = typeof raw === 'string' ? raw.trim() : '';
  if (!expression) return { cron: null, reason: 'The Custom (Cron) rule has no expression.' };
  if (expression.startsWith('=')) {
    return { cron: null, reason: 'The cron expression is an n8n expression, evaluated at publish time — Cronsole cannot know its value.' };
  }
  const fields = expression.split(/\s+/);
  if (fields.length === 5) return { cron: fields.join(' ') };
  if (fields.length === 6) {
    if (/^\d+$/.test(fields[0]!)) return { cron: fields.slice(1).join(' ') };
    return {
      cron: null,
      reason: `"${expression}" fires more than once a minute (seconds field "${fields[0]}"); cron cannot express that.`
    };
  }
  return { cron: null, reason: `"${expression}" is not a 5- or 6-field cron expression.` };
}

/** Every rule on one enabled schedule node. */
function readNode(node: N8nScheduleNode): N8nRuleReading[] {
  if (node.type === LEGACY_CRON_NODE) {
    return [{
      node: node.name,
      localCron: null,
      reason: 'Scheduled by the legacy Cron node, which Cronsole does not read yet — n8n recommends replacing it with a Schedule Trigger.'
    }];
  }
  const rule = node.parameters?.rule as { interval?: unknown } | undefined;
  // The node's own default when `rule` is absent: one rule, daily at midnight.
  const intervals = Array.isArray(rule?.interval) ? rule.interval : [{ field: 'days' }];
  if (intervals.length === 0) {
    return [{ node: node.name, localCron: null, reason: 'The Schedule Trigger has no rules.' }];
  }
  return intervals.map(interval => {
    const read = readRule(interval);
    return read.cron === null
      ? { node: node.name, localCron: null, reason: read.reason }
      : { node: node.name, localCron: read.cron };
  });
}

/** The zone a workflow's rules are written in, or null when nobody has said. */
export function resolveZone(sources: N8nZoneSources): string | null {
  const own = sources.workflowZone?.trim();
  if (own && own !== DEFAULT_ZONE) return own;
  const instance = sources.instanceZone?.trim();
  return instance ? instance : null;
}

/**
 * A workflow's schedule as Cronsole stores it.
 *
 * **One task per workflow, one cron per task.** A workflow with two rules (or
 * two schedule nodes) has no single cron, so `cron` is null and `rules` keeps
 * both — the schedule is reported, just not reduced to something it is not.
 */
export function readWorkflowSchedule(
  nodes: readonly N8nScheduleNode[],
  zones: N8nZoneSources,
  at: Date = new Date()
): N8nWorkflowSchedule {
  const scheduleNodes = nodes.filter(
    n => (N8N_SCHEDULE_NODE_TYPES as readonly string[]).includes(n.type) && n.disabled !== true
  );
  const timeZone = resolveZone(zones);
  if (scheduleNodes.length === 0) return { scheduled: false, cron: null, timeZone, rules: [] };

  const rules = scheduleNodes.flatMap(readNode);
  const base = { scheduled: true as const, timeZone, rules };

  if (rules.length > 1) {
    return {
      ...base,
      cron: null,
      reason: `Has ${rules.length} schedule rules; Cronsole stores one cron per task, so each is listed instead.`
    };
  }

  const only = rules[0]!;
  if (only.localCron === null) return { ...base, cron: null, reason: only.reason };

  if (!timeZone) {
    return {
      ...base,
      cron: null,
      reason:
        'n8n runs this schedule in the instance time zone, which its API does not report. ' +
        'Set the instance time zone on the n8n connection so Cronsole can convert it to UTC.'
    };
  }

  const shifted = shiftCronToUtc(only.localCron, timeZone, at);
  return shifted.cron === null
    ? { ...base, cron: null, reason: shifted.reason }
    : { ...base, cron: shifted.cron };
}
