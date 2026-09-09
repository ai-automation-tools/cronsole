import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ImportFileModal } from '../ImportFileModal';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn() }
}));

const BUNDLE = JSON.stringify({
  cronsoleTaskVersion: '1.0',
  task: { name: 'Nightly digest', platform: 'TASKHUB_NATIVE', schedule: '0 4 * * *', job: {} }
});

/**
 * Import takes a file, and only a file.
 *
 * The tests that matter are the routing ones: a Cronsole task is rebuilt here,
 * a Windows backup is handed to Restore, and neither one is ever mistaken for
 * the other — a `.xml` reaching `JSON.parse` produces "not valid JSON", which is
 * true about the bytes and useless about the situation.
 */
describe('ImportFileModal', () => {
  let queryClient: QueryClient;

  const renderModal = () => {
    const onClose = vi.fn();
    const onWindowsBackup = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ImportFileModal onClose={onClose} onWindowsBackup={onWindowsBackup} />
      </QueryClientProvider>
    );
    return { onClose, onWindowsBackup };
  };

  const pickFile = (file: File) => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  };

  const jsonFile = (contents: string, name = 'task.json') =>
    new File([contents], name, { type: 'application/json' });

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
  });

  it('leads with the consequence: this creates a task', () => {
    // The distinction that used to live in a chooser now lives on the controls.
    // Adopting a machine's tasks creates nothing; this does, and says so.
    renderModal();
    expect(screen.getByText(/This creates a task/)).toBeInTheDocument();
  });

  it('names both halves of what it accepts before anything is picked', () => {
    renderModal();
    expect(screen.getByText(/A Cronsole task .json/)).toBeInTheDocument();
    expect(screen.getByText(/A Windows backup .xml or .zip/)).toBeInTheDocument();
  });

  it('imports a task file and keeps the first-run time on screen', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { task: { id: 'n1', name: 'Nightly digest', nextRunTime: '2026-08-18T04:00:00.000Z' } }
    } as never);
    renderModal();
    pickFile(jsonFile(BUNDLE));

    // The body IS the file — the route sees exactly what was downloaded.
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tasks/import', JSON.parse(BUNDLE)));
    // Shown, not toasted: the first run is the fact worth reading, and it is
    // what a message that fades takes with it.
    expect(await screen.findByText(/Imported/)).toBeInTheDocument();
    expect(screen.getByText(/will first run/)).toBeInTheDocument();
  });

  it('hands a Windows .xml to Restore instead of importing it', async () => {
    const { onWindowsBackup } = renderModal();
    const xml = new File([new Uint8Array([0xff, 0xfe, 0x3c, 0x00])], 'Nightly.xml', { type: 'text/xml' });
    pickFile(xml);

    await waitFor(() => expect(onWindowsBackup).toHaveBeenCalledWith(xml));
    // The load-bearing half: a Windows definition must never reach the import
    // route, which cannot create one and would refuse with a sentence about
    // JSON.
    expect(api.post).not.toHaveBeenCalled();
  });

  it('hands a backup .zip over the same way', async () => {
    const { onWindowsBackup } = renderModal();
    const zip = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], 'backup.zip', { type: 'application/zip' });
    pickFile(zip);

    await waitFor(() => expect(onWindowsBackup).toHaveBeenCalledWith(zip));
    expect(api.post).not.toHaveBeenCalled();
  });

  it('recognises a Windows backup whose extension was lost', async () => {
    // Renamed on the way through an email or a download folder. The bytes still
    // say UTF-16 XML, and "not valid JSON" would be the wrong answer.
    const { onWindowsBackup } = renderModal();
    const renamed = new File([new Uint8Array([0xff, 0xfe, 0x3c, 0x00])], 'Nightly', { type: '' });
    pickFile(renamed);

    await waitFor(() => expect(onWindowsBackup).toHaveBeenCalledWith(renamed));
  });

  it('keeps a refusal on screen, since it names what to do next', async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { data: { error: 'That bundle is from a Windows Task Scheduler task... use Tools → Restore' } }
    } as never);
    renderModal();
    pickFile(jsonFile(BUNDLE));

    expect(await screen.findByText(/Tools → Restore/)).toBeInTheDocument();
  });

  it('blames the file, not the import, when the JSON will not parse', async () => {
    renderModal();
    pickFile(jsonFile('{ not json'));

    expect(await screen.findByText(/not valid JSON/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
