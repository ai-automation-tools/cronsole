import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportModal } from '../ImportModal';
import { api } from '../../api';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../api', () => ({
  api: {
    get: vi.fn()
  }
}));

const mockDiscovery = [
  {
    platform: 'WINDOWS_TASK_SCHEDULER',
    categories: [
      { name: 'Backup', count: 3 },
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

describe('ImportModal Component', () => {
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
  });

  it('renders loading screen initially', async () => {
    vi.mocked(api.get).mockReturnValue(new Promise(() => {}));

    render(
      <QueryClientProvider client={queryClient}>
        <ImportModal onClose={vi.fn()} onImport={vi.fn()} />
      </QueryClientProvider>
    );

    expect(screen.getByText('Scanning platforms for tasks...')).toBeInTheDocument();
  });

  it('renders discovered categories and filters Microsoft/Uncategorized from default selection', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });

    render(
      <QueryClientProvider client={queryClient}>
        <ImportModal onClose={vi.fn()} onImport={vi.fn()} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    expect(screen.getByText('Import & Sync')).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
    expect(screen.getByText('Microsoft')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();

    expect(screen.getByText('3 tasks')).toBeInTheDocument();
    expect(screen.getByText('2 tasks')).toBeInTheDocument();
    expect(screen.getByText('5 tasks')).toBeInTheDocument();
    expect(screen.getByText('10 tasks')).toBeInTheDocument();
    expect(screen.getByText('1 tasks')).toBeInTheDocument();

    expect(screen.getByText('Sync 3 Categories')).toBeInTheDocument();
  });

  it('allows toggling selected categories and fires onImport', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    const onImport = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <ImportModal onClose={vi.fn()} onImport={onImport} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    const backupLabel = screen.getByText('Backup');
    fireEvent.click(backupLabel);

    const microsoftLabel = screen.getByText('Microsoft');
    fireEvent.click(microsoftLabel);

    expect(screen.getByText('Sync 3 Categories')).toBeInTheDocument();

    const syncButton = screen.getByText('Sync 3 Categories');
    fireEvent.click(syncButton);

    expect(onImport).toHaveBeenCalledWith(['Maintenance', 'Automation', 'Microsoft']);
  });

  it('calls onClose when close or discard is clicked', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: mockDiscovery });
    const onClose = vi.fn();

    render(
      <QueryClientProvider client={queryClient}>
        <ImportModal onClose={onClose} onImport={vi.fn()} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText('Scanning platforms for tasks...')).not.toBeInTheDocument();
    });

    // The modal renders through a portal to document.body, so query from there.
    const closeBtn = document.querySelector('header button');
    expect(closeBtn).toBeInTheDocument();
    if (closeBtn) {
      fireEvent.click(closeBtn);
    }
    expect(onClose).toHaveBeenCalledTimes(1);

    const discardBtn = screen.getByText('Discard');
    fireEvent.click(discardBtn);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
