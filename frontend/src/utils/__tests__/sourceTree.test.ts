import { describe, it, expect } from 'vitest';
import {
  buildSourceTree,
  isRailNodeSelected,
  expandedSourceFor,
  ALL_SOURCES,
  FAVORITES_KEY,
  UNCATEGORIZED,
  type RailNode
} from '../sourceTree';
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
    // It narrows the starred dimension and resets the rail's other two — it does
    // NOT rewrite status or system. Composing with the lit view is the whole
    // point of it being a rail row rather than a view of its own.
    expect(fav.patch).toEqual({ source: 'All', category: 'All', favorites: 'only' });
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
    expect(labels(native.children)).toEqual(['HTTP jobs', 'Scripts']);
    expect(find(tree, 'Scripts')!.count).toBe(2);
    // And it patches the source, not the category — the two groupings are
    // genuinely different dimensions.
    expect(find(tree, 'Scripts')!.patch).toEqual({
      source: 'TASKHUB_NATIVE:EXEC',
      category: 'All',
      favorites: 'any'
    });
  });

  it('lists both native job types even when one has no tasks', () => {
    // Structure, not data: native has exactly two job types, always. *Scripts*
    // disappearing because you have written no script tasks yet reads as a
    // missing feature rather than an empty bucket — and the rail is navigation,
    // so an empty destination still needs a route to it.
    const tree = buildSourceTree({
      population: [
        task({ platform: 'TASKHUB_NATIVE', source: 'TASKHUB_NATIVE:HTTP' })
      ],
      filters: filters()
    });

    const native = find(tree, 'Cronsole (Native)')!;
    expect(labels(native.children)).toEqual(['HTTP jobs', 'Scripts']);
    expect(find(tree, 'Scripts')!.count).toBe(0);
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
