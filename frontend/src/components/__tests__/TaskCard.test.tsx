import type { ComponentProps } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '../TaskCard';
import type { Task } from '../../types';
import { vi, describe, it, expect } from 'vitest';

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
  render(<TaskCard {...props} />);
  return props;
};

describe('TaskCard Component', () => {
  it('renders task details correctly', () => {
    renderCard();
    expect(screen.getByText('Test Schedule Task')).toBeInTheDocument();
    expect(screen.getByText('test-external-id')).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
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
