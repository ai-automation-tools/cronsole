import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskCard } from '../TaskCard';
import type { Task } from '../../types';
import { vi, describe, it, expect } from 'vitest';

// The card carries the collections control, which reads `GET /collections`.
vi.mock('../../api', () => ({
  api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

// The schedule zone defaults to the machine's, so a clock-time assertion would pass
// or fail by where the suite runs. Pin it to Pacific.
vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: 'America/Los_Angeles' });
  return { ...actual, useSettings: () => ({ settings: settings() }), getSettings: settings };
});

const mockTask: Task = {
  id: 'task-123',
  name: 'Test Schedule Task',
  externalId: 'test-external-id',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Backup',
  updatedAt: '2026-06-23T11:00:00Z',
  metadata: {}
};

// Render helper so every test gets all required props with sensible spies,
// overridable per test. Returns the spies for assertions.
const renderCard = (task: Task = mockTask, overrides: Partial<ComponentProps<typeof TaskCard>> = {}) => {
  const props = {
    task,
    onSelect: vi.fn(),
    onRun: vi.fn(),
    onCategoryUpdate: vi.fn(),
    onClone: vi.fn(),
    onToggleStatus: vi.fn(),
    ...overrides
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <TaskCard {...props} />
    </QueryClientProvider>
  );
  return props;
};

describe('TaskCard Component', () => {
  it('renders task details correctly', () => {
    renderCard();
    expect(screen.getByText('Test Schedule Task')).toBeInTheDocument();
    // The platform id rides on the title's tooltip; the detail modal shows it
    // under the title (and says so once a rename diverges from it).
    expect(screen.getByTitle(/test-external-id/)).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Run / })).toHaveTextContent('Run');
  });

  // --- run strip (added 2026-11-13) ---
  it('draws the last runs oldest → newest, and names them in words', () => {
    renderCard({
      ...mockTask,
      recentRuns: [
        { status: 'FAILURE', triggeredAt: '2026-11-13T03:00:00Z' },
        { status: 'SUCCESS', triggeredAt: '2026-11-13T02:00:00Z' },
        { status: 'SUCCESS', triggeredAt: '2026-11-13T01:00:00Z' }
      ]
    });
    const strip = screen.getByRole('img', { name: /^Last 3 recorded runs: 2 succeeded, 1 failed$/ });
    const bars = Array.from(strip.children).map(b => b.className);
    expect(bars).toHaveLength(7);
    // Four empty outlines — absence is never drawn as success — then the runs.
    expect(bars.slice(0, 4).every(c => c.includes('border'))).toBe(true);
    expect(bars[6]).toContain('bg-danger');
    expect(bars[5]).toContain('bg-success');
  });

  it('draws no strip at all for a task with no recorded run', () => {
    renderCard({ ...mockTask, recentRuns: [] });
    expect(screen.queryByRole('img', { name: /recorded run/ })).toBeNull();
  });

    // --- schedule preview (added 2026-08-11) ---
  //
  // The card is the surface most people read; it has to answer "when does this
  // run?" without a click. The zone is pinned to Pacific above, so a UTC cron is shown
  // shifted — the same reading the detail modal gives.

  it('shows the schedule in words on the card', () => {
    renderCard({ ...mockTask, schedule: '0 15 * * *' });
    // 15:00 UTC reads 8 AM in PDT and 7 AM in PST, so the expected hour follows the date.
    expect(screen.getByText(/^Daily at (8:00 AM PDT|7:00 AM PST)$/)).toBeInTheDocument();
  });

  it('shows the raw cron when the shape is one describeCron will not guess at', () => {
    // A range in the hour field. (`0 4 1 * *` used to be the example here; a
    // day-of-month schedule became describable when the picker made it a
    // one-click choice.)
    renderCard({ ...mockTask, schedule: '0 9-17 * * 1-5' });
    expect(screen.getByText('0 9-17 * * 1-5')).toBeInTheDocument();
  });

  it('says there is no cron schedule rather than rendering nothing', () => {
    renderCard();
    expect(screen.getByText('No cron schedule')).toBeInTheDocument();
  });

  // --- favorites (added 2026-08-11) ---

  it('stars a task without also opening it', () => {
    // Every card surface opens the detail modal on click, so a star that did not
    // stop propagation would toggle the favorite AND open the task.
    const onToggleFavorite = vi.fn();
    const { onSelect } = renderCard(mockTask, { onToggleFavorite });
    fireEvent.click(screen.getByTitle('Add to favorites'));
    expect(onToggleFavorite).toHaveBeenCalledWith(mockTask);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows an already-starred task as starred', () => {
    renderCard({ ...mockTask, isFavorite: true }, { onToggleFavorite: vi.fn() });
    const star = screen.getByTitle('Remove from favorites');
    expect(star).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a red indicator when the last run failed', () => {
    renderCard({ ...mockTask, lastRunStatus: 'FAILURE', lastRunAt: '2026-07-07T16:00:00Z' });
    expect(screen.getByText('Run failed')).toBeInTheDocument();
  });

  it('shows no failure indicator when the last run succeeded', () => {
    renderCard({ ...mockTask, lastRunStatus: 'SUCCESS' });
    expect(screen.queryByText('Run failed')).not.toBeInTheDocument();
  });

  it('triggers onSelect when the card is clicked', () => {
    const { onSelect } = renderCard();
    fireEvent.click(screen.getByText('Test Schedule Task'));
    expect(onSelect).toHaveBeenCalledWith(mockTask);
  });

  it('triggers onRun when the run (play) button is clicked', () => {
    const { onRun, onSelect } = renderCard();
    const playButton = screen.getByTitle('Run Task');
    expect(playButton).toBeInTheDocument();
    fireEvent.click(playButton);
    expect(onRun).toHaveBeenCalledWith(mockTask);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('triggers onClone when the clone button is clicked', () => {
    const { onClone, onSelect } = renderCard();
    const cloneButton = screen.getByTitle('Clone Task');
    expect(cloneButton).toBeInTheDocument();
    fireEvent.click(cloneButton);
    expect(onClone).toHaveBeenCalledWith(mockTask);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('allows category editing and triggers onCategoryUpdate on Enter key', () => {
    const { onCategoryUpdate } = renderCard();
    fireEvent.click(screen.getByText('Backup'));

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Backup');

    fireEvent.change(input, { target: { value: 'NewCategory' } });
    expect(input).toHaveValue('NewCategory');
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onCategoryUpdate).toHaveBeenCalledWith('task-123', 'NewCategory');
  });

  it('cancels category editing on Escape key', () => {
    const { onCategoryUpdate } = renderCard();
    fireEvent.click(screen.getByText('Backup'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'NewCategory' } });
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(onCategoryUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Backup')).toBeInTheDocument();
  });

  // --- enable/disable toggle + disabled-run gating (added 2026-07-16) ---

  it('shows a Disable toggle on an active task and calls onToggleStatus', () => {
    const { onToggleStatus, onSelect } = renderCard();
    const toggle = screen.getByTitle('Disable task');
    fireEvent.click(toggle);
    expect(onToggleStatus).toHaveBeenCalledWith(mockTask);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('shows an Enable toggle on a disabled task', () => {
    const disabled = { ...mockTask, status: 'DISABLED' };
    const { onToggleStatus } = renderCard(disabled);
    const toggle = screen.getByTitle('Enable task');
    fireEvent.click(toggle);
    expect(onToggleStatus).toHaveBeenCalledWith(disabled);
  });

  it('grays out and disables Run when the task is disabled', () => {
    const { onRun } = renderCard({ ...mockTask, status: 'DISABLED' });
    // The Run button now carries the explanatory title instead of "Run Task".
    expect(screen.queryByTitle('Run Task')).not.toBeInTheDocument();
    const runButton = screen.getByTitle('This task is disabled — enable it first to run it');
    expect(runButton).toBeDisabled();
    fireEvent.click(runButton);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('hides the toggle for a MISSING task (nothing to enable/disable)', () => {
    renderCard({ ...mockTask, status: 'MISSING' });
    expect(screen.queryByTitle('Enable task')).not.toBeInTheDocument();
    expect(screen.queryByTitle('Disable task')).not.toBeInTheDocument();
    // Run is disabled with a MISSING-specific reason.
    expect(screen.getByTitle("This task isn't on the platform — nothing to run")).toBeDisabled();
  });
});
