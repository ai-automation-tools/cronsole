import { render, renderHook, act, screen, fireEvent, waitFor } from '@testing-library/react';
import { SyncSourcesModal } from '../SyncSourcesModal';
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

/**
 * The folder picker that adopts tasks already on the machine.
 *
 * This was the discovery half of the old Import modal. It is reached from
 * **Sync** now — Import takes a file — so there is no chooser in front of it and
 * discovery fires on mount: the modal exists only because someone asked for
 * exactly this.
 */
describe('SyncSourcesModal', () => {
  let queryClient: QueryClient;

  const renderModal = (onAdd = vi.fn(), onClose = vi.fn()) => {
    render(
      <QueryClientProvider client={queryClient}>
        <SyncSourcesModal onClose={onClose} onAdd={onAdd} />
      </QueryClientProvider>
    );
    return { onAdd, onClose };
  };

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.clearAllMocks();
    localStorage.clear();
    seedSettings(); // back to defaults — lastImportCategories: null
  });

  it('renders the loading screen while discovery runs', async () => {
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

    expect(screen.getByText('Add tasks from this machine')).toBeInTheDocument();
    for (const name of ['Backup', 'Maintenance', 'Automation', 'Microsoft', 'Uncategorized']) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }

    // Backup 3 + Maintenance 2 + Automation 5; Microsoft's 10 and
    // Uncategorized's 1 excluded on a first run.
    expect(await screen.findByRole('button', { name: /track 10 tasks/i })).toBeInTheDocument();
  });

  it('says nothing is created, because that is what separates it from Import', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();
    expect(await screen.findByText(/Nothing is created/)).toBeInTheDocument();
  });

  it('states the task count before the click, not just the category count', async () => {
    // "Sync 3 Categories" hid the fact that those three are 10 tasks. The number
    // has to arrive before the action rather than after it.
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => expect(preview()).toMatch(/10 tasks across 3 folders/));
  });

  it("restores the last selection instead of re-selecting everything", async () => {
    // The bug: every run after the first inherited the first run's answer, which
    // is how a 352-row dashboard happens.
    seedSettings({ lastImportCategories: ['Backup'] });
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();

    await waitFor(() => expect(preview()).toMatch(/3 tasks across 1 folder\b/));
    expect(screen.getByText(/from last time/i)).toBeInTheDocument();
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

  it('allows toggling selected categories and fires onAdd', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    const { onAdd } = renderModal();

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Backup'));      // off
    fireEvent.click(screen.getByText('Microsoft'));   // on

    fireEvent.click(screen.getByRole('button', { name: /track 17 tasks/i }));
    expect(onAdd).toHaveBeenCalledWith(['Maintenance', 'Automation', 'Microsoft']);
  });

  it('remembers the selection only when it is actually committed', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    renderModal();
    await waitFor(() => screen.getByRole('button', { name: 'All' }));

    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    // Ticking alone must not persist — closing without committing changes nothing.
    expect(getSettings().lastImportCategories).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /track 21 tasks/i }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Discard'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
