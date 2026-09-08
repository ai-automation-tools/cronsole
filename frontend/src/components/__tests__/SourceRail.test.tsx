import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, cleanup } from '@testing-library/react';
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
      folderPath: 'All',
      favorites: 'any',
      collection: 'All'
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
    expect(onSelect).toHaveBeenCalledWith({ source: 'CLAUDE_CODE', category: 'All', folderPath: 'All', favorites: 'any', collection: 'All' });
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
      folderPath: 'All',
      favorites: 'any',
      collection: 'All',
      system: 'include'
    });
  });

  it('expands an ordinary folder to reveal its own subfolders', async () => {
    // Regression: the folder row's chevron used to be gated on `isGroup`, true
    // only for the \Microsoft\ disclosure — so an ordinary folder with real
    // subfolders (data present, `node.children` populated) rendered no way to
    // open it at all. Selecting its label filtered; nothing revealed the folder
    // underneath it.
    const onSelect = renderRail(
      [
        task({ category: 'AI-Tools', externalId: '\\AI-Tools\\a' }),
        task({ category: 'AI-Tools', externalId: '\\AI-Tools\\Backups\\b' })
      ],
      { source: 'WINDOWS_TASK_SCHEDULER' }
    );

    await screen.findByText('AI-Tools');
    expect(screen.queryByText('Backups')).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Expand AI-Tools'));
    expect(await screen.findByText('Backups')).toBeInTheDocument();

    // AI-Tools itself is still selectable independent of the chevron.
    fireEvent.click(screen.getByText('AI-Tools'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'AI-Tools', folderPath: 'All' })
    );

    fireEvent.click(screen.getByText('Backups'));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'AI-Tools', folderPath: 'Backups' })
    );
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
        folderPath: 'All',
        favorites: 'any',
        collection: 'All'
      });
    });

    it('offers the way back out', async () => {
      renderCollapsed();
      expect(await screen.findByLabelText('Expand sidebar')).toBeInTheDocument();
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

/**
 * The Collections band — its own section, between the scopes and the tree.
 */
describe('SourceRail collections band', () => {
  const renderBand = (over: Partial<Parameters<typeof SourceRail>[0]> = {}) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      population: [task({ category: 'AI-Maintenance' })],
      filters: DEFAULT_FILTERS,
      onSelect: vi.fn(),
      onManageCollections: vi.fn(),
      onToggleCollectionsCollapsed: vi.fn(),
      onTogglePinnedCollapsed: vi.fn(),
      onToggleSourcesCollapsed: vi.fn(),
      onTogglePin: vi.fn(),
      pins: [],
      ...over
    } as Parameters<typeof SourceRail>[0];
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SourceRail {...props} />
        </MemoryRouter>
      </QueryClientProvider>
    );
    return props;
  };

  it('keeps the manage button inside the band, not at the foot of the rail', async () => {
    renderBand();
    const band = await screen.findByTestId('collections-band');
    // The control that makes a collection belongs to the section it makes into.
    expect(within(band).getByRole('button', { name: /new collection/i })).toBeInTheDocument();
  });

  it('folds a band shut, and says how much it is holding', async () => {
    const pins = [
      {
        id: 'pin-1',
        nodeKey: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
        label: 'AI-Maintenance',
        patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' }
      }
    ];

    renderBand({ pins, pinnedCollapsed: false });
    const open = await screen.findByTestId('pinned-band');
    expect(within(open).getByText('AI-Maintenance')).toBeInTheDocument();

    cleanup();

    renderBand({ pins, pinnedCollapsed: true });
    const shut = await screen.findByTestId('pinned-band');
    // The rows go; the tally stays, because a chevron that hid twelve rows with
    // no hint of them is the thing this count prevents.
    expect(within(shut).queryByText('AI-Maintenance')).toBeNull();
    expect(within(shut).getByText('1')).toBeInTheDocument();
  });

  it('folds the two bands independently', async () => {
    const pins = [
      {
        id: 'pin-1',
        nodeKey: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
        label: 'AI-Maintenance',
        patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' }
      }
    ];

    // Pinned shut, Collections open: one chevron must not speak for the other.
    renderBand({ pins, pinnedCollapsed: true, collectionsCollapsed: false });

    const collections = await screen.findByTestId('collections-band');
    expect(
      within(collections).getByRole('button', { name: /new collection/i })
    ).toBeInTheDocument();

    const pinned = screen.getByTestId('pinned-band');
    expect(within(pinned).queryByText('AI-Maintenance')).toBeNull();
  });

  it('names the Sources section down at the tree, not at the top of the rail', async () => {
    renderBand();
    const sources = await screen.findByTestId('sources-band');
    // The heading and its help `?` sit inside the section they describe. Atop
    // the rail the word named a quarter of what sat under it.
    expect(within(sources).getByText('Sources')).toBeInTheDocument();
    expect(within(sources).getByRole('button', { name: /collapse sources/i })).toBeInTheDocument();
  });

  it('folds the Sources tree without touching the bands above it', async () => {
    renderBand({ sourcesCollapsed: true, collectionsCollapsed: false });

    const sources = await screen.findByTestId('sources-band');
    expect(within(sources).queryByText('Windows Task Scheduler')).toBeNull();
    // Folded, it still says how many platforms it is holding: Windows, which
    // has the task, plus Cronsole-native, which `shownSources` defaults to even
    // with nothing in it.
    expect(within(sources).getByText('2')).toBeInTheDocument();

    const collections = screen.getByTestId('collections-band');
    expect(
      within(collections).getByRole('button', { name: /new collection/i })
    ).toBeInTheDocument();
  });

  it('offers Explore and Manage under the tree, and only while the tree is open', async () => {
    renderBand({ sourcesCollapsed: false });
    const sources = await screen.findByTestId('sources-band');

    // The rail lists the sources you have; these are the only route to the ones
    // you do not — which is what makes an opt-in default set safe rather than
    // indistinguishable from a missing platform.
    expect(within(sources).getByRole('button', { name: /explore sources/i })).toBeInTheDocument();
    expect(within(sources).getByRole('button', { name: /manage sources/i })).toBeInTheDocument();
  });

  it('hides the two actions while the Sources tree is folded', async () => {
    renderBand({ sourcesCollapsed: true });
    const sources = await screen.findByTestId('sources-band');
    // Folding a section hides what it holds. Two buttons surviving the fold
    // would be the section refusing to close.
    expect(within(sources).queryByRole('button', { name: /explore sources/i })).toBeNull();
  });

  it('lists Cronsole-native on a fresh install even with no native tasks', async () => {
    renderBand();
    const sources = await screen.findByTestId('sources-band');
    // The default `shownSources`. A first run that listed only the platforms
    // holding tasks would show one row and no way to learn there are others.
    expect(within(sources).getByText('Cronsole (Native)')).toBeInTheDocument();
  });

  it('shows no Pinned band until something is pinned', async () => {
    renderBand({ pins: [] });
    // Collections keeps its empty state — the button below it is how the first
    // one gets made. Pinned has no such control, so an empty band could only
    // point somewhere else, and it does not render at all.
    await screen.findByTestId('collections-band');
    expect(screen.queryByTestId('pinned-band')).toBeNull();
  });

  it('pins a folder from the tree, and hands back the node it was asked about', async () => {
    const props = renderBand({ filters: { ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' } });

    const add = await screen.findByRole('button', { name: /pin AI-Maintenance to collections/i });
    fireEvent.click(add);

    expect(props.onTogglePin).toHaveBeenCalledTimes(1);
    expect(vi.mocked(props.onTogglePin!).mock.calls[0][0]).toMatchObject({
      key: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
      label: 'AI-Maintenance'
    });
  });

  it('offers to unpin the folder that is already pinned', async () => {
    renderBand({
      filters: { ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' },
      pins: [
        {
          id: 'pin-1',
          nodeKey: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
          label: 'AI-Maintenance',
          patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' }
        }
      ]
    });

    // Both surfaces offer it, and that is the intent: the tree row is where you
    // notice the folder is already pinned, the band row is where you notice the
    // pin is no longer earning its place.
    await screen.findByTestId('collections-band');
    expect(
      screen.getAllByRole('button', { name: /unpin AI-Maintenance from collections/i })
    ).toHaveLength(2);
  });

  it('unpins from the pinned row itself, so a pin whose folder is gone is still removable', async () => {
    // The folder is NOT in the population — it has been emptied or its platform
    // disconnected. There is no tree row left to click, which is exactly when a
    // row you cannot remove would be worst.
    const props = renderBand({
      population: [task({ category: 'AI-Tools' })],
      pins: [
        {
          id: 'pin-1',
          nodeKey: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
          label: 'AI-Maintenance',
          patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' }
        }
      ]
    });

    const band = await screen.findByTestId('pinned-band');
    // Still there, reading 0 rather than having silently disappeared.
    expect(within(band).getByText('AI-Maintenance')).toBeInTheDocument();

    fireEvent.click(
      within(band).getByRole('button', { name: /unpin AI-Maintenance from collections/i })
    );
    expect(vi.mocked(props.onTogglePin!).mock.calls[0][0]).toMatchObject({ key: 'pin:pin-1' });
  });

  it('offers no pin on the system disclosure group — it is an expander, not a place', async () => {
    renderBand({
      population: [
        task({ category: 'AI-Maintenance' }),
        task({ category: '\\Microsoft\\Windows', isSystem: true })
      ],
      filters: { ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' }
    });

    await screen.findByText('System tasks');
    expect(screen.queryByRole('button', { name: /pin System tasks/i })).toBeNull();
  });
});

describe('SourceRail reordering', () => {
  /**
   * The keyboard path, which is the one jsdom can drive — HTML5 drag events
   * carry no `dataTransfer` here. It is also the path that matters most: the
   * rail is navigation, and an order you can only set with a pointer is one a
   * keyboard user does not have at all.
   */
  const railWithSources = (onReorder = vi.fn(), sourceOrder: string[] = []) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SourceRail
            population={[
              task({ platform: 'WINDOWS_TASK_SCHEDULER' }),
              task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:HTTP' })
            ]}
            filters={DEFAULT_FILTERS}
            onSelect={vi.fn()}
            sourceOrder={sourceOrder}
            onReorder={onReorder}
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    return onReorder;
  };

  it('Alt+ArrowDown reports the whole band in its new order', async () => {
    const onReorder = railWithSources();
    // Alphabetical to start: Cronsole (Native), then Windows.
    fireEvent.keyDown(await screen.findByText('Cronsole (Native)'), {
      key: 'ArrowDown',
      altKey: true
    });
    expect(onReorder).toHaveBeenCalledWith('source', [
      'WINDOWS_TASK_SCHEDULER',
      'TASKHUB_NATIVE'
    ]);
  });

  it('does not fire at the end of the band', async () => {
    const onReorder = railWithSources();
    fireEvent.keyDown(await screen.findByText('Cronsole (Native)'), {
      key: 'ArrowUp',
      altKey: true
    });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('leaves the arrows alone without Alt', async () => {
    const onReorder = railWithSources();
    fireEvent.keyDown(await screen.findByText('Cronsole (Native)'), { key: 'ArrowDown' });
    expect(onReorder).not.toHaveBeenCalled();
  });

  it('draws the sources in the stored order', async () => {
    railWithSources(vi.fn(), ['WINDOWS_TASK_SCHEDULER']);
    await screen.findByText('Windows Task Scheduler');
    const labels = screen
      .getAllByText(/^(Cronsole \(Native\)|Windows Task Scheduler)$/)
      .map(el => el.textContent);
    expect(labels).toEqual(['Windows Task Scheduler', 'Cronsole (Native)']);
  });
});
