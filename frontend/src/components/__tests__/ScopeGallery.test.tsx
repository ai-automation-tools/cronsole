import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ToastProvider } from '../../hooks/ToastProvider';
import { CollectionsGallery, PinnedGallery } from '../ScopeGallery';
import type { RailNode } from '../../utils/sourceTree';

const PIN: RailNode = {
  key: 'pin:pin-1',
  label: 'AI-Maintenance',
  count: 3,
  patch: { source: 'WINDOWS_TASK_SCHEDULER', category: 'AI-Maintenance' }
};

const renderGallery = (nodes: RailNode[]) => {
  const props = { nodes, onSelect: vi.fn(), onTogglePin: vi.fn(), onReorder: vi.fn() };
  render(<ToastProvider><PinnedGallery {...props} /></ToastProvider>);
  return props;
};

describe('PinnedGallery', () => {
  it('opens the pinned folder on click', () => {
    const props = renderGallery([PIN]);
    fireEvent.click(screen.getByRole('button', { name: /^Open AI-Maintenance, 3 tasks$/ }));
    expect(props.onSelect).toHaveBeenCalledWith(PIN.patch);
    expect(screen.getByText('Windows Task Scheduler')).toBeInTheDocument();
  });

  it('unpins from the card — the only surface left once the folder is gone', () => {
    const props = renderGallery([{ ...PIN, count: 0 }]);
    expect(screen.getByText(/the folder is empty or gone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Unpin AI-Maintenance$/ }));
    expect(props.onTogglePin).toHaveBeenCalledWith(expect.objectContaining({ key: 'pin:pin-1' }));
  });

  it('copies a link to the folder, and offers no rename', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderGallery([PIN]);
    fireEvent.click(screen.getByRole('button', { name: /copy link to AI-Maintenance/i }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const url = new URL(writeText.mock.calls[0][0]);
    expect(url.searchParams.get('category')).toBe('AI-Maintenance');
    expect(screen.queryByRole('button', { name: /rename/i })).toBeNull();
  });

  it('says how to pin when nothing is pinned', () => {
    renderGallery([]);
    expect(screen.getByText(/keeps\s+tracking the folder/)).toBeInTheDocument();
  });
});

const COLLECTION: RailNode = {
  key: 'collection:c1',
  label: 'Morning checks',
  count: 4,
  patch: { collection: 'c1' }
};

describe('CollectionsGallery', () => {
  const renderCollections = (nodes: RailNode[]) => {
    const props = { nodes, onSelect: vi.fn(), onReorder: vi.fn(), onManage: vi.fn() };
    render(<ToastProvider><CollectionsGallery {...props} /></ToastProvider>);
    return props;
  };

  it('opens a collection on click', () => {
    const props = renderCollections([COLLECTION]);
    fireEvent.click(screen.getByRole('button', { name: /^Open Morning checks, 4 tasks$/ }));
    expect(props.onSelect).toHaveBeenCalledWith(COLLECTION.patch);
  });

  it('renames through the manager, and offers the manager itself', () => {
    const props = renderCollections([COLLECTION]);
    fireEvent.click(screen.getByRole('button', { name: /^Rename Morning checks$/ }));
    expect(props.onManage).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: /new or manage collections/i }));
    expect(props.onManage).toHaveBeenLastCalledWith();
  });

  it('offers to make the first collection when there are none', () => {
    const props = renderCollections([]);
    fireEvent.click(screen.getByRole('button', { name: /^New collection$/ }));
    expect(props.onManage).toHaveBeenCalledTimes(1);
  });
});
