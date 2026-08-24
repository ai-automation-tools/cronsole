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
// screen's job is which views exist and what goes in them.
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

/**
 * A realistic install: one source connected, one added-but-not-connected, one
 * never added. The three states the tabs split on, one of each.
 */
const MATRIX = [
  row({ configured: true, healthState: 'HEALTHY', taskCount: 4 }),
  row({ platform: 'TASKHUB_NATIVE', label: 'Cronsole-native' }),
  row({
    platform: 'GITHUB_ACTIONS',
    label: 'GitHub Actions',
    access: 'observer',
    summary: 'Read-only. Cronsole reads the scheduled workflows in the repositories you name.'
  })
];

const renderScreen = (search = '') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/sources${search}`]}>
        <SourcesScreen />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

const tab = (name: RegExp) => screen.getByRole('tab', { name });

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
  it('splits the tabs on whether a source is connected, not on whether it is listed', async () => {
    renderScreen();

    // Cronsole-native is in the default `shownSources` and still unconnected —
    // the state the old two-way split put among the working sources.
    expect(await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER')).toBeInTheDocument();
    expect(screen.queryByTestId('pending-source-TASKHUB_NATIVE')).toBeNull();

    expect(tab(/connected/i)).toHaveAttribute('aria-selected', 'true');
    expect(within(tab(/connected/i)).getByText('1')).toBeInTheDocument();
    expect(within(tab(/available/i)).getByText('2')).toBeInTheDocument();

    fireEvent.click(tab(/available/i));

    expect(screen.getByTestId('pending-source-TASKHUB_NATIVE')).toBeInTheDocument();
    expect(screen.getByTestId('available-source-GITHUB_ACTIONS')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-row-WINDOWS_TASK_SCHEDULER')).toBeNull();
  });

  it('lands a legacy ?focus=yours link on Connected rather than nowhere', async () => {
    renderScreen('?focus=yours');
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');
    expect(tab(/connected/i)).toHaveAttribute('aria-selected', 'true');
  });

  it('opens Available directly when the rail asks for it', async () => {
    renderScreen('?focus=available');
    expect(await screen.findByTestId('available-source-GITHUB_ACTIONS')).toBeInTheDocument();
    expect(tab(/available/i)).toHaveAttribute('aria-selected', 'true');
  });

  it('adds a source to the sidebar without claiming it is connected', async () => {
    renderScreen('?focus=available');
    const offer = await screen.findByTestId('available-source-GITHUB_ACTIONS');

    fireEvent.click(within(offer).getByRole('button', { name: /add to sidebar/i }));

    // It moves within Available — from "not added" to "added, needs setting up".
    // Landing in Connected would be the lie the whole split exists to avoid.
    expect(screen.getByTestId('pending-source-GITHUB_ACTIONS')).toBeInTheDocument();
    expect(screen.queryByTestId('available-source-GITHUB_ACTIONS')).toBeNull();
    expect(within(tab(/connected/i)).getByText('1')).toBeInTheDocument();
  });

  it('tells an unconnected source what would actually connect it', async () => {
    renderScreen('?focus=available');
    const pending = await screen.findByTestId('pending-source-TASKHUB_NATIVE');

    // Cronsole-native has nothing to fill in, so it gets the sentence and no
    // button — a Connect control that cannot connect anything is worse.
    expect(within(pending).getByText(/whenever the Cronsole backend is running/i)).toBeInTheDocument();
    expect(within(pending).queryByRole('button', { name: /^set up/i })).toBeNull();
  });

  it('offers a setup panel only for the sources that are composed by hand', async () => {
    renderScreen('?focus=available');
    const offer = await screen.findByTestId('available-source-GITHUB_ACTIONS');
    fireEvent.click(within(offer).getByRole('button', { name: /add to sidebar/i }));

    const pending = screen.getByTestId('pending-source-GITHUB_ACTIONS');
    const setUp = within(pending).getByRole('button', { name: /set up github actions/i });

    fireEvent.click(setUp);
    expect(within(pending).getByRole('button', { name: /close setup/i })).toBeInTheDocument();
  });

  it('will not let a source holding tasks be hidden, and says why', async () => {
    renderScreen();

    const card = await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');
    const toggle = within(card).getByRole('button', { name: /in sidebar/i });

    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', expect.stringContaining('4 tasks'));
  });

  it('hides an empty, unconnected source that the user turns off', async () => {
    renderScreen('?focus=available');
    const pending = await screen.findByTestId('pending-source-TASKHUB_NATIVE');

    fireEvent.click(within(pending).getByRole('button', { name: /in sidebar/i }));

    expect(screen.queryByTestId('pending-source-TASKHUB_NATIVE')).toBeNull();
    // And it is findable again, which is what makes hiding safe to offer.
    expect(screen.getByTestId('available-source-TASKHUB_NATIVE')).toBeInTheDocument();
  });

  it('labels an observer as chosen rather than unfinished', async () => {
    renderScreen('?focus=available');
    const offer = await screen.findByTestId('available-source-GITHUB_ACTIONS');
    // The badge is the server's judgement, not a count of struck-through cells:
    // "read-only" and "half-built" look identical without it.
    expect(within(offer).getByText('Observer')).toBeInTheDocument();
  });

  it('keeps a connected source’s failures out of the disclosure', async () => {
    vi.mocked(api.get).mockResolvedValue({
      data: {
        platforms: [row({
          configured: true,
          healthState: 'DEGRADED',
          capabilities: [{
            verb: 'run',
            label: 'Run now',
            description: 'Start a task immediately.',
            support: 'verified',
            lastSuccessAt: '2026-08-01T00:00:00.000Z',
            lastFailureAt: '2026-08-20T00:00:00.000Z',
            lastFailureReason: 'the agent did not answer'
          }]
        })]
      }
    } as never);
    renderScreen();

    const card = await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');
    // Visible without expanding anything: collapsing a card is a density
    // decision and must never make the screen quieter when something is wrong.
    expect(within(card).getByText(/did not answer/i)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /capabilities and evidence/i }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('shows the per-verb evidence once the disclosure is opened', async () => {
    renderScreen();
    const card = await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');

    fireEvent.click(within(card).getByRole('button', { name: /capabilities and evidence/i }));

    expect(within(card).getByRole('columnheader', { name: /last failure/i })).toBeInTheDocument();
  });

  it('keeps quick links in their own view and says nothing is read or written', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');

    fireEvent.click(tab(/quick links/i));

    expect(screen.getByText(/nothing is read or written/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ChatGPT Schedules/i })).toBeInTheDocument();
  });

  it('keeps the remove control reachable without a hover', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');
    fireEvent.click(tab(/quick links/i));

    // Rendered, not revealed: on a touch screen a hover-only control does not
    // exist, and mobile is first-class here.
    const remove = screen.getByRole('button', { name: /remove the Claude Routines link/i });
    fireEvent.click(remove);

    expect(screen.queryByRole('link', { name: /Claude Routines/i })).toBeNull();
  });

  it('adds a quick link to the preference document, not to a bare storage key', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');
    fireEvent.click(tab(/quick links/i));

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
    renderScreen('?focus=available');
    await screen.findByTestId('available-source-GITHUB_ACTIONS');

    // There is no plugin folder, so offering a form would advertise an
    // extension point that does not exist.
    const link = screen.getByRole('link', { name: /adding a source/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('Sources_Guide.md#adding-a-source'));
  });

  it('moves between views with the arrow keys, as a tablist should', async () => {
    renderScreen();
    await screen.findByTestId('platform-row-WINDOWS_TASK_SCHEDULER');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(tab(/available/i)).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    expect(tab(/quick links/i)).toHaveAttribute('aria-selected', 'true');
  });
});
