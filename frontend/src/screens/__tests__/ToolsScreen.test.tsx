import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ToolsScreen } from '../ToolsScreen';

/**
 * The property this pins is the one `ToolCard`'s removed per-card disclosure
 * used to guarantee: a tool nobody has selected never mounts (nine of the ten
 * real tools fire a query on mount), and a tool you switch away from stays
 * mounted — hidden, not unmounted — so work in progress survives. The sidebar
 * now owns exactly that, at the screen level instead of per card.
 *
 * Every real tool component is mocked to a stub that records its own mount
 * count, because the real ones each carry their own queries and this test's
 * job is which one is in the DOM, not what any of them render.
 */
// `vi.mock` below is hoisted above this file's own `import` statements (it
// has to run before `import { ToolsScreen }` resolves ToolsScreen's own
// dependency graph), so `stub` can't reference a statically-imported React —
// nothing has been imported yet. `require` still works because it resolves
// synchronously rather than waiting for module evaluation order.
//
// Counting happens in an effect, not the render body, because it needs to
// count *mounts*: a parent re-render invokes the same component instance
// again without unmounting it, which a counter incremented directly in the
// render body cannot tell apart from a real remount.
const { mountCounts, stub } = vi.hoisted(() => {
  const mountCounts: Record<string, number> = {};
  const stub = (id: string) => () => {
    require('react').useEffect(() => {
      mountCounts[id] = (mountCounts[id] ?? 0) + 1;
    }, []);
    return require('react').createElement('div', { 'data-testid': `stub-${id}` }, id);
  };
  return { mountCounts, stub };
});

vi.mock('../../components/tools/MassActionsTool', () => ({ MassActionsTool: stub('mass-actions') }));
vi.mock('../../components/tools/DiagnosticsTool', () => ({ DiagnosticsTool: stub('diagnostics') }));
vi.mock('../../components/tools/TaskHealthTool', () => ({ TaskHealthTool: stub('task-health') }));
vi.mock('../../components/tools/ExecutionAnalyticsTool', () => ({ ExecutionAnalyticsTool: stub('analytics') }));
vi.mock('../../components/tools/ScheduleTesterTool', () => ({ ScheduleTesterTool: stub('schedule-tester') }));
vi.mock('../../components/tools/BulkExportTool', () => ({ BulkExportTool: stub('backup') }));
vi.mock('../../components/tools/ImportTaskTool', () => ({ ImportTaskTool: stub('import-task') }));
vi.mock('../../components/tools/RestoreTool', () => ({ RestoreTool: stub('restore') }));
vi.mock('../../components/tools/RunHistoryTool', () => ({ RunHistoryTool: stub('run-history') }));
vi.mock('../../components/tools/ConnectPackTool', () => ({ ConnectPackTool: stub('connect-pack') }));

const renderTools = (initialPath = '/tools') => {
  Object.keys(mountCounts).forEach(k => delete mountCounts[k]);
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToolsScreen />
    </MemoryRouter>
  );
};

/** The sidebar renders twice (desktop + the mobile strip jsdom can't hide via
 *  media query), so every query is scoped to the desktop `nav`. */
const nav = () => screen.getByRole('navigation', { name: 'Tools' });

describe('ToolsScreen', () => {
  it('mounts only the default (first) tool, never the other nine', () => {
    renderTools();

    expect(screen.getByTestId('stub-mass-actions')).toBeVisible();
    expect(screen.queryByTestId('stub-restore')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stub-diagnostics')).not.toBeInTheDocument();
    expect(mountCounts['mass-actions']).toBe(1);
  });

  it('selects a tool from `?tool=` on load, falling back to the first for an unknown value', () => {
    renderTools('/tools?tool=restore');
    expect(screen.getByTestId('stub-restore')).toBeVisible();
    expect(screen.queryByTestId('stub-mass-actions')).not.toBeInTheDocument();

    renderTools('/tools?tool=not-a-real-tool');
    expect(screen.getByTestId('stub-mass-actions')).toBeVisible();
  });

  it('mounts a newly-selected tool and keeps the previous one mounted, hidden', () => {
    renderTools();

    fireEvent.click(within(nav()).getByRole('button', { name: 'Restore from backup' }));

    expect(screen.getByTestId('stub-restore')).toBeVisible();
    // Still in the DOM — not unmounted — just hidden.
    expect(screen.getByTestId('stub-mass-actions').parentElement).not.toBeVisible();
    expect(mountCounts['restore']).toBe(1);
    expect(mountCounts['mass-actions']).toBe(1); // not remounted
  });

  it('switching back to a previously-visited tool does not remount it', () => {
    renderTools();
    fireEvent.click(within(nav()).getByRole('button', { name: 'Restore from backup' }));
    fireEvent.click(within(nav()).getByRole('button', { name: 'Mass actions' }));

    expect(screen.getByTestId('stub-mass-actions')).toBeVisible();
    expect(screen.getByTestId('stub-restore').parentElement).not.toBeVisible();
    expect(mountCounts['mass-actions']).toBe(1);
    expect(mountCounts['restore']).toBe(1);
  });
});
