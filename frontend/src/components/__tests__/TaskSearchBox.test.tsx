import { act, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskSearchBox } from '../TaskSearchBox';

const box = () => screen.getByPlaceholderText(/Search tasks/) as HTMLInputElement;

describe('TaskSearchBox', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('keeps every key while the URL lags, and ignores the late echo of its own write', () => {
    const onCommit = vi.fn();
    const { rerender } = render(<TaskSearchBox value="" onCommit={onCommit} inputRef={createRef()} />);

    fireEvent.change(box(), { target: { value: 'ba' } });
    act(() => { vi.advanceTimersByTime(150); });
    expect(onCommit).toHaveBeenLastCalledWith('ba');

    // The user keeps typing before the URL catches up …
    fireEvent.change(box(), { target: { value: 'backup' } });
    // … then the URL lands with the older write. That was the wipe.
    rerender(<TaskSearchBox value="ba" onCommit={onCommit} inputRef={createRef()} />);
    expect(box().value).toBe('backup');

    act(() => { vi.advanceTimersByTime(150); });
    expect(onCommit).toHaveBeenLastCalledWith('backup');
  });

  it('takes a change made elsewhere (a clear button, a saved view)', () => {
    const { rerender } = render(<TaskSearchBox value="old" onCommit={vi.fn()} inputRef={createRef()} />);
    rerender(<TaskSearchBox value="" onCommit={vi.fn()} inputRef={createRef()} />);
    expect(box().value).toBe('');
  });

  it('clears on Escape at once, even with a write still pending', () => {
    const onCommit = vi.fn();
    render(<TaskSearchBox value="" onCommit={onCommit} inputRef={createRef()} />);
    fireEvent.change(box(), { target: { value: 'xyz' } });
    fireEvent.keyDown(box(), { key: 'Escape' });
    act(() => { vi.advanceTimersByTime(300); });
    expect(box().value).toBe('');
    expect(onCommit).not.toHaveBeenCalledWith('xyz');
  });
});
