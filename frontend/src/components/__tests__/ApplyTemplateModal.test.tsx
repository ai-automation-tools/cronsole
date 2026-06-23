import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplyTemplateModal } from '../ApplyTemplateModal';
import { api } from '../../api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Template } from '../../types';

vi.mock('../../api', () => ({
  api: {
    post: vi.fn()
  }
}));

const mockTemplate: Template = {
  id: 'template-cron-backup',
  name: 'Daily Cron Backup',
  description: 'Creates a daily backup of a target directory.',
  commandTemplate: 'backup-tool --src {{srcDir}} --dest {{destDir}} --options {{options}}',
  scheduleExpression: '0 0 * * *',
  targetPlatforms: ['WINDOWS_TASK_SCHEDULER', 'CLAUDE_CODE'],
  sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
  command: 'backup-tool',
  upvotes: 5,
  parameters: [
    { key: 'srcDir', label: 'Source Directory', type: 'path', required: true, default: 'C:\\data' },
    { key: 'destDir', label: 'Destination Directory', type: 'path', required: true },
    { key: 'options', label: 'Backup Options', type: 'select', required: false, default: '--fast', options: ['--fast', '--full'] }
  ]
};

describe('ApplyTemplateModal Component', () => {
  let queryClient: QueryClient;
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('renders template information, input fields, and pre-populates defaults', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    expect(screen.getByText('Daily Cron Backup')).toBeInTheDocument();
    expect(screen.getByText('Creates a daily backup of a target directory.')).toBeInTheDocument();

    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();

    const srcInput = screen.getByDisplayValue('C:\\data');
    expect(srcInput).toBeInTheDocument();

    const destInput = screen.getAllByPlaceholderText('C:\\path\\to\\file')[1];
    expect(destInput).toBeInTheDocument();

    expect(screen.getByText(/backup-tool --src C:\\data --dest\s+--options --fast/)).toBeInTheDocument();
    expect(screen.getByText('Fill the required fields above before applying.')).toBeInTheDocument();
  });

  it('allows applying when required fields are filled', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } });
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={onClose} />
      </QueryClientProvider>
    );

    const destInput = screen.getAllByPlaceholderText('C:\\path\\to\\file')[1];
    fireEvent.change(destInput, { target: { value: 'D:\\backup' } });

    expect(screen.getByText(/backup-tool --src C:\\data --dest D:\\backup --options --fast/)).toBeInTheDocument();
    expect(screen.queryByText('Fill the required fields above before applying.')).not.toBeInTheDocument();

    const platformBtn = screen.getByText('Claude');
    fireEvent.click(platformBtn);

    const createBtn = screen.getByRole('button', { name: /Create Task/ });
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/templates/template-cron-backup/apply', {
        platform: 'CLAUDE_CODE',
        schedule: '0 0 * * *',
        name: 'Daily Cron Backup',
        command: 'backup-tool --src C:\\data --dest D:\\backup --options --fast'
      });
    });

    expect(alertSpy).toHaveBeenCalledWith('Task created on Claude from "Daily Cron Backup".');
    expect(onClose).toHaveBeenCalled();
  });

  it('can simulate application in DEMO mode without API call', async () => {
    import.meta.env.VITE_DEMO_MODE = 'true';
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={onClose} />
      </QueryClientProvider>
    );

    const destInput = screen.getAllByPlaceholderText('C:\\path\\to\\file')[1];
    fireEvent.change(destInput, { target: { value: 'D:\\backup' } });

    const createBtn = screen.getByRole('button', { name: /Create Task/ });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(api.post).not.toHaveBeenCalled();
    });

    expect(alertSpy).toHaveBeenCalledWith('Demo mode — "Daily Cron Backup" would be created on Windows.');
    expect(onClose).toHaveBeenCalled();

    import.meta.env.VITE_DEMO_MODE = undefined;
  });
});
