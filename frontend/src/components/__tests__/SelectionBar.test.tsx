import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../hooks/ToastProvider';
import { SelectionBar } from '../SelectionBar';
import type { Task } from '../../types';

vi.mock('../../api', () => ({ api: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn() } }));

const task = (id: string): Task => ({
  id, name: id, externalId: id, platform: 'WINDOWS_TASK_SCHEDULER', status: 'ACTIVE',
  category: 'C', updatedAt: '2026-11-13T00:00:00Z', metadata: {}
});

const renderBar = (selected: Task[], shownCount: number) => {
  const props = { onSelectAll: vi.fn(), onClear: vi.fn(), onExit: vi.fn() };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <SelectionBar selected={selected} shownCount={shownCount} categories={[]} {...props} />
      </ToastProvider>
    </QueryClientProvider>
  );
  return props;
};

describe('SelectionBar', () => {
  it('offers Select all while anything shown is unselected', () => {
    const props = renderBar([task('a')], 3);
    fireEvent.click(screen.getByRole('button', { name: /Select all 3/ }));
    expect(props.onSelectAll).toHaveBeenCalled();
  });

  it('turns into Deselect all once everything shown is selected', () => {
    const props = renderBar([task('a'), task('b')], 2);
    fireEvent.click(screen.getByRole('button', { name: /Deselect all/ }));
    expect(props.onClear).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Select all/ })).toBeNull();
  });
});
