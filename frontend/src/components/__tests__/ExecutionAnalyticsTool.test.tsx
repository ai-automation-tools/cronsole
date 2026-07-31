import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ExecutionAnalyticsTool } from '../tools/ExecutionAnalyticsTool';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { get: vi.fn() } }));

const navigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigate };
});

type Analytics = {
  window: { from: string; to: string; days: number; timeZone: string };
  totals: { runs: number; succeeded: number; failed: number; pending: number };
  trend: { covered: { from: string; to: string }; partial: boolean; days: unknown[] };
  duration: {
    considered: number;
    excludedManualTriggerRuns: number;
    minimumSamplesPerSide: number;
    tasks: unknown[];
  };
  idle: { thresholdDays: number; tasks: unknown[]; unassessed: unknown[] };
};

const respond = (overrides: Partial<Analytics> = {}) => {
  const data: Analytics = {
    window: {
      from: '2026-06-28T12:00:00.000Z',
      to: '2026-07-28T12:00:00.000Z',
      days: 30,
      timeZone: 'America/Los_Angeles'
    },
    totals: { runs: 12, succeeded: 9, failed: 3, pending: 0 },
    trend: {
      covered: { from: '2026-07-26T00:00:00.000Z', to: '2026-07-28T12:00:00.000Z' },
      partial: false,
      days: [
        { day: '2026-07-26', runs: 0, succeeded: 0, failed: 0, pending: 0 },
        { day: '2026-07-27', runs: 4, succeeded: 2, failed: 2, pending: 0 },
        { day: '2026-07-28', runs: 8, succeeded: 7, failed: 1, pending: 0 }
      ]
    },
    duration: { considered: 0, excludedManualTriggerRuns: 0, minimumSamplesPerSide: 2, tasks: [] },
    idle: { thresholdDays: 30, tasks: [], unassessed: [] },
    ...overrides
  };
  vi.mocked(api.get).mockResolvedValue({ data } as never);
  return data;
};

const renderTool = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ExecutionAnalyticsTool />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const switchTo = (label: RegExp) => fireEvent.click(screen.getByRole('tab', { name: label }));

describe('ExecutionAnalyticsTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks the server to cut the buckets in the reader\'s own timezone', async () => {
    // Bucketing in UTC puts a 6pm run on tomorrow's bar and looks completely
    // normal doing it — so the zone travels with the request, not by assumption.
    respond();
    renderTool();

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(vi.mocked(api.get).mock.calls[0][1]).toMatchObject({
      params: { days: 30, tz: expect.any(String) }
    });
  });

  it('leads with the exact totals for the window', async () => {
    respond();
    renderTool();

    expect(await screen.findByText('12')).toBeInTheDocument();
    // "Failed" is both a stat label and a legend entry — the legend is the
    // secondary encoding, so both are meant to be there.
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  // Emerald and red separate by only ΔE 8.1 under deuteranopia, so the chart
  // must never rest identity on hue alone.
  it('renders a legend so the bars are readable without colour vision', async () => {
    respond();
    renderTool();

    expect(await screen.findAllByText('Succeeded')).toHaveLength(2);
    expect(screen.getAllByText('Failed')).toHaveLength(2);
    // Pending appears only in the legend — its stat tile isn't one of the three.
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('prints a day\'s numbers on focus, so the chart is readable by keyboard', async () => {
    respond();
    renderTool();

    const bars = await screen.findAllByRole('button', { name: /run/ });
    fireEvent.focus(bars[1]);

    // Scoped to the live region, so this proves the readout updated rather than
    // just re-finding the bar's own label.
    const readout = screen.getByRole('status');
    await waitFor(() => expect(within(readout).getByText(/4 runs/)).toBeInTheDocument());
    expect(within(readout).getByText(/2 failed/)).toBeInTheDocument();
  });

  it('draws a bar for every day in the span, including the empty ones', async () => {
    // A trend that omits its empty days draws a straight line across an outage.
    respond();
    renderTool();

    const bars = await screen.findAllByRole('button', { name: /run/ });
    expect(bars).toHaveLength(3);
    expect(bars[0]).toHaveAccessibleName(/0 runs/);
  });

  it('says so when the chart covers less than the period the totals do', async () => {
    respond({
      trend: {
        covered: { from: '2026-07-26T00:00:00.000Z', to: '2026-07-28T12:00:00.000Z' },
        partial: true,
        days: [{ day: '2026-07-26', runs: 1, succeeded: 1, failed: 0, pending: 0 }]
      }
    });
    renderTool();

    expect(await screen.findByText(/Too many runs to chart the whole period/i)).toBeInTheDocument();
  });

  it('states that the trend counts only runs Cronsole performed', async () => {
    // Without this, an empty period reads as "nothing ran" when it means
    // "Cronsole triggered nothing".
    respond();
    renderTool();

    expect(await screen.findByText(/Cronsole performed/)).toBeInTheDocument();
    expect(screen.getByText(/firing on its own schedule isn't recorded/i)).toBeInTheDocument();
  });

  it('explains an empty duration list instead of just showing nothing', async () => {
    // On a Windows-only machine this list is legitimately empty, and an empty
    // list with no explanation reads as a broken feature.
    respond({
      duration: { considered: 0, excludedManualTriggerRuns: 40, minimumSamplesPerSide: 2, tasks: [] }
    });
    renderTool();

    await screen.findByText('Runs');
    switchTo(/duration/i);

    expect(await screen.findByText(/Nothing to compare yet/i)).toBeInTheDocument();
    expect(screen.getByText(/accept/)).toBeInTheDocument();
    expect(screen.getByText(/40 runs were left out/)).toBeInTheDocument();
  });

  it('shows recent against baseline, not a bare ratio', async () => {
    respond({
      duration: {
        considered: 10,
        excludedManualTriggerRuns: 0,
        minimumSamplesPerSide: 2,
        tasks: [
          {
            taskId: 'n1',
            name: 'Nightly digest',
            recentMedianMs: 4000,
            baselineMedianMs: 1000,
            changeRatio: 4,
            recentSamples: 5,
            baselineSamples: 5
          }
        ]
      }
    });
    renderTool();

    await screen.findByText('Runs');
    switchTo(/duration/i);

    expect(await screen.findByText('Nightly digest')).toBeInTheDocument();
    expect(screen.getByText(/4\.0s now vs 1\.0s typical/)).toBeInTheDocument();
    expect(screen.getByText(/↑ 4\.0×/)).toBeInTheDocument();
  });

  it('carries the evidence beside every idle task, never the verdict alone', async () => {
    respond({
      idle: {
        thresholdDays: 30,
        tasks: [
          {
            taskId: 'w1',
            name: 'Nightly Backup',
            platform: 'WINDOWS_TASK_SCHEDULER',
            category: 'Work',
            isSystem: false,
            lastRunAt: '2026-06-13T03:00:00.000Z',
            daysSinceLastRun: 45,
            evidence: 'Windows reported a last run at 2026-06-13T03:00:00.000Z'
          }
        ],
        unassessed: []
      }
    });
    renderTool();

    await screen.findByText('Runs');
    switchTo(/idle/i);

    expect(await screen.findByText('Nightly Backup')).toBeInTheDocument();
    expect(screen.getByText(/Windows reported a last run/)).toBeInTheDocument();
    expect(screen.getByText('45d')).toBeInTheDocument();
  });

  it("hides Windows' own tasks by default and names how many", async () => {
    // The same lens the dashboard and the health card use — hidden, counted out
    // loud, never silently dropped.
    respond({
      idle: {
        thresholdDays: 30,
        tasks: [
          {
            taskId: 'm1',
            name: 'AikCertEnrollTask',
            platform: 'WINDOWS_TASK_SCHEDULER',
            category: 'Microsoft',
            isSystem: true,
            lastRunAt: '2026-06-13T03:00:00.000Z',
            daysSinceLastRun: 45,
            evidence: 'Windows reported a last run at 2026-06-13T03:00:00.000Z'
          }
        ],
        unassessed: []
      }
    });
    renderTool();

    await screen.findByText('Runs');
    switchTo(/idle/i);

    expect(await screen.findByText('1 system hidden')).toBeInTheDocument();
    expect(screen.queryByText('AikCertEnrollTask')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('1 system hidden'));
    expect(await screen.findByText('AikCertEnrollTask')).toBeInTheDocument();
  });

  it('reports what it did not assess, so an empty list is not read as all-clear', async () => {
    respond({
      idle: {
        thresholdDays: 30,
        tasks: [],
        unassessed: [
          { taskId: 'a', name: 'Parked', isSystem: false, reason: 'disabled', evidence: 'DISABLED' },
          {
            taskId: 'b',
            name: 'Old agent',
            isSystem: false,
            reason: 'no-run-evidence',
            evidence: 'The connected agent has not reported a last-run time for this task'
          }
        ]
      }
    });
    renderTool();

    await screen.findByText('Runs');
    switchTo(/idle/i);

    expect(await screen.findByText(/Every scheduled task has run recently/i)).toBeInTheDocument();
    expect(screen.getByText(/1 disabled · 1 no run data from the agent/)).toBeInTheDocument();
  });
});
