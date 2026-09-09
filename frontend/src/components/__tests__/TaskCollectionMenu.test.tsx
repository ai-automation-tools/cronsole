import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TaskCollectionMenu } from '../TaskCollectionMenu';
import type { Task } from '../../types';
import { api } from '../../api';

vi.mock('../../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }
}));

const task = (over: Partial<Task> = {}): Task => ({
  id: 't1',
  name: 'Nightly backup',
  category: 'AI-Tools',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  externalId: '\\Cronsole\\nightly',
  updatedAt: '2026-08-15T00:00:00.000Z',
  ...over
});

const COLLECTIONS = [
  { id: 'c1', name: 'Morning checks', position: 0, taskIds: ['t1'], count: 1, createdAt: '', updatedAt: '' },
  { id: 'c2', name: 'Backups', position: 1, taskIds: [], count: 0, createdAt: '', updatedAt: '' }
];

const renderMenu = (props: Partial<Parameters<typeof TaskCollectionMenu>[0]> = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskCollectionMenu task={task()} {...props} />
    </QueryClientProvider>
  );
};

beforeEach(() => {
  vi.mocked(api.get).mockResolvedValue({ data: COLLECTIONS });
  vi.mocked(api.post).mockResolvedValue({ data: COLLECTIONS[1] });
});

describe('TaskCollectionMenu', () => {
  /**
   * The panel is portalled to `document.body` so it cannot be clipped by the
   * list view's `overflow-hidden` or a kanban column's `overflow-y-auto` — the
   * ancestors that limited this control to the task modal. Asserted through
   * `document.body` rather than the render container, because a panel that is
   * still a descendant of the trigger would pass a container-scoped query while
   * being invisible in exactly the two views this was added for.
   */
  it('renders its panel outside the trigger, so no ancestor can clip it', async () => {
    const { container } = renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /add nightly backup to a collection/i }));

    expect(await screen.findByText('Morning checks')).toBeInTheDocument();
    expect(container.querySelector('[role="button"] + div')).toBeNull();
    expect(container.textContent).not.toContain('Morning checks');
  });

  it('shows how many collections a task is already in', () => {
    renderMenu({ task: task({ collectionIds: ['c1', 'c2'] }) });

    // The count is on the control itself, so membership is legible from a task
    // row without opening anything.
    const button = screen.getByRole('button', { name: /is in 2 collections/i });
    expect(button).toHaveTextContent('2');
  });

  it('ticks a collection the task already belongs to, and unticking removes it', async () => {
    renderMenu({ task: task({ collectionIds: ['c1'] }) });
    fireEvent.click(screen.getByRole('button', { name: /is in 1 collection/i }));

    const member = await screen.findByRole('button', { name: /morning checks/i });
    expect(member).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /backups/i })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(member);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/collections/c1/members', { remove: ['t1'] })
    );
  });

  it('adds the task to a collection it is not in', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /add nightly backup to a collection/i }));

    fireEvent.click(await screen.findByRole('button', { name: /backups/i }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/collections/c2/members', { add: ['t1'] })
    );
  });

  it('creates a collection with the task already in it', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /add nightly backup to a collection/i }));

    fireEvent.click(await screen.findByRole('button', { name: /new collection/i }));
    fireEvent.change(screen.getByPlaceholderText('Collection name'), { target: { value: 'Weekly' } });
    fireEvent.click(screen.getByRole('button', { name: /create & add/i }));

    // One call, so a collection can never be created and then fail to receive
    // the task that motivated it.
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/collections', { name: 'Weekly', taskIds: ['t1'] })
    );
  });

  it('spells the action out in the labeled variant', () => {
    renderMenu({ variant: 'labeled' });
    expect(screen.getByRole('button', { name: /add nightly backup to a collection/i }))
      .toHaveTextContent('Add to collection');
  });

  it('names the empty state rather than showing an empty menu', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [] });
    renderMenu();

    fireEvent.click(screen.getByRole('button', { name: /add nightly backup to a collection/i }));
    expect(await screen.findByText(/a set of tasks you pick by hand/i)).toBeInTheDocument();
  });
});
