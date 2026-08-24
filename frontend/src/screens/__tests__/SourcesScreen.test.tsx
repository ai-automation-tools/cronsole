import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, render, renderHook, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { SourcesScreen } from '../SourcesScreen';
import { api } from '../../api';
import { useSettings } from '../../hooks/useSettings';
import type { PlatformMatrixRow } from '../../hooks/usePlatformMatrix';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  subscribeAuthToken: () => () => {}
}));

// The two hand-composed connection panels each own a query and a form; this
// screen's job is which sections exist and what goes in them.
vi.mock('../../components/ClaudeRoutinesPanel', () => ({ ClaudeRoutinesPanel: () => null }));
vi.mock('../../components/GitHubReposPanel', () => ({ GitHubReposPanel: () => null }));

const row = (over: Partial<PlatformMatrixRow>): PlatformMatrixRow => ({
  platform: 'WINDOWS_TASK_SCHEDULER',
  label: 'Windows Task Scheduler',
  summary: 'Your machine’s own scheduler.',
  maturity: 'functional',
  access: 'controller',
  configured: false,
  isActive: false,
  healthState: null,
  healthReason: null,
  lastSync: null,
  taskCount: 0,
  capabilities: [],
  lastVerifiedAt: null,
  executionHost: null,
  ...over
});

const MATRIX = [
  row({}),
  row({ platform: 'TASKHUB_NATIVE', label: 'Cronsole-native' }),
  row({
    platform: 'GITHUB_ACTIONS',
    label: 'GitHub Actions',
    access: 'observer',
    summary: 'Read-only. Cronsole reads the scheduled workflows in the repositories you name.'
  })
];

const renderScreen = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SourcesScreen />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

beforeEach(() => {
  localStorage.clear();
  // The settings store is module-level and reads `localStorage` once at import,
  // so clearing the key is not enough — a source added by one test would still
  // be in `shownSources` for the next. Reset the store itself.
  const { result } = renderHook(() => useSettings());
  act(() => result.current.reset());
  cleanup();
  vi.mocked(api.get).mockResolvedValue({ data: { platforms: MATRIX } } as never);
});

describe('SourcesScreen', () => {
  it('splits the sources you have from the ones you could add', async () => {
    renderScreen();

    // A fresh install: Windows and native get full cards, GitHub Actions is an
    // offer. Four platforms of which two are real is the thing being avoided.
    expect(await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER')).toBeInTheDocument();
    expect(screen.getByTestId('platform-row-TASKHUB_NATIVE')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-row-GITHUB_ACTIONS')).toBeNull();
    expect(screen.getByTestId('available-source-GITHUB_ACTIONS')).toBeInTheDocument();
  });

  it('moves a source into Your sources when it is added', async () => {
    renderScreen();
    const offer = await screen.findByTestId('available-source-GITHUB_ACTIONS');

    fireEvent.click(within(offer).getByRole('button', { name: /add to sidebar/i }));

    expect(await screen.findByTestId('platform-row-GITHUB_ACTIONS')).toBeInTheDocument();
    expect(screen.queryByTestId('available-source-GITHUB_ACTIONS')).toBeNull();
  });

  it('will not let a source holding tasks be hidden, and says why', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: { platforms: [row({ taskCount: 4 })] }
    } as never);
    renderScreen();

    const card = await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');
    const toggle = within(card).getByRole('button', { name: /in sidebar/i });

    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', expect.stringContaining('4 tasks'));
  });

  it('hides an empty, unconnected source that the user turns off', async () => {
    renderScreen();
    const card = await screen.findByTestId('platform-row-TASKHUB_NATIVE');

    fireEvent.click(within(card).getByRole('button', { name: /in sidebar/i }));

    expect(screen.queryByTestId('platform-row-TASKHUB_NATIVE')).toBeNull();
    // And it is findable again, which is what makes hiding safe to offer.
    expect(screen.getByTestId('available-source-TASKHUB_NATIVE')).toBeInTheDocument();
  });

  it('labels an observer as chosen rather than unfinished', async () => {
    renderScreen();
    const offer = await screen.findByTestId('available-source-GITHUB_ACTIONS');
    // The badge is the server's judgement, not a count of struck-through cells:
    // "read-only" and "half-built" look identical without it.
    expect(within(offer).getByText('Observer')).toBeInTheDocument();
  });

  it('keeps quick links below the real sources and says nothing is read or written', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');

    expect(screen.getByText('Quick links')).toBeInTheDocument();
    expect(screen.getByText(/nothing is read or written/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ChatGPT Schedules/i })).toBeInTheDocument();
  });

  it('adds a quick link to the preference document, not to a bare storage key', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');

    fireEvent.click(screen.getByRole('button', { name: /add link/i }));
    fireEvent.change(screen.getByLabelText(/platform name/i), { target: { value: 'n8n' } });
    fireEvent.change(screen.getByLabelText(/url/i), { target: { value: 'n8n.local' } });
    fireEvent.click(screen.getByRole('button', { name: /save link/i }));

    const link = await screen.findByRole('link', { name: /n8n/i });
    // The scheme is assumed rather than demanded of the person typing.
    expect(link).toHaveAttribute('href', 'https://n8n.local');
    expect(localStorage.getItem('cronsole_platform_links')).toBeNull();
    expect(JSON.parse(localStorage.getItem('cronsole.settings') ?? '{}').quickLinks)
      .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'n8n' })]));
  });

  it('points a custom source at the guide rather than at a form', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');

    // There is no plugin folder, so offering a form would advertise an
    // extension point that does not exist.
    const link = screen.getByRole('link', { name: /adding a source/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('Sources_Guide.md#adding-a-source'));
  });
});
