import { describe, it, expect } from 'vitest';
import { PlatformType, ExecutionStatus } from '@prisma/client';
import {
  csvCell,
  csvFilename,
  historyWhere,
  runKindFor,
  summarizeHistory,
  toCsvBuffer,
  type RunHistoryRow
} from '../runHistory.js';

const row = (overrides: Partial<RunHistoryRow> = {}): RunHistoryRow => ({
  triggeredAt: new Date('2026-07-20T09:00:00.000Z'),
  taskId: 't1',
  taskName: 'Nightly Backup',
  taskPath: '\\Work\\Nightly',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  category: 'Work',
  status: ExecutionStatus.SUCCESS,
  runKind: 'manual-trigger',
  durationMs: 1200,
  platformRunId: null,
  log: 'Started successfully',
  ...overrides
});

describe('historyWhere', () => {
  // ExecutionLog has no userId of its own — ownership only exists through the
  // task relation, so a missing join filter returns every user's runs.
  it('always scopes to the owner through the task relation', () => {
    expect(historyWhere('user-1', {})).toMatchObject({ task: { userId: 'user-1' } });
  });

  it('applies the range, status, platform and task filters', () => {
    const from = new Date('2026-07-01T00:00:00Z');
    const to = new Date('2026-07-31T00:00:00Z');
    const where = historyWhere('user-1', {
      from,
      to,
      status: [ExecutionStatus.FAILURE, ExecutionStatus.TIMEOUT],
      platform: PlatformType.TASKHUB_NATIVE,
      taskId: 't9'
    });

    expect(where).toEqual({
      task: { userId: 'user-1', platform: PlatformType.TASKHUB_NATIVE, id: 't9' },
      triggeredAt: { gte: from, lte: to },
      status: { in: [ExecutionStatus.FAILURE, ExecutionStatus.TIMEOUT] }
    });
  });

  it('omits filters that were not asked for, rather than sending empty ones', () => {
    const where = historyWhere('user-1', { status: [] });
    expect(where).not.toHaveProperty('status');
    expect(where).not.toHaveProperty('triggeredAt');
  });
});

describe('runKindFor', () => {
  // The distinction the whole report rests on: only NativeScheduler executes
  // work, so anything logged against a platform task is a trigger, and its
  // SUCCESS means "the agent accepted the start", not "the task worked".
  it('separates a real execution from a fire-and-forget trigger', () => {
    expect(runKindFor(PlatformType.TASKHUB_NATIVE)).toBe('native-execution');
    expect(runKindFor(PlatformType.WINDOWS_TASK_SCHEDULER)).toBe('manual-trigger');
    expect(runKindFor(PlatformType.CLAUDE_CODE)).toBe('manual-trigger');
  });
});

describe('csvCell', () => {
  it('escapes per RFC 4180 — quotes, commas, and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('renders empty for null and undefined, and ISO for dates', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(new Date('2026-07-20T09:00:00.000Z'))).toBe('2026-07-20T09:00:00.000Z');
    expect(csvCell(0)).toBe('0');
  });

  // The one that matters most. Cronsole stores command lines, so an exported
  // cell is attacker-influenceable text that is already about running things:
  // without this, opening the report in Excel executes it.
  it('neutralizes every leading character a spreadsheet treats as a formula', () => {
    // Prefixed but NOT quoted: an apostrophe is not a CSV metacharacter, so
    // quoting here would be noise. Neutralization and escaping are separate jobs.
    expect(csvCell("=cmd|'/c calc'!A1")).toBe("'=cmd|'/c calc'!A1");
    // And when it needs both, it gets both — prefix inside the quotes.
    expect(csvCell('=HYPERLINK("http://x","go")')).toBe('"\'=HYPERLINK(""http://x"",""go"")"');
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tsneaky')).toBe("'\tsneaky");
  });

  it('does not touch a value that merely contains those characters later', () => {
    // Over-escaping would corrupt ordinary data — most log lines contain '='.
    expect(csvCell('exit=0')).toBe('exit=0');
    expect(csvCell('a-b')).toBe('a-b');
  });
});

describe('toCsvBuffer', () => {
  it('starts with a UTF-8 BOM so Excel does not mojibake non-ASCII names', () => {
    const buffer = toCsvBuffer([row({ taskName: 'Sauvegarde quotidienne' })]);
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.subarray(3).toString('utf8')).toContain('Sauvegarde quotidienne');
  });

  it('writes the header, CRLF line endings, and one line per run', () => {
    const text = toCsvBuffer([row(), row({ taskName: 'Second' })]).subarray(3).toString('utf8');
    const lines = text.split('\r\n').filter(Boolean);

    expect(lines[0]).toBe(
      'triggeredAt,taskName,taskPath,platform,category,status,runKind,durationMs,platformRunId,log'
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('Nightly Backup');
    expect(lines[2]).toContain('Second');
  });

  it('carries runKind on every row, so status is readable', () => {
    const text = toCsvBuffer([
      row({ platform: PlatformType.TASKHUB_NATIVE, runKind: 'native-execution' })
    ]).toString('utf8');
    expect(text).toContain('native-execution');
  });

  it('produces a parseable file even when a log contains commas, quotes and newlines', () => {
    const text = toCsvBuffer([row({ log: 'failed: "x", then\nretried' })]).subarray(3).toString('utf8');
    // Header + one record; the embedded newline must live inside quotes, not
    // split the record into two rows.
    const quoted = text.match(/"failed: ""x"", then\nretried"/);
    expect(quoted).not.toBeNull();
  });

  it('writes a header-only file for an empty result rather than nothing', () => {
    const text = toCsvBuffer([]).subarray(3).toString('utf8');
    expect(text.trim()).toBe(
      'triggeredAt,taskName,taskPath,platform,category,status,runKind,durationMs,platformRunId,log'
    );
  });
});

describe('summarizeHistory', () => {
  it('counts runs, distinct tasks, and the tasks that actually failed', () => {
    const summary = summarizeHistory([
      row({ taskId: 'a', status: ExecutionStatus.FAILURE, triggeredAt: new Date('2026-07-20T10:00:00Z') }),
      row({ taskId: 'a', status: ExecutionStatus.TIMEOUT, triggeredAt: new Date('2026-07-20T09:00:00Z') }),
      row({ taskId: 'b', status: ExecutionStatus.SUCCESS, triggeredAt: new Date('2026-07-20T08:00:00Z') })
    ]);

    expect(summary).toMatchObject({
      runs: 3,
      tasks: 2,
      succeeded: 1,
      failed: 2,
      // Two failures on ONE task is one task to go and look at, not two.
      tasksWithFailures: 1
    });
  });

  it('reports the real span of the rows, newest first in, oldest last', () => {
    const summary = summarizeHistory([
      row({ triggeredAt: new Date('2026-07-20T10:00:00Z') }),
      row({ triggeredAt: new Date('2026-07-01T10:00:00Z') })
    ]);
    expect(summary.to).toEqual(new Date('2026-07-20T10:00:00Z'));
    expect(summary.from).toEqual(new Date('2026-07-01T10:00:00Z'));
  });

  it('has no range for an empty set instead of inventing one', () => {
    expect(summarizeHistory([])).toMatchObject({ runs: 0, from: null, to: null });
  });
});

describe('csvFilename', () => {
  it('puts the range in the name so a saved file stays self-describing', () => {
    expect(csvFilename(new Date('2026-07-01T00:00:00Z'), new Date('2026-07-28T00:00:00Z'))).toBe(
      'cronsole-run-history_2026-07-01_2026-07-28.csv'
    );
    expect(csvFilename(null, null)).toBe('cronsole-run-history.csv');
  });
});
