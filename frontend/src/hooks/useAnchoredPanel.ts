import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Anchor a **portalled** panel to the control that opened it.
 *
 * This exists because of one CSS property. A popover rendered as an absolutely
 * positioned child can only be used where no ancestor clips it — and in this app
 * almost everything clips: the task list sits inside `overflow-hidden`, each
 * kanban column inside `overflow-y-auto`, and the task modal's own panel is
 * `overflow-hidden` too. That is why the collections control was reachable only
 * by opening a task while the star beside it sat on all five task surfaces, and
 * it is why anything else needing a menu would have hit the same wall.
 *
 * So the panel goes to `document.body` with `position: fixed`, and this hook
 * owns the consequences of that choice:
 *
 * - **Placement**, right-aligned to the trigger and clamped to the viewport.
 * - **Flipping above** when there is no room below — a menu that opens off the
 *   bottom of a phone is the same defect as a clipped one, reached differently.
 * - **Re-anchoring on scroll, in the capture phase**, because a fixed panel does
 *   not travel with the element it points at, and the scroll that moves it is
 *   usually an inner one (a list, a kanban column) that does not bubble.
 * - **Closing** on an outside click or Escape.
 *
 * Extracted from `TaskCollectionMenu` when a second control needed the same
 * behaviour. Copying it would have been four subtle things to get right twice,
 * and the copy that drifts is the one nobody notices — a menu that stops
 * flipping only misbehaves near the bottom of the screen.
 */

const GAP = 6;

export interface AnchoredPanelOptions {
  open: boolean;
  onClose: () => void;
  /** The control the panel points at. */
  triggerRef: React.RefObject<HTMLElement | null>;
  /** The panel itself — measured, so the flip decision uses its real height. */
  panelRef: React.RefObject<HTMLElement | null>;
  /** Fixed width, needed to clamp the left edge before the panel is measured. */
  width: number;
  /**
   * Values that change the panel's height. Placement is re-measured when they
   * move, or a panel that grew stays anchored where the shorter one fitted.
   */
  remeasure?: unknown[];
}

export function useAnchoredPanel({
  open,
  onClose,
  triggerRef,
  panelRef,
  width,
  remeasure = []
}: AnchoredPanelOptions): { top: number; left: number } | null {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Held in a ref so the effect below does not re-subscribe its listeners every
  // render just because the caller passed a new closure. Synced in an effect
  // rather than during render — a ref write during render is what makes a
  // component fail to update in ways nothing reports.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const place = useCallback(() => {
    const trigger = triggerRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const height = panelRef.current?.offsetHeight ?? 0;
    const left = Math.min(
      Math.max(GAP, trigger.right - width),
      window.innerWidth - width - GAP
    );
    const below = trigger.bottom + GAP;
    const flip = height > 0 && below + height > window.innerHeight && trigger.top - height - GAP > 0;
    setPos({ top: flip ? trigger.top - height - GAP : below, left });
  }, [triggerRef, panelRef, width]);

  // Measured after the panel exists, so the flip uses its real height rather
  // than a guess that would be wrong for every content length but one.
  useLayoutEffect(() => {
    if (open) place();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place, ...remeasure]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Both nodes, because the panel is no longer a descendant of the trigger.
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Stopped here so a task modal this menu lives inside does not also
        // close on the same keypress — the menu is the innermost thing open.
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    const onScroll = () => place();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, place, triggerRef, panelRef]);

  return pos;
}
