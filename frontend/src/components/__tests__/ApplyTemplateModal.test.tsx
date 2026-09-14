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
    claudeCreate = 'unsupported';
    // Two different GETs reach this modal, so the mock has to route by URL — a
    // single mockResolvedValue hands the folder payload to the capability
    // matrix, which then reads `platforms` off an object that has none.
    vi.mocked(api.get).mockImplementation((url: string) =>
      Promise.resolve(url === '/tools/platforms' ? { data: matrix() } : { data: folders() })
    );
  });

  // The Windows folder selector reads the machine's real Task Scheduler
  // folders. \Microsoft\Windows comes back writable: false — the backend
  // reports unwritable folders honestly rather than hiding them, and the
  // modal is what filters them out of the picker.
  const folders = () => ({
    defaultFolder: '\\Cronsole',
    folders: [
      { path: '\\', taskCount: 3, writable: true },
      { path: '\\Cronsole', taskCount: 1, writable: true },
      { path: '\\Work', taskCount: 2, writable: true },
      { path: '\\Microsoft\\Windows', taskCount: 214, writable: false }
    ]
  });

  /**
   * The server's capability matrix, which is where "can Cronsole create here?"
   * now comes from — the modal holds no list of creatable platforms.
   *
   * Claude's `create` is a **per-install** answer (`unsupported` without a
   * readable Claude Code session, reachable with one), so it is a variable here
   * rather than a fixture constant: a test that hardcoded either value would be
   * asserting one of the two worlds and calling it the behaviour.
   */
  let claudeCreate: 'verified' | 'declared' | 'unsupported' = 'unsupported';
  const cell = (verb: string, support: string) => ({
    verb, label: verb, description: '', support,
    lastSuccessAt: null, lastFailureAt: null, lastFailureReason: null
  });
  const matrix = () => ({
    platforms: [
      { platform: 'WINDOWS_TASK_SCHEDULER', label: 'Windows', capabilities: [cell('create', 'verified')] },
      { platform: 'CLAUDE_CODE', label: 'Claude', capabilities: [cell('create', claudeCreate)] }
    ]
  });

  it('renders template information, input fields, and pre-populates defaults', async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    expect(screen.getByText('Daily Cron Backup')).toBeInTheDocument();
    expect(screen.getByText('Creates a daily backup of a target directory.')).toBeInTheDocument();

    // Both targets show; once the capability matrix lands, only the creatable
    // one (Windows) is selectable and Claude is a compatibility label.
    // The assertion **waits**, because the answer comes from the server rather
    // than from a constant in the bundle — and before it arrives the modal
    // deliberately asserts nothing, leaving both clickable.
    expect(screen.getByRole('button', { name: /Windows/ })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: /Claude/ })).toBeDisabled());

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
    // Create stays disabled until the capability matrix has actually answered:
    // an optimistic *selection* is fine, an optimistic *submit* is a request the
    // platform may refuse.
    const createBtn = screen.getByRole('button', { name: /Create Task/ });
    await waitFor(() => expect(createBtn).not.toBeDisabled());
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

  it('creates a new folder only when asked, and names what it made', async () => {
    // `foldersCreated` comes back from the server. Cronsole creating a folder is
    // the exception to "Cronsole creates only \Cronsole" and nothing removes one
    // again, so the confirmation has to name it rather than imply it.
    vi.mocked(api.post).mockResolvedValue({
      data: { success: true, foldersCreated: ['\\Work', '\\Work\\Nightly'] }
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getAllByPlaceholderText('C:\\path\\to\\file')[1], {
      target: { value: 'D:\\backup' }
    });

    const select = await screen.findByRole('combobox', { name: 'Task Scheduler folder' });
    await waitFor(() => {
      expect(screen.getByRole('option', { name: /\\Work/ })).toBeInTheDocument();
    });

    // First, not last. A real machine has dozens of folders, and at the bottom
    // the one option that is not a folder is the one you have to scroll to find.
    expect(
      Array.from(select.querySelectorAll('option')).map(o => o.textContent)[0]
    ).toBe('New folder…');

    // No free-text box until the gesture is made: choosing "New folder…" IS the
    // opt-in, which is why there is no separate checkbox beside it.
    expect(screen.queryByRole('textbox', { name: 'New folder path' })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: '::new::' } });
    const pathInput = screen.getByRole('textbox', { name: 'New folder path' });

    // Empty is refused at the button rather than sent as a folder of ''.
    expect(screen.getByRole('button', { name: /Create Task/ })).toBeDisabled();

    fireEvent.change(pathInput, { target: { value: '\\Work\\Nightly' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Task/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/templates/template-cron-backup/apply',
        expect.objectContaining({ folder: '\\Work\\Nightly', createFolder: true })
      );
    });
    expect(toastMock).toHaveBeenCalledWith(
      expect.stringContaining('Created folders \\Work, \\Work\\Nightly.'),
      'success'
    );
  });

  it('does not send createFolder when an existing folder is picked', async () => {
    vi.mocked(api.post).mockResolvedValue({ data: { success: true, foldersCreated: [] } });

    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    fireEvent.change(screen.getAllByPlaceholderText('C:\\path\\to\\file')[1], {
      target: { value: 'D:\\backup' }
    });
    await screen.findByRole('combobox', { name: 'Task Scheduler folder' });
    fireEvent.click(screen.getByRole('button', { name: /Create Task/ }));

    await waitFor(() => expect(api.post).toHaveBeenCalled());
    // Byte-identical to an apply made before the field existed — the signed
    // opt-in is absent, so the agent refuses a missing folder as it always did.
    expect(vi.mocked(api.post).mock.calls.at(-1)![1]).not.toHaveProperty('createFolder');
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

    // A custom name is what gets sent — once the capability matrix has landed,
    // which is the other thing Create waits on.
    fireEvent.change(nameInput, { target: { value: 'My Backup Copy 2' } });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Create Task/ })).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: /Create Task/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/templates/template-cron-backup/apply',
        expect.objectContaining({ name: 'My Backup Copy 2' })
      );
    });
  });

  /**
   * **Creatability is a property of the install, not of the build.**
   *
   * The modal held a hardcoded `CREATABLE_PLATFORMS` set until 2026-08-13, which
   * could not be right in both of Claude's worlds at once: with a readable
   * Claude Code session on the backend's machine the connector creates routines,
   * without one `create` is a boundary. Same component, same template, opposite
   * answers — driven only by what the server reports.
   */
  describe('Claude, whose create verb depends on the install', () => {
    it('offers a Claude routine when the matrix says create is reachable', async () => {
      claudeCreate = 'declared';
      vi.mocked(api.post).mockResolvedValue({ data: { success: true } });

      render(
        <QueryClientProvider client={queryClient}>
          <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
        </QueryClientProvider>
      );

      const claudeBtn = await screen.findByRole('button', { name: /Claude/ });
      await waitFor(() => expect(claudeBtn).toBeEnabled());
      fireEvent.click(claudeBtn);

      // A routine's "command" is a prompt, and the repositories field appears
      // only here — a Windows task has no checkout to attach.
      expect(screen.getByText('Resolved prompt')).toBeInTheDocument();
      fireEvent.change(screen.getAllByPlaceholderText('C:\\path\\to\\file')[1], {
        target: { value: 'D:\\backup' }
      });
      fireEvent.change(screen.getByLabelText('Repositories'), {
        target: { value: ' https://github.com/owner/repo \n\n' }
      });

      const createBtn = screen.getByRole('button', { name: /Create Task/ });
      await waitFor(() => expect(createBtn).not.toBeDisabled());
      fireEvent.click(createBtn);

      await waitFor(() => {
        expect(api.post).toHaveBeenCalledWith('/templates/template-cron-backup/apply',
          expect.objectContaining({
            platform: 'CLAUDE_CODE',
            // Trimmed, blank lines dropped — a trailing newline is not a repo
            // the routine gets told to check out.
            repositoryUrls: ['https://github.com/owner/repo']
          }));
      });
      // No `folder`: that is a Windows concept, and the backend rejects it here.
      expect(vi.mocked(api.post).mock.calls.at(-1)![1]).not.toHaveProperty('folder');
    });

    it('says what is missing when no target can be created here', async () => {
      // Windows unreachable too — the whole template becomes copy-to-set-up.
      vi.mocked(api.get).mockImplementation((url: string) =>
        Promise.resolve(url === '/tools/platforms'
          ? { data: { platforms: [
              { platform: 'WINDOWS_TASK_SCHEDULER', label: 'Windows', capabilities: [cell('create', 'unsupported')] },
              { platform: 'CLAUDE_CODE', label: 'Claude', capabilities: [cell('create', 'unsupported')] }
            ] } }
          : { data: folders() })
      );

      render(
        <QueryClientProvider client={queryClient}>
          <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
        </QueryClientProvider>
      );

      // Names the actual fix (sign in / create at claude.ai), not a generic
      // "not supported" — the platform is capable, this install is not set up.
      expect(await screen.findByText(/needs a Claude Code session/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create Task/ })).toBeDisabled();
    });
  });

  it('cron preset chips update the schedule field', () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
      </QueryClientProvider>
    );

    // Read off the picker, which is the register the modal opens on. The chip
    // sets the schedule whichever one is showing.
    expect(screen.getByText('0 0 * * *')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hourly' }));
    expect(screen.getByText('0 * * * *')).toBeInTheDocument();
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

      expect(screen.getByText('0 16 * * *')).toBeInTheDocument();
      // The UTC form is printed beside the field as the "stored as" hint (§9
      // requires it) — what must never happen is it being the *value* of the
      // field, which is the defect this block exists for.
      expect(screen.queryByDisplayValue('0 0 * * *')).not.toBeInTheDocument();
      // The field must name the zone it is read in, or the number is a guess.
      expect(screen.getByText(/Schedule · PST/)).toBeInTheDocument();
    });

    it('applies the UTC form of what was typed', async () => {
      vi.mocked(api.post).mockResolvedValue({ data: { id: 'task-new' } });
      render(
        <QueryClientProvider client={queryClient}>
          <ApplyTemplateModal template={mockTemplate} onClose={vi.fn()} />
        </QueryClientProvider>
      );

      // 8 AM Pacific.
      fireEvent.click(screen.getByRole('button', { name: 'Cron' }));
      fireEvent.change(screen.getByDisplayValue('0 16 * * *'), { target: { value: '0 8 * * *' } });
      // Two path params share a placeholder; srcDir has a default, destDir is
      // the required empty one.
      fireEvent.change(screen.getAllByPlaceholderText('C:\\path\\to\\file')[1], {
        target: { value: 'C:\\dest' }
      });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Create Task/i })).not.toBeDisabled()
      );
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
