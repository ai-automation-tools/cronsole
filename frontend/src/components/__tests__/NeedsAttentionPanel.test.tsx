import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NeedsAttentionPanel, type TaskHealth } from '../NeedsAttentionPanel';
import { api } from '../../api';
import type { Task } from '../../types';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const health = (overrides: Partial<TaskHealth> = {}): TaskHealth => ({
  taskId: 't1',
  name: 'Nightly Backup',
  platform: 'WINDOWS_TASK_SCHEDULER',
  category: 'Work',
  isSystem: false,
  tier: 'critical',
  score: 50,
  signals: [
    {
      code: 'last-run-failed',
      severity: 'critical',
      summary: 'The last run failed.',
      evidence: 'Windows recorded exit code 2 for the run at 2026-07-27T03:00:00.000Z',
      weight: 50
    }
  ],
  ...overrides
});

const respond = (tasks: TaskHealth[]) => {
  const counts = {
    tasks: tasks.length,
    critical: tasks.filter(t => t.tier === 'critical').length,
    attention: tasks.filter(t => t.tier === 'attention').length,
    unknown: tasks.filter(t => t.tier === 'unknown').length,
    ok: tasks.filter(t => t.tier === 'ok').length
  };
  vi.mocked(api.get).mockResolvedValue({ data: { evaluatedAt: '2026-07-28T12:00:00Z', counts, tasks } } as never);
};

const renderPanel = (tasks: Task[] = [], onTaskSelect = vi.fn()) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NeedsAttentionPanel tasks={tasks} onTaskSelect={onTaskSelect} />
    </QueryClientProvider>
  );
  return onTaskSelect;
};

describe('NeedsAttentionPanel', () => {
  beforeEach(() => vi.clearAllMocks());

  // A permanent "all good" panel is the banner people learn to ignore — and
  // then miss the one time it says something.
  it('renders nothing when every task is healthy', async () => {
    respond([health({ tier: 'ok', score: 100, signals: [] })]);
    renderPanel();
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/needs attention/i)).not.toBeInTheDocument();
  });

  it('leads with the failing task and its headline signal, not a score', async () => {
    respond([health()]);
    renderPanel();

    expect(await screen.findByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.getByText('The last run failed.')).toBeInTheDocument();
    // The number must not be the headline — it is a ranking key, and shown
    // only alongside its signals once expanded.
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  // The rule the whole feature rests on: a claim never appears without its source.
  it('shows the evidence behind a signal when the row is expanded', async () => {
    respond([health()]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /nightly backup/i }));

    expect(screen.getByText(/Windows recorded exit code 2/)).toBeInTheDocument();
    expect(screen.getByText(/used to order this list, not to grade the task/i)).toBeInTheDocument();
  });

  // Silence is not health. An unmeasured task has to look different from a fine one.
  it('shows unmeasured tasks as their own tier rather than folding them into healthy', async () => {
    respond([
      health({
        taskId: 't2',
        name: 'Unmeasured',
        tier: 'unknown',
        score: null,
        signals: [
          {
            code: 'no-run-evidence',
            severity: 'info',
            summary: 'TaskHub has no run results for this task yet.',
            evidence: 'The connected agent does not report last-run results — republish the agent to enable health checks',
            weight: 0
          }
        ]
      })
    ]);
    renderPanel();

    expect(await screen.findByText('Unmeasured')).toBeInTheDocument();
    expect(screen.getByText(/1 unmeasured/i)).toBeInTheDocument();
    // And it says how to fix the measurement, so nobody debugs a working task.
    fireEvent.click(screen.getByRole('button', { name: /unmeasured/i }));
    expect(screen.getByText(/republish the agent/i)).toBeInTheDocument();
  });

  it('opens the underlying task when one is available', async () => {
    respond([health()]);
    const task = { id: 't1', name: 'Nightly Backup' } as Task;
    const onTaskSelect = renderPanel([task]);

    fireEvent.click(await screen.findByRole('button', { name: /nightly backup/i }));
    fireEvent.click(screen.getByRole('button', { name: /open task/i }));

    expect(onTaskSelect).toHaveBeenCalledWith(task);
  });

  // The bug live testing found: 4 of the 5 worst tasks on a real machine were
  // `\Microsoft\` entries, burying the ones the user can act on — the exact
  // problem the dashboard's Personal lens exists to solve.
  it("keeps Windows' own tasks out of the list by default, and says how many", async () => {
    respond([
      health({ taskId: 'sys', name: 'AikCertEnrollTask', isSystem: true }),
      health({ taskId: 'mine', name: 'Nightly Backup', isSystem: false })
    ]);
    renderPanel();

    expect(await screen.findByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.queryByText('AikCertEnrollTask')).not.toBeInTheDocument();
    // Hidden, but never silently: 257 rows vanishing without a word is the
    // other half of the same mistake.
    expect(screen.getByRole('button', { name: /1 system hidden/i })).toBeInTheDocument();
  });

  it("brings Windows' own tasks back when asked", async () => {
    respond([
      health({ taskId: 'sys', name: 'AikCertEnrollTask', isSystem: true }),
      health({ taskId: 'mine', name: 'Nightly Backup', isSystem: false })
    ]);
    renderPanel();

    fireEvent.click(await screen.findByRole('button', { name: /1 system hidden/i }));
    expect(screen.getByText('AikCertEnrollTask')).toBeInTheDocument();
  });

  it('caps the list and offers the rest rather than dumping 50 rows', async () => {
    respond(Array.from({ length: 8 }, (_, i) => health({ taskId: `t${i}`, name: `Task ${i}` })));
    renderPanel();

    expect(await screen.findByText('Task 0')).toBeInTheDocument();
    expect(screen.queryByText('Task 6')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show 3 more/i }));
    expect(screen.getByText('Task 6')).toBeInTheDocument();
  });
});
