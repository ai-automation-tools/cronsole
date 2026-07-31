import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ScheduleTesterTool } from '../tools/ScheduleTesterTool';
import { api } from '../../api';

vi.mock('../../api', () => ({ api: { post: vi.fn() } }));

const renderTool = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ScheduleTesterTool />
    </QueryClientProvider>
  );
};

/** The #14 shape: a once-a-year cron that registers as an hourly trigger. */
const REPLACED = {
  score: 0.7,
  warnings: ['Cron pattern not recognized; REPLACED with an hourly trigger (~8,760 runs a year).'],
  trigger: { type: 'Daily', startBoundary: '00:00', repetition: { interval: 'PT1H' } },
  lossy: 'replaced' as const,
  requestedRuns: ['2027-01-01T04:00:00.000Z'],
  effectiveRuns: [
    '2026-07-31T13:00:00.000Z',
    '2026-07-31T14:00:00.000Z',
    '2026-07-31T15:00:00.000Z'
  ],
  diverges: true
};

const EXACT = {
  score: 1,
  warnings: [],
  trigger: { type: 'Daily', startBoundary: '09:00' },
  requestedRuns: ['2026-08-01T09:00:00.000Z', '2026-08-02T09:00:00.000Z'],
  effectiveRuns: ['2026-08-01T09:00:00.000Z', '2026-08-02T09:00:00.000Z'],
  diverges: false
};

describe('ScheduleTesterTool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('says plainly when the registered schedule is not the one you typed', async () => {
    // The whole reason the tool exists. A score of 0.7 and the word "lossy" are
    // not what makes this land — "this is not the schedule you typed" is.
    vi.mocked(api.post).mockResolvedValue({ data: REPLACED } as never);
    renderTool();

    await waitFor(() => {
      expect(screen.getByText(/this is not the schedule you typed/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/what you asked for/i)).toBeInTheDocument();
    expect(screen.getByText(/what will actually run/i)).toBeInTheDocument();
    expect(screen.getByText(/discarded and replaced/i)).toBeInTheDocument();
  });

  it('shows every run in both local time and UTC', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: EXACT } as never);
    renderTool();

    // Two occurrences, each rendered with a UTC companion — the tester must
    // never leave "which zone is this?" as an open question.
    // Match the UTC parenthetical beside each run, not every mention of "UTC"
    // on the card (the cron field's own label says UTC too).
    await waitFor(() => {
      expect(screen.getAllByText(/^\(.*UTC\)$/)).toHaveLength(2);
    });
  });

  it('confirms an exact conversion instead of staying silent about it', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: EXACT } as never);
    renderTool();

    await waitFor(() => {
      expect(screen.getByText(/converts exactly/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/what will actually run/i)).not.toBeInTheDocument();
  });

  it('explains the absence of dates for an approximated step rather than inventing them', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        score: 0.7,
        warnings: ['Minute step 7 does not divide 60 evenly.'],
        trigger: { type: 'Daily', startBoundary: '00:00', repetition: { interval: 'PT7M' } },
        lossy: 'approximated',
        requestedRuns: ['2026-07-31T12:07:00.000Z'],
        effectiveRuns: null,
        diverges: false
      }
    } as never);
    renderTool();

    await waitFor(() => {
      expect(screen.getByText(/would be a\s+guess rather than a reading/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/what will actually run/i)).not.toBeInTheDocument();
  });

  it('reports a cron with no upcoming occurrences as "never"', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { ...EXACT, requestedRuns: [], effectiveRuns: [], diverges: false }
    } as never);
    renderTool();

    await waitFor(() => {
      expect(screen.getByText(/no upcoming occurrences/i)).toBeInTheDocument();
    });
  });

  it('surfaces an invalid expression without pretending to have run times', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: {
        score: 0,
        warnings: ['Schedule must be a 5-field cron expression (min hour dom month dow).'],
        trigger: null,
        requestedRuns: [],
        effectiveRuns: null,
        diverges: false
      }
    } as never);
    renderTool();

    await waitFor(() => {
      expect(screen.getByText(/must be a 5-field cron/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/next runs/i)).not.toBeInTheDocument();
  });

  it('sends the cron and platform the user picked, and creates nothing', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: EXACT } as never);
    renderTool();

    fireEvent.change(screen.getByLabelText(/platform to test against/i), {
      target: { value: 'TASKHUB_NATIVE' }
    });

    await waitFor(() => {
      const calls = vi.mocked(api.post).mock.calls;
      const last = calls.at(-1);
      expect(last?.[0]).toBe('/tasks/preview'); // preview only — never /tasks
      expect(last?.[1]).toMatchObject({ platform: 'TASKHUB_NATIVE' });
    });
    expect(vi.mocked(api.post).mock.calls.every(c => c[0] === '/tasks/preview')).toBe(true);
  });
});
