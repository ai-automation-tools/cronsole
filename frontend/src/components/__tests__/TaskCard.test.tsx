import { render, screen, fireEvent } from '@testing-library/react';
import { TaskCard } from '../TaskCard';
import type { Task } from '../../types';
import { vi, describe, it, expect } from 'vitest';

const mockTask: Task = {
  id: 'task-123',
  name: 'Test Schedule Task',
  externalId: 'test-external-id',
  platform: 'WINDOWS_TASK_SCHEDULER',
  status: 'ACTIVE',
  category: 'Backup',
  updatedAt: '2026-06-23T11:00:00Z',
  metadata: {}
};

describe('TaskCard Component', () => {
  it('renders task details correctly', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    const onCategoryUpdate = vi.fn();
    const onClone = vi.fn();

    render(
      <TaskCard 
        task={mockTask} 
        onSelect={onSelect} 
        onRun={onRun} 
        onCategoryUpdate={onCategoryUpdate} 
        onClone={onClone}
      />
    );

    expect(screen.getByText('Test Schedule Task')).toBeInTheDocument();
    expect(screen.getByText('test-external-id')).toBeInTheDocument();
    expect(screen.getByText('Backup')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
  });

  it('triggers onSelect when the card is clicked', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    const onCategoryUpdate = vi.fn();
    const onClone = vi.fn();

    render(
      <TaskCard 
        task={mockTask} 
        onSelect={onSelect} 
        onRun={onRun} 
        onCategoryUpdate={onCategoryUpdate} 
        onClone={onClone}
      />
    );

    fireEvent.click(screen.getByText('Test Schedule Task'));
    expect(onSelect).toHaveBeenCalledWith(mockTask);
  });

  it('triggers onRun when the run (play) button is clicked', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    const onCategoryUpdate = vi.fn();
    const onClone = vi.fn();

    render(
      <TaskCard 
        task={mockTask} 
        onSelect={onSelect} 
        onRun={onRun} 
        onCategoryUpdate={onCategoryUpdate} 
        onClone={onClone}
      />
    );

    const playButton = screen.getByTitle('Run Task');
    expect(playButton).toBeInTheDocument();
    fireEvent.click(playButton);

    expect(onRun).toHaveBeenCalledWith(mockTask);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('triggers onClone when the clone button is clicked', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    const onCategoryUpdate = vi.fn();
    const onClone = vi.fn();

    render(
      <TaskCard 
        task={mockTask} 
        onSelect={onSelect} 
        onRun={onRun} 
        onCategoryUpdate={onCategoryUpdate} 
        onClone={onClone}
      />
    );

    const cloneButton = screen.getByTitle('Clone Task');
    expect(cloneButton).toBeInTheDocument();
    fireEvent.click(cloneButton);

    expect(onClone).toHaveBeenCalledWith(mockTask);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('allows category editing and triggers onCategoryUpdate on Enter key', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    const onCategoryUpdate = vi.fn();
    const onClone = vi.fn();

    render(
      <TaskCard 
        task={mockTask} 
        onSelect={onSelect} 
        onRun={onRun} 
        onCategoryUpdate={onCategoryUpdate} 
        onClone={onClone}
      />
    );

    const categoryEl = screen.getByText('Backup');
    fireEvent.click(categoryEl);

    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('Backup');

    fireEvent.change(input, { target: { value: 'NewCategory' } });
    expect(input).toHaveValue('NewCategory');

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(onCategoryUpdate).toHaveBeenCalledWith('task-123', 'NewCategory');
  });

  it('cancels category editing on Escape key', () => {
    const onSelect = vi.fn();
    const onRun = vi.fn();
    const onCategoryUpdate = vi.fn();
    const onClone = vi.fn();

    render(
      <TaskCard 
        task={mockTask} 
        onSelect={onSelect} 
        onRun={onRun} 
        onCategoryUpdate={onCategoryUpdate} 
        onClone={onClone}
      />
    );

    const categoryEl = screen.getByText('Backup');
    fireEvent.click(categoryEl);

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'NewCategory' } });
    
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });

    expect(onCategoryUpdate).not.toHaveBeenCalled();
    expect(screen.getByText('Backup')).toBeInTheDocument();
  });
});
