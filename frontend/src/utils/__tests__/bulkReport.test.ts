import { describe, it, expect } from 'vitest';
import { bulkToastMessage, hasBadNews, resolvedIds, type BulkReport } from '../bulkReport';

const report = (over: Partial<BulkReport> = {}): BulkReport => ({
  requested: 0,
  updated: 0,
  unchanged: 0,
  refused: 0,
  failed: 0,
  skipped: 0,
  summary: '',
  items: [],
  ...over
});

const item = (taskId: string, outcome: BulkReport['items'][number]['outcome']) => ({
  taskId,
  name: `Task ${taskId}`,
  outcome
});

describe('resolvedIds', () => {
  it('drops successes and no-ops from the selection', () => {
    const ids = resolvedIds(
      report({ items: [item('a', 'updated'), item('b', 'unchanged')] })
    );
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('keeps a failed task selected, because the next move is a retry', () => {
    // Making someone re-find the three rows that didn't work among two hundred
    // is the same scaling problem bulk actions exist to solve.
    const ids = resolvedIds(
      report({ items: [item('a', 'updated'), item('b', 'failed'), item('c', 'skipped')] })
    );
    expect(ids).toEqual(['a']);
  });

  it('keeps a refused task selected too', () => {
    const ids = resolvedIds(report({ items: [item('a', 'refused')] }));
    expect(ids).toEqual([]);
  });

  it('drops ids that matched no task at all', () => {
    // A ghost id would otherwise stay pinned to the toolbar's count forever,
    // with no row on screen to deselect.
    const ids = resolvedIds(report({ items: [item('a', 'updated')], notFound: ['ghost'] }));
    expect(ids.sort()).toEqual(['a', 'ghost']);
  });
});

describe('hasBadNews', () => {
  it('is false when everything worked or was already done', () => {
    expect(hasBadNews(report({ updated: 5, unchanged: 2 }))).toBe(false);
  });

  it('treats a refusal as bad news even though nothing broke', () => {
    // Cronsole declined to act and the user asked it to. Reporting that in a
    // green toast is the confident lie in miniature.
    expect(hasBadNews(report({ updated: 5, refused: 1 }))).toBe(true);
  });

  it('is true for failures and for a halted remainder', () => {
    expect(hasBadNews(report({ updated: 5, failed: 1 }))).toBe(true);
    expect(hasBadNews(report({ updated: 5, skipped: 40 }))).toBe(true);
  });
});

describe('bulkToastMessage', () => {
  it('appends the halt reason so a stopped run explains itself', () => {
    const message = bulkToastMessage(
      report({ summary: '3 enabled · 40 not attempted', haltedReason: 'Stopped after "A": Agent offline' })
    );
    expect(message).toBe('3 enabled · 40 not attempted — Stopped after "A": Agent offline');
  });

  it('leaves an uninterrupted run alone', () => {
    expect(bulkToastMessage(report({ summary: '3 enabled' }))).toBe('3 enabled');
  });
});
