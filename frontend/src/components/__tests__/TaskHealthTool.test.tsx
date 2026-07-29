import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TaskHealthTool, type TaskHealth } from '../tools/TaskHealthTool';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

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

const respond = (tasks: TaskHealth[], ok = 12) => {
  const counts = {
    tasks: tasks.length + ok,
    critical: tasks.filter(t => t.tier === 'critical').length,
    attention: tasks.filter(t => t.tier === 'attention').length,
    unknown: tasks.filter(t => t.tier === 'unknown').length,
    ok
  };
  vi.mocked(api.get).mockResolvedValue({ data: { evaluatedAt: '2026-07-28T12:00:00Z', counts, tasks } } as never);
};

const renderTool = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TaskHealthTool />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('TaskHealthTool', () => {
  beforeEach(() => vi.clearAllMocks());

  // Deliberately the opposite of a dashboard banner: a *tool* that vanished
  // when all was well would read as a missing feature. You opened this tab to
  // ask the question, so it answers even when the answer is "nothing".
  it('still renders, and says so, when nothing needs attention', async () => {
    respond([]);
    renderTool();

    expect(await screen.findByText(/nothing needs attention/i)).toBeInTheDocument();
    expect(screen.getByText('Task health')).toBeInTheDocument();
    expect(screen.getByText(/12 healthy/i)).toBeInTheDocument();
  });

  it('leads with the failing task and its headline signal, not a score', async () => {
    respond([health()]);
    renderTool();

    expect(await screen.findByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.getByText('The last run failed.')).toBeInTheDocument();
    // The number is a ranking key — it appears only alongside its signals.
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  // The rule the whole feature rests on: a claim never appears without its source.
  it('shows the evidence behind a signal when the row is expanded', async () => {
    respond([health()]);
    renderTool();

    fireEvent.click(await screen.findByRole('button', { name: /nightly backup/i }));

    expect(screen.getByText(/Windows recorded exit code 2/)).toBeInTheDocument();
    expect(screen.getByText(/orders this list, doesn't grade the task/i)).toBeInTheDocument();
  });

  // Silence is not health. An unmeasured task must look different from a fine one.
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
    renderTool();

    expect(await screen.findByText('Unmeasured')).toBeInTheDocument();
    expect(screen.getByText(/1 unmeasured/i)).toBeInTheDocument();
    // And it says how to fix the measurement, so nobody debugs a working task.
    fireEvent.click(screen.getByRole('button', { name: /unmeasured/i }));
    expect(screen.getByText(/republish the agent/i)).toBeInTheDocument();
  });

  // The bug live testing found: 4 of the 5 worst tasks on a real machine were
  // `\Microsoft\` entries, burying the ones the user can act on.
  it("keeps Windows' own tasks out of the list by default, and says how many", async () => {
    respond([
      health({ taskId: 'sys', name: 'AikCertEnrollTask', isSystem: true }),
      health({ taskId: 'mine', name: 'Nightly Backup', isSystem: false })
    ]);
    renderTool();

    expect(await screen.findByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.queryByText('AikCertEnrollTask')).not.toBeInTheDocument();
    // Hidden, but never silently — 99 rows vanishing without a word is the
    // other half of the same mistake.
    expect(screen.getByRole('button', { name: /1 system hidden/i })).toBeInTheDocument();
  });

  it("brings Windows' own tasks back when asked", async () => {
    respond([
      health({ taskId: 'sys', name: 'AikCertEnrollTask', isSystem: true }),
      health({ taskId: 'mine', name: 'Nightly Backup', isSystem: false })
    ]);
    renderTool();

    fireEvent.click(await screen.findByRole('button', { name: /1 system hidden/i }));
    expect(screen.getByText('AikCertEnrollTask')).toBeInTheDocument();
  });

  it('deep-links to the task, so the card needs no dashboard state', async () => {
    respond([health()]);
    renderTool();

    fireEvent.click(await screen.findByRole('button', { name: /nightly backup/i }));
    fireEvent.click(screen.getByRole('button', { name: /open task/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks/t1'));
  });

  it('caps the list and offers the rest rather than dumping 40 rows', async () => {
    respond(Array.from({ length: 9 }, (_, i) => health({ taskId: `t${i}`, name: `Task ${i}` })));
    renderTool();

    expect(await screen.findByText('Task 0')).toBeInTheDocument();
    expect(screen.queryByText('Task 7')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /show 3 more/i }));
    expect(screen.getByText('Task 7')).toBeInTheDocument();
  });
});
