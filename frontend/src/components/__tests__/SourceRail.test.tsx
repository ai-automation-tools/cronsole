import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '../../hooks/ToastProvider';
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
      <MemoryRouter><ToastProvider>
        <SourceRail
          population={population}
          filters={{ ...DEFAULT_FILTERS, ...filters }}
          onSelect={onSelect}
        />
      </ToastProvider></MemoryRouter>
    </QueryClientProvider>
  );
  return onSelect;
};

beforeEach(() => {
  seq = 0;
  // Routed by endpoint rather than one payload for every GET. The blanket mock
  // handed the *connections* array to `useCollections` too, so every collection
  // row was built from `{platform, state}` and carried `label: undefined` — a
  // shape no server produces, quietly pinning the rail against it.
  vi.mocked(api.get).mockImplementation((url: string) =>
    Promise.resolve(
      url.includes('/tasks/health')
        ? {
            data: [
              { platform: 'WINDOWS_TASK_SCHEDULER', state: 'HEALTHY' },
              { platform: 'CLAUDE_CODE', state: 'OFFLINE' }
            ]
          }
        : { data: [] }
    ) as never
  );
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

  it('states health for a healthy platform too, so silence cannot mean two things', async () => {
    // The 2026-09 pass drew an exception-only readout — nothing on a healthy
    // source, a mark on everything else — and it was rejected here rather than
    // in review. A platform with NO connection already renders no dot, so
    // suppressing the healthy one makes "connected and fine" and "not connected
    // at all" the same absence. §9: absence of evidence is `unknown`, never `ok`.
    renderRail([task(), task({ platform: 'GEMINI_TRIGGERS', source: 'GEMINI_TRIGGERS' })]);

    // Windows is HEALTHY per the mocked connections and says so.
    expect(await screen.findByTitle('Windows Task Scheduler — Online')).toBeInTheDocument();
    // Gemini has no connection row at all: it makes no health claim, and the
    // absence of one is not a claim of health.
    const gemini = screen.getByTitle('Gemini API Triggers');
    expect(gemini).toBeInTheDocument();
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
        <MemoryRouter><ToastProvider>
          <SourceRail
            population={sys}
            filters={{ ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' }}
            onSelect={vi.fn()}
          />
        </ToastProvider></MemoryRouter>
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
          <MemoryRouter><ToastProvider>
            <SourceRail
              population={[task({ category: 'AI-Tools' }), task({ category: 'AI-Maintenance' })]}
              filters={{ ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' }}
              onSelect={onSelect}
              collapsed
              onToggleCollapsed={vi.fn()}
            />
          </ToastProvider></MemoryRouter>
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
 * The Scopes list — All tasks, Favorites, Collections, Pinned (2026-11-13; it
 * was two sliders and a tabbed panel), with Sources below. Collections and
 * Pinned open galleries in the main area, so the rail lists neither.
 */
describe('SourceRail sections', () => {
  const PIN = {
    id: 'pin-1',
    nodeKey: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
    label: 'AI-Maintenance',
    patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' }
  };

  const renderBand = (over: Partial<Parameters<typeof SourceRail>[0]> = {}) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const props = {
      population: [task({ category: 'AI-Maintenance' })],
      filters: DEFAULT_FILTERS,
      onSelect: vi.fn(),
      onTogglePin: vi.fn(),
      onShowLens: vi.fn(),
      pins: [],
      ...over
    } as Parameters<typeof SourceRail>[0];
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ToastProvider>
          <SourceRail {...props} />
        </ToastProvider></MemoryRouter>
      </QueryClientProvider>
    );
    return props;
  };

  const scopeNames = () =>
    within(screen.getByTestId('scopes-band')).getAllByRole('button').map(b => b.getAttribute('aria-label')?.split(',')[0]);

  it('lists All tasks, Favorites, Collections and Pinned, in that order', async () => {
    renderBand({ pins: [PIN] });
    await screen.findByTestId('scopes-band');
    expect(scopeNames()).toEqual(['All tasks', 'Favorites', 'Collections', 'Pinned']);
    expect(screen.getByRole('button', { name: /^All tasks, 1 task$/ })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^Pinned, 1 pinned folder$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Collections, 0 collections$/ })).toBeInTheDocument();
    // Both are drawn in the main area, never here.
    expect(screen.queryByTestId('collections-band')).toBeNull();
    expect(screen.queryByTestId('pinned-band')).toBeNull();
  });

  it('selects a scope on click', async () => {
    const props = renderBand();
    await screen.findByTestId('scopes-band');
    fireEvent.click(screen.getByRole('button', { name: /^Favorites, / }));
    expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ favorites: 'only' }));
  });

  it.each(['collections', 'pinned'] as const)('opens the %s gallery, and lights only its row while open', async lens => {
    const label = lens === 'pinned' ? 'Pinned' : 'Collections';
    const props = renderBand({ pins: [PIN], lens });
    await screen.findByTestId('scopes-band');
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}, `) }));
    expect(props.onShowLens).toHaveBeenCalledWith(lens);
    expect(props.onSelect).not.toHaveBeenCalled();
    // A gallery is not a task slice, so the filters behind it light nothing.
    expect(screen.getByRole('button', { name: new RegExp(`^${label}, `) })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: /^All tasks, / })).not.toHaveAttribute('aria-current');
  });

  it('lights Collections while one collection is open — it has no row of its own', async () => {
    renderBand({ filters: { ...DEFAULT_FILTERS, collection: 'c1' } });
    await screen.findByTestId('scopes-band');
    expect(screen.getByRole('button', { name: /^Collections, / })).toHaveAttribute('aria-current', 'true');
  });

  it('draws neither gallery row without a handler to open one', async () => {
    renderBand({ onShowLens: undefined });
    await screen.findByTestId('scopes-band');
    expect(scopeNames()).toEqual(['All tasks', 'Favorites']);
  });

  it('heads the Sources section with its count', async () => {
    renderBand();
    const sources = await screen.findByTestId('sources-band');
    // Windows (holds the task) and Cronsole-native (shown by default).
    expect(within(sources).getByRole('heading', { name: /^Sources\s*2$/ })).toBeInTheDocument();
  });

  it('offers Explore and Manage from the utility bar', async () => {
    // Out of the scroll, so nothing can take the only route to a source you
    // have NOT added with it.
    renderBand();
    await screen.findByTestId('sources-band');
    expect(screen.getByRole('button', { name: /explore sources/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /manage sources/i })).toBeInTheDocument();
  });

  it('lists Cronsole-native on a fresh install even with no native tasks', async () => {
    renderBand();
    const sources = await screen.findByTestId('sources-band');
    // The default `shownSources`. A first run that listed only the platforms
    // holding tasks would show one row and no way to learn there are others.
    expect(within(sources).getByText('Cronsole (Native)')).toBeInTheDocument();
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

  it('offers to unpin from the folder row it mirrors', async () => {
    renderBand({ filters: { ...DEFAULT_FILTERS, source: 'WINDOWS_TASK_SCHEDULER' }, pins: [PIN] });
    const sources = await screen.findByTestId('sources-band');
    expect(
      within(sources).getByRole('button', { name: /unpin AI-Maintenance from collections/i })
    ).toBeInTheDocument();
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

/**
 * The filter field — the rail's own lens, over routes rather than over tasks.
 */
describe('SourceRail filter', () => {
  const type = (value: string) =>
    fireEvent.change(screen.getByLabelText('Filter sources and folders'), { target: { value } });

  it('narrows the tree to matching folders and opens the branch holding them', async () => {
    renderRail([
      task({ category: 'AI-Tools' }),
      task({ category: 'Backups' }),
      task({ category: 'Reports' })
    ]);
    await screen.findByText('Windows Task Scheduler');
    // Nothing is expanded to begin with — filters are on All sources.
    expect(screen.queryByText('AI-Tools')).not.toBeInTheDocument();

    type('back');

    // A match opens its branch: delivering the row you asked for by name, folded
    // shut inside its parent, would hide the answer inside the result.
    expect(screen.getByText('Backups')).toBeInTheDocument();
    expect(screen.queryByText('AI-Tools')).not.toBeInTheDocument();
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
  });

  it('never filters away the scopes', async () => {
    // They are not search results — they are the two rows that mean "stop
    // narrowing", and a query matching nothing must still leave a route back.
    renderRail([task({ category: 'AI-Tools' })]);
    await screen.findByText('Windows Task Scheduler');

    type('zzz-nothing-matches');

    expect(screen.getByRole('button', { name: /^All tasks, / })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Favorites, / })).toBeInTheDocument();
  });

  it('says what it searched when it found nothing, and offers the way out', async () => {
    renderRail([task({ category: 'AI-Tools' })]);
    await screen.findByText('Windows Task Scheduler');

    type('payroll');

    // "Found nothing" and "looked at nothing" render identically as an absence,
    // so the empty state states its coverage — SyncOutcome.notes' rule, in the UI.
    expect(screen.getByText(/Nothing here is called/)).toBeInTheDocument();
    expect(screen.getByText(/filters the sidebar, not your tasks/)).toBeInTheDocument();

    // Two ways out, deliberately: the `x` in the field, and a button where the
    // reader's eyes already are. Clicking the second one.
    const clears = screen.getAllByRole('button', { name: /clear filter/i });
    expect(clears).toHaveLength(2);
    fireEvent.click(clears[1]);
    expect(screen.getByText('Windows Task Scheduler')).toBeInTheDocument();
  });

  it('names the sources it looked in and did not match', async () => {
    renderRail([
      task({ category: 'AI-Tools' }),
      task({ platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE', category: 'Routines' })
    ]);
    await screen.findByText('Claude Code');

    type('ai-tools');

    // Every source that was looked at and did not match is named — Cronsole
    // (Native) is in the default `shownSources` and so was searched too.
    const note = screen.getByText(/No match in/);
    expect(note).toHaveTextContent('Searched 3 sources');
    expect(note).toHaveTextContent('Claude Code');
    expect(note).toHaveTextContent('Cronsole (Native)');
  });

  it('drops the query when the rail collapses, so nothing narrows invisibly', async () => {
    // At 72px there is no field, no clear button and no empty state. A query
    // surviving would leave platforms missing from the icon rail with nothing
    // saying why — indistinguishable from a source that disappeared.
    const onToggleCollapsed = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ToastProvider>
          <SourceRail
            population={[task({ category: 'Backups' })]}
            filters={DEFAULT_FILTERS}
            onSelect={vi.fn()}
            onToggleCollapsed={onToggleCollapsed}
          />
        </ToastProvider></MemoryRouter>
      </QueryClientProvider>
    );
    await screen.findByText('Windows Task Scheduler');

    type('payroll');
    expect(screen.getByText(/Nothing here is called/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(onToggleCollapsed).toHaveBeenCalled();
    expect(screen.getByLabelText('Filter sources and folders')).toHaveValue('');
  });

  it('Escape clears it', async () => {
    renderRail([task({ category: 'AI-Tools' })]);
    await screen.findByText('Windows Task Scheduler');

    const field = screen.getByLabelText('Filter sources and folders');
    fireEvent.change(field, { target: { value: 'payroll' } });
    expect(screen.getByText(/Nothing here is called/)).toBeInTheDocument();

    fireEvent.keyDown(field, { key: 'Escape' });
    expect(screen.queryByText(/Nothing here is called/)).not.toBeInTheDocument();
  });
});

/**
 * Caps — no list draws itself unbounded, and none hides rows silently.
 */
describe('SourceRail row caps', () => {
  const folders = (n: number) =>
    Array.from({ length: n }, (_, i) => task({ category: `Folder-${String(i).padStart(2, '0')}` }));

  it('caps a long folder list and says how many it is holding back', async () => {
    renderRail(folders(15), { source: 'WINDOWS_TASK_SCHEDULER' });
    await screen.findByText('Folder-00');

    // Ten shown, five behind one control that states the remainder — a cap
    // with no count is a silent truncation.
    expect(screen.getByText('Folder-09')).toBeInTheDocument();
    expect(screen.queryByText('Folder-10')).not.toBeInTheDocument();

    const more = screen.getByRole('button', { name: 'Show 5 more folders' });
    fireEvent.click(more);
    expect(screen.getByText('Folder-14')).toBeInTheDocument();
  });

  it('never puts the system disclosure behind the cap', async () => {
    // It sorts last and its whole job is saying that 300 tasks are held back, so
    // a plain cap would hide it first on exactly the machines with most to
    // disclose. §9 wants it disclosed, not fenced — and behind a fold is most of
    // the way to fenced.
    renderRail(
      [...folders(15), task({ category: 'Microsoft\\Windows\\Defrag', isSystem: true })],
      { source: 'WINDOWS_TASK_SCHEDULER' }
    );
    await screen.findByText('Folder-00');

    expect(screen.getByText('System tasks')).toBeInTheDocument();
    // The cap counts the folders it governs and not the disclosure it exempts.
    expect(screen.getByRole('button', { name: 'Show 5 more folders' })).toBeInTheDocument();
  });

  it('leaves a list one over the cap alone', async () => {
    // "Show 1 more" costs a row to save a row and hides something for no gain.
    renderRail(folders(11), { source: 'WINDOWS_TASK_SCHEDULER' });
    await screen.findByText('Folder-00');
    expect(screen.getByText('Folder-10')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show 1 more/i })).toBeNull();
  });

  it('never caps the source list — every source you chose to show is drawn', async () => {
    const platforms = ['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE', 'CLAUDE_CODE', 'GITHUB_ACTIONS', 'VERCEL_CRON', 'GEMINI_TRIGGERS', 'N8N'];
    renderRail(platforms.map((platform, i) => task({ platform, category: `C${i}`, externalId: `x${i}` })));
    await screen.findByText('Windows Task Scheduler');
    expect(screen.queryByRole('button', { name: /more source/i })).toBeNull();
  });

  it('lifts the cap on a list of matches — capping one would hide the hit', async () => {
    renderRail(folders(15), { source: 'WINDOWS_TASK_SCHEDULER' });
    await screen.findByText('Folder-00');

    fireEvent.change(screen.getByLabelText('Filter sources and folders'), {
      target: { value: 'folder-' }
    });

    // All fifteen match, past the cap, all drawn. Capping a result set would
    // put the row you typed for behind a "Show 5 more" you have no reason to expect.
    expect(screen.getByText('Folder-00')).toBeInTheDocument();
    expect(screen.getByText('Folder-14')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more folders/i })).toBeNull();
  });

  it('still caps the children a match dragged along with it', async () => {
    // The other half of the same rule, and the half a blanket "no caps while
    // filtering" got wrong on a real machine: typing `ai` matched `AI-Lab` and
    // emptied all eight of its subfolders onto the rail. Those subfolders are
    // not hits — the folder above them is — so they keep their cap.
    renderRail(
      [
        ...Array.from({ length: 14 }, (_, i) =>
          task({ category: 'AI-Lab', externalId: `\\AI-Lab\\Sub-${String(i).padStart(2, '0')}\\t${i}` })
        ),
        task({ category: 'Reports' })
      ],
      { source: 'WINDOWS_TASK_SCHEDULER' }
    );
    await screen.findByText('AI-Lab');

    fireEvent.change(screen.getByLabelText('Filter sources and folders'), {
      target: { value: 'ai-lab' }
    });

    expect(screen.getByText('AI-Lab')).toBeInTheDocument();
    expect(screen.getByText('Sub-00')).toBeInTheDocument();
    expect(screen.queryByText('Sub-13')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show 4 more folders' })).toBeInTheDocument();
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
        <MemoryRouter><ToastProvider>
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
        </ToastProvider></MemoryRouter>
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

  it('reports the WHOLE band even while the rail is filtered', async () => {
    // `orderBy` drops every record the reported list does not name — that is
    // stated in its own doc as a precondition: the caller hands in the band's
    // own rows. Reporting the *filtered* rows breaks it, and on the Pinned band
    // it is destructive: five pins, a query matching two, one drag, and the
    // other three are written out of a synced preference for good.
    //
    // The cap never had this problem (hidden rows stay in the key list, only
    // the rendering is trimmed) and the filter must not either.
    const onReorder = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter><ToastProvider>
          <SourceRail
            population={[
              task({ platform: 'WINDOWS_TASK_SCHEDULER' }),
              task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:HTTP' }),
              task({ platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE' })
            ]}
            filters={DEFAULT_FILTERS}
            onSelect={vi.fn()}
            onReorder={onReorder}
          />
        </ToastProvider></MemoryRouter>
      </QueryClientProvider>
    );
    await screen.findByText('Claude Code');

    // Narrow to one row, then move it.
    fireEvent.change(screen.getByLabelText('Filter sources and folders'), {
      target: { value: 'windows' }
    });
    fireEvent.keyDown(screen.getByText('Windows Task Scheduler'), {
      key: 'ArrowUp',
      altKey: true
    });

    // Every platform is named, not just the one on screen.
    expect(onReorder).toHaveBeenCalledTimes(1);
    const [section, keys] = onReorder.mock.calls[0];
    expect(section).toBe('source');
    expect(keys).toHaveLength(3);
    expect(keys).toEqual(
      expect.arrayContaining(['WINDOWS_TASK_SCHEDULER', 'TASKHUB_NATIVE', 'CLAUDE_CODE'])
    );
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
