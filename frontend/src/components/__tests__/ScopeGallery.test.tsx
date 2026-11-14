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
    expect(screen.getByText('Pinned · Windows Task Scheduler')).toBeInTheDocument();
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

  it('summarizes the tasks behind the card: sources, active, failed', () => {
    const task = (id: string, extra: object) => ({
      id, name: id, externalId: id, platform: 'WINDOWS_TASK_SCHEDULER', status: 'ACTIVE',
      category: 'AI-Maintenance', updatedAt: '2026-11-13T00:00:00Z', metadata: {}, ...extra
    });
    const members = [task('a', {}), task('b', { lastRunStatus: 'FAILURE' }), task('c', { status: 'DISABLED' })];
    render(
      <ToastProvider>
        <PinnedGallery nodes={[PIN]} onSelect={vi.fn()} onTogglePin={vi.fn()} onReorder={vi.fn()} membersOf={() => members as never} />
      </ToastProvider>
    );
    expect(screen.getByText(/2 active/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
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

  it('creates a collection from the New collection card', async () => {
    const onCreate = vi.fn().mockResolvedValue(true);
    render(
      <ToastProvider>
        <CollectionsGallery nodes={[COLLECTION]} onSelect={vi.fn()} onReorder={vi.fn()} onManage={vi.fn()} onCreate={onCreate} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: 'New collection' }));
    fireEvent.change(screen.getByLabelText('New collection'), { target: { value: '  Nightly  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));
    await vi.waitFor(() => expect(onCreate).toHaveBeenCalledWith('Nightly'));
  });

  it('deletes from the card, through the caller', () => {
    const onDelete = vi.fn();
    render(
      <ToastProvider>
        <CollectionsGallery nodes={[COLLECTION]} onSelect={vi.fn()} onReorder={vi.fn()} onManage={vi.fn()} onDelete={onDelete} />
      </ToastProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /^Delete Morning checks$/ }));
    expect(onDelete).toHaveBeenCalledWith('c1', 'Morning checks', 4);
  });

  it('opens a collection on click', () => {
    const props = renderCollections([COLLECTION]);
    fireEvent.click(screen.getByRole('button', { name: /^Open Morning checks, 4 tasks$/ }));
    expect(props.onSelect).toHaveBeenCalledWith(COLLECTION.patch);
  });

  it('renames through the manager, and offers the manager itself', () => {
    const props = renderCollections([COLLECTION]);
    fireEvent.click(screen.getByRole('button', { name: /^Rename Morning checks$/ }));
    expect(props.onManage).toHaveBeenCalledWith('c1');
    fireEvent.click(screen.getByRole('button', { name: /^manage collections$/i }));
    expect(props.onManage).toHaveBeenLastCalledWith();
  });

  it('offers to make the first collection when there are none', () => {
    const props = renderCollections([]);
    fireEvent.click(screen.getByRole('button', { name: /^New collection$/ }));
    expect(props.onManage).toHaveBeenCalledTimes(1);
  });
});
