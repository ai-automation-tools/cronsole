import { render, renderHook, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportModal } from '../ImportModal';
import { api } from '../../api';
import { getSettings, useSettings, type Settings } from '../../hooks/useSettings';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

/**
 * Seed the settings store through its real API.
 *
 * `useSettings` keeps a MODULE-LEVEL `current`, read from localStorage once at
 * import time — so writing localStorage inside a test is invisible to it, and
 * `localStorage.clear()` doesn't roll it back between tests. Driving the actual
 * store is both correct and the thing the component really reads.
 */
function seedSettings(patch: Partial<Settings> = {}) {
  const { result } = renderHook(() => useSettings());
  act(() => result.current.replaceAll(patch));
}

vi.mock('../../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn()
  }
}));

const mockDiscovery = [
  {
    platform: 'WINDOWS_TASK_SCHEDULER',
    categories: [
      { name: 'Backup', count: 3, excludedCount: 2 },
      { name: 'Maintenance', count: 2 },
      { name: 'Microsoft', count: 10 }
    ]
  },
  {
    platform: 'CLAUDE_TASK_FLEET',
    categories: [
      { name: 'Automation', count: 5 },
      { name: 'Uncategorized', count: 1 }
    ]
  }
];

const preview = () => screen.getByTestId('import-preview').textContent ?? '';

describe('ImportModal Component', () => {
  let queryClient: QueryClient;

  /**
   * Render, then take the discovery branch of the chooser.
   *
   * The modal now opens on a two-way choice — adopt the machine's existing
   * tasks, or create one from a file — so every test below that is about
   * discovery has to say so first. Kept in the helper rather than repeated:
   * the click is setup for those tests, not their subject, and the chooser has
   * its own describe block that exercises it directly.
   *
   * It also means the discovery query does not fire until this click, which is
   * the component's deliberate behaviour (an agent round trip is not spent
   * while the user is still choosing).
   */
  const renderModal = (onImport = vi.fn(), onClose = vi.fn()) => {
    render(
      <QueryClientProvider client={queryClient}>
        <ImportModal onClose={onClose} onImport={onImport} />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Tasks already on this machine/ }));
    return { onImport, onClose };
  };

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    localStorage.clear();
    seedSettings(); // back to defaults — lastImportCategories: null
  });

  it('renders the loading screen once discovery is chosen', async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));
    renderModal();
    expect(screen.getByText('Scanning platforms for tasks...')).toBeInTheDocument();
  });

  it('renders discovered categories and filters Microsoft/Uncategorized from default selection', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Import & Sync')).toBeInTheDocument();
    for (const name of ['Backup', 'Maintenance', 'Automation', 'Microsoft', 'Uncategorized']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Backup 3 + Maintenance 2 + Automation 5; Microsoft's 10 and
    // Uncategorized's 1 excluded on a first run.
    expect(await screen.findByRole('button', { name: /import 10 tasks/i })).toBeInTheDocument();
  });

  it('states the task count before the click, not just the category count', async () => {
    // "Sync 3 Categories" hid the fact that those three are 10 tasks. The number
    // has to arrive before the action rather than after it.
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => expect(preview()).toMatch(/10 tasks across 3 folders/));
  });

  it("restores the last import's selection instead of re-selecting everything", async () => {
    // The bug: every run after the first inherited the first run's answer, which
    // is how a 352-row dashboard happens.
    seedSettings({ lastImportCategories: ['Backup'] });
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => expect(preview()).toMatch(/3 tasks across 1 folder\b/));
    expect(screen.getByText(/from last import/i)).toBeInTheDocument();
  });

  it('drops a remembered category whose folder no longer exists', async () => {
    // Otherwise the count promises tasks that are not there.
    seedSettings({ lastImportCategories: ['Backup', 'DeletedFolder'] });
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => expect(preview()).toMatch(/3 tasks across 1 folder\b/));
  });

  it('offers None / Non-system / All, and All really does include the OS tasks', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'All' }));

    fireEvent.click(screen.getByRole('button', { name: 'None' }));
    expect(preview()).toMatch(/nothing selected/i);

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(preview()).toMatch(/21 tasks across 5 folders/); // 3+2+10+5+1

    fireEvent.click(screen.getByRole('button', { name: 'Non-system' }));
    expect(preview()).toMatch(/10 tasks across 3 folders/);
  });

  it('warns when the selection brings back tasks the user had removed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();
    await waitFor(() => expect(preview()).toMatch(/Includes 2 you had removed/));
  });

  it('allows toggling selected categories and fires onImport', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    const { onImport } = renderModal();

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Backup'));      // off
    fireEvent.click(screen.getByText('Microsoft'));   // on

    fireEvent.click(screen.getByRole('button', { name: /import 17 tasks/i }));
    expect(onImport).toHaveBeenCalledWith(['Maintenance', 'Automation', 'Microsoft']);
  });

  it('remembers the selection only when the import is actually committed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'All' }));

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    // Ticking alone must not persist — closing without importing changes nothing.
    expect(getSettings().lastImportCategories).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /import 21 tasks/i }));
    expect(getSettings().lastImportCategories).toHaveLength(5);
  });

  it('renders platform headings through platformLabel, never the raw enum', async () => {
    // Regression: the heading was `platform.replace(/_/g, ' ')`, so it printed
    // "TASKHUB NATIVE" months after the product became Cronsole, and "WINDOWS TASK
    // SCHEDULER" where every other surface says "Windows". platform.ts calls itself
    // the single source of truth for platform display; this was the one caller
    // re-deriving it. Found by opening the modal, not by any test.
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { platform: 'TASKHUB_NATIVE', categories: [{ name: 'Native', count: 1 }] },
        { platform: 'WINDOWS_TASK_SCHEDULER', categories: [{ name: 'Backup', count: 3 }] }
      ]
    });
    renderModal();

    await waitFor(() => expect(screen.getByText('Cronsole')).toBeInTheDocument());
    expect(screen.getByText('Windows')).toBeInTheDocument();
    // The raw enum, de-underscored, must not reach the screen in any form.
    expect(screen.queryByText(/TASKHUB/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/WINDOWS TASK SCHEDULER/i)).not.toBeInTheDocument();
  });

  it('gives no heading to a platform that discovered nothing', async () => {
    // The live shape: Cronsole-native reports zero categories on every machine
    // with no native tasks, so a bare "Cronsole" heading sat above empty space.
    vi.mocked(api.get).mockResolvedValue({
      data: [
        { platform: 'TASKHUB_NATIVE', categories: [] },
        { platform: 'WINDOWS_TASK_SCHEDULER', categories: [{ name: 'Backup', count: 3 }] }
      ]
    });
    renderModal();

    await waitFor(() => expect(screen.getByText('Windows')).toBeInTheDocument());
    expect(screen.queryByText('Cronsole')).not.toBeInTheDocument();
  });

  it('does not contradict "No tasks discovered" with a heading underneath it', async () => {
    // The agent-offline case. Every platform is empty, so the modal says so —
    // and must not then print a section header promising a list.
    vi.mocked(api.get).mockResolvedValue({
      data: [{ platform: 'TASKHUB_NATIVE', categories: [] }]
    });
    renderModal();

    await waitFor(() => expect(screen.getByText('No tasks discovered')).toBeInTheDocument());
    expect(screen.queryByText('Cronsole')).not.toBeInTheDocument();
  });

  it('says "1 task", not "1 tasks"', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: [{
        platform: 'WINDOWS_TASK_SCHEDULER',
        categories: [{ name: 'Solo', count: 1 }, { name: 'Several', count: 4 }]
      }]
    });
    renderModal();

    await waitFor(() => expect(screen.getByText('1 task')).toBeInTheDocument());
    expect(screen.getByText('4 tasks')).toBeInTheDocument();
  });

  it('does not log the discovery payload — it carries task names and native paths', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => expect(preview()).toMatch(/10 tasks/));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('calls onClose when close or discard is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    const { onClose } = renderModal(vi.fn(), vi.fn());

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    // By accessible name, not `header button`. That positional selector was
    // silently retargeted when a `?` was added ahead of Close in the header —
    // it kept finding *a* button and the test failed somewhere else entirely.
    fireEvent.click(screen.getByRole('button', { name: 'Close import' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Discard'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

/**
 * The chooser, and the file path behind it.
 *
 * "Import" covers two unrelated actions — adopting tasks that already exist on
 * the machine, and creating one from a file — so the tests that matter here are
 * the ones about telling them apart and about not paying one path's costs on
 * the other.
 */
describe('ImportModal — choosing a kind of import', () => {
  let queryClient: QueryClient;

  const renderChooser = () => {
    const onImport = vi.fn();
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ImportModal onClose={onClose} onImport={onImport} />
      </QueryClientProvider>
    );
    return { onImport, onClose };
  };

  const chooseFile = () => {
    fireEvent.click(screen.getByRole('button', { name: /A task file/ }));
  };

  const pickFile = (contents: string, name = 'task.json') => {
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([contents], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    fireEvent.change(input);
  };

  const BUNDLE = JSON.stringify({
    cronsoleTaskVersion: '1.0',
    task: { name: 'Nightly digest', platform: 'TASKHUB_NATIVE', schedule: '0 4 * * *', job: {} }
  });

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    localStorage.clear();
    seedSettings();
  });

  it('opens on the choice and spends nothing until one is made', async () => {
    // Discovery is an agent round trip that can take its full timeout and fails
    // outright when the agent is offline. Firing it while someone is still
    // reading two buttons would put an irrelevant error over the file path.
    renderChooser();

    expect(screen.getByRole('button', { name: /Tasks already on this machine/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A task file/ })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('leads with the consequence, because that is the difference', async () => {
    // Not "sources vs JSON": the file extension is a footnote, and what a
    // reader can act on is that one adopts and the other creates.
    renderChooser();
    expect(screen.getByText(/Nothing is created/)).toBeInTheDocument();
    expect(screen.getByText(/This creates a task/)).toBeInTheDocument();
  });

  it('names where a Windows .xml goes, rather than letting it be discovered as a refusal', () => {
    renderChooser();
    expect(screen.getByText(/goes to Tools . Restore instead/)).toBeInTheDocument();
  });

  it('only fetches discovery once that path is chosen', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderChooser();

    fireEvent.click(screen.getByRole('button', { name: /Tasks already on this machine/ }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/tasks/discover'));
  });

  it('lets you go back, so the choice is not a one-way door', async () => {
    renderChooser();
    chooseFile();
    expect(screen.getByText('Import a task file')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to import options' }));
    expect(screen.getByRole('button', { name: /Tasks already on this machine/ })).toBeInTheDocument();
  });

  it('imports a file and keeps the first-run time on screen', async () => {
    vi.mocked(api.post).mockResolvedValue({
      data: { task: { id: 'n1', name: 'Nightly digest', nextRunTime: '2026-08-18T04:00:00.000Z' } }
    });
    renderChooser();
    chooseFile();
    pickFile(BUNDLE);

    // The body IS the file — the route sees exactly what was downloaded.
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/tasks/import', JSON.parse(BUNDLE)));
    // Shown, not toasted: the first run is the fact worth reading, and it is
    // what a message that fades takes with it.
    expect(await screen.findByText(/Imported/)).toBeInTheDocument();
    expect(screen.getByText(/will first run/)).toBeInTheDocument();
  });

  it('does not run a platform sync after a file import', async () => {
    // onImport triggers a sync — an agent round trip this path never touched.
    vi.mocked(api.post).mockResolvedValue({ data: { task: { id: 'n1', name: 'X', nextRunTime: null } } });
    const { onImport } = renderChooser();
    chooseFile();
    pickFile(BUNDLE);

    await screen.findByText(/Imported/);
    expect(onImport).not.toHaveBeenCalled();
  });

  it('keeps a refusal on screen, since it names another screen', async () => {
    vi.mocked(api.post).mockRejectedValue({
      response: { data: { error: 'That bundle is from a Windows Task Scheduler task... use Tools → Restore' } }
    });
    renderChooser();
    chooseFile();
    pickFile(BUNDLE);

    expect(await screen.findByText(/Tools → Restore/)).toBeInTheDocument();
  });

  it('blames the file, not the import, when the JSON will not parse', async () => {
    renderChooser();
    chooseFile();
    pickFile('{ not json');

    expect(await screen.findByText(/not valid JSON/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
