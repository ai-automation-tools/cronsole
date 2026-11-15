import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { moveKey } from '../utils/railOrder';
import type { RailSection } from '../utils/sourceTree';

/**
 * Props a reorderable row's `<li>` spreads. Named so the hook can return an
 * empty object for a band that cannot reorder without the two shapes diverging.
 */
export interface DragProps {
  draggable?: boolean;
  onDragStart?: (e: DragEvent<HTMLLIElement>) => void;
  onDragOver?: (e: DragEvent<HTMLLIElement>) => void;
  onDragLeave?: () => void;
  onDrop?: (e: DragEvent<HTMLLIElement>) => void;
  onDragEnd?: () => void;
  onKeyDown?: (e: KeyboardEvent<HTMLLIElement>) => void;
  className?: string;
}

/**
 * **Drag one band's rows into the order you want**, with a keyboard path.
 *
 * Native HTML5 drag-and-drop rather than a library: the rail reorders a flat
 * list of at most a few dozen rows inside one container, which is the exact case
 * the platform already handles, and a drag library is a dependency plus a
 * provider plus a sensor config to do it. What the platform does *not* give is a
 * keyboard path — HTML5 DnD has none at all — so **Alt+Arrow moves the focused
 * row**, which is the half that would otherwise make this control mouse-only.
 * That is not a nicety here: the rail is the app's navigation, and a
 * navigation preference you cannot set without a pointer is one a keyboard user
 * simply does not have.
 *
 * A drop means *the dragged row takes the target's index* — the same thing
 * Alt+Arrow does one step at a time, so the two gestures cannot disagree about
 * what a move is. Order is written by the caller, never here: this hook knows
 * two rows swapped, and `onReorder` knows where that fact is kept.
 *
 * ponytail: touch is left out — HTML5 DnD does not fire for a finger and the
 * keyboard path needs a keyboard, so the rail is arranged on a desktop and the
 * order (a synced preference) is what the phone reads. Add pointer-event
 * dragging if anyone ever wants to arrange a sidebar from a phone.
 *
 * Returns no props at all for a band of fewer than two rows or one whose caller
 * passed no handler — a single row that can be picked up and dropped on itself
 * is an affordance that promises something it cannot do.
 */
export function useBandReorder(
  section: RailSection,
  keys: string[],
  onReorder?: (section: RailSection, keys: string[]) => void
): (key: string) => DragProps {
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const enabled = !!onReorder && keys.length > 1;

  const move = (from: string, to: string) => {
    const next = moveKey(keys, from, to);
    // `moveKey` returns the same array when nothing moved — a drop on yourself,
    // or on a row that has gone since the drag began. Reporting that would push
    // a write for a change that did not happen.
    if (next !== keys) onReorder?.(section, next);
  };

  return (key: string) => {
    if (!enabled) return {};
    return {
      draggable: true,
      onDragStart: e => {
        dragging.current = key;
        e.dataTransfer.effectAllowed = 'move';
        // Set *something*: Firefox starts no drag at all without payload, and
        // it doubles as the fallback when `dragging` is lost to a re-render.
        e.dataTransfer.setData('text/plain', key);
      },
      onDragOver: e => {
        // Preventing the default is what makes this a drop target — without it
        // the row rejects every drag and the whole gesture silently no-ops.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (over !== key) setOver(key);
      },
      onDragLeave: () => setOver(prev => (prev === key ? null : prev)),
      onDrop: e => {
        e.preventDefault();
        move(dragging.current ?? e.dataTransfer.getData('text/plain'), key);
        dragging.current = null;
        setOver(null);
      },
      onDragEnd: () => {
        dragging.current = null;
        setOver(null);
      },
      onKeyDown: e => {
        // Alt-modified, so the arrows keep meaning "move the caret / scroll" in
        // every other context and this cannot shadow a browser or screen-reader
        // binding. Bubbles up from the row's own button, which is what holds
        // focus.
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
        const i = keys.indexOf(key);
        const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= keys.length) return;
        e.preventDefault();
        move(key, keys[j]);
      },
      className: `cursor-grab active:cursor-grabbing rounded-xl ${
        over === key ? 'ring-1 ring-ring/60' : ''
      }`
    };
  };
}

/** Merge a reorder hook's props with a row's own class, rather than letting one replace the other. */
export const withClass = (props: DragProps, cls: string): DragProps => ({
  ...props,
  className: `${cls} ${props.className ?? ''}`
});

