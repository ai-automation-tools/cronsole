import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api', () => ({
  api: { get: vi.fn() }
}));

// The schedule zone is pinned to UTC so a cell's date does not depend on the
// machine the suite runs on. Zone bucketing itself is covered in
// `utils/__tests__/calendar.test.ts`, against both UTC and Pacific.
vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: 'utc' });
  return {
    ...actual,
    getSettings: settings,
    useSettings: () => ({ settings: settings(), update: vi.fn(), replaceAll: vi.fn(), reset: vi.fn() })
  };
});

// The grid's "today" comes from this, so the month it opens on is fixed.
vi.mock('../../hooks/useMinuteClock', () => ({
  useMinuteClock: () => new Date('2026-03-11T12:00:00.000Z')
}));

import { CalendarView } from '../CalendarView';
import { api } from '../../api';
import type { Task } from '../../types';

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  name: 'Nightly digest',
  category: 'Backups',
  platform: 'TASKHUB_NATIVE',
  status: 'ACTIVE',
  externalId: '\\Backups\\Nightly',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...over
});

const response = (over: Record<string, unknown> = {}) => ({
  data: {
    range: { from: '2026-02-28T00:00:00.000Z', to: '2026-04-13T00:00:00.000Z' },
    scope: { includeSystem: false, systemExcluded: 0, maxPerTask: 200 },
    tasks: [],
    unplaceable: [],
    truncated: 0,
    ...over
  }
});

/**
 * The calendar view.
 *
 * The tests that matter are the honesty ones. Drawing chips on a grid is
 * mechanical; what a calendar can silently get wrong is claiming a task does not
 * run — by omitting one it could not place, by cutting a frequent task's list
 * short without saying so, or by rendering an empty month before the answer has
 * arrived. Each of those renders as a perfectly plausible calendar.
 */
describe('CalendarView', () => {
  let queryClient: QueryClient;

  const renderView = (tasks: Task[] = [task()], includeSystem = false) => {
    const onTaskSelect = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <CalendarView tasks={tasks} includeSystem={includeSystem} onTaskSelect={onTaskSelect} />
      </QueryClientProvider>
    );
    return { onTaskSelect };
  };

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  it('opens on the month containing today, in the schedule zone', async () => {
    vi.mocked(api.get).mockResolvedValue(response());
    renderView();
    expect(await screen.findByText('March 2026')).toBeInTheDocument();
  });

  it('asks for a padded range around the grid, and passes the lens', async () => {
    vi.mocked(api.get).mockResolvedValue(response());
    renderView([task()], true);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    const [url, config] = vi.mocked(api.get).mock.calls[0];
    expect(url).toBe('/tools/occurrences');
    // A day either side of the six-week grid — see `rangeFor`.
    expect(config!.params).toMatchObject({
      from: '2026-02-28T00:00:00.000Z',
      to: '2026-04-13T00:00:00.000Z',
      includeSystem: 'true'
    });
  });

  it('says it is still working rather than drawing an empty month', async () => {
    // An empty grid claims "nothing runs this month", which is a much more
    // surprising statement than "the answer has not arrived".
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderView();
    expect(await screen.findByText(/Working out when each task fires/i)).toBeInTheDocument();
  });

  it('places a run on the day it falls on, and opens the task when clicked', async () => {
    vi.mocked(api.get).mockResolvedValue(
      response({ tasks: [{ taskId: 't1', occurrences: ['2026-03-11T09:00:00.000Z'], truncatedAfter: null }] })
    );
    const { onTaskSelect } = renderView();

    const chip = await screen.findByTitle(/Nightly digest —/);
    fireEvent.click(chip);
    expect(onTaskSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('collapses a task that runs several times in a day into one chip with a count', async () => {
    // Six rows in a cell with room for three is how a busy day becomes unreadable.
    vi.mocked(api.get).mockResolvedValue(
      response({
        tasks: [{
          taskId: 't1',
          occurrences: [
            '2026-03-11T09:00:00.000Z',
            '2026-03-11T13:00:00.000Z',
            '2026-03-11T17:00:00.000Z'
          ],
          truncatedAfter: null
        }]
      })
    );
    renderView();
    expect(await screen.findByText('×3')).toBeInTheDocument();
  });

  it('ignores runs for tasks the current filters excluded', async () => {
    // The response is keyed on the range, not the filters, so it covers tasks
    // this slice does not show. Drawing them would make the calendar disagree
    // with every other view of the same slice.
    vi.mocked(api.get).mockResolvedValue(
      response({ tasks: [{ taskId: 'not-on-screen', occurrences: ['2026-03-11T09:00:00.000Z'], truncatedAfter: null }] })
    );
    renderView([task({ id: 't1' })]);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByTitle(/Nightly digest —/)).not.toBeInTheDocument();
  });

  it('names a task it could not place, with the reason', async () => {
    // §9: a refusal to convert must state why. A logon-triggered task silently
    // missing from a calendar is indistinguishable from a deleted one.
    vi.mocked(api.get).mockResolvedValue(
      response({ unplaceable: [{ taskId: 't1', reason: 'No cron schedule — runs at logon.' }] })
    );
    renderView();

    expect(await screen.findByText(/has no place on a calendar/i)).toBeInTheDocument();
    expect(screen.getByText(/runs at logon/)).toBeInTheDocument();
  });

  it('says when a task runs too often to draw the whole range', async () => {
    // Without this the second half of the month is empty, which reads as "it
    // stopped running" — the most expensive wrong thing a calendar can say.
    vi.mocked(api.get).mockResolvedValue(
      response({
        tasks: [{
          taskId: 't1',
          occurrences: ['2026-03-01T00:00:00.000Z'],
          truncatedAfter: '2026-03-01T00:00:00.000Z'
        }],
        truncated: 1
      })
    );
    renderView();
    expect(await screen.findByText(/too often to list every run/i)).toBeInTheDocument();
  });

  it('does not warn about truncation for a task the filters excluded', async () => {
    // The warning is about the grid on screen. Counting a task this slice does
    // not draw would put a permanent notice over a complete calendar.
    vi.mocked(api.get).mockResolvedValue(
      response({
        tasks: [{ taskId: 'elsewhere', occurrences: [], truncatedAfter: '2026-03-01T00:00:00.000Z' }],
        truncated: 1
      })
    );
    renderView([task({ id: 't1' })]);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByText(/too often to list every run/i)).not.toBeInTheDocument();
  });

  it('steps months and comes back to today', async () => {
    vi.mocked(api.get).mockResolvedValue(response());
    renderView();

    fireEvent.click(await screen.findByLabelText('Next month'));
    expect(await screen.findByText('April 2026')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Today'));
    expect(await screen.findByText('March 2026')).toBeInTheDocument();
  });

  it('switches to a week grid of seven days', async () => {
    vi.mocked(api.get).mockResolvedValue(response());
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: 'Week' }));
    const grid = await screen.findByTestId('calendar-grid');
    // Six weeks of cells become one. The heading changes shape with it.
    await waitFor(() => expect(within(grid).getAllByText(/^\d+$/).length).toBeLessThanOrEqual(7));
  });
});
