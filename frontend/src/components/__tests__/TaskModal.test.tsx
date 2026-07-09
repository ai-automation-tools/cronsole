import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskModal } from '../TaskModal';
import type { Task } from '../../types';
import { vi, describe, it, expect } from 'vitest';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

// TaskModal calls useToast; provide a no-op so tests don't need a ToastProvider.
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() })
}));

const mockTask: Task = {
  id: 'task-123',
  name: 'Test Modal Task',
  externalId: 'test-external-id',
  platform: 'CLAUDE_TASK_FLEET',
  status: 'ACTIVE',
  category: 'Automation',
  updatedAt: '2026-06-23T11:00:00Z',
  metadata: { cron: '0 0 * * *', command: 'node test.js' }
};

const renderModal = (props: Partial<React.ComponentProps<typeof TaskModal>> = {}) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TaskModal
        task={mockTask}
        onClose={vi.fn()}
        onRun={vi.fn()}
        onCategoryUpdate={vi.fn()}
        {...props}
      />
    </QueryClientProvider>
  );
};

describe('TaskModal Component', () => {
  it('renders nothing when task is null', () => {
    const { container } = renderModal({ task: null });
    expect(container.firstChild).toBeNull();
  });

  it('renders task metadata and details when task is provided', () => {
    renderModal();

    expect(screen.getByText('Test Modal Task')).toBeInTheDocument();
    expect(screen.getByText('test-external-id')).toBeInTheDocument();
    expect(screen.getByText('CLAUDE_TASK_FLEET')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();

    // Check that metadata is formatted and displayed
    expect(screen.getByText(/"cron": "0 0 \* \* \*"/)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = renderModal({ onClose });

    const closeBtn = container.querySelector('header button');
    expect(closeBtn).toBeInTheDocument();
    if (closeBtn) {
      fireEvent.click(closeBtn);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('triggers onRun and onClose when Run Now is clicked', () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    renderModal({ onRun, onClose });

    const runBtn = screen.getByText('Run Now');
    fireEvent.click(runBtn);

    expect(onRun).toHaveBeenCalledWith(mockTask);
    expect(onClose).toHaveBeenCalled();
  });

  it('allows changing category and clicking Save to update', () => {
    const onCategoryUpdate = vi.fn();
    renderModal({ onCategoryUpdate });

    // Click "Change" button
    const changeBtn = screen.getByText('Change');
    fireEvent.click(changeBtn);

    // Get the input textbox
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Automation');

    // Change input value
    fireEvent.change(input, { target: { value: 'NewCategoryVal' } });

    // Click "Save"
    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    expect(onCategoryUpdate).toHaveBeenCalledWith('task-123', 'NewCategoryVal');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('allows canceling category edit', () => {
    const onCategoryUpdate = vi.fn();
    renderModal({ onCategoryUpdate });

    // Click "Change"
    fireEvent.click(screen.getByText('Change'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'NewCategoryVal' } });

    // Click "Cancel"
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    expect(onCategoryUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
  });

  it('loads and shows execution history on the Run History tab', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [
        {
          id: 'run-1',
          taskId: 'task-123',
          triggeredAt: '2026-07-07T16:19:06Z',
          status: 'SUCCESS',
          log: '[scheduled] GET http://localhost:3000/api/health → 200'
        },
        {
          id: 'run-2',
          taskId: 'task-123',
          triggeredAt: '2026-07-07T16:18:46Z',
          status: 'FAILURE',
          log: 'GET https://example.com failed: ECONNREFUSED'
        }
      ]
    });

    renderModal();

    fireEvent.click(screen.getByText('Run History'));

    await waitFor(() => {
      expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    });
    expect(api.get).toHaveBeenCalledWith('/tasks/task-123/executions');
    expect(screen.getByText('FAILURE')).toBeInTheDocument();
    expect(screen.getByText(/ECONNREFUSED/)).toBeInTheDocument();
  });

  it('shows an empty state when a task has no runs', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });

    renderModal();
    fireEvent.click(screen.getByText('Run History'));

    await waitFor(() => {
      expect(screen.getByText('No recorded runs yet')).toBeInTheDocument();
    });
  });

  it('hides the Delete button for platform-synced tasks', () => {
    renderModal();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('deletes a TaskHub-native task after confirmation', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { message: 'Task deleted' } });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onClose = vi.fn();

    renderModal({
      task: { ...mockTask, platform: 'TASKHUB_NATIVE' },
      onClose
    });

    fireEvent.click(screen.getByText('Delete'));

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/tasks/task-123');
    });
    expect(onClose).toHaveBeenCalled();
  });
});
