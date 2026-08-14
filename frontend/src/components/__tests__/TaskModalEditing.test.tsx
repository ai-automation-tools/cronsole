import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Task } from '../../types';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

vi.mock('../../hooks/useToast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('../../hooks/useConfirm', () => ({ useConfirm: () => confirmMock }));

vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: 'utc' });
  return {
    ...actual,
    getSettings: settings,
    useSettings: () => ({ settings: settings(), update: vi.fn(), replaceAll: vi.fn(), reset: vi.fn() })
  };
});

import { TaskModal } from '../TaskModal';
import { api } from '../../api';

/**
 * What this read-only screen still has to say about a task, and the one removal
 * verb that is unique to Claude.
 *
 * A rename is a **Cronsole label, never the machine**: it writes the DB row and
 * stops, so a Windows task keeps its Task Scheduler path. Someone who renames one
 * and then searches Task Scheduler for the new name finds nothing — which is why
 * this screen keeps showing the real path and says so once the two diverge. (The
 * rename *itself* moved into EditTaskModal and is tested there; what is pinned
 * here is that the divergence is still disclosed.)
 *
 * Disconnect is Claude's stand-in for untrack, and exists because untrack cannot
 * work there: a Claude task is tracked *because* the routine is declared in the
 * connection config, so removing the row leaves the declaration and the next
 * sync brings it back (troubleshooting #47).
 */

const windowsTask: Task = {
  id: 'task-1',
  name: 'Nightly Backup',
  externalId: '\\Edge-Radar\\Nightly Backup',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Edge-Radar',
  updatedAt: '2026-08-12T11:00:00Z',
  metadata: { command: 'echo hi' }
};

const claudeTask: Task = {
  id: 'task-2',
  name: 'Weekly planner',
  externalId: 'trig_01ABCDEF',
  platform: 'CLAUDE_CODE',
  status: 'ACTIVE',
  category: 'Claude',
  updatedAt: '2026-08-12T11:00:00Z',
  metadata: {}
};

const renderModal = (task: Task, onClose = vi.fn()) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TaskModal task={task} onClose={onClose} onRun={vi.fn()} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
  vi.mocked(api.get).mockResolvedValue({ data: [] });
  vi.mocked(api.patch).mockResolvedValue({ data: { ...windowsTask, name: 'Backup (2am)' } });
  vi.mocked(api.delete).mockResolvedValue({ data: { removed: 'trig_01ABCDEF', tasksRemoved: 1, connectionRemoved: true } });
});

describe('a renamed task', () => {
  it('keeps the real path on screen, so the machine is still findable', () => {
    // The path is how you find the task in Task Scheduler AND how every signed
    // agent command addresses it. A rename must never appear to move it.
    renderModal(windowsTask);
    expect(screen.getByText('\\Edge-Radar\\Nightly Backup')).toBeInTheDocument();
  });

  it('says so once the Cronsole label and the machine have parted company', () => {
    // Silence here is the failure: the user searches Task Scheduler for the new
    // name, finds nothing, and concludes Cronsole lost the task.
    renderModal({ ...windowsTask, name: 'Backup (2am)' });
    expect(screen.getByText(/Task Scheduler still calls it/i)).toBeInTheDocument();
    expect(screen.getByText('Nightly Backup')).toBeInTheDocument();
  });

  it('says nothing when the label still matches the machine', () => {
    renderModal(windowsTask);
    expect(screen.queryByText(/Task Scheduler still calls it/i)).not.toBeInTheDocument();
  });

  it('claims no second name for a platform that has none', () => {
    // A Claude id is an opaque trig_… and a native row IS the task, so neither
    // has a platform name to disagree with — deriving one from the id would
    // print "still calls it trig_01ABCDEF" over every routine.
    renderModal(claudeTask);
    expect(screen.queryByText(/Task Scheduler still calls it/i)).not.toBeInTheDocument();
  });
});

describe('removing a Claude task', () => {
  it('offers Disconnect routine instead of Remove from Cronsole', () => {
    // Untrack refuses server-side for this platform. Offering the button anyway
    // would be a control whose only outcome is an error message.
    renderModal(claudeTask);
    expect(screen.getByRole('button', { name: /Disconnect routine/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove from Cronsole/i })).not.toBeInTheDocument();
  });

  it('still offers Remove from Cronsole for Windows', () => {
    renderModal(windowsTask);
    expect(screen.getByRole('button', { name: /Remove from Cronsole/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Disconnect routine/i })).not.toBeInTheDocument();
  });

  it('names the token cost before the click, and where the routine keeps running', async () => {
    renderModal(claudeTask);
    fireEvent.click(screen.getByRole('button', { name: /Disconnect routine/i }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    const opts = confirmMock.mock.calls[0][0] as { message: string };
    // The one irreversible part, stated before it is spent rather than after.
    expect(opts.message).toMatch(/only shows it once/i);
    expect(opts.message).toMatch(/keeps running at claude\.ai/i);
  });

  it('disconnects by routine id — the externalId — not the Cronsole task id', async () => {
    // The routine registry is keyed on the trig_ id; sending task-2 would 404
    // and leave the routine declared.
    renderModal(claudeTask);
    fireEvent.click(screen.getByRole('button', { name: /Disconnect routine/i }));

    await waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/tools/platforms/claude/routines/trig_01ABCDEF')
    );
  });

  it('does nothing when the confirmation is declined', async () => {
    confirmMock.mockResolvedValue(false);
    renderModal(claudeTask);
    fireEvent.click(screen.getByRole('button', { name: /Disconnect routine/i }));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(api.delete).not.toHaveBeenCalled();
  });
});
