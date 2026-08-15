import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { SourceRail } from '../SourceRail';
import { DEFAULT_FILTERS, type TaskFilters } from '../../utils/taskFilters';
import type { Task } from '../../types';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

let seq = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${++seq}`,
  name: `task ${seq}`,
  category: 'AI-Tools',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  externalId: `\\Cronsole\\task-${seq}`,
  updatedAt: '2026-08-15T00:00:00.000Z',
  ...over
});

const renderRail = (
  population: Task[],
  filters: Partial<TaskFilters> = {},
  onSelect = vi.fn()
) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SourceRail
          population={population}
          filters={{ ...DEFAULT_FILTERS, ...filters }}
          onSelect={onSelect}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return onSelect;
};

beforeEach(() => {
  seq = 0;
  vi.mocked(api.get).mockResolvedValue({
    data: [
      { platform: 'WINDOWS_TASK_SCHEDULER', state: 'HEALTHY' },
      { platform: 'CLAUDE_CODE', state: 'OFFLINE' }
    ]
  } as never);
});

describe('SourceRail', () => {
  it('lists sources and opens the branch the filters are in', async () => {
    renderRail(
      [task({ category: 'AI-Tools' }), task({ category: 'AI-Maintenance' })],
      { source: 'WINDOWS_TASK_SCHEDULER' }
    );

    expect(await screen.findByText('Windows Task Scheduler')).toBeInTheDocument();
    // The selected source's folders are visible without a click — after a reload
    // or a pasted link the tree has to open on where you are.
    expect(screen.getByText('AI-Tools')).toBeInTheDocument();
    expect(screen.getByText('AI-Maintenance')).toBeInTheDocument();
  });

  it('keeps a collapsed source collapsed', async () => {
    renderRail([task({ category: 'AI-Tools' })]);
    await screen.findByText('Windows Task Scheduler');
    // Filters are on All sources, so nothing is expanded.
    expect(screen.queryByText('AI-Tools')).not.toBeInTheDocument();
  });

  it('selecting a folder patches source and category together', async () => {
    const onSelect = renderRail(
      [task({ category: 'AI-Tools' })],
      { source: 'WINDOWS_TASK_SCHEDULER' }
    );

    fireEvent.click(await screen.findByText('AI-Tools'));
    expect(onSelect).toHaveBeenCalledWith({
      source: 'WINDOWS_TASK_SCHEDULER',
      category: 'AI-Tools',
      favorites: 'any'
    });
  });

  it('selecting a source clears the folder, so one cannot survive a source change', async () => {
    // A folder belongs to the source it came from. Carrying `AI-Tools` across to
    // Claude would filter to nothing while the rail showed Claude selected.
    const onSelect = renderRail(
      [task({ category: 'AI-Tools' }), task({ platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE' })],
      { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Tools' }
    );

    fireEvent.click(await screen.findByText('Claude Code'));
    expect(onSelect).toHaveBeenCalledWith({ source: 'CLAUDE_CODE', category: 'All', favorites: 'any' });
  });

  it('shows platform health beside the platform it describes', async () => {
    // This is the old sidebar "System Status" panel, folded into the navigation.
    renderRail([task(), task({ platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE' })]);

    expect(
      await screen.findByTitle('Windows Task Scheduler — Online')
    ).toBeInTheDocument();
    expect(screen.getByTitle('Claude Code — Offline')).toBeInTheDocument();
  });

  it('the \\Microsoft\\ group expands but never selects', async () => {
    const onSelect = renderRail(
      [task({ category: 'AI-Tools' }), task({ category: 'Microsoft\\Windows\\Defrag', isSystem: true })],
      { source: 'WINDOWS_TASK_SCHEDULER' }
    );

    const group = await screen.findByText(/System tasks/);
    fireEvent.click(group);

    // Clicking it discloses rather than filters: the rail must not become a
    // third controller of the system lens.
    expect(onSelect).not.toHaveBeenCalled();
    const leaf = screen.getByText('Microsoft\\Windows\\Defrag');
    expect(leaf).toBeInTheDocument();

    // Its children include system tasks rather than isolating them.
    fireEvent.click(leaf);
    expect(onSelect).toHaveBeenCalledWith({
      source: 'WINDOWS_TASK_SCHEDULER',
      category: 'Microsoft\\Windows\\Defrag',
      favorites: 'any',
      system: 'include'
    });
  });

  it('discloses that the system group is being held back, and stops once it is not', async () => {
    // The disclosure used to be words inside the label; it is a badge now,
    // because as text it wrapped the row onto two lines. Pinned here because a
    // badge is exactly the kind of thing that can silently stop rendering — and
    // this one is the only on-screen statement that 257 tasks are hidden.
    const sys = [
      task({ category: 'AI-Tools' }),
      task({ category: 'Microsoft\\Windows\\Defrag', isSystem: true })
    ];

    const { unmount } = render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <SourceRail
            population={sys}
            filters={{ ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' }}
            onSelect={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    expect(await screen.findByText('hidden')).toBeInTheDocument();
    unmount();

    // Lens showing them: the badge must go, or it describes a state that is no
    // longer true — the lit-chip problem in its smallest form.
    renderRail(sys, { source: 'WINDOWS_TASK_SCHEDULER', system: 'include' });
    await screen.findByText(/System tasks/);
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
  });

  describe('collapsed', () => {
    const renderCollapsed = (onSelect = vi.fn()) => {
      render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <SourceRail
              population={[task({ category: 'AI-Tools' }), task({ category: 'AI-Maintenance' })]}
              filters={{ ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' }}
              onSelect={onSelect}
              collapsed
              onToggleCollapsed={vi.fn()}
            />
          </MemoryRouter>
        </QueryClientProvider>
      );
      return onSelect;
    };

    it('drops the folder level rather than shrinking it', async () => {
      // At 72px a folder name has nowhere to go, and a second level rendered as
      // a column of tooltips is worse than one that admits it needs width.
      renderCollapsed();
      await screen.findByLabelText(/^Windows Task Scheduler, 2 tasks$/);
      expect(screen.queryByText('AI-Tools')).not.toBeInTheDocument();
      expect(screen.queryByText('AI-Maintenance')).not.toBeInTheDocument();
    });

    it('keeps every source reachable, named and counted', async () => {
      // The collapsed rail is still navigation. Losing the counts would make it
      // a row of anonymous glyphs, and losing the names would make it unusable
      // to a screen reader — so both survive, one visibly and one as the label.
      const onSelect = renderCollapsed();
      // Await the connection-derived row — it appears only once `useConnections`
      // resolves, so awaiting the task-derived one first races it.
      expect(await screen.findByLabelText(/^Claude Code, 0 tasks$/)).toBeInTheDocument();
      const windows = screen.getByLabelText(/^Windows Task Scheduler, 2 tasks$/);
      expect(within(windows).getByText('2')).toBeInTheDocument();

      fireEvent.click(windows);
      expect(onSelect).toHaveBeenCalledWith({
        source: 'WINDOWS_TASK_SCHEDULER',
        category: 'All',
        favorites: 'any'
      });
    });

    it('offers the way back out', async () => {
      renderCollapsed();
      expect(await screen.findByLabelText('Expand sources')).toBeInTheDocument();
    });
  });

  it('lists a connected platform with no tasks, and counts it zero', async () => {
    // The rail is navigation: a connected platform with nothing imported has to
    // be reachable so its empty state can say so.
    renderRail([task()]);

    const claude = (await screen.findByText('Claude Code')).closest('button')!;
    expect(within(claude).getByText('0')).toBeInTheDocument();
  });
});
