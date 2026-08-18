import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TaskHealthTool, type TaskHealth } from '../tools/TaskHealthTool';
import { openToolCard } from './helpers/toolCard';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const navigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
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

/**
 * Build a response in the shape the route actually returns.
 *
 * The healthy tasks are materialised into `tasks`, because that is what
 * `GET /tools/task-health` sends — it returns every scored task, not only the
 * failing ones. The earlier fixture faked them by bumping `counts.ok` and left
 * `tasks` holding unhealthy rows only, so the card's `Healthy` tile could read
 * an unscoped total while the other three were personal-filtered and no test
 * could see the mismatch. A fixture that models a different payload than the
 * server sends is a suite that agrees with itself.
 */
const respond = (tasks: TaskHealth[], ok = 12, okAreSystem = false) => {
  const healthy = Array.from({ length: ok }, (_, i) =>
    health({ taskId: `ok${i}`, name: `Healthy ${i}`, tier: 'ok', score: 100, signals: [], isSystem: okAreSystem })
  );
  const allTasks = [...tasks, ...healthy];
  const counts = {
    tasks: allTasks.length,
    critical: tasks.filter(t => t.tier === 'critical').length,
    attention: tasks.filter(t => t.tier === 'attention').length,
    unknown: tasks.filter(t => t.tier === 'unknown').length,
    ok
  };
  vi.mocked(api.get).mockResolvedValue({
    data: { evaluatedAt: '2026-07-28T12:00:00Z', counts, tasks: allTasks }
  } as never);
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
  openToolCard('task-health');
};

/** Open the disclosure that reveals the per-task list. */
const openList = async () =>
  fireEvent.click(await screen.findByRole('button', { name: /needing attention/i }));

describe('TaskHealthTool', () => {
  beforeEach(() => vi.clearAllMocks());

  // The card's job on a utility tab is to answer its question at a glance. The
  // per-task list is a deliberate second click, not the default view.
  it('shows only the summary until asked for the list', async () => {
    respond([health()]);
    renderTool();

    // The counts are there…
    expect(await screen.findByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText(/across 13 tasks/i)).toBeInTheDocument();

    // …and the task itself is not, until you open it.
    expect(screen.queryByText('Nightly Backup')).not.toBeInTheDocument();
    const disclosure = screen.getByRole('button', { name: /show 1 task needing attention/i });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(disclosure);
    expect(screen.getByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /hide the list/i })).toBeInTheDocument();
  });

  // Deliberately the opposite of a dashboard banner: a *tool* that vanished
  // when all was well would read as a missing feature. You opened this tab to
  // ask the question, so it answers even when the answer is "nothing".
  it('still renders, and says so, when nothing needs attention', async () => {
    respond([]);
    renderTool();

    expect(await screen.findByText(/nothing needs attention/i)).toBeInTheDocument();
    expect(screen.getByText('Task health')).toBeInTheDocument();
    // No disclosure to click when there is no list behind it.
    expect(screen.queryByRole('button', { name: /needing attention/i })).not.toBeInTheDocument();
  });

  // Found on a real 352-task machine, and by no test: the row read
  // `12 / 25 / 1 / 218` under "across 352 tasks" — three tiers counted over the
  // user's own tasks and `Healthy` counted over everyone's, so it summed to 256
  // and described no population at all.
  it('counts every tier over the same population as the label', async () => {
    respond(
      [health({ taskId: 'mine', isSystem: false }), health({ taskId: 'sys', isSystem: true })],
      10,
      true // the healthy tasks are Windows' own
    );
    renderTool();

    // Personal view: 1 unhealthy task, 0 healthy — the 10 healthy ones are all
    // system and must not leak into a row that excludes system tasks.
    expect(await screen.findByText(/across 1 task$/i)).toBeInTheDocument();
    // Anchored: `toHaveTextContent('0')` matches "10" by substring, so the
    // unscoped value this test exists to reject would sail straight through it.
    expect(screen.getByText('Healthy').previousElementSibling).toHaveTextContent(/^0$/);

    // Including system: 12 tasks, 10 of them healthy.
    fireEvent.click(screen.getByRole('button', { name: /1 system hidden/i }));
    expect(await screen.findByText(/across 12 tasks/i)).toBeInTheDocument();
    expect(screen.getByText('Healthy').previousElementSibling).toHaveTextContent(/^10$/);
  });

  it('leads with the failing task and its headline signal, not a score', async () => {
    respond([health()]);
    renderTool();
    await openList();

    expect(screen.getByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.getByText('The last run failed.')).toBeInTheDocument();
    // The number is a ranking key — it appears only alongside its signals.
    expect(screen.queryByText('50')).not.toBeInTheDocument();
  });

  // The rule the whole feature rests on: a claim never appears without its source.
  it('shows the evidence behind a signal when the row is expanded', async () => {
    respond([health()]);
    renderTool();
    await openList();

    fireEvent.click(screen.getByRole('button', { name: /nightly backup/i }));

    expect(screen.getByText(/Windows recorded exit code 2/)).toBeInTheDocument();
    expect(screen.getByText(/orders this list, doesn't grade the task/i)).toBeInTheDocument();
  });

  // Silence is not health. An unmeasured task must look different from a fine one.
  it('counts unmeasured tasks as their own tier rather than folding them into healthy', async () => {
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
            summary: 'Cronsole has no run results for this task yet.',
            evidence: 'The connected agent does not report last-run results — republish the agent to enable health checks',
            weight: 0
          }
        ]
      })
    ]);
    renderTool();

    expect(await screen.findByText('Unmeasured')).toBeInTheDocument();
    await openList();
    // And it says how to fix the measurement, so nobody debugs a working task.
    fireEvent.click(screen.getByRole('button', { name: /unmeasured/i }));
    expect(screen.getByText(/republish the agent/i)).toBeInTheDocument();
  });

  // The bug live testing found: 4 of the 5 worst tasks on a real machine were
  // `\Microsoft\` entries, burying the ones the user can act on.
  it("keeps Windows' own tasks out of the count and the list by default", async () => {
    respond([
      health({ taskId: 'sys', name: 'AikCertEnrollTask', isSystem: true }),
      health({ taskId: 'mine', name: 'Nightly Backup', isSystem: false })
    ]);
    renderTool();

    // Hidden, but never silently — rows vanishing without a word is the other
    // half of the same mistake.
    expect(await screen.findByRole('button', { name: /1 system hidden/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show 1 task needing attention/i })).toBeInTheDocument();

    await openList();
    expect(screen.getByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.queryByText('AikCertEnrollTask')).not.toBeInTheDocument();
  });

  it("brings Windows' own tasks back when asked", async () => {
    respond([
      health({ taskId: 'sys', name: 'AikCertEnrollTask', isSystem: true }),
      health({ taskId: 'mine', name: 'Nightly Backup', isSystem: false })
    ]);
    renderTool();

    fireEvent.click(await screen.findByRole('button', { name: /1 system hidden/i }));
    await openList();
    expect(screen.getByText('AikCertEnrollTask')).toBeInTheDocument();
  });

  it('deep-links to the task, so the card needs no dashboard state', async () => {
    respond([health()]);
    renderTool();
    await openList();

    fireEvent.click(screen.getByRole('button', { name: /nightly backup/i }));
    fireEvent.click(screen.getByRole('button', { name: /open task/i }));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/tasks/t1'));
  });

  describe('when the list is long', () => {
    beforeEach(() => respond(Array.from({ length: 9 }, (_, i) => health({ taskId: `t${i}`, name: `Task ${i}` }))));

    it('caps the list and offers the rest rather than dumping 40 rows', async () => {
      renderTool();
      await openList();

      expect(screen.getByText('Task 0')).toBeInTheDocument();
      expect(screen.queryByText('Task 7')).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /show 3 more/i }));
      expect(screen.getByText('Task 7')).toBeInTheDocument();
    });

    // Once everything is open, the control that opened it has scrolled out of
    // reach — so there has to be a way back out from the bottom.
    it('offers a collapse at the bottom only once fully expanded', async () => {
      renderTool();
      await openList();

      expect(screen.queryByRole('button', { name: /^collapse$/i })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /show 3 more/i }));
      const collapse = screen.getByRole('button', { name: /^collapse$/i });
      expect(collapse).toBeInTheDocument();

      fireEvent.click(collapse);
      // Back to the summary, not merely back to the capped list.
      expect(screen.queryByText('Task 0')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /show 9 tasks needing attention/i })).toBeInTheDocument();
    });
  });
});
