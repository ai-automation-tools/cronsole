import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ApplyTemplateModal } from '../ApplyTemplateModal';
import { api } from '../../api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Template } from '../../types';

vi.mock('../../api', () => ({
  api: {
    post: vi.fn(),
    get: vi.fn()
  }
}));

// ApplyTemplateModal calls useToast; expose a shared spy so tests can assert on it.
const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast: toastMock })
}));

/**
 * The schedule timezone defaults to Pacific, which would make every cron
 * assertion in this file depend on the date the suite runs (PST vs PDT). Pin it
 * instead: most tests aren't about the zone and run in UTC, and the ones that
 * are set `zone.mode` explicitly alongside a fixed system time.
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

const mockTemplate: Template = {
  id: 'template-cron-backup',
  name: 'Daily Cron Backup',
  description: 'Creates a daily backup of a target directory.',
  commandTemplate: 'backup-tool --src {{srcDir}} --dest {{destDir}} --options {{options}}',
  scheduleExpression: '0 0 * * *',
  targetPlatforms: ['WINDOWS_TASK_SCHEDULER', 'CLAUDE_CODE'],
  sourcePlatform: 'WINDOWS_TASK_SCHEDULER',
  command: 'backup-tool',
  parameters: [
    { key: 'srcDir', label: 'Source Directory', type: 'path', required: true, default: 'C:\\data' },
    { key: 'destDir', label: 'Destination Directory', type: 'path', required: true },
    { key: 'options', label: 'Backup Options', type: 'select', required: false, default: '--fast', options: ['--fast', '--full'] }
  ]
};

describe('ApplyTemplateModal Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    vi.clearAllMocks();
    zone.mode = 'utc';
    // The Windows folder selector reads the machine's real Task Scheduler
    // folders. \Microsoft\Windows comes back writable: false — the backend
    // reports unwritable folders honestly rather than hiding them, and the
    // modal is what filters them out of the picker.
    vi.mocked(api.get).mockResolvedValue({
      data: {
        defaultFolder: '\\Cronsole',
        folders: [
          { path: '\\', taskCount: 3, writable: true },
          { path: '\\Cronsole', taskCount: 1, writable: true },
          { path: '\\Work', taskCount: 2, writable: true },
          { path: '\\Microsoft\\Windows', taskCount: 214, writable: false }
        ]
      }
    });
  });

  it('renders template information, input fields, and pre-populates defaults', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    expect(screen.getByText('Daily Cron Backup')).toBeInTheDocument();
    expect(screen.getByText('Creates a daily backup of a target directory.')).toBeInTheDocument();

    // Both targets show, but only the creatable one (Windows) is selectable;
    // Claude is a compatibility label and its button is disabled.
    expect(screen.getByRole('button', { name: /Windows/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Claude/ })).toBeDisabled();

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

    // Windows (the creatable target) is selected by default; Claude is disabled,
    // so apply goes to Windows — never the uncreatable platform.
    const createBtn = screen.getByRole('button', { name: /Create Task/ });
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);

    await waitFor(() => {
      // Raw parameter values go to the server; the backend owns substitution.
      expect(api.post).toHaveBeenCalledWith('/templates/template-cron-backup/apply', {
        platform: 'WINDOWS_TASK_SCHEDULER',
        schedule: '0 0 * * *',
        name: 'Daily Cron Backup',
        parameters: {
          srcDir: 'C:\\data',
          destDir: 'D:\\backup',
          options: '--fast'
        },
        // Windows tasks carry their destination folder; untouched, it is the
        // default — so existing behavior is unchanged unless you pick one.
        folder: '\\Cronsole'
      });
    });

    expect(toastMock).toHaveBeenCalledWith('Task created on Windows from "Daily Cron Backup".', 'success');
    expect(onClose).toHaveBeenCalled();
  });

  it('applies into a chosen Task Scheduler folder, and never offers \\Microsoft\\', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } });

    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    const destInput = screen.getAllByPlaceholderText('C:\\path\\to\\file')[1];
    fireEvent.change(destInput, { target: { value: 'D:\\backup' } });

    // Target the folder select by its accessible name — the template's own
    // `options` parameter is also a combobox, and the folder one only appears
    // once the query resolves, so an unqualified findByRole grabs the wrong node.
    const select = await screen.findByRole('combobox', { name: 'Task Scheduler folder' });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /\\Work/ })).toBeInTheDocument();
    });

    // \Microsoft\Windows came back writable:false — it must never be selectable.
    // Windows keeps its own tasks there and a collision silently overwrites one.
    expect(screen.queryByRole('option', { name: /Microsoft/ })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: '\\Work' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Task/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/templates/template-cron-backup/apply',
        expect.objectContaining({ folder: '\\Work' })
      );
    });
  });

  it('prefills the task name, sends an edited name, and blocks an empty one', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true } });

    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    // Prefilled with the template name.
    const nameInput = screen.getByDisplayValue('Daily Cron Backup');

    // Fill the one missing required param so name is the only gate left.
    const destInput = screen.getAllByPlaceholderText('C:\\path\\to\\file')[1];
    fireEvent.change(destInput, { target: { value: 'D:\\backup' } });

    // Empty name disables apply.
    fireEvent.change(nameInput, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: /Create Task/ })).toBeDisabled();

    // A custom name is what gets sent.
    fireEvent.change(nameInput, { target: { value: 'My Backup Copy 2' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Task/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/templates/template-cron-backup/apply',
        expect.objectContaining({ name: 'My Backup Copy 2' })
      );
    });
  });

  it('cron preset chips update the schedule field', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    expect(screen.getByDisplayValue('0 0 * * *')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hourly' }));
    expect(screen.getByDisplayValue('0 * * * *')).toBeInTheDocument();
  });

  /**
   * The reported defect: applying a template silently produced a task on UTC
   * clock time. `0 0 * * *` is midnight UTC, which is 4 PM the previous day in
   * Pacific — the field must show the Pacific reading and the request must still
   * carry UTC, because everything below the browser (the trigger converter, the
   * signed agent command, Task Scheduler) reads UTC.
   */
  describe('schedule timezone', () => {
    beforeEach(() => {
      zone.mode = 'America/Los_Angeles';
      // January so the offset is PST (−08:00) regardless of when this runs.
      // `shouldAdvanceTime` keeps the clock ticking so `waitFor` can still poll
      // — a frozen clock makes it hang for its full timeout and report the
      // assertion as the failure, which sends you debugging the wrong thing.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      vi.setSystemTime(new Date('2024-01-15T12:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('pre-fills the template schedule in the user’s zone, not UTC', () => {
      render(
        <QueryClientProvider client={queryClient}>
          <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
        </QueryClientProvider>
      );

      expect(screen.getByDisplayValue('0 16 * * *')).toBeInTheDocument();
      expect(screen.queryByDisplayValue('0 0 * * *')).not.toBeInTheDocument();
      // The field must name the zone it is read in, or the number is a guess.
      expect(screen.getByText(/Schedule \(cron · PST\)/)).toBeInTheDocument();
    });

    it('applies the UTC form of what was typed', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
      render(
        <QueryClientProvider client={queryClient}>
          <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
        </QueryClientProvider>
      );

      // 8 AM Pacific.
      fireEvent.change(screen.getByDisplayValue('0 16 * * *'), { target: { value: '0 8 * * *' } });
      // Two path params share a placeholder; srcDir has a default, destDir is
      // the required empty one.
      fireEvent.change(screen.getAllByPlaceholderText('C:\\path\\to\\file')[1], {
        target: { value: 'C:\\dest' }
      });
      fireEvent.click(screen.getByRole('button', { name: /Create Task/i }));

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith(
          `/templates/${mockTemplate.id}/apply`,
          expect.objectContaining({ schedule: '0 16 * * *' })
        );
      });
    });
  });
});
