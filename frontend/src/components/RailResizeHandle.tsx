import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import {
  clampRailWidth,
  RAIL_WIDTH_DEFAULT,
  RAIL_WIDTH_MAX,
  RAIL_WIDTH_MIN,
  RAIL_WIDTH_STEP,
  RAIL_WIDTH_STEP_LARGE
} from '../utils/railWidth';

interface RailResizeHandleProps {
  width: number;
  /** Every move — the panel follows the pointer live. */
  onResize: (px: number) => void;
  /** The gesture finished — the moment to persist. */
  onCommit: (px: number) => void;
  /** Drag started / ended, so the panel can drop its width transition meanwhile. */
  onDraggingChange?: (dragging: boolean) => void;
}

/**
 * The drag edge on the right of the source rail.
 *
 * A `separator` with a value, so it is a real control rather than a pointer-only
 * affordance: arrows step it (Shift for a bigger step), Home/End go to the
 * limits, and double-click or Enter puts it back to the default — the rail's
 * reorder already has a keyboard twin for the same reason.
 *
 * The visible line is 2px but the hit area is 8px, half of it over the page, so
 * the edge is easy to catch without the panel's own border moving.
 */
export const RailResizeHandle = ({
  width,
  onResize,
  onCommit,
  onDraggingChange
}: RailResizeHandleProps) => {
  const drag = useRef<{ startX: number; startWidth: number; last: number } | null>(null);

  const end = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    document.body.style.removeProperty('cursor');
    document.body.style.removeProperty('user-select');
    onDraggingChange?.(false);
    onCommit(d.last);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, last: width };
    // On the body, not the handle: the pointer leaves the 8px strip the moment
    // you drag fast, and a cursor that flickers back to an arrow reads as
    // having let go. Same for text selection across the task list.
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    onDraggingChange?.(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const next = clampRailWidth(d.startWidth + e.clientX - d.startX);
    if (next === d.last) return;
    d.last = next;
    onResize(next);
  };

  const set = (px: number) => {
    const w = clampRailWidth(px);
    onResize(w);
    onCommit(w);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? RAIL_WIDTH_STEP_LARGE : RAIL_WIDTH_STEP;
    const to: Record<string, number | undefined> = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      Home: RAIL_WIDTH_MIN,
      End: RAIL_WIDTH_MAX,
      Enter: RAIL_WIDTH_DEFAULT
    };
    const target = to[e.key];
    if (target === undefined) return;
    e.preventDefault();
    set(target);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={RAIL_WIDTH_MIN}
      aria-valuemax={RAIL_WIDTH_MAX}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => set(RAIL_WIDTH_DEFAULT)}
      onKeyDown={onKeyDown}
      className="group/resize absolute inset-y-0 -right-1 z-20 flex w-2 cursor-col-resize touch-none justify-center focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="h-full w-0.5 bg-transparent transition-colors group-hover/resize:bg-primary/60 group-focus-visible/resize:bg-primary group-active/resize:bg-primary"
      />
    </div>
  );
};
