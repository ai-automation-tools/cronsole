import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';
import { SyncMenu } from '../SyncMenu';

/**
 * Sync's two gestures.
 *
 * The one that matters is that they stay two. A refresh (`scope: 'tracked'`)
 * and an adopt (`{ categories }`) are different requests with different
 * consequences — the second forgets the untracks inside the folders it names —
 * so a control that quietly ran both would undo deliberate removals on every
 * routine sync.
 */
describe('SyncMenu', () => {
  const renderMenu = (isSyncing = false) => {
    const onRefresh = vi.fn();
    const onAddSources = vi.fn();
    render(<SyncMenu onRefresh={onRefresh} onAddSources={onAddSources} isSyncing={isSyncing} />);
    return { onRefresh, onAddSources };
  };

  it('refreshes on the primary click, and adopts nothing', () => {
    const { onRefresh, onAddSources } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Sync$/ }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onAddSources).not.toHaveBeenCalled();
  });

  it('opens the folder picker only from the menu', () => {
    const { onRefresh, onAddSources } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Sync options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add tasks from this machine/ }));

    expect(onAddSources).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('offers the plain refresh in the menu too, named for what it does not do', () => {
    const { onRefresh } = renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Sync options' }));

    const refresh = screen.getByRole('menuitem', { name: /Refresh tracked tasks/ });
    expect(refresh).toHaveTextContent(/Adds nothing new/);
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('says nothing is created before the picker is opened', () => {
    // The consequence used to live in the chooser this replaced. It has to
    // survive the move, or the split loses the thing that made it honest.
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Sync options' }));
    expect(screen.getByText(/Nothing is created/)).toBeInTheDocument();
  });

  it('closes the menu once a choice is made', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Sync options' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add tasks from this machine/ }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('disables both halves while a sync is in flight', () => {
    renderMenu(true);
    expect(screen.getByRole('button', { name: /Syncing/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sync options' })).toBeDisabled();
  });
});
