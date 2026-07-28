import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BulkExportTool } from '../tools/BulkExportTool';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn() }
}));

const toast = vi.fn();
vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ toast })
}));

// The real machine this was built against: 95 user tasks across 13 folders vs
// 257 under \Microsoft\. The proportions are the point — a default that includes
// system tasks buries the ones the user came for.
const FOLDERS = {
  folders: [
    { path: '\\', taskCount: 38, writable: true },
    { path: '\\Work', taskCount: 5, writable: true },
    { path: '\\Work\\Backups', taskCount: 2, writable: true },
    { path: '\\Microsoft', taskCount: 0, writable: false },
    { path: '\\Microsoft\\Windows', taskCount: 257, writable: false }
  ],
  defaultFolder: '\\TaskHub'
};

const renderTool = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <BulkExportTool />
    </QueryClientProvider>
  );
};

describe('BulkExportTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({ data: FOLDERS } as never);
    delete (window as unknown as { showDirectoryPicker?: () => void }).showDirectoryPicker;
  });

  it('says it exports the machine, not just what TaskHub imported', async () => {
    renderTool();
    // The whole reason the tool exists: un-imported tasks are the ones nothing
    // else is holding. If the copy stops saying so, the invisible fence is back.
    expect(await screen.findByText(/including tasks you never imported/i)).toBeInTheDocument();
  });

  it('counts only non-system tasks by default', async () => {
    renderTool();
    // 38 + 5 + 2 = 45, excluding the 257 under \Microsoft\.
    await waitFor(() => expect(screen.getByText('45')).toBeInTheDocument());
  });

  it('includes system tasks in the count once opted in', async () => {
    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('checkbox', { name: /include windows/i }));
    await waitFor(() => expect(screen.getByText('302')).toBeInTheDocument());
  });

  it('names how many system tasks are being held back', async () => {
    renderTool();
    expect(await screen.findByText(/257 tasks under/i)).toBeInTheDocument();
  });

  it('warns that exported XML carries command lines and secrets', async () => {
    renderTool();
    expect(await screen.findByText(/pass secrets on the command line/i)).toBeInTheDocument();
  });

  it('offers the ZIP fallback when the browser has no directory picker', async () => {
    renderTool();
    expect(await screen.findByText(/downloads as a \.zip/i)).toBeInTheDocument();
  });

  it('offers a destination folder when the browser can write one', async () => {
    (window as unknown as { showDirectoryPicker: () => void }).showDirectoryPicker = () => {};
    renderTool();
    expect(await screen.findByText(/choose a destination folder/i)).toBeInTheDocument();
  });

  it('requires a folder before it will export one', async () => {
    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('radio', { name: /one folder/i }));
    expect(screen.getByRole('button', { name: /export tasks/i })).toBeDisabled();
  });

  it('scopes the count to the chosen folder, subfolders included', async () => {
    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('radio', { name: /one folder/i }));
    fireEvent.change(screen.getByLabelText(/folder to export/i), { target: { value: '\\Work' } });
    // \Work (5) + \Work\Backups (2)
    await waitFor(() => expect(screen.getByText('7')).toBeInTheDocument());
  });

  it('drops subfolders from the count when unticked', async () => {
    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('radio', { name: /one folder/i }));
    fireEvent.change(screen.getByLabelText(/folder to export/i), { target: { value: '\\Work' } });
    await screen.findByText('7');
    fireEvent.click(screen.getByRole('checkbox', { name: /include subfolders/i }));
    await waitFor(() => expect(screen.getByText('5')).toBeInTheDocument());
  });

  it('hides system folders from the picker unless opted in', async () => {
    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('radio', { name: /one folder/i }));
    const select = screen.getByLabelText(/folder to export/i);
    expect(select.querySelector('option[value="\\\\Microsoft\\\\Windows"]')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: /include windows/i }));
    await waitFor(() =>
      expect(select.querySelector('option[value="\\\\Microsoft\\\\Windows"]')).not.toBeNull()
    );
  });

  it('requests the zip format and reports the counts from the header', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: new Blob(['zip']),
      headers: {
        'content-disposition': 'attachment; filename="taskhub-tasks.zip"',
        'x-taskhub-export-counts': JSON.stringify({
          enumerated: 352, selected: 45, exported: 45, failed: 0, skippedSystem: 257
        })
      }
    } as never);
    // jsdom has no real object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('button', { name: /export tasks/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/tools/export/tasks',
        expect.objectContaining({ scope: 'all', format: 'zip', includeSystem: false }),
        expect.objectContaining({ responseType: 'blob' })
      )
    );
    expect(await screen.findByText(/Exported 45 of 45 tasks/i)).toBeInTheDocument();
    expect(screen.getByText(/257 Windows system tasks skipped/i)).toBeInTheDocument();
  });

  it('surfaces partial failures instead of reporting a clean backup', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: new Blob(['zip']),
      headers: {
        'content-disposition': 'attachment; filename="t.zip"',
        'x-taskhub-export-counts': JSON.stringify({
          enumerated: 352, selected: 45, exported: 44, failed: 1, skippedSystem: 257
        })
      }
    } as never);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    renderTool();
    await screen.findByText('45');
    fireEvent.click(screen.getByRole('button', { name: /export tasks/i }));

    expect(await screen.findByText(/1 task could not be exported/i)).toBeInTheDocument();
  });

  it('says the agent may be offline when folders cannot be read', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Agent offline'));
    renderTool();
    expect(await screen.findByText(/Windows agent may be offline/i)).toBeInTheDocument();
  });
});
