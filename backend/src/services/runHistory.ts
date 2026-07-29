/**
 * Cross-task run history — the bulk read `ExecutionLog` never had.
 *
 * Until now history was reachable only 20 rows at a time, **per task**, so
 * "which tasks failed this month?" had no answer anywhere in the product. This
 * module is the one query three separate features needed (CSV export, richer
 * analytics, and the health score), which is why it exists on its own rather
 * than inside a route.
 *
 * ## The thing to understand before reading a row
 *
 * `ExecutionLog` records runs **TaskHub performed**, not runs that *happened*.
 * Rows are written in exactly two places: `POST /api/tasks/:id/run` and
 * `NativeScheduler`. A Windows task firing on its own schedule writes nothing
 * here at all.
 *
 * That makes `status` mean two different things depending on the platform, and
 * conflating them is how a report lies:
 *
 * - **TaskHub-native** — TaskHub ran the job itself, so `status` and
 *   `durationMs` describe the actual work. This is a real execution record.
 * - **Windows** — TaskHub asked the agent to start the task. `SUCCESS` means
 *   *"Windows accepted the start"*; the task's own outcome is not in this row,
 *   and `durationMs` measures the round trip, not the work. It is fire-and-forget
 *   ([#12](../../docs/troubleshooting/README.md) is the same lesson: a hung task
 *   reports SUCCESS too).
 *
 * Every row therefore carries a `runKind` saying which of those it is. A reader
 * who sorts by duration and compares the two is comparing a job to a handshake.
 */

import { ExecutionStatus, PlatformType } from '@prisma/client';

/** How to read a row's `status` and `durationMs`. Derived, never guessed. */
export type RunKind = 'native-execution' | 'manual-trigger';

export interface RunHistoryRow {
  triggeredAt: Date;
  taskId: string;
  taskName: string;
  taskPath: string;
  platform: PlatformType;
  category: string;
  status: ExecutionStatus;
  runKind: RunKind;
  durationMs: number | null;
  platformRunId: string | null;
  log: string | null;
}

export interface RunHistoryFilters {
  from?: Date;
  to?: Date;
  status?: ExecutionStatus[];
  platform?: PlatformType;
  taskId?: string;
}

/**
 * Prisma `where` for one user's history.
 *
 * Ownership is enforced through the `task` relation because `ExecutionLog` has
 * no `userId` of its own — so the scope has to be a join filter, and forgetting
 * it would return every user's runs. Written as a single exported function so
 * there is exactly one place that decides "whose history is this".
 */
export function historyWhere(userId: string, filters: RunHistoryFilters) {
  const triggeredAt =
    filters.from || filters.to
      ? { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) }
      : undefined;

  return {
    task: {
      userId,
      ...(filters.platform ? { platform: filters.platform } : {}),
      ...(filters.taskId ? { id: filters.taskId } : {})
    },
    ...(triggeredAt ? { triggeredAt } : {}),
    ...(filters.status?.length ? { status: { in: filters.status } } : {})
  };
}

/**
 * Which kind of record this row is.
 *
 * Derived from the platform rather than stored, because it is a property of how
 * the row *came to exist*: only `NativeScheduler` actually executes work, and it
 * only ever runs TaskHub-native tasks. Anything logged against a platform task
 * got there through a manual trigger — nothing else writes one.
 */
export function runKindFor(platform: PlatformType): RunKind {
  return platform === PlatformType.TASKHUB_NATIVE ? 'native-execution' : 'manual-trigger';
}

/** Roll rows up into the numbers a report leads with. */
export function summarizeHistory(rows: RunHistoryRow[]) {
  const tasks = new Set(rows.map(r => r.taskId));
  const failed = rows.filter(r => r.status === 'FAILURE' || r.status === 'TIMEOUT');
  return {
    runs: rows.length,
    tasks: tasks.size,
    succeeded: rows.filter(r => r.status === 'SUCCESS').length,
    failed: failed.length,
    pending: rows.filter(r => r.status === 'PENDING').length,
    /** Distinct tasks with at least one failure — the actionable count. */
    tasksWithFailures: new Set(failed.map(r => r.taskId)).size,
    from: rows.length ? rows[rows.length - 1].triggeredAt : null,
    to: rows.length ? rows[0].triggeredAt : null
  };
}

// --- CSV -------------------------------------------------------------------

const CSV_COLUMNS = [
  'triggeredAt',
  'taskName',
  'taskPath',
  'platform',
  'category',
  'status',
  'runKind',
  'durationMs',
  'platformRunId',
  'log'
] as const;

/**
 * Characters that make a spreadsheet treat a cell as a **formula** rather than
 * text. Excel, LibreOffice and Sheets all do this, and Excel will additionally
 * offer to run DDE for `=cmd|…`.
 *
 * This matters more here than in most exports: TaskHub's rows contain task names
 * and **command lines**, i.e. attacker-influenceable text that is already about
 * executing things. A task named `=cmd|'/c calc'!A1` would otherwise turn a
 * "run history" download into a live payload the moment someone opens it.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * One CSV cell: neutralized, then quoted per RFC 4180.
 *
 * Neutralization is a leading apostrophe, which spreadsheets strip on display
 * and treat as "this is text". It **does** alter the stored byte, and that is
 * the deliberate trade: a visibly prefixed value is recoverable, a spreadsheet
 * that executed its own contents is not.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);

  if (FORMULA_TRIGGERS.some(c => text.startsWith(c))) {
    text = `'${text}`;
  }

  // Quote when the value contains a delimiter, a quote, or a line break;
  // embedded quotes double. Log snippets routinely contain all three.
  if (/[",\r\n]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Serialize rows to CSV bytes.
 *
 * **UTF-8 with a BOM**, deliberately: without it Excel decodes the file as the
 * system ANSI codepage, and a task named `Sauvegarde quotidienne` arrives
 * mojibake. Same class of care as the UTF-16 + BOM the Task Scheduler XML needs
 * — the encoding is part of the format, not an afterthought.
 *
 * CRLF line endings, per RFC 4180.
 */
export function toCsvBuffer(rows: RunHistoryRow[]): Buffer {
  const lines = [
    CSV_COLUMNS.join(','),
    ...rows.map(row => CSV_COLUMNS.map(column => csvCell(row[column])).join(','))
  ];

  return Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(lines.join('\r\n') + '\r\n', 'utf8')
  ]);
}

/** `taskhub-run-history_2026-07-01_2026-07-28.csv` — the range is in the name. */
export function csvFilename(from: Date | null, to: Date | null): string {
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const range = from && to ? `_${day(from)}_${day(to)}` : from ? `_from-${day(from)}` : '';
  return `taskhub-run-history${range}.csv`;
}
