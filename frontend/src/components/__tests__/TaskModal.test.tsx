import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskModal } from '../TaskModal';
import type { Task } from '../../types';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn()
  }
}));

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockResolvedValue(true);
});

// TaskModal calls useToast; provide a no-op so tests don't need a ToastProvider.
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() })
}));

// TaskModal calls useConfirm; provide a shared stub so tests don't need a
// ConfirmProvider and can assert the confirmation options passed to it.
const { confirmMock } = vi.hoisted(() => ({ confirmMock: vi.fn() }));
vi.mock('../../hooks/useConfirm', () => ({
  useConfirm: () => confirmMock
}));

/**
 * The schedule timezone defaults to Pacific, so cron fields and clock readings
 * would otherwise shift with the date the suite runs (PST vs PDT). Pin it to
 * UTC; the zone conversion has its own tests in utils/__tests__/timezone.test.ts
 * and the authoring path is covered in ApplyTemplateModal.test.tsx.
 */
const { zone } = vi.hoisted(() => ({ zone: { mode: 'utc' } }));
vi.mock('../../hooks/useSettings', async importOriginal => {
  const actual = await importOriginal<typeof import('../../hooks/useSettings')>();
  const settings = () => ({ ...actual.DEFAULT_SETTINGS, timezone: zone.mode });
  return {
    ...actual,
    getSettings: settings,
    useSettings: () => ({
      settings: settings(),
      update: vi.fn(),
      replaceAll: vi.fn(),
      reset: vi.fn()
    })
  };
});

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
    renderModal({ onClose });

    // By accessible name, not `header button` — that positional selector broke
    // the moment a rename pencil was added ahead of Close in the same header,
    // and silently pointed the assertion at a different control.
    fireEvent.click(screen.getByRole('button', { name: 'Close task details' }));
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

  it('hides the Delete button for platforms without native delete support', () => {
    // CLAUDE_TASK_FLEET has no connector deleteTask — the button must not render.
    renderModal();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
  });

  it('deletes a Windows task after a scheduler-specific confirmation', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { message: 'Task deleted' } });
    const onClose = vi.fn();

    renderModal({
      task: { ...mockTask, platform: 'WINDOWS_TASK_SCHEDULER' },
      onClose
    });

    fireEvent.click(screen.getByText('Delete from Windows'));

    // The confirm copy must say the real scheduler entry goes too, and be flagged
    // as a destructive action.
    expect(confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tone: 'danger',
        message: expect.stringContaining('Windows Task Scheduler')
      })
    );
    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/tasks/task-123');
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not delete when the confirmation is cancelled', async () => {
    confirmMock.mockResolvedValue(false);
    renderModal({ task: { ...mockTask, platform: 'WINDOWS_TASK_SCHEDULER' } });

    fireEvent.click(screen.getByText('Delete from Windows'));

    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(api.delete).not.toHaveBeenCalled();
  });

  describe('untrack vs delete — two removals that must never be confusable', () => {
    it('untracks without ever calling delete, and says what survives', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { message: 'Removed from Cronsole' } });
      const onClose = vi.fn();

      renderModal({ task: { ...mockTask, platform: 'WINDOWS_TASK_SCHEDULER' }, onClose });
      fireEvent.click(screen.getByText('Remove from Cronsole'));

      // The confirm must name what SURVIVES. "Are you sure?" on the reversible
      // action is what trains people to click through the irreversible one.
      expect(confirmMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Remove from Cronsole?',
          confirmText: 'Remove from Cronsole',
          message: expect.stringContaining('NOT deleted')
        })
      );
      // And it must NOT be styled or flagged as destructive.
      expect(confirmMock.mock.calls[0][0].tone).not.toBe('danger');

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/tasks/task-123/untrack');
      });
      // The load-bearing assertion of this whole feature.
      expect(api.delete).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('does not untrack when the confirmation is cancelled', async () => {
      confirmMock.mockResolvedValue(false);
      renderModal({ task: { ...mockTask, platform: 'WINDOWS_TASK_SCHEDULER' } });

      fireEvent.click(screen.getByText('Remove from Cronsole'));

      await waitFor(() => expect(confirmMock).toHaveBeenCalled());
      expect(api.post).not.toHaveBeenCalled();
    });

    it('offers both verbs on a Windows task, with different labels', () => {
      renderModal({ task: { ...mockTask, platform: 'WINDOWS_TASK_SCHEDULER' } });

      expect(screen.getByText('Remove from Cronsole')).toBeInTheDocument();
      expect(screen.getByText('Delete from Windows')).toBeInTheDocument();
      // A bare "Delete" would be the ambiguous label this design rejects.
      expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    });

    it('does not offer untrack for a Cronsole-native task', () => {
      // A native task exists nowhere else, so "remove but keep it" cannot be
      // true — offering it would be a destructive action under a safe label.
      renderModal({ task: { ...mockTask, platform: 'TASKHUB_NATIVE' } });

      expect(screen.queryByText('Remove from Cronsole')).not.toBeInTheDocument();
      expect(screen.getByText('Delete')).toBeInTheDocument();
    });
  });

  it('deletes a Cronsole-native task after confirmation', async () => {
    vi.mocked(api.delete).mockResolvedValue({ data: { message: 'Task deleted' } });
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

  it('edits a Cronsole-native task schedule via PATCH /tasks/:id/schedule', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { score: 1, warnings: [] } });
    vi.mocked(api.patch).mockResolvedValue({ data: { ...mockTask, schedule: '0 8 * * *' } });

    renderModal({
      task: {
        ...mockTask,
        platform: 'TASKHUB_NATIVE',
        schedule: '0 3 * * *',
        metadata: {
          job: { jobType: 'HTTP', url: 'https://example.com/health', method: 'GET' }
        }
      }
    });

    fireEvent.click(screen.getByRole('button', { name: /Edit Schedule/i }));
    expect(screen.getByText('Cronsole-native')).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue('0 3 * * *'), {
      target: { value: '0 8 * * *' }
    });
    fireEvent.click(screen.getByRole('button', { name: /Update Schedule/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-123/schedule', { schedule: '0 8 * * *' });
    });
  });

  it('edits a Windows task command & settings via PATCH /tasks/:id/actions', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...mockTask } });
    renderModal({
      task: {
        ...mockTask,
        platform: 'WINDOWS_TASK_SCHEDULER',
        metadata: {
          actions: [{ type: 'Exec', path: 'powershell.exe', arguments: '-File C:\\x.ps1', workingDirectory: 'C:\\scripts' }],
          description: 'Old desc',
          runLevel: 'LUA'
        }
      }
    });

    // The Action section's Edit button opens the editor (prefilled).
    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    const commandInput = screen.getByDisplayValue('powershell.exe -File C:\\x.ps1');
    fireEvent.change(commandInput, { target: { value: 'powershell.exe -File C:\\y.ps1' } });

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-123/actions', {
        command: 'powershell.exe -File C:\\y.ps1',
        workingDirectory: 'C:\\scripts',
        description: 'Old desc',
        runLevel: 'least'
      });
    });
  });

  it('quotes a spaced executable path in the prefilled command so it round-trips', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...mockTask } });
    renderModal({
      task: {
        ...mockTask,
        platform: 'WINDOWS_TASK_SCHEDULER',
        metadata: {
          actions: [{ type: 'Exec', path: 'C:\\Program Files\\App\\app.exe', arguments: '--run', workingDirectory: '' }],
          description: '',
          runLevel: 'LUA'
        }
      }
    });

    fireEvent.click(screen.getByRole('button', { name: /^Edit$/ }));
    // The executable path with a space is quoted so the backend tokenizes it back
    // to a single executable instead of splitting on "C:\Program".
    screen.getByDisplayValue('"C:\\Program Files\\App\\app.exe" --run');
    // Change only the description; the (unchanged) command must still be the quoted form.
    // (Working dir + description share the "(optional)" placeholder — description is second.)
    const optionalInputs = screen.getAllByPlaceholderText('(optional)');
    fireEvent.change(optionalInputs[1], { target: { value: 'now with a description' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-123/actions', {
        command: '"C:\\Program Files\\App\\app.exe" --run',
        workingDirectory: '',
        description: 'now with a description',
        runLevel: 'least'
      });
    });
  });

  it('disables the Action Edit button when no command is reported yet', () => {
    renderModal({
      task: { ...mockTask, platform: 'WINDOWS_TASK_SCHEDULER', metadata: {} }
    });
    const editBtn = screen.getByRole('button', { name: /^Edit$/ });
    expect(editBtn).toBeDisabled();
  });

  it('triggers patch request when Enable/Disable is clicked', async () => {
    vi.mocked(api.patch).mockResolvedValue({ data: { ...mockTask, status: 'DISABLED' } });
    renderModal();

    const toggleBtn = screen.getByRole('button', { name: /Disable/i });
    expect(toggleBtn).toBeInTheDocument();

    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/tasks/task-123/status', { status: 'DISABLED' });
    });
  });
});
