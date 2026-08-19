import { describe, it, expect } from 'vitest';
import {
  buildSourceTree,
  isRailNodeSelected,
  expandedSourceFor,
  ALL_SOURCES,
  FAVORITES_KEY,
  UNCATEGORIZED,
  railSectionOf,
  type RailNode
} from '../sourceTree';
import type { RailPin } from '../railPins';
import { DEFAULT_FILTERS, type TaskFilters } from '../taskFilters';
import type { Task } from '../../types';

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

const filters = (over: Partial<TaskFilters> = {}): TaskFilters => ({
  ...DEFAULT_FILTERS,
  ...over
});

/** Find a node by label anywhere in the tree. */
const find = (nodes: RailNode[], label: string): RailNode | undefined => {
  for (const n of nodes) {
    if (n.label === label) return n;
    const hit = n.children && find(n.children, label);
    if (hit) return hit;
  }
  return undefined;
};

const labels = (nodes: RailNode[] | undefined) => (nodes ?? []).map(n => n.label);

describe('buildSourceTree — top level', () => {
  it('leads with All sources and lists one row per platform', () => {
    const tree = buildSourceTree({
      population: [
        task({ platform: 'WINDOWS_TASK_SCHEDULER' }),
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:EXEC' }),
        task({ platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE' })
      ],
      filters: filters()
    });

    expect(tree[0].key).toBe(ALL_SOURCES);
    expect(tree[0].count).toBe(3);
    // Favorites is the second scope row, above the platforms.
    expect(tree[1].key).toBe(FAVORITES_KEY);
    expect(labels(tree.slice(2))).toEqual([
      'Claude Code',
      'Cronsole (Native)',
      'Windows Task Scheduler'
    ]);
  });

  it('offers Favorites as a scope row, counted under the other lenses', () => {
    const tree = buildSourceTree({
      population: [
        task({ isFavorite: true }),
        task({ isFavorite: true, platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE' }),
        task()
      ],
      filters: filters()
    });

    const fav = tree.find(n => n.key === FAVORITES_KEY)!;
    expect(fav.count).toBe(2);
    // It narrows the starred dimension and resets every other rail dimension —
    // it does NOT rewrite status or system. Composing with the lit view is the
    // whole point of it being a rail row rather than a view of its own.
    expect(fav.patch).toEqual({
      source: 'All',
      category: 'All',
      favorites: 'only',
      collection: 'All'
    });
  });

  it('makes every other rail node clear the starred scope', () => {
    // Otherwise clicking a source while starred-only is in force leaves you
    // filtered to favorites with the rail insisting you see the whole source.
    const tree = buildSourceTree({
      population: [task({ category: 'AI-Tools' })],
      filters: filters({ favorites: 'only', source: 'WINDOWS_TASK_SCHEDULER' })
    });

    expect(tree[0].patch).toMatchObject({ favorites: 'any' });
    const windows = find(tree, 'Windows Task Scheduler')!;
    expect(windows.patch).toMatchObject({ favorites: 'any' });
    expect(find(tree, 'AI-Tools')!.patch).toMatchObject({ favorites: 'any' });
  });

  it('lists a connected platform that has no tasks yet', () => {
    // The rail is navigation, not a filter: a connected Claude account with
    // nothing imported has to be reachable so its empty state can say so.
    const tree = buildSourceTree({
      population: [task()],
      filters: filters(),
      connectedPlatforms: ['CLAUDE_CODE']
    });

    const claude = find(tree, 'Claude Code');
    expect(claude).toBeDefined();
    expect(claude!.count).toBe(0);
  });

  it('keeps the selected source listed even when nothing derives it', () => {
    // A link written before native split (`?source=TASKHUB_NATIVE`) must still
    // light a row, or the list is filtered while the rail sits entirely unlit.
    const tree = buildSourceTree({
      population: [task()],
      filters: filters({ source: 'TASKHUB_NATIVE:EXEC' })
    });

    expect(find(tree, 'Cronsole (Native)')).toBeDefined();
  });

  it('the parts sum to the whole', () => {
    const population = [
      task({ category: 'A' }),
      task({ category: 'B' }),
      task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:HTTP' })
    ];
    const tree = buildSourceTree({ population, filters: filters() });

    const all = tree[0].count;
    // Favorites is a *scope*, not a partition of the sources, so it is excluded
    // from the sum — it double-counts tasks that are also in a platform row.
    const sum = tree
      .slice(1)
      .filter(n => n.key !== FAVORITES_KEY)
      .reduce((n, row) => n + row.count, 0);
    expect(all).toBe(sum);
  });
});

describe('buildSourceTree — level 2 grouping', () => {
  it('groups Windows by folder, with Uncategorized last', () => {
    const tree = buildSourceTree({
      population: [
        task({ category: 'AI-Tools' }),
        task({ category: 'AI-Maintenance' }),
        task({ category: 'AI-Tools' }),
        task({ category: '' })
      ],
      filters: filters()
    });

    const windows = find(tree, 'Windows Task Scheduler')!;
    expect(labels(windows.children)).toEqual(['AI-Maintenance', 'AI-Tools', UNCATEGORIZED]);
    expect(find(tree, 'AI-Tools')!.count).toBe(2);
  });

  it('groups Cronsole-native by job type, not by folder', () => {
    const tree = buildSourceTree({
      population: [
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:HTTP', category: 'Monitoring' }),
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:EXEC', category: 'Monitoring' }),
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:EXEC', category: 'Backups' })
      ],
      filters: filters()
    });

    const native = find(tree, 'Cronsole (Native)')!;
    // Job type, and labelled by subtype alone — the parent already says Cronsole.
    // Alphabetical, so the list order is not the order they happened to ship in.
    expect(labels(native.children)).toEqual(['Checks', 'HTTP jobs', 'Programs', 'Scripts']);
    expect(find(tree, 'Programs')!.count).toBe(2);
    // And it patches the source, not the category — the two groupings are
    // genuinely different dimensions.
    expect(find(tree, 'Programs')!.patch).toEqual({
      source: 'TASKHUB_NATIVE:EXEC',
      category: 'All',
      favorites: 'any',
      collection: 'All'
    });
  });

  it('lists every native job type even when none has tasks', () => {
    // Structure, not data: native has exactly four job types, always. *Checks*
    // disappearing because you have written no checks yet reads as a missing
    // feature rather than an empty bucket — and the rail is navigation, so an
    // empty destination still needs a route to it.
    const tree = buildSourceTree({
      population: [
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:HTTP' })
      ],
      filters: filters()
    });

    const native = find(tree, 'Cronsole (Native)')!;
    expect(labels(native.children)).toEqual(['Checks', 'HTTP jobs', 'Programs', 'Scripts']);
    expect(find(tree, 'Checks')!.count).toBe(0);
    expect(find(tree, 'Scripts')!.count).toBe(0);
    expect(find(tree, 'Programs')!.count).toBe(0);
  });

  it('routes the new job types to their own source keys', () => {
    const tree = buildSourceTree({
      population: [
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:SCRIPT' }),
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:CHECK' }),
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:CHECK' })
      ],
      filters: filters()
    });

    expect(find(tree, 'Scripts')!.count).toBe(1);
    expect(find(tree, 'Checks')!.count).toBe(2);
    expect(find(tree, 'Checks')!.patch).toEqual({
      source: 'TASKHUB_NATIVE:CHECK',
      category: 'All',
      favorites: 'any',
      collection: 'All'
    });
  });
});

describe('buildSourceTree — the \\Microsoft\\ group', () => {
  const withSystem = (over: Partial<TaskFilters> = {}) =>
    buildSourceTree({
      population: [
        task({ category: 'AI-Tools' }),
        task({ category: 'Microsoft\\Windows\\Defrag', isSystem: true }),
        task({ category: 'Microsoft\\Windows\\Defrag', isSystem: true }),
        task({ category: 'Microsoft\\Windows\\Chkdsk', isSystem: true })
      ],
      filters: filters(over)
    });

  it('collects system tasks into one collapsed group at the bottom', () => {
    const windows = find(withSystem(), 'Windows Task Scheduler')!;
    const last = windows.children!.at(-1)!;

    expect(last.label).toContain('System');
    expect(last.count).toBe(3);
    expect(labels(last.children)).toEqual([
      'Microsoft\\Windows\\Chkdsk',
      'Microsoft\\Windows\\Defrag'
    ]);
  });

  it('is a disclosure, not a selection — it never writes system: only', () => {
    const windows = find(withSystem(), 'Windows Task Scheduler')!;
    const group = windows.children!.at(-1)!;

    // No patch at all: the rail must not become a third controller of the
    // system lens alongside the Filters drawer and the System view.
    expect(group.patch).toBeUndefined();
    // Its children include rather than isolate — and clear the starred scope,
    // like every other selectable rail node.
    expect(group.children![0].patch).toEqual({
      source: 'WINDOWS_TASK_SCHEDULER',
      category: 'Microsoft\\Windows\\Chkdsk',
      favorites: 'any',
      collection: 'All',
      system: 'include'
    });
  });

  it('excludes system tasks from the source count while the lens hides them', () => {
    const windows = find(withSystem(), 'Windows Task Scheduler')!;
    // One personal task. The 3 system ones are counted by their own group, which
    // says so — two labelled disjoint buckets, not one number over two lenses.
    expect(windows.count).toBe(1);
    // The disclosure is the `withheld` flag, which the rail renders as a badge.
    // It is deliberately NOT folded into the label — as text it wrapped the row
    // onto two lines among single-line siblings.
    expect(windows.children!.at(-1)!.withheld).toBe(true);
  });

  it('includes them in the source count once the lens shows them', () => {
    // Otherwise the row promises 1 and the click delivers 4.
    const windows = find(withSystem({ system: 'include' }), 'Windows Task Scheduler')!;
    expect(windows.count).toBe(4);
    expect(windows.children!.at(-1)!.withheld).toBeFalsy();
  });

  it('omits the group entirely when there are no system tasks', () => {
    const tree = buildSourceTree({ population: [task()], filters: filters() });
    const windows = find(tree, 'Windows Task Scheduler')!;
    expect(labels(windows.children)).toEqual(['AI-Tools']);
  });
});

describe('isRailNodeSelected', () => {
  const tree = () =>
    buildSourceTree({
      population: [task({ category: 'AI-Tools' }), task({ category: 'AI-Maintenance' })],
      filters: filters()
    });

  it('matches on exactly the dimensions the node sets', () => {
    const folder = find(tree(), 'AI-Tools')!;
    expect(
      isRailNodeSelected(
        folder,
        filters({ source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Tools' })
      )
    ).toBe(true);
    // A different folder in the same source is not this node.
    expect(
      isRailNodeSelected(
        folder,
        filters({ source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' })
      )
    ).toBe(false);
  });

  it('does not care about dimensions the node leaves alone', () => {
    // Narrowing by search or status must not un-light the folder you are in.
    const folder = find(tree(), 'AI-Tools')!;
    expect(
      isRailNodeSelected(
        folder,
        filters({ source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Tools', search: 'backup' })
      )
    ).toBe(true);
  });

  it('never selects a disclosure group', () => {
    const withSys = buildSourceTree({
      population: [task({ category: 'Sys', isSystem: true })],
      filters: filters()
    });
    const group = find(withSys, 'Windows Task Scheduler')!.children!.at(-1)!;
    expect(isRailNodeSelected(group, filters({ system: 'only' }))).toBe(false);
  });
});

describe('expandedSourceFor', () => {
  it('is null for All sources', () => {
    expect(expandedSourceFor(filters())).toBeNull();
  });

  it('resolves a subtype to its platform row', () => {
    expect(expandedSourceFor(filters({ source: 'TASKHUB_NATIVE:EXEC' }))).toBe('TASKHUB_NATIVE');
  });
});

describe('buildSourceTree — collections', () => {
  const claude = () =>
    task({ platform: 'CLAUDE_CODE', source: 'CLAUDE_CODE', category: 'Claude' });

  it('lists a collection whether or not anything is in it', () => {
    // The STRUCTURAL_SUBTYPES rule, not the folder rule. A collection is
    // *declared*, so an empty one is a real place the user made and named — and
    // it is exactly where they need to navigate to put the first task in it.
    const tree = buildSourceTree({
      population: [task()],
      filters: filters(),
      collections: [{ id: 'c1', name: 'Empty set' }]
    });

    const row = find(tree, 'Empty set')!;
    expect(row).toBeDefined();
    expect(row.count).toBe(0);
  });

  it('counts only its members, across platforms', () => {
    const a = task({ collectionIds: ['c1'] });
    const b = claude();
    (b as Task).collectionIds = ['c1'];
    const tree = buildSourceTree({
      population: [a, b, task()],
      filters: filters(),
      collections: [{ id: 'c1', name: 'View2' }]
    });

    // Two members from two different platforms — the whole point of the feature.
    expect(find(tree, 'View2')!.count).toBe(2);
  });

  it('resets every other rail dimension when selected', () => {
    const tree = buildSourceTree({
      population: [task()],
      filters: filters({ source: 'WINDOWS_TASK_SCHEDULER', favorites: 'only' }),
      collections: [{ id: 'c1', name: 'View2' }]
    });

    // A collection spans systems, so selecting one cannot leave a source or a
    // star narrowing it — the heading would name the collection over a list
    // filtered by something it does not mention.
    expect(find(tree, 'View2')!.patch).toEqual({
      source: 'All',
      category: 'All',
      favorites: 'any',
      collection: 'c1'
    });
  });

  it('clears the collection when any other rail row is picked', () => {
    const tree = buildSourceTree({
      population: [task()],
      filters: filters({ collection: 'c1' }),
      collections: [{ id: 'c1', name: 'View2' }]
    });

    // Every node states the whole rail scope, so a collection cannot survive a
    // click that does not mention it.
    expect(find(tree, 'Windows Task Scheduler')!.patch).toMatchObject({ collection: 'All' });
    expect(tree[0].patch).toMatchObject({ collection: 'All' });
    expect(find(tree, 'AI-Tools')!.patch).toMatchObject({ collection: 'All' });
  });

  it('is selected only when its own id is the one in force', () => {
    const collections = [
      { id: 'c1', name: 'One' },
      { id: 'c2', name: 'Two' }
    ];
    const tree = buildSourceTree({
      population: [task()],
      filters: filters({ collection: 'c1' }),
      collections
    });

    expect(isRailNodeSelected(find(tree, 'One')!, filters({ collection: 'c1' }))).toBe(true);
    expect(isRailNodeSelected(find(tree, 'Two')!, filters({ collection: 'c1' }))).toBe(false);
    // And "All sources" must NOT light up while a collection is selected.
    expect(isRailNodeSelected(tree[0], filters({ collection: 'c1' }))).toBe(false);
  });
});

describe('pinned rail locations', () => {
  const pin = (over: Partial<RailPin> = {}): RailPin => ({
    id: 'pin-1',
    nodeKey: 'WINDOWS_TASK_SCHEDULER/AI-Maintenance',
    label: 'AI-Maintenance',
    patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' },
    ...over
  });

  /**
   * The whole reason a pin is not a snapshot: it has to keep agreeing with the
   * folder. Asserted as *one* number read twice rather than two numbers compared,
   * because the failure this guards against is a second tally drifting from the
   * first.
   */
  it('reads the same count as the folder it mirrors, and follows it as it grows', () => {
    const before = buildSourceTree({
      population: [
        task({ category: 'AI-Maintenance' }),
        task({ category: 'AI-Maintenance' }),
        task({ category: 'AI-Tools' })
      ],
      filters: filters(),
      pins: [pin()]
    });
    expect(find(before, 'AI-Maintenance')!.count).toBe(2);

    const after = buildSourceTree({
      population: [
        task({ category: 'AI-Maintenance' }),
        task({ category: 'AI-Maintenance' }),
        task({ category: 'AI-Maintenance' }),
        task({ category: 'AI-Tools' })
      ],
      filters: filters(),
      pins: [pin()]
    });
    // The pin row, not the folder row — both exist and both must say 3.
    expect(after.find(n => n.key === 'pin:pin-1')!.count).toBe(3);
    expect(find(after, 'AI-Maintenance')!.count).toBe(3);
  });

  it('survives its folder vanishing — reads 0 and keeps a patch you can still click', () => {
    const tree = buildSourceTree({
      population: [task({ category: 'AI-Tools' })],
      filters: filters(),
      pins: [pin()]
    });

    const row = tree.find(n => n.key === 'pin:pin-1')!;
    expect(row.count).toBe(0);
    expect(row.label).toBe('AI-Maintenance');
    expect(row.patch).toMatchObject({
      source: 'WINDOWS_TASK_SCHEDULER',
      category: 'AI-Maintenance'
    });
  });

  it('resets the whole rail scope like every other node', () => {
    const tree = buildSourceTree({
      population: [task({ category: 'AI-Maintenance' })],
      filters: filters({ collection: 'c1', favorites: 'only' }),
      pins: [pin()]
    });

    // Picking a pin must not leave you inside a collection the heading no
    // longer mentions — RAIL_SCOPE_RESET, same as a folder row.
    expect(tree.find(n => n.key === 'pin:pin-1')!.patch).toMatchObject({
      collection: 'All',
      favorites: 'any'
    });
  });

  it('sits in its own band, between the collections and the sources', () => {
    const tree = buildSourceTree({
      population: [task({ category: 'AI-Maintenance' })],
      filters: filters(),
      collections: [{ id: 'c1', name: 'Morning checks' }],
      pins: [pin()]
    });

    // A pin is NOT classified as a collection — that split is what gives the
    // two their own headed, separately foldable sections.
    expect(tree.map(n => railSectionOf(n.key))).toEqual([
      'scope',
      'scope',
      'collection',
      'pinned',
      'source'
    ]);
  });

  it('follows a rename rather than printing the name it was pinned under', () => {
    // Same folder key, different label on the node — the pin shows today's name.
    const tree = buildSourceTree({
      population: [task({ category: 'AI-Maintenance' })],
      filters: filters(),
      pins: [pin({ label: 'the name it had last month' })]
    });

    expect(tree.find(n => n.key === 'pin:pin-1')!.label).toBe('AI-Maintenance');
  });
});
