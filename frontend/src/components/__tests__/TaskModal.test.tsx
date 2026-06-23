import { render, screen, fireEvent } from '@testing-library/react';
import { TaskModal } from '../TaskModal';
import type { Task } from '../../types';
import { vi, describe, it, expect } from 'vitest';

const mockTask: Task = {
  id: 'task-123',
  name: 'Test Modal Task',
  externalId: 'test-external-id',
  platform: 'CLAUDE_TASK_FLEET',
  status: 'ACTIVE',
  category: 'Automation',
  updatedAt: '2026-06-23T11:00:00Z',
  metadata: { cron: '0 0 * * *', command: 'node test.js' }
};

describe('TaskModal Component', () => {
  it('renders nothing when task is null', () => {
    const { container } = render(
      <TaskModal 
        task={null} 
        onClose={vi.fn()} 
        onRun={vi.fn()} 
        onCategoryUpdate={vi.fn()} 
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders task metadata and details when task is provided', () => {
    render(
      <TaskModal 
        task={mockTask} 
        onClose={vi.fn()} 
        onRun={vi.fn()} 
        onCategoryUpdate={vi.fn()} 
      />
    );

    expect(screen.getByText('Test Modal Task')).toBeInTheDocument();
    expect(screen.getByText('test-external-id')).toBeInTheDocument();
    expect(screen.getByText('CLAUDE_TASK_FLEET')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
    
    // Check that metadata is formatted and displayed
    expect(screen.getByText(/"cron": "0 0 \* \* \*"/)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <TaskModal 
        task={mockTask} 
        onClose={onClose} 
        onRun={vi.fn()} 
        onCategoryUpdate={vi.fn()} 
      />
    );

    const closeBtn = container.querySelector('header button');
    expect(closeBtn).toBeInTheDocument();
    if (closeBtn) {
      fireEvent.click(closeBtn);
    }
    expect(onClose).toHaveBeenCalled();
  });

  it('triggers onRun and onClose when Run Now is clicked', () => {
    const onRun = vi.fn();
    const onClose = vi.fn();
    render(
      <TaskModal 
        task={mockTask} 
        onClose={onClose} 
        onRun={onRun} 
        onCategoryUpdate={vi.fn()} 
      />
    );

    const runBtn = screen.getByText('Run Now');
    fireEvent.click(runBtn);

    expect(onRun).toHaveBeenCalledWith(mockTask);
    expect(onClose).toHaveBeenCalled();
  });

  it('allows changing category and clicking Save to update', () => {
    const onCategoryUpdate = vi.fn();
    render(
      <TaskModal 
        task={mockTask} 
        onClose={vi.fn()} 
        onRun={vi.fn()} 
        onCategoryUpdate={onCategoryUpdate} 
      />
    );

    // Click "Change" button
    const changeBtn = screen.getByText('Change');
    fireEvent.click(changeBtn);

    // Get the input textbox
    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Automation');

    // Change input value
    fireEvent.change(input, { target: { value: 'NewCategoryVal' } });

    // Click "Save"
    const saveBtn = screen.getByText('Save');
    fireEvent.click(saveBtn);

    expect(onCategoryUpdate).toHaveBeenCalledWith('task-123', 'NewCategoryVal');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('allows canceling category edit', () => {
    const onCategoryUpdate = vi.fn();
    render(
      <TaskModal 
        task={mockTask} 
        onClose={vi.fn()} 
        onRun={vi.fn()} 
        onCategoryUpdate={onCategoryUpdate} 
      />
    );

    // Click "Change"
    fireEvent.click(screen.getByText('Change'));

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'NewCategoryVal' } });

    // Click "Cancel"
    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    expect(onCategoryUpdate).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
  });
});
