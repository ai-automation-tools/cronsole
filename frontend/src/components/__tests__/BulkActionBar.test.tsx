import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { BulkActionBar } from '../BulkActionBar';

const renderBar = (over: Partial<React.ComponentProps<typeof BulkActionBar>> = {}) => {
  const props = {
    selectedCount: 3,
    offscreenCount: 0,
    enabledCount: 2,
    disabledCount: 1,
    onEnable: vi.fn(),
    onDisable: vi.fn(),
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
    const { onEnable, onDisable, onClear } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: /Enable 1 task/ }));
    fireEvent.click(screen.getByRole('button', { name: /Disable 2 tasks/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(onEnable).toHaveBeenCalled();
    expect(onDisable).toHaveBeenCalled();
    expect(onClear).toHaveBeenCalled();
  });

  it('blocks both actions while a bulk request is in flight', () => {
    // Each task is a round trip to an elevated agent; a second batch launched
    // over the first would interleave signed commands for no benefit.
    const { onEnable } = renderBar({ isPending: true });
    const enable = screen.getByRole('button', { name: /Enable 1 task/ });
    expect(enable).toBeDisabled();
    fireEvent.click(enable);
    expect(onEnable).not.toHaveBeenCalled();
  });
});
