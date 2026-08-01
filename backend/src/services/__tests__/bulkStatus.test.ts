import { describe, it, expect, vi } from 'vitest';
import { PlatformType, TaskStatus } from '@prisma/client';
import {
  applyBulkStatus,
  isAgentDownMessage,
  summarizeBulkStatus,
  type BulkStatusTask
} from '../bulkStatus.js';

const task = (over: Partial<BulkStatusTask> = {}): BulkStatusTask => ({
  id: 'task-1',
  name: 'Nightly backup',
  platform: PlatformType.WINDOWS_TASK_SCHEDULER,
  externalId: '\\Cronsole\\Nightly backup',
  status: TaskStatus.ACTIVE,
  ...over
});

/** A connector whose setTaskStatus answers from a queue of scripted results. */
const connectorReturning = (
  results: Array<{ success: boolean; message?: string } | Error>
) => {
  const setTaskStatus = vi.fn(async () => {
    const next = results.shift() ?? { success: true };
    if (next instanceof Error) throw next;
    return next;
  });
  return { setTaskStatus } as any;
};

const resolveTo = (connector: any) => () => ({ connector, config: { userId: 'u1' } });

describe('applyBulkStatus', () => {
  it('reports each task individually rather than one batch verdict', async () => {
    const connector = connectorReturning([{ success: true }, { success: true }]);
    const report = await applyBulkStatus(
      [task({ id: 'a', name: 'A' }), task({ id: 'b', name: 'B' })],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    expect(report.requested).toBe(2);
    expect(report.updated).toBe(2);
    expect(report.items.map(i => i.taskId)).toEqual(['a', 'b']);
    expect(report.items.every(i => i.outcome === 'updated')).toBe(true);
  });

  it('calls the connector with the enabled flag the status implies', async () => {
    const connector = connectorReturning([{ success: true }]);
    await applyBulkStatus([task({ status: TaskStatus.DISABLED })], TaskStatus.ACTIVE, resolveTo(connector));
    expect(connector.setTaskStatus).toHaveBeenCalledWith(
      '\\Cronsole\\Nightly backup',
      true,
      { userId: 'u1' }
    );
  });

  it('counts a task already in the requested state as unchanged, not updated', async () => {
    // The number people read is `updated`. Counting a no-op there inflates it,
    // and counting it as a failure invents an error that did not happen.
    const connector = connectorReturning([]);
    const report = await applyBulkStatus(
      [task({ status: TaskStatus.DISABLED })],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    expect(report.unchanged).toBe(1);
    expect(report.updated).toBe(0);
    expect(report.failed).toBe(0);
    expect(connector.setTaskStatus).not.toHaveBeenCalled();
  });

  it('refuses a MISSING task in the backend, without asking the platform', async () => {
    const connector = connectorReturning([]);
    const report = await applyBulkStatus(
      [task({ status: TaskStatus.MISSING })],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    expect(report.refused).toBe(1);
    expect(report.items[0].message).toMatch(/re-sync or remove/i);
    // The UI greys this out too, but the server must not depend on that.
    expect(connector.setTaskStatus).not.toHaveBeenCalled();
  });

  it('keeps going after a per-task platform refusal', async () => {
    // An elevation/ACL refusal says nothing about the next task, so it must not
    // end the batch.
    const connector = connectorReturning([
      { success: false, message: 'Access is denied. The task requires elevation.' },
      { success: true }
    ]);
    const report = await applyBulkStatus(
      [task({ id: 'a', name: 'A' }), task({ id: 'b', name: 'B' })],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    expect(report.failed).toBe(1);
    expect(report.updated).toBe(1);
    expect(report.skipped).toBe(0);
    expect(report.haltedReason).toBeUndefined();
    expect(connector.setTaskStatus).toHaveBeenCalledTimes(2);
  });

  it('stops the batch when the agent is gone, and says so', async () => {
    // The point: 50 tasks against an offline agent is 50 × the connector's ~15s
    // timeout. Reporting the same fact fifty times is slower AND less useful
    // than reporting it once and naming what was not attempted.
    const connector = connectorReturning([{ success: false, message: 'Agent offline' }]);
    const report = await applyBulkStatus(
      [task({ id: 'a', name: 'A' }), task({ id: 'b', name: 'B' }), task({ id: 'c', name: 'C' })],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.haltedReason).toMatch(/Agent offline/);
    expect(connector.setTaskStatus).toHaveBeenCalledTimes(1);
    // Every skipped task carries the reason — a caller must never have to infer
    // the halt from the arithmetic.
    expect(report.items.filter(i => i.outcome === 'skipped').every(i => !!i.message)).toBe(true);
  });

  it('treats a thrown agent timeout the same as a returned one', async () => {
    const connector = connectorReturning([new Error('Agent trigger timeout after 15000ms')]);
    const report = await applyBulkStatus(
      [
        task({ id: 'a', status: TaskStatus.DISABLED }),
        task({ id: 'b', status: TaskStatus.DISABLED })
      ],
      TaskStatus.ACTIVE,
      resolveTo(connector)
    );

    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(1);
  });

  it('reports a missing connector as a failure rather than throwing', async () => {
    const report = await applyBulkStatus(
      [task({ platform: PlatformType.CLAUDE_CODE })],
      TaskStatus.DISABLED,
      () => ({ connector: undefined, config: {} })
    );

    expect(report.failed).toBe(1);
    expect(report.items[0].message).toMatch(/No connector/);
  });

  it('gives every non-updated outcome a message', async () => {
    const connector = connectorReturning([
      { success: false, message: 'Access is denied.' },
      { success: false, message: 'Agent offline' }
    ]);
    const report = await applyBulkStatus(
      [
        task({ id: 'ok', status: TaskStatus.ACTIVE }),
        task({ id: 'same', status: TaskStatus.DISABLED }),
        task({ id: 'gone', status: TaskStatus.MISSING }),
        task({ id: 'denied', status: TaskStatus.ACTIVE }),
        task({ id: 'halt', status: TaskStatus.ACTIVE }),
        task({ id: 'never', status: TaskStatus.ACTIVE })
      ],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    for (const item of report.items) {
      if (item.outcome === 'updated') expect(item.message).toBeUndefined();
      else expect(item.message, `${item.taskId} (${item.outcome}) has no message`).toBeTruthy();
    }
  });

  it('has counts that add up to the request', async () => {
    const connector = connectorReturning([{ success: false, message: 'Agent offline' }]);
    const report = await applyBulkStatus(
      [
        task({ id: 'same', status: TaskStatus.DISABLED }),
        task({ id: 'gone', status: TaskStatus.MISSING }),
        task({ id: 'halt', status: TaskStatus.ACTIVE }),
        task({ id: 'never', status: TaskStatus.ACTIVE })
      ],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    const total =
      report.updated + report.unchanged + report.refused + report.failed + report.skipped;
    expect(total).toBe(report.requested);
    expect(report.items).toHaveLength(report.requested);
  });
});

describe('isAgentDownMessage', () => {
  it('recognizes the shapes an absent agent produces', () => {
    expect(isAgentDownMessage('Agent offline')).toBe(true);
    expect(isAgentDownMessage('Agent trigger timeout after 15000ms')).toBe(true);
    expect(isAgentDownMessage('connect ECONNREFUSED 127.0.0.1:3000')).toBe(true);
  });

  it('does not mistake a per-task refusal for an absent agent', () => {
    // If this were loose, one ACL'd task would abort the rest of the batch.
    expect(isAgentDownMessage('Access is denied. The task requires elevation.')).toBe(false);
    expect(isAgentDownMessage('The task is disabled')).toBe(false);
    expect(isAgentDownMessage(undefined)).toBe(false);
  });
});

describe('summarizeBulkStatus', () => {
  it('names every non-zero outcome, not just the successes', async () => {
    const connector = connectorReturning([{ success: false, message: 'Agent offline' }]);
    const report = await applyBulkStatus(
      [
        task({ id: 'same', status: TaskStatus.DISABLED }),
        task({ id: 'gone', status: TaskStatus.MISSING }),
        task({ id: 'halt', status: TaskStatus.ACTIVE }),
        task({ id: 'never', status: TaskStatus.ACTIVE })
      ],
      TaskStatus.DISABLED,
      resolveTo(connector)
    );

    const summary = summarizeBulkStatus(report);
    expect(summary).toContain('0 disabled');
    expect(summary).toContain('1 already disabled');
    expect(summary).toContain('1 refused');
    expect(summary).toContain('1 failed');
    expect(summary).toContain('1 not attempted');
  });

  it('stays short when everything worked', async () => {
    const connector = connectorReturning([{ success: true }, { success: true }]);
    const report = await applyBulkStatus(
      [task({ id: 'a', status: TaskStatus.DISABLED }), task({ id: 'b', status: TaskStatus.DISABLED })],
      TaskStatus.ACTIVE,
      resolveTo(connector)
    );

    expect(summarizeBulkStatus(report)).toBe('2 enabled');
  });
});
