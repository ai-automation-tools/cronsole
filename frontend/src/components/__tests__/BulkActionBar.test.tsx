import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { BulkActionBar } from '../BulkActionBar';

const renderBar = (over: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) => {
  const props = {
    selectedCount: 3,
    offscreenCount: 0,
    enabledCount: 2,
    disabledCount: 1,
    untrackableCount: 3,
    exportableCount: 3,
    onEnable: vi.fn(),
    onDisable: vi.fn(),
    onRecategorize: vi.fn(),
    onUntrack: vi.fn(),
    onExport: vi.fn(),
    onClear: vi.fn(),
    isPending: false,
    ...over
  };
  render(<BulkActionBar {...props} />);
  return props;
};

describe('BulkActionBar', () => {
  it('stays out of the way when nothing is selected', () => {
    renderBar({ selectedCount: 0 });
    expect(screen.queryByRole('region', { name: 'Bulk actions' })).not.toBeInTheDocument();
  });

  it('states the selection size', () => {
    renderBar();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('says how many selected tasks the current view is not showing', () => {
    // The honesty rule this bar exists for: kanban shows disabled tasks the
    // other views hide, so a selection can outlive its visibility. Dropping
    // those members silently would be cheaper and dishonest.
    renderBar({ selectedCount: 12, offscreenCount: 3 });
    expect(screen.getByText(/3 not visible here/)).toBeInTheDocument();
  });

  it('says nothing about visibility when the whole selection is on screen', () => {
    renderBar({ offscreenCount: 0 });
    expect(screen.queryByText(/not visible here/)).not.toBeInTheDocument();
  });

  it('names what each button will change, not the selection size', () => {
    // Asking to enable 12 tasks of which 9 are already enabled is a 3-task
    // operation. Labelling it "Enable 12" is the same inflation the server's
    // `unchanged` outcome exists to avoid.
    renderBar({ selectedCount: 12, enabledCount: 9, disabledCount: 3 });
    expect(screen.getByRole('button', { name: /Enable 3 tasks/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Disable 9 tasks/ })).toBeInTheDocument();
  });

  it('disables Enable when every selected task is already enabled, and explains why', () => {
    renderBar({ selectedCount: 4, enabledCount: 4, disabledCount: 0 });
    const enable = screen.getByRole('button', { name: /already enabled/ });
    expect(enable).toBeDisabled();
    fireEvent.click(enable);
  });

  it('disables Disable when every selected task is already disabled', () => {
    renderBar({ selectedCount: 4, enabledCount: 0, disabledCount: 4 });
    expect(screen.getByRole('button', { name: /already disabled/ })).toBeDisabled();
  });

  it('fires the handlers', () => {
    const { onEnable, onDisable, onRecategorize, onUntrack, onExport, onClear } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Enable 1 task/ }));
    fireEvent.click(screen.getByRole('button', { name: /Disable 2 tasks/ }));
    fireEvent.click(screen.getByRole('button', { name: /Move 3 tasks into a category/ }));
    fireEvent.click(screen.getByRole('button', { name: /Remove 3 tasks from Cronsole/ }));
    fireEvent.click(screen.getByRole('button', { name: /Export 3 tasks as Task Scheduler XML/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onEnable).toHaveBeenCalled();
    expect(onDisable).toHaveBeenCalled();
    expect(onRecategorize).toHaveBeenCalled();
    expect(onUntrack).toHaveBeenCalled();
    expect(onExport).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('blocks every action while a bulk request is in flight', () => {
    // Each task can be a round trip to an elevated agent; a second batch
    // launched over the first would interleave signed commands for no benefit.
    const { onEnable, onUntrack, onExport } = renderBar({ isPending: true });
    for (const name of [/Enable 1 task/, /Remove 3 tasks from Cronsole/, /Export 3 tasks/]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(onEnable).not.toHaveBeenCalled();
    expect(onUntrack).not.toHaveBeenCalled();
    expect(onExport).not.toHaveBeenCalled();
  });

  it('never labels untrack as a plain "Remove"', () => {
    // The label is the only thing standing between this and the delete it is
    // deliberately not: removing 40 rows and destroying 40 real scheduled tasks
    // are one click apart and a world apart in consequence.
    renderBar();
    const untrack = screen.getByRole('button', { name: /Remove 3 tasks from Cronsole/ });
    expect(untrack).toHaveAccessibleName(/leaving them running on their platform/);
  });

  it('counts only the tasks each action can actually touch', () => {
    // A selection of 5 holding 2 Cronsole-native tasks is a 3-task untrack. The
    // same rule as Enable/Disable: promising 5 and delivering 3 is the inflation
    // the server's per-item reporting exists to avoid.
    renderBar({ selectedCount: 5, untrackableCount: 3, exportableCount: 2 });
    expect(screen.getByRole('button', { name: /Remove 3 tasks from Cronsole/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Export 2 tasks as Task Scheduler XML/ })).toBeInTheDocument();
  });

  it('disables untrack when nothing in the selection can be untracked, and says why', () => {
    renderBar({ selectedCount: 2, untrackableCount: 0 });
    const untrack = screen.getByRole('button', { name: /Cronsole-native tasks exist only here/ });
    expect(untrack).toBeDisabled();
  });

  it('disables export when nothing in the selection is a Windows task, and says why', () => {
    renderBar({ selectedCount: 2, exportableCount: 0 });
    expect(screen.getByRole('button', { name: /only Windows Task Scheduler tasks/i })).toBeDisabled();
  });

  it('never disables Categorize — it applies to every task and can refuse none', () => {
    renderBar({ selectedCount: 4, enabledCount: 0, disabledCount: 0, untrackableCount: 0, exportableCount: 0 });
    expect(screen.getByRole('button', { name: /Move 4 tasks into a category/ })).toBeEnabled();
  });
});
