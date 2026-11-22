import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RailResizeHandle } from '../RailResizeHandle';
import { RAIL_WIDTH_DEFAULT, RAIL_WIDTH_MAX, RAIL_WIDTH_MIN } from '../../utils/railWidth';

const setup = (width = 300) => {
  const onResize = vi.fn();
  const onCommit = vi.fn();
  const onDraggingChange = vi.fn();
  render(
    <RailResizeHandle
      width={width}
      onResize={onResize}
      onCommit={onCommit}
      onDraggingChange={onDraggingChange}
    />
  );
  return { handle: screen.getByRole('separator', { name: /resize sidebar/i }), onResize, onCommit, onDraggingChange };
};

describe('RailResizeHandle', () => {
  it('states its value and limits, so it is a control and not only a pointer target', () => {
    const { handle } = setup(300);
    expect(handle).toHaveAttribute('aria-valuenow', '300');
    expect(handle).toHaveAttribute('aria-valuemin', String(RAIL_WIDTH_MIN));
    expect(handle).toHaveAttribute('aria-valuemax', String(RAIL_WIDTH_MAX));
  });

  it('steps with the arrows, further with Shift, and commits each step', () => {
    const { handle, onCommit } = setup(300);
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(handle, { key: 'ArrowLeft', shiftKey: true });
    expect(onCommit.mock.calls.map(c => c[0])).toEqual([316, 236]);
  });

  it('goes to the limits on Home/End and resets on Enter or double-click', () => {
    const { handle, onCommit } = setup(300);
    fireEvent.keyDown(handle, { key: 'Home' });
    fireEvent.keyDown(handle, { key: 'End' });
    fireEvent.keyDown(handle, { key: 'Enter' });
    fireEvent.doubleClick(handle);
    expect(onCommit.mock.calls.map(c => c[0])).toEqual([
      RAIL_WIDTH_MIN, RAIL_WIDTH_MAX, RAIL_WIDTH_DEFAULT, RAIL_WIDTH_DEFAULT
    ]);
  });

  it('follows the pointer live and persists once, on release', () => {
    const { handle, onResize, onCommit, onDraggingChange } = setup(300);
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 5000, pointerId: 1 });
    expect(onResize.mock.calls.map(c => c[0])).toEqual([350, RAIL_WIDTH_MAX]);
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 5000, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledExactlyOnceWith(RAIL_WIDTH_MAX);
    expect(onDraggingChange.mock.calls.map(c => c[0])).toEqual([true, false]);
    expect(document.body.style.cursor).toBe('');
  });
});
