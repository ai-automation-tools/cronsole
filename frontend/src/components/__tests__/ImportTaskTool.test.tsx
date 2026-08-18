import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ImportTaskTool } from '../tools/ImportTaskTool';
import { openToolCard } from './helpers/toolCard';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn() }
}));

const toast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast })
}));

const archive = (over: Record<string, unknown> = {}) => ({
  id: 'arc_1',
  name: 'Nightly digest',
  platform: 'TASKHUB_NATIVE',
  deletedVia: 'ui',
  deletedAt: new Date(Date.now() - 3_600_000).toISOString(),
  executionsArchived: 12,
  restorable: { ok: true },
  ...over
});

const pickFile = (contents: string, name = 'task.json') => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([contents], name, { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  fireEvent.change(input);
};

const renderTool = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={client}>
      <ImportTaskTool />
    </QueryClientProvider>
  );
  openToolCard('import-task');
  return result;
};

const BUNDLE = JSON.stringify({
  cronsoleTaskVersion: '1.0',
  task: { name: 'Nightly digest', platform: 'TASKHUB_NATIVE', schedule: '0 4 * * *', job: {} }
});

describe('ImportTaskTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: { total: 0, archives: [] } });
  });

  it('posts the file contents verbatim, so the route sees exactly what was downloaded', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { task: { id: 'n1', name: 'Nightly digest', nextRunTime: null } }
    });
    renderTool();
    pickFile(BUNDLE);

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/tasks/import', JSON.parse(BUNDLE))
    );
  });

  it('says when the imported task will first run — it is created ACTIVE', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { task: { id: 'n1', name: 'Nightly digest', nextRunTime: '2026-08-18T04:00:00.000Z' } }
    });
    renderTool();
    pickFile(BUNDLE);

    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast.mock.calls[0][0]).toMatch(/first run/i);
    expect(toast.mock.calls[0][1]).toBe('success');
  });

  it('keeps a bad-JSON message about the FILE, not about the import', async () => {
    renderTool();
    pickFile('{ not json');

    expect(await screen.findByText(/not valid JSON/i)).toBeTruthy();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('shows the backend refusal on screen, since it names another screen', async () => {
    // A Windows bundle is refused with a pointer to Tools → Restore. That is too
    // long-lived and too actionable for a toast that fades.
    vi.mocked(api.post).mockRejectedValue({
      response: { data: { error: 'That bundle is from a Windows Task Scheduler task... use Tools → Restore' } }
    });
    renderTool();
    pickFile(BUNDLE);

    expect(await screen.findByText(/Tools → Restore/)).toBeTruthy();
  });

  it('offers Restore only where the archive is restorable, and shows why when it is not', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        total: 2,
        archives: [
          archive(),
          archive({
            id: 'arc_2',
            name: 'Backup drive',
            platform: 'WINDOWS_TASK_SCHEDULER',
            restorable: { ok: false, reason: 'Its definition lives on the machine as Task Scheduler XML.' }
          })
        ]
      }
    });
    renderTool();

    // One row is restorable, one is not — so exactly one button, and the other
    // row carries the reason rather than a disabled control with a tooltip.
    expect(await screen.findByText('Backup drive')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /restore/i })).toHaveLength(1);
    expect(screen.getByText(/definition lives on the machine/)).toBeTruthy();
  });

  it('calls the restore route and says the result is a NEW task', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { total: 1, archives: [archive()] } });
    vi.mocked(api.post).mockResolvedValue({ data: { task: { name: 'Nightly digest' } } });
    renderTool();

    fireEvent.click(await screen.findByRole('button', { name: /restore/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/tools/task-archives/arc_1/restore')
    );
    // The archived runs do not come back and the id changes; a bare "restored"
    // would let someone go looking for a history that is not there.
    expect(toast.mock.calls[0][0]).toMatch(/as a new task/i);
  });

  it('explains an empty archive list instead of implying nothing was ever deleted', async () => {
    renderTool();
    expect(
      await screen.findByText(/Deletions on other platforms are not recoverable/i)
    ).toBeTruthy();
  });
});
